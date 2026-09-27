import { getStaffAvailabilities, getRoomsByOrg, getMembersByOrg, db } from './db.js';
import { getCampaignDays, localDateStr, campaignConfig } from './utils.js';
import { choisirJury } from './jury.js';
import { buildCapacityMap, capaciteToutLeMonde, consommerStaff, slotKey } from './capacite.js';
import {
  collection, query, where, getDocs, writeBatch, doc, getDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/**
 * Algorithme de placement des entretiens : mode « dispos ».
 *
 * Utilisé quand `config.modeRdv === 'dispos'` : le cooptant dépose ses
 * disponibilités dans le formulaire, puis le bureau lance ce placement.
 * (Dans le mode « creneaux », le cooptant réserve lui-même et l'algo ne sert pas.)
 *
 * Principes :
 *  - greedy first-fit, candidats les plus contraints placés en premier
 *    (maximise le taux de placement global)
 *  - continuité des jurés : les créneaux sont pourvus dans l'ordre
 *    chronologique et les mêmes personnes enchaînent tant qu'elles n'ont pas
 *    atteint `config.maxEntretiensAffiles` (voir js/jury.js). Mieux vaut
 *    mobiliser deux membres trois heures que six membres une heure.
 *  - une salle ne peut accueillir qu'un entretien à la fois
 *  - idempotent : relancer nettoie les entretiens 'planifie' précédents,
 *    sans jamais toucher aux entretiens déjà réalisés
 *  - batches Firestore chunkés (max 490 ops)
 *
 * @param {string}   campaignId
 * @param {Function} onProgress callback(message: string)
 * @returns {Promise<{placed: number, failed: number}>}
 */
export async function runPlacementAlgorithm(campaignId, onProgress = () => {}) {
  onProgress('Chargement des données…');

  // ── 1. Configuration de l'asso ───────────────────────────────────
  const campDoc = await getDoc(doc(db, 'campaigns', campaignId));
  if (!campDoc.exists()) throw new Error('Espace de recrutement introuvable.');
  const campaign = { id: campDoc.id, ...campDoc.data() };
  const cfg      = campaignConfig(campaign);

  const dureeMinutes = cfg.dureeMinutes;
  const battement    = cfg.battementMinutes || 0;
  // Les champs jury en base sont jury1Id..jury3Id → 3 jurés assignables max.
  const nbJurys      = Math.max(1, Math.min(3, cfg.nbJurys));
  const orgId        = campaign.organizationId;

  // ── 2. Chargement parallèle ──────────────────────────────────────
  const [staffDispos, rooms] = await Promise.all([
    getStaffAvailabilities(campaignId),
    orgId ? getRoomsByOrg(orgId) : Promise.resolve([]),
  ]);

  // ── 3. Idempotence : reset du planning précédent ─────────────────
  onProgress('Nettoyage du planning précédent…');
  const resetCount = await resetPreviousPlanning(campaignId);
  if (resetCount > 0) onProgress(`↳ ${resetCount} entretien(s) précédent(s) supprimé(s).`);

  // ── 4. Candidats à placer (après reset) ──────────────────────────
  const allCandidates = await loadCandidates(campaignId);
  const pending = allCandidates.filter(c => c.statut === 'recu');

  if (!pending.length) {
    onProgress('Aucun cooptant à placer (statut « reçu »).');
    return { placed: 0, failed: 0 };
  }

  // ── 5. Fenêtre autorisée par le calendrier de l'asso ────────────
  //    Un créneau hors période (ou déjà passé) ne doit jamais être proposé.
  const allowedDays = new Set(getCampaignDays(campaign).map(localDateStr));
  if (!allowedDays.size) {
    onProgress('⚠️ La période d\'entretiens est terminée ou mal configurée.');
    return { placed: 0, failed: pending.length };
  }

  // ── 6. Capacity map ──────────────────────────────────────────────
  //    staff_availabilities.creneaux = [{jour:'YYYY-MM-DD', creneaux:['08:00',…]}]
  //
  //    Deux régimes : soit le staff a déclaré ses créneaux, soit l'asso a
  //    choisi de ne rien demander et tout le monde est réputé libre sur la
  //    période. Dans le second cas, c'est le cooptant qui impose l'horaire.
  let capacityMap;
  let nbJuresPotentiels = staffDispos.length;

  if (cfg.staffToujoursDispo) {
    const jures = await juresDeLOrg(orgId);
    nbJuresPotentiels = jures.length;
    capacityMap = capaciteToutLeMonde(jures, allowedDays, dureeMinutes, cfg.heureFin);
    onProgress(`Staff réputé disponible sur toute la période : ${jures.length} juré(s) mobilisable(s).`);
  } else {
    capacityMap = buildCapacityMap(staffDispos, nbJurys, allowedDays, dureeMinutes);
  }

  const slotCount = Object.keys(capacityMap).length;

  if (!slotCount) {
    onProgress(cfg.staffToujoursDispo
      ? '⚠️ Aucun juré : ajoute des membres, ou des noms dans la liste du staff.'
      : '⚠️ Aucune disponibilité staff exploitable : vérifie les dispos du bureau et la période.');
    return { placed: 0, failed: pending.length };
  }

  onProgress(
    `${nbJuresPotentiels} membre(s) staff · ${pending.length} cooptant(s) à placer · ` +
    `${slotCount} créneaux ouverts · ${nbJurys} juré(s) · ${dureeMinutes} min.`
  );

  // ── 7. Tri : candidats les plus contraints en premier ────────────
  const ranked = pending
    .map(c => ({
      candidate: c,
      slots: flattenCandidateDispo(c.disponibilites || [], allowedDays),
    }))
    .sort((a, b) => a.slots.length - b.slots.length);

  // ── 8. Greedy first-fit ──────────────────────────────────────────
  const assignments = [];
  const failReasons = [];
  let   failed      = 0;

  for (const { candidate, slots } of ranked) {
    if (!slots.length) {
      failed++;
      failReasons.push(`${candidate.prenom} ${candidate.nom} : aucune disponibilité renseignée`);
      continue;
    }
    let placed = false;
    for (const slotISO of slots) {
      const slot = capacityMap[slotISO];
      if (slot && slot.restant >= nbJurys) {
        assignments.push({ candidate, slotISO, slot });
        // Un entretien mobilise `nbJurys` personnes sur TOUS les créneaux qu'il
        // occupe, battement compris. Avant, le créneau débordé était mis à zéro
        // en entier : avec six staffeurs et deux jurés requis, un entretien
        // d'1 h 30 supprimait trois entretiens possibles à l'heure suivante au
        // lieu d'un seul.
        consommerStaff(capacityMap, slotISO, dureeMinutes + battement, nbJurys);
        placed = true;
        break;
      }
    }
    if (!placed) {
      failed++;
      failReasons.push(`${candidate.prenom} ${candidate.nom} : aucun créneau commun avec le staff`);
    }
  }

  onProgress(`${assignments.length} placé(s) · ${failed} sans créneau.`);
  failReasons.slice(0, 5).forEach(r => onProgress(`  ↳ ${r}`));
  if (failReasons.length > 5) onProgress(`  ↳ … et ${failReasons.length - 5} autre(s).`);

  if (!assignments.length) return { placed: 0, failed };

  // ── 9. Regrouper par créneau ─────────────────────────────────────
  const bySlot = {};
  for (const a of assignments) {
    if (!bySlot[a.slotISO]) bySlot[a.slotISO] = { slot: a.slot, items: [] };
    bySlot[a.slotISO].items.push(a);
  }

  // ── 10. Création des entretiens en batch (max 490 ops) ──────────
  let batch    = writeBatch(db);
  let batchOps = 0;
  const flushBatch = async () => {
    if (batchOps > 0) { await batch.commit(); batch = writeBatch(db); batchOps = 0; }
  };

  // Ordre CHRONOLOGIQUE. `bySlot` suit l'ordre de placement des candidats (les
  // plus contraints d'abord), pas celui de l'horloge : sans ce tri, « qui vient
  // de passer » ne veut rien dire et la continuité des jurés est impossible.
  const creneauxTries = Object.entries(bySlot)
    .sort(([a], [b]) => new Date(a) - new Date(b));

  // Entretiens déjà posés, pour que `choisirJury` sache qui enchaîne et qui est
  // déjà pris sur un créneau qui chevauche.
  //
  // On PART des entretiens que le reset a conservés (ceux déjà réalisés). Sans
  // eux, relancer un placement pouvait assigner un juré à une heure où il avait
  // déjà un entretien, et ignorait tout le travail qu'il avait déjà fourni.
  const posesCetteFois = await entretiensConserves(campaignId, dureeMinutes);
  if (posesCetteFois.length) {
    onProgress(`${posesCetteFois.length} entretien(s) déjà réalisé(s) pris en compte.`);
  }

  for (const [slotISO, { slot, items }] of creneauxTries) {
    const slotDate = new Date(slotISO);
    const endDate  = new Date(slotDate.getTime() + dureeMinutes * 60 * 1000);

    // Une salle par entretien simultané sur ce créneau
    let roomIndex  = 0;

    for (const { candidate } of items) {
      const jurors = choisirJury({
        disponibles:  slot.staffIds,
        interviews:   posesCetteFois,
        debut:        slotDate,
        fin:          endDate,
        nbJurys,
        maxAffiles:   cfg.maxEntretiensAffiles,
        battementMin: battement,
      });
      posesCetteFois.push({
        datetimeStart: slotDate, datetimeEnd: endDate,
        jury1Id: jurors[0] || null, jury2Id: jurors[1] || null, jury3Id: jurors[2] || null,
      });

      const room = rooms[roomIndex++] || null;

      batch.set(doc(collection(db, 'interviews')), {
        campaignId,
        organizationId: orgId,
        candidateId:    candidate.id,
        datetimeStart:  slotDate,
        datetimeEnd:    endDate,
        statut:         'planifie',
        selfBooked:     false,        // placé par le bureau, pas réservé par le cooptant
        jury1Id:        jurors[0] || null,
        jury2Id:        jurors[1] || null,
        jury3Id:        jurors[2] || null,
        roomId:         room?.id   || null,
        salleNom:       room?.code || null,
        createdAt:      serverTimestamp(),
      });
      batch.update(doc(db, 'candidates', candidate.id), { statut: 'place' });
      batchOps += 2;

      if (batchOps >= 490) await flushBatch();
    }
  }

  await flushBatch();
  onProgress(`✅ Planning enregistré : ${assignments.length} entretien(s) créé(s).`);
  return { placed: assignments.length, failed };
}

// ─── Idempotence ─────────────────────────────────────────────────────────────
// Supprime les entretiens encore 'planifie' et remet leurs cooptants en 'recu'.
// Ne touche jamais un entretien déjà réalisé.

async function resetPreviousPlanning(campaignId) {
  const snap = await getDocs(query(
    collection(db, 'interviews'),
    where('campaignId', '==', campaignId),
    where('statut',     '==', 'planifie')
  ));
  if (snap.empty) return 0;

  const candidateIds = [...new Set(
    snap.docs.map(d => d.data().candidateId).filter(Boolean)
  )];
  const candDocs = await Promise.all(
    candidateIds.map(id => getDoc(doc(db, 'candidates', id)))
  );

  const ops = [];
  snap.docs.forEach(d => ops.push({ type: 'delete', ref: d.ref }));
  candDocs.forEach(d => {
    // Seuls les cooptants encore au stade 'place' repassent en 'recu' :
    // un 'entretien_fait' garde son statut.
    if (d.exists() && d.data().statut === 'place') {
      ops.push({ type: 'update', ref: d.ref, data: { statut: 'recu' } });
    }
  });

  for (let i = 0; i < ops.length; i += 490) {
    const b = writeBatch(db);
    ops.slice(i, i + 490).forEach(op =>
      op.type === 'delete' ? b.delete(op.ref) : b.update(op.ref, op.data)
    );
    await b.commit();
  }
  return snap.size;
}

/**
 * Tous les jurés mobilisables d'une asso : membres avec compte + noms de la
 * liste du staff, dédupliqués par nom.
 *
 * Un membership porte un UID Firebase et un doc roster son propre id : les
 * comparer ne dédupliquerait jamais rien, et quelqu'un ayant les deux
 * compterait double dans la capacité.
 *
 * @param {string} orgId
 * @returns {Promise<string[]>} identifiants tels qu'ils apparaissent dans
 *   `staff_availabilities.userId` et dans `interviews.juryNId`
 */
async function juresDeLOrg(orgId) {
  if (!orgId) return [];
  const [membres, rosterSnap] = await Promise.all([
    getMembersByOrg(orgId),
    getDocs(query(collection(db, 'roster_members'), where('organizationId', '==', orgId))),
  ]);

  const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const vus  = new Set();
  const ids  = [];

  const ajouter = (id, nom) => {
    const cle = norm(nom);
    if (!id || (cle && vus.has(cle))) return;
    if (cle) vus.add(cle);
    ids.push(id);
  };

  membres.forEach(m => ajouter(m.userId, m.displayName || m.email));
  rosterSnap.docs.forEach(d => ajouter(d.id, d.data().displayName));
  return ids;
}

/**
 * Entretiens que le reset a laissés en place (statut ≠ 'planifie', donc déjà
 * réalisés), normalisés pour `choisirJury`.
 *
 * @param {string} campaignId
 * @param {number} dureeMinutes durée de repli si `datetimeEnd` manque
 */
async function entretiensConserves(campaignId, dureeMinutes) {
  const snap = await getDocs(query(
    collection(db, 'interviews'),
    where('campaignId', '==', campaignId)
  ));
  return snap.docs.map(d => {
    const iv = d.data();
    const st = iv.datetimeStart?.toDate ? iv.datetimeStart.toDate() : new Date(iv.datetimeStart);
    let en = iv.datetimeEnd?.toDate ? iv.datetimeEnd.toDate()
           : (iv.datetimeEnd ? new Date(iv.datetimeEnd) : null);
    if (!en || isNaN(en)) en = new Date(st.getTime() + dureeMinutes * 60000);
    return {
      datetimeStart: st, datetimeEnd: en,
      jury1Id: iv.jury1Id || null, jury2Id: iv.jury2Id || null, jury3Id: iv.jury3Id || null,
    };
  }).filter(iv => !isNaN(iv.datetimeStart));
}

// ─── Chargement des candidats ────────────────────────────────────────────────

async function loadCandidates(campaignId) {
  const snap = await getDocs(query(
    collection(db, 'candidates'),
    where('campaignId', '==', campaignId)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Capacity map ────────────────────────────────────────────────────────────
// Capacité d'un créneau = nb de groupes de `nbJurys` jurés disponibles.

// ─── Dispos candidat → liste de créneaux ISO ─────────────────────────────────
// candidate.disponibilites = [{jour:'YYYY-MM-DD', creneaux:['08:00',…]}]

function flattenCandidateDispo(disponibilites, allowedDays) {
  const result = [];
  for (const d of disponibilites) {
    if (!d?.jour || !Array.isArray(d.creneaux)) continue;
    if (!allowedDays.has(d.jour)) continue;            // hors période
    for (const hour of d.creneaux) {
      const key = slotKey(d.jour, hour);
      if (key) result.push(key);
    }
  }
  return result;
}

