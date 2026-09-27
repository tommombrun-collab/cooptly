/**
 * Capacité des créneaux pour le placement automatique (mode « dispos »).
 *
 * Module sans dépendance, donc testable directement et réutilisable par une
 * page publique. `algo.js` ne peut pas l'être : il importe `db.js`, donc
 * Firestore.
 *
 * Les disponibilités du staff sont déclarées à l'heure pleine
 * (`[{jour: 'YYYY-MM-DD', creneaux: ['08:00', '09:00', …]}]`), alors qu'un
 * entretien peut durer plus d'une heure : tout l'enjeu est de ne retenir que
 * les personnes libres sur la durée complète.
 */

export const SLOT_MIN = 60;   // pas de la grille de disponibilités, en minutes

/** Première heure proposée, et dernière heure de fin par défaut. */
export const HEURE_DEBUT = 8;
export const HEURE_FIN_DEFAUT = 19;
/** Bornes de l'heure de fin réglable (`config.heureFin`). */
export const HEURE_FIN_MIN = 17;
export const HEURE_FIN_MAX = 23;

/** Pas proposés pour les créneaux de réservation, en minutes. */
export const PAS_CRENEAUX = [15, 30, 60];

/** `config.pasCreneauxMinutes` ramené à un pas autorisé (30 par défaut). */
export function pasCreneauxValide(pas) {
  const p = parseInt(pas, 10);
  return PAS_CRENEAUX.includes(p) ? p : 30;
}

/**
 * Pas des lignes des plannings : 15 min si les créneaux sont au quart d'heure,
 * sinon 30. Un entretien est rangé dans la ligne où il commence
 * (`ligneDuPlanning`), donc changer le pas ne fait disparaître personne.
 */
export function pasPlanning(pasCreneaux) {
  return pasCreneauxValide(pasCreneaux) === 15 ? 15 : 30;
}

