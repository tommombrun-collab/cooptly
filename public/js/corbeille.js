/**
 * Corbeille : ce que le bureau supprime reste récupérable 30 jours.
 *
 * Avant, supprimer un cooptant (ou « tout effacer » dans les paramètres)
 * détruisait les documents sur-le-champ, sans retour possible. Le projet n'a
 * pas de sauvegarde automatique de la base, donc une fausse manip était
 * définitive.
 *
 * Principe : une entrée de `corbeille` garde une copie intégrale des documents
 * supprimés (collection, identifiant, contenu). La copie et les suppressions
 * partent dans UN SEUL lot : soit tout passe, soit rien n'est effacé. Restaurer
 * réécrit chaque document sous son identifiant d'origine.
 *
 * Pas de Cloud Functions sur ce projet : la purge des entrées de plus de
 * 30 jours se fait à l'ouverture de la corbeille (`listerCorbeille`).
 */
import { collection, doc, getDoc, getDocs, query, where, writeBatch, serverTimestamp, deleteDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const DUREE_CORBEILLE_JOURS = 30;

/** Seules collections que `restaurer` accepte de réécrire. */
export const COLLECTIONS_RESTAURABLES = ['candidates', 'interviews', 'interview_evaluations', 'staff_availabilities'];

// Un lot Firestore accepte 500 écritures ; on garde de la marge.
const MAX_ECRITURES_LOT = 450;

/**
 * Met des documents à la corbeille puis les supprime, en un seul lot.
 *
 * @param {import('firebase/firestore').Firestore} db
 * @param {object} p
 * @param {string} p.organizationId
 * @param {string} p.type      'cooptant' | 'dispos'
 * @param {string} p.libelle   ce que verra le bureau (« Léa Martin »)
 * @param {{col: string, id: string, data: object}[]} p.docs
 * @param {string} [p.par]     email de la personne qui supprime
 */
export async function mettreEnCorbeille(db, { organizationId, type, libelle, docs, par = null }) {
  if (!docs.length) return;
  if (docs.length + 1 > MAX_ECRITURES_LOT) throw new Error('Trop de documents pour une seule entrée de corbeille.');
  const lot = writeBatch(db);
  lot.set(doc(collection(db, 'corbeille')), {
    organizationId, type, libelle,
    supprimePar: par,
    supprimeLe: serverTimestamp(),
    // Documents anciens sans `organizationId` : on le complète, sinon
    // `restaurer` les refuserait (il n'accepte que ceux de l'asso).
    docs: docs.map(d => ({ col: d.col, id: d.id, data: { ...d.data, organizationId: d.data?.organizationId ?? organizationId } })),
  });
  docs.forEach(d => lot.delete(doc(db, d.col, d.id)));
  await lot.commit();
}

/**
 * Met un cooptant à la corbeille avec son entretien et son évaluation.
 * @param {import('firebase/firestore').Firestore} db
 * @param {object} c cooptant ({ id, ...données })
 * @param {object[]} entretiens snapshots Firestore
 * @param {object[]} evaluations snapshots Firestore
 * @param {string} organizationId
 * @param {string} [par]
 */
export function cooptantEnCorbeille(db, c, entretiens, evaluations, organizationId, par) {
  const { id, ...data } = c;
  // Champs calculés par la page (préfixés `_`) : pas des données à restaurer.
  Object.keys(data).forEach(k => { if (k.startsWith('_')) delete data[k]; });
  return mettreEnCorbeille(db, {
    organizationId, type: 'cooptant', par,
    libelle: `${c.prenom || ''} ${c.nom || ''}`.trim() || c.email || 'Cooptant',
    docs: [
      { col: 'candidates', id, data },
      ...entretiens.map(s => ({ col: 'interviews', id: s.id, data: s.data() })),
      ...evaluations.map(s => ({ col: 'interview_evaluations', id: s.id, data: s.data() })),
    ],
  });
}

/**
 * Entrées de la corbeille d'une asso, les plus récentes d'abord. Supprime au
 * passage celles qui ont dépassé la durée de conservation.
 * @returns {Promise<object[]>}
 */
export async function listerCorbeille(db, organizationId) {
  const snap = await getDocs(query(collection(db, 'corbeille'), where('organizationId', '==', organizationId)));
  const limite = Date.now() - DUREE_CORBEILLE_JOURS * 86400000;
  const gardees = [], perimees = [];
  snap.docs.forEach(d => {
    const e = { id: d.id, ...d.data() };
    const t = e.supprimeLe?.toMillis?.();
    (t && t < limite ? perimees : gardees).push(e);
  });
  if (perimees.length) {
    await Promise.all(perimees.map(e => deleteDoc(doc(db, 'corbeille', e.id)))).catch(() => {});
  }
  return gardees.sort((a, b) => (b.supprimeLe?.toMillis?.() ?? Date.now()) - (a.supprimeLe?.toMillis?.() ?? Date.now()));
}

/**
 * Remet chaque document à sa place, puis retire l'entrée de la corbeille.
 *
 * Un document qui existe de nouveau entre-temps (le cooptant a re-postulé :
 * son identifiant est déterministe) n'est PAS écrasé : la version actuelle est
 * plus récente que la copie.
 *
 * @returns {Promise<{restaures: number, ignores: number}>}
 */
export async function restaurer(db, entree) {
  // Restaurer écrit avec les droits de la personne qui clique. Une entrée
  // fabriquée à la main pourrait viser une autre collection (memberships,
  // platform_admins…) ou une autre asso : on ne remet que ce que la corbeille
  // sait produire, et seulement pour l'asso de l'entrée.
  const valides = (entree.docs || []).filter(d =>
    COLLECTIONS_RESTAURABLES.includes(d.col)
    && typeof d.id === 'string' && d.id && !d.id.includes('/')
    && d.data && d.data.organizationId === entree.organizationId);
  const refuses = (entree.docs || []).length - valides.length;
  const existants = await Promise.all(valides.map(d => getDoc(doc(db, d.col, d.id))));
  const lot = writeBatch(db);
  let restaures = 0, ignores = refuses;
  valides.forEach((d, i) => {
    if (existants[i].exists()) { ignores++; return; }
    lot.set(doc(db, d.col, d.id), d.data);
    restaures++;
  });
  lot.delete(doc(db, 'corbeille', entree.id));
  await lot.commit();
  return { restaures, ignores };
}

/** Suppression définitive d'une entrée (demande d'effacement, par exemple). */
export function viderEntree(db, entreeId) {
  return deleteDoc(doc(db, 'corbeille', entreeId));
}

export { MAX_ECRITURES_LOT };
