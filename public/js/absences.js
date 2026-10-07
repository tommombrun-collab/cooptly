/**
 * Absences : un cooptant qui ne s'est pas présenté à son entretien.
 *
 * Une fiche `absences` par créneau manqué (identifiant : entretien + horaire).
 * Elle reste quand l'entretien est replanifié : le bureau doit la voir au
 * classement final. Le créneau ACTUEL est « absent » seulement si une fiche
 * porte son entretien et son horaire (`absentAuCreneau`).
 *
 * Signalée depuis la fiche du cooptant (bureau) ou depuis les formulaires
 * d'évaluation, lien public compris (staffeurs sans compte). Lisible par le
 * bureau seulement (firestore.rules).
 */
import { collection, doc, getDocs, query, setDoc, where, serverTimestamp, Timestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const ms = t => t?.toMillis?.() ?? (t instanceof Date ? t.getTime() : null);

/** Identifiant déterministe : signaler deux fois le même créneau ne crée qu'une fiche. */
export const idAbsence = (interviewId, datetimeStart) => `${interviewId}_${ms(datetimeStart)}`;

/**
 * @param {object} iv entretien ({ id, organizationId, campaignId, candidateId, datetimeStart })
 * @param {{par?: string, source?: string}} [o]
 */
export function signalerAbsence(db, iv, { par = null, source = 'fiche' } = {}) {
  const debut = iv.datetimeStart instanceof Date ? Timestamp.fromDate(iv.datetimeStart) : iv.datetimeStart;
  return setDoc(doc(db, 'absences', idAbsence(iv.id, debut)), {
    organizationId: iv.organizationId,
    campaignId: iv.campaignId,
    candidateId: iv.candidateId,
    interviewId: iv.id,
    datetimeStart: debut,
    par: par ? String(par).slice(0, 120) : null,
    source,
    createdAt: serverTimestamp(),
  });
}

/** Toutes les absences d'une campagne (bureau). Liste vide si la lecture échoue. */
export async function chargerAbsences(db, organizationId, campaignId) {
  try {
    const snap = await getDocs(query(collection(db, 'absences'),
      where('organizationId', '==', organizationId), where('campaignId', '==', campaignId)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('Absences illisibles :', e);
    return [];
  }
}

/** Absences d'un cooptant (bureau), de la plus ancienne à la plus récente. */
export async function absencesDuCooptant(db, organizationId, candidateId) {
  try {
    const snap = await getDocs(query(collection(db, 'absences'),
      where('organizationId', '==', organizationId), where('candidateId', '==', candidateId)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(a.datetimeStart) - ms(b.datetimeStart));
  } catch (e) {
    console.warn('Absences illisibles :', e);
    return [];
  }
}

/** Map candidateId → liste d'absences. */
export function absencesParCooptant(absences) {
  const m = new Map();
  absences.forEach(a => { if (!m.has(a.candidateId)) m.set(a.candidateId, []); m.get(a.candidateId).push(a); });
  return m;
}

/** Le créneau actuel de cet entretien est-il marqué absent ? */
export function absentAuCreneau(absences, iv) {
  if (!iv || !absences?.length) return false;
  const t = ms(iv.datetimeStart);
  return absences.some(a => a.interviewId === iv.id && ms(a.datetimeStart) === t);
}

/** « 1 absence », « 2 absences ». */
export const libelleAbsences = n => `${n} absence${n > 1 ? 's' : ''}`;
