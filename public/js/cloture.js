/**
 * Fin d'un recrutement et préparation du suivant.
 *
 * Le bureau suivant est souvent recruté PARMI les cooptants de l'année : il ne
 * doit pas voir comment on l'a noté. À la clôture, toutes les données des
 * cooptants (retenus compris) sont donc effacées, définitivement, 30 jours
 * plus tard (le temps de rattraper une clôture trop tôt) ou tout de suite.
 *
 * ⚠️ Exception VOULUE à « toute suppression passe par la corbeille » : la
 * corbeille garderait justement ce qu'il faut faire disparaître. On vide aussi
 * les entrées de corbeille de l'asso, qui contiennent des copies de cooptants.
 *
 * Ce qui reste : réglages, questions, grille, consignes, salles, comptes du
 * bureau, liste du staff, et des chiffres anonymes par année (`historique`).
 *
 * États (`campaign.etat`) : absent = recrutement en cours ; 'cloture' ;
 * 'preparation' (données effacées, le recrutement suivant se règle).
 */
import { collection, doc, getDocs, query, where, writeBatch, updateDoc, serverTimestamp, Timestamp, deleteField }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { campaignConfig } from './utils.js';

export const DELAI_EFFACEMENT_JOURS = 30;
const LOT = 450;

/** Documents à effacer : ce qui concerne les cooptants et les dispos de ce recrutement. */
async function documentsAEffacer(db, orgId, campaignId) {
  const parOrg = col => getDocs(query(collection(db, col), where('organizationId', '==', orgId)));
  const parCampagne = col => getDocs(query(collection(db, col), where('campaignId', '==', campaignId)));
  // Les collections cloisonnées se lisent filtrées par asso (les règles ne
  // sont pas des filtres) ; celles en lecture publique, par recrutement.
  const [cands, ivs, evals, notes, absences, dispos, corbeille] = await Promise.all([
    parCampagne('candidates'),
    parCampagne('interviews'),
    getDocs(query(collection(db, 'interview_evaluations'), where('organizationId', '==', orgId), where('campaignId', '==', campaignId))),
    parOrg('notes_internes'),
    getDocs(query(collection(db, 'absences'), where('organizationId', '==', orgId), where('campaignId', '==', campaignId))),
    parCampagne('staff_availabilities'),
    parOrg('corbeille'),
  ]);
  // Notes : celles de ce recrutement (les anciennes n'ont pas toujours de campaignId).
  const notesDuRecrutement = notes.docs.filter(d => !d.data().campaignId || d.data().campaignId === campaignId);
  const votes = await documentsDesVotes(db, orgId, campaignId);
  return [...cands.docs, ...ivs.docs, ...evals.docs, ...notesDuRecrutement, ...absences.docs, ...dispos.docs, ...corbeille.docs, ...votes];
}

/**
 * Votes des membres (js/vote.js) : bulletins et participations, puis les
 * scrutins eux-mêmes EN DERNIER (ils portent la liste des cooptants). Un vote
 * encore ouvert est d'abord clos : ses bulletins ne se lisent, donc ne se
 * listent pour être effacés, qu'une fois le vote clos (firestore.rules).
 */
async function documentsDesVotes(db, orgId, campaignId) {
  const scrutins = await getDocs(query(collection(db, 'scrutins'), where('organizationId', '==', orgId), where('campaignId', '==', campaignId)));
  const ouverts = scrutins.docs.filter(d => d.data().ouvert === true);
  if (ouverts.length) {
    const lot = writeBatch(db);
    ouverts.forEach(d => lot.update(d.ref, { ouvert: false }));
    await lot.commit();
  }
  const parScrutin = await Promise.all(scrutins.docs.map(s => Promise.all(['bulletins', 'participations'].map(col =>
    getDocs(query(collection(db, col), where('organizationId', '==', orgId), where('scrutinId', '==', s.id)))))));
  return [...parScrutin.flat().flatMap(snap => snap.docs), ...scrutins.docs];
}