/** Libellé 'HH:MM' de la ligne de planning qui contient l'heure `d`. */
export function ligneDuPlanning(d, pasLignes) {
  const m = Math.floor((d.getHours() * 60 + d.getMinutes()) / pasLignes) * pasLignes;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** `config.heureFin` ramenée dans les bornes, 19 si absente ou invalide. */
export function heureFinValide(heureFin) {
  const h = parseInt(heureFin, 10);
  if (!Number.isFinite(h)) return HEURE_FIN_DEFAUT;
  return Math.max(HEURE_FIN_MIN, Math.min(HEURE_FIN_MAX, h));
}

/**
 * Heures pleines proposées par les grilles de disponibilités, de 8 h jusqu'à
 * l'heure de fin exclue (19 → 08:00…18:00, la case 18:00 couvrant 18 h-19 h).
 *
 * Source unique : staff et cooptants ne peuvent cocher que ces heures, donc
 * c'est aussi la plage sur laquelle on considère le staff disponible quand
 * l'asso ne demande pas de déclaration préalable. L'heure de fin se règle par
 * asso (`config.heureFin`), pour les entretiens en visio le soir.
 *
 * @param {number} [heureFin=19]
 * @returns {string[]} ['08:00', '09:00', …]
 */
export function heuresGrille(heureFin = HEURE_FIN_DEFAUT) {
  const fin = heureFinValide(heureFin);
  return Array.from({ length: fin - HEURE_DEBUT },
    (_, i) => `${String(HEURE_DEBUT + i).padStart(2, '0')}:00`);
}

/** Grille par défaut (8 h-19 h). Préférer `heuresGrille(cfg.heureFin)`. */
export const HEURES_GRILLE = heuresGrille();

/**
 * Capacité quand personne n'a déclaré ses disponibilités : tout le staff est
 * réputé libre sur toute la période.
 *
 * Certaines assos ne veulent pas imposer à leur bureau de remplir une grille
 * en amont. Le cooptant dit quand il peut, le bureau s'arrange : sans ça,
 * l'algorithme refusait de placer qui que ce soit faute de disponibilités.
 *
 * @param {string[]}    juresIds    tous les jurés mobilisables (comptes + roster)
 * @param {Set<string>} allowedDays jours 'YYYY-MM-DD' de la période
 * @param {number}      dureeMinutes durée d'un entretien
 * @param {number}      [heureFin=19] fin de la plage (`config.heureFin`)
 * @returns {Object<string, {staffIds: string[], restant: number}>}
 */
export function capaciteToutLeMonde(juresIds, allowedDays, dureeMinutes = 30, heureFin = HEURE_FIN_DEFAUT) {
  const ids = [...new Set(juresIds)].filter(Boolean);
  if (!ids.length) return {};

  // On réutilise `buildCapacityMap` en fabriquant une disponibilité complète :
  // la règle « libre sur toute la durée de l'entretien » s'applique ainsi sans
  // être réécrite, y compris pour un entretien de plus d'une heure.
  const creneaux = [...allowedDays].map(jour => ({ jour, creneaux: heuresGrille(heureFin) }));
  return buildCapacityMap(
    ids.map(userId => ({ userId, creneaux })),
    1, allowedDays, dureeMinutes
  );
}

/** Nombre de créneaux horaires qu'occupe un entretien de `occupeMin` minutes. */
export function creneauxOccupes(occupeMin) {
  return Math.max(1, Math.ceil(occupeMin / SLOT_MIN));
}

/**
 * Clé ISO d'un créneau, en heure locale (cohérent avec l'affichage de l'app).
 * @param {string} jour 'YYYY-MM-DD'
 * @param {string} hour 'HH:MM'
 * @returns {string|null}
 */
export function slotKey(jour, hour) {
  if (!jour || !hour) return null;
  const [h, m] = String(hour).split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const dt = new Date(`${jour}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

/**
 * Capacité de chaque créneau horaire.
 *
 * `staffIds` ne retient que les personnes disponibles sur **toute la durée** de
 * l'entretien, pas seulement à son heure de départ. Avant, un entretien de
 * 90 min démarrant à 10 h était pourvu par des jurés libres de 10 h à 11 h,
 * alors qu'il courait jusqu'à 11 h 30.
 *
 * `restant` compte les personnes encore mobilisables ; il descend au fil des
 * placements (voir `consommerStaff`).
 *
 * @param {object[]}    staffDispos  docs `staff_availabilities`
 * @param {number}      nbJurys      jurés requis par entretien
 * @param {Set<string>} allowedDays  jours 'YYYY-MM-DD' de la période
 * @param {number}      dureeMinutes durée d'un entretien
 * @returns {Object<string, {staffIds: string[], restant: number}>}
 */
export function buildCapacityMap(staffDispos, nbJurys, allowedDays, dureeMinutes = 30) {
  // Heures déclarées, par jour puis par personne.
  const parJour = {};
  for (const staff of staffDispos) {
    for (const dayBlock of (staff.creneaux || [])) {
      if (!dayBlock?.jour || !Array.isArray(dayBlock.creneaux)) continue;
      if (!allowedDays.has(dayBlock.jour)) continue;          // hors période
      if (!parJour[dayBlock.jour]) parJour[dayBlock.jour] = new Map();
      const heures = parJour[dayBlock.jour].get(staff.userId) || new Set();
      dayBlock.creneaux.forEach(h => heures.add(h));
      parJour[dayBlock.jour].set(staff.userId, heures);
    }
  }

  const nbCreneaux = creneauxOccupes(dureeMinutes);
  const map = {};

  for (const [jour, parPersonne] of Object.entries(parJour)) {
    for (const [userId, heures] of parPersonne) {
      for (const heure of heures) {
        const key = slotKey(jour, heure);
        if (!key) continue;

        // Libre sur toutes les heures que l'entretien va traverser ?
        const [h0] = String(heure).split(':').map(Number);
        let couvre = true;
        for (let i = 1; i < nbCreneaux; i++) {
          if (!heures.has(`${String(h0 + i).padStart(2, '0')}:00`)) { couvre = false; break; }
        }
        if (!couvre) continue;

        if (!map[key]) map[key] = { staffIds: [], restant: 0 };
        if (!map[key].staffIds.includes(userId)) map[key].staffIds.push(userId);
      }
    }
  }

  for (const key of Object.keys(map)) map[key].restant = map[key].staffIds.length;
  return map;
}

/**
 * Retire `nbJurys` personnes de tous les créneaux qu'un entretien occupe.
 *
 * Remplace la mise à zéro du créneau débordé, qui supprimait toute sa capacité
 * restante au lieu des seules personnes réellement mobilisées : avec six
 * staffeurs et deux jurés requis, un entretien d'1 h 30 faisait perdre trois
 * entretiens à l'heure suivante au lieu d'un seul.
 *
 * @param {object} map       carte renvoyée par `buildCapacityMap`
 * @param {string} slotISO   créneau de départ
 * @param {number} occupeMin durée réellement occupée (entretien + battement)
 * @param {number} nbJurys
 */
export function consommerStaff(map, slotISO, occupeMin, nbJurys) {
  const start = new Date(slotISO).getTime();
  for (let i = 0; i < creneauxOccupes(occupeMin); i++) {
    const cle = new Date(start + i * SLOT_MIN * 60 * 1000).toISOString();
    if (map[cle]) map[cle].restant = Math.max(0, map[cle].restant - nbJurys);
  }
}

/**
 * Combien de jurés restent libres sur un créneau, en comptant les VRAIES
 * personnes prises par les entretiens qui le chevauchent.
 *
 * Avant : « disponibles − entretiens qui chevauchent × jurés par entretien ».
 * Un entretien retirait donc deux personnes du créneau même quand ses jurés
 * n'étaient pas disponibles sur ce créneau-là. Cas réel (1er octobre) :
 * trois dispos à 12:00, un entretien 11:30-12:00 avec Chloé et Camille, pause de
 * 15 min ; Camille n'était pas dispo à 12:00, seule Chloé était prise, il restait
 * deux jurés et le créneau affichait pourtant « Complet ».
 *
 * Un entretien dont le jury est incomplet réserve encore les places manquantes
 * parmi les disponibles : on ne sait pas qui les prendra, mais elles sont dues.
 *
 * @param {string[]} disposIds   personnes libres sur toute la durée du créneau
 * @param {{juryIds: string[]}[]} occupations entretiens qui chevauchent (pause comprise),
 *   un seul par groupe
 * @param {number} nbJurys
 * @returns {number} jurés encore libres
 */
export function juresEncoreLibres(disposIds, occupations, nbJurys) {
  const dispos = new Set(disposIds);
  const pris = new Set();
  let aTrouver = 0;
  for (const occ of occupations) {
    const jures = [...new Set((occ.juryIds || []).filter(Boolean))];
    jures.forEach(id => { if (dispos.has(id)) pris.add(id); });
    aTrouver += Math.max(0, nbJurys - jures.length);
  }
  return Math.max(0, dispos.size - pris.size - aTrouver);
}
