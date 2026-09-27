import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, Timestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { app } from './auth.js';
import { CAMPAIGN_CONFIG_DEFAULTS, regrouperMembres } from './utils.js';

const db = getFirestore(app);
export { db, Timestamp };

// ─── Organizations ────────────────────────────────────────────────────────────

export async function getOrgBySlug(slug) {
  const q = query(collection(db, 'organizations'), where('slug', '==', slug));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function getOrg(orgId) {
  const snap = await getDoc(doc(db, 'organizations', orgId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createOrg(data) {
  return addDoc(collection(db, 'organizations'), { ...data, createdAt: serverTimestamp() });
}

// ─── Campaigns (participations org) ──────────────────────────────────────────

export async function getCampaign(campaignId) {
  const snap = await getDoc(doc(db, 'campaigns', campaignId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getCampaignsByOrg(orgId) {
  const q = query(collection(db, 'campaigns'), where('organizationId', '==', orgId), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createCampaign(data) {
  return addDoc(collection(db, 'campaigns'), { ...data, createdAt: serverTimestamp() });
}

// Espace de recrutement permanent de l'asso (1 seul "campaign" par asso).
// Renvoie l'existant (le plus récent si plusieurs) ou en crée un avec des règles par défaut.
export async function getOrCreateOrgCampaign(orgId) {
  const existing = await getCampaignsByOrg(orgId);
  if (existing.length) return existing[0];
  const ref = await addDoc(collection(db, 'campaigns'), {
    organizationId: orgId,
    name: 'Recrutement',
    recrutementOuvert: true,
    config: { ...CAMPAIGN_CONFIG_DEFAULTS },
    formConfig: { customQuestions: [] },
    interviewCriteria: [],
    createdAt: serverTimestamp(),
  });
  return getCampaign(ref.id);
}

export async function updateCampaign(campaignId, data) {
  return updateDoc(doc(db, 'campaigns', campaignId), data);
}

// ─── Candidates ───────────────────────────────────────────────────────────────

export async function getCandidateByToken(token) {
  const q = query(collection(db, 'candidates'), where('resultToken', '==', token));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function getCandidatesByCampaign(campaignId) {
  const q = query(collection(db, 'candidates'), where('campaignId', '==', campaignId), orderBy('createdAt', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createCandidate(data) {
  return addDoc(collection(db, 'candidates'), { ...data, createdAt: serverTimestamp() });
}

export async function updateCandidate(candidateId, data) {
  return updateDoc(doc(db, 'candidates', candidateId), data);
}

// ─── Staff availabilities ─────────────────────────────────────────────────────

export async function getStaffAvailabilities(campaignId) {
  const q = query(collection(db, 'staff_availabilities'), where('campaignId', '==', campaignId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function setStaffAvailability(userId, campaignId, creneaux, type = 'dispo') {
  const q = query(collection(db, 'staff_availabilities'),
    where('userId', '==', userId), where('campaignId', '==', campaignId));
  const snap = await getDocs(q);
  if (!snap.empty) {
    return updateDoc(snap.docs[0].ref, { creneaux, type });
  }
  return addDoc(collection(db, 'staff_availabilities'), { userId, campaignId, creneaux, type });
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

export async function getRoomsByOrg(orgId) {
  const q = query(collection(db, 'rooms'), where('organizationId', '==', orgId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createRoom(data) {
  return addDoc(collection(db, 'rooms'), data);
}

export async function deleteRoom(roomId) {
  return deleteDoc(doc(db, 'rooms', roomId));
}

// ─── Room bookings ────────────────────────────────────────────────────────────

export async function getRoomBookings(campaignId) {
  const q = query(collection(db, 'room_bookings'), where('campaignId', '==', campaignId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Interview evaluations ────────────────────────────────────────────────────

export async function getEvaluationsByCandidate(candidateId, campaignId) {
  const q = query(
    collection(db, 'interview_evaluations'),
    where('candidateId', '==', candidateId),
    where('campaignId',  '==', campaignId)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveEvaluation(evalData, existingId = null) {
  if (existingId) {
    await updateDoc(doc(db, 'interview_evaluations', existingId), { ...evalData, updatedAt: serverTimestamp() });
    return existingId;
  }
  const ref = await addDoc(collection(db, 'interview_evaluations'), { ...evalData, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}

// ─── Interviews ───────────────────────────────────────────────────────────────

export async function getInterviewsByCampaign(campaignId) {
  const q = query(collection(db, 'interviews'), where('campaignId', '==', campaignId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createInterview(data) {
  return addDoc(collection(db, 'interviews'), data);
}

export async function updateInterview(interviewId, data) {
  return updateDoc(doc(db, 'interviews', interviewId), data);
}

// ─── Memberships ──────────────────────────────────────────────────────────────

/**
 * Membres du bureau d'une asso, UN par personne.
 *
 * Une personne ajoutée à l'avance par email a un premier document (id
 * automatique), puis auth.js lui crée à la connexion le document canonique
 * `{uid}_{orgId}` exigé par les règles. Les deux coexistent : la liste affichait
 * donc les membres connectés en double, et « Retirer » n'en supprimait qu'un.
 *
 * On regroupe par personne (UID, sinon email) ; le document canonique donne
 * les valeurs affichées, et `_docIds` liste TOUS les documents de la personne
 * pour qu'une modification ou un retrait les touche tous.
 *
 * @returns {Promise<object[]>} `{ id, ...données, _docIds: string[] }`
 */
export async function getMembersByOrg(orgId) {
  const q = query(collection(db, 'memberships'), where('organizationId', '==', orgId));
  const snap = await getDocs(q);
  return regrouperMembres(snap.docs.map(d => ({ id: d.id, ...d.data() })), orgId);
}

export async function addMembership(userId, organizationId, role = 'member') {
  const id = `${userId}_${organizationId}`;
  return addDoc(collection(db, 'memberships'), { userId, organizationId, role, id });
}