/** Chiffres anonymes de l'année, gardés dans `campaign.historique`. */
export async function chiffresDuRecrutement(db, orgId, campaign) {
  const [cands, ivs, evals, absences] = await Promise.all([
    getDocs(query(collection(db, 'candidates'), where('campaignId', '==', campaign.id))),
    getDocs(query(collection(db, 'interviews'), where('campaignId', '==', campaign.id))),
    getDocs(query(collection(db, 'interview_evaluations'), where('organizationId', '==', orgId), where('campaignId', '==', campaign.id))),
    getDocs(query(collection(db, 'absences'), where('organizationId', '==', orgId), where('campaignId', '==', campaign.id))),
  ]);
  const cfg = campaignConfig(campaign);
  const evalues = new Set(evals.docs.map(d => d.data().candidateId));
  const avecEntretien = new Set(ivs.docs.map(d => d.data().candidateId));
  return {
    debut: cfg.dateDebut || null,
    fin: cfg.dateFin || null,
    candidatures: cands.size,
    entretiens: avecEntretien.size,
    evalues: evalues.size,
    absences: absences.size,
    stand: cands.docs.filter(d => d.data().source === 'stand').length,
  };
}

/** Clôture : formulaire fermé, chiffres gardés, effacement prévu dans 30 jours. */
export async function cloturer(db, orgId, campaign) {
  const chiffres = await chiffresDuRecrutement(db, orgId, campaign);
  const effacement = Timestamp.fromMillis(Date.now() + DELAI_EFFACEMENT_JOURS * 86400000);
  await updateDoc(doc(db, 'campaigns', campaign.id), {
    etat: 'cloture',
    clotureLe: serverTimestamp(),
    effacementPrevuLe: effacement,
    recrutementOuvert: false,
    statut: 'fermee',
    // Liste réécrite en entier plutôt qu'arrayUnion : la démo (Cooptly) ne le connaît pas.
    historique: [...(campaign.historique || []), { ...chiffres, clotureLe: Timestamp.fromMillis(Date.now()) }],
  });
  return chiffres;
}

/** Revenir sur une clôture, tant que rien n'est effacé. */
export function rouvrir(db, campaign) {
  return updateDoc(doc(db, 'campaigns', campaign.id), {
    etat: deleteField(), clotureLe: deleteField(), effacementPrevuLe: deleteField(),
    // La ligne d'historique ajoutée à la clôture est retirée : elle reviendra à la prochaine.
    historique: (campaign.historique || []).slice(0, -1),
  });
}

/**
 * Efface définitivement les données des cooptants de ce recrutement.
 * @param {(fait: number, total: number) => void} [progression]
 * @returns {Promise<number>} nombre de documents effacés
 */
export async function effacerDonnees(db, orgId, campaign, progression = () => {}) {
  const docs = await documentsAEffacer(db, orgId, campaign.id);
  for (let i = 0; i < docs.length; i += LOT) {
    const lot = writeBatch(db);
    docs.slice(i, i + LOT).forEach(d => lot.delete(d.ref));
    await lot.commit();
    progression(Math.min(i + LOT, docs.length), docs.length);
  }
  await updateDoc(doc(db, 'campaigns', campaign.id), {
    donneesEffaceesLe: serverTimestamp(),
    rankOrder: [],
  });
  return docs.length;
}

/**
 * Préparer le recrutement suivant : données effacées si ce n'est pas fait,
 * dates de l'an dernier retirées, tout le reste gardé (réglages, questions,
 * grille, consignes). Le bureau règle ensuite les dates (assistant).
 */
export async function preparerSuivant(db, orgId, campaign, progression) {
  if (!campaign.donneesEffaceesLe) await effacerDonnees(db, orgId, campaign, progression);
  // ⚠️ `config` se remplace en entier : on repart de campaignConfig.
  const config = { ...campaignConfig(campaign), dateDebut: null, dateFin: null, deadlineCandidature: null, joursExclus: [] };
  await updateDoc(doc(db, 'campaigns', campaign.id), {
    etat: 'preparation', config, recrutementOuvert: false, statut: 'fermee', alertesIgnorees: [],
    clotureLe: deleteField(), effacementPrevuLe: deleteField(), donneesEffaceesLe: deleteField(),
    assistantFait: false,
  });
}

/** Le recrutement est réglé : il redevient « en cours » (fermé tant que le bureau ne l'ouvre pas). */
export function terminerPreparation(db, campaign) {
  return updateDoc(doc(db, 'campaigns', campaign.id), { etat: deleteField(), assistantFait: true });
}

/** Effacement prévu dépassé ? Appelé à l'ouverture du tableau de bord (pas de Cloud Functions). */
export function effacementDu(campaign) {
  return campaign?.etat === 'cloture' && !campaign.donneesEffaceesLe
    && (campaign.effacementPrevuLe?.toMillis?.() ?? Infinity) <= Date.now();
}
