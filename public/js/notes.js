/**
 * Notes internes du bureau, sur un cooptant ou sur un entretien.
 *
 * Elles vivent à part, dans `notes_internes`, lisible par le seul bureau de
 * l'asso (firestore.rules). Avant, elles étaient posées directement sur
 * `candidates.notesInternes` et `interviews.notes` : deux collections lisibles
 * sans compte (formulaire, planning public), donc par n'importe qui connaissant
 * la clé publique de la base.
 *
 * Identifiants : `c_<candidateId>` (note sur un cooptant) et `iv_<interviewId>`
 * (note sur un entretien). Les anciennes notes sont déplacées ici à la
 * première ouverture d'une page du bureau (`migrerNotes`).
 */
import { collection, doc, getDocs, query, where, setDoc, writeBatch, serverTimestamp, deleteField }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const idNoteCooptant  = candidateId => `c_${candidateId}`;
export const idNoteEntretien = interviewId => `iv_${interviewId}`;

/**
 * Notes de l'asso pour une campagne.
 * Filtre par asso indispensable : les règles ne sont pas des filtres.
 * @returns {Promise<Map<string, {id: string, data: object}>>} id → note
 */
export async function chargerNotes(db, organizationId, campaignId) {
  const snap = await getDocs(query(collection(db, 'notes_internes'), where('organizationId', '==', organizationId)));
  const notes = new Map();
  snap.docs.forEach(d => {
    const data = d.data();
    if (!campaignId || !data.campaignId || data.campaignId === campaignId) notes.set(d.id, { id: d.id, data });
  });
  return notes;
}

/** Texte d'une note, '' si absente. */
export const texteNote = (notes, id) => notes.get(id)?.data?.texte || '';

/**
 * Enregistre une note (création ou remplacement du texte).
 * @param {object} cible { organizationId, campaignId, candidateId, interviewId? }
 */
export async function enregistrerNote(db, notes, id, cible, texte) {
  const data = {
    organizationId: cible.organizationId,
    campaignId:     cible.campaignId || null,
    candidateId:    cible.candidateId || null,
    interviewId:    cible.interviewId || null,
    texte,
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'notes_internes', id), data, { merge: true });
  notes.set(id, { id, data: { ...(notes.get(id)?.data || {}), ...data } });
}

/**
 * Déplace les anciennes notes (champ `notesInternes` d'un cooptant, `notes`
 * d'un entretien) vers `notes_internes`, et efface l'ancien champ. Copie et
 * effacement partent dans le même lot : aucune note ne peut se perdre entre
 * les deux. Une note privée déjà présente est gardée, l'ancienne s'y ajoute.
 *
 * @param {object} o
 * @param {object[]} o.cooptants  { id, notesInternes, organizationId, campaignId }
 * @param {object[]} o.entretiens { id, notes, candidateId, organizationId, campaignId }
 * @returns {Promise<number>} nombre de notes déplacées
 */
export async function migrerNotes(db, notes, { organizationId, campaignId, cooptants = [], entretiens = [] }) {
  const aDeplacer = [
    ...cooptants.filter(c => String(c.notesInternes || '').trim()).map(c => ({
      id: idNoteCooptant(c.id), ancien: c.notesInternes, source: doc(db, 'candidates', c.id), champ: 'notesInternes',
      cible: { candidateId: c.id },
    })),
    ...entretiens.filter(iv => String(iv.notes || '').trim()).map(iv => ({
      id: idNoteEntretien(iv.id), ancien: iv.notes, source: doc(db, 'interviews', iv.id), champ: 'notes',
      cible: { candidateId: iv.candidateId || null, interviewId: iv.id },
    })),
  ];
  for (let i = 0; i < aDeplacer.length; i += 200) {
    const lot = writeBatch(db);
    const paquet = aDeplacer.slice(i, i + 200);
    paquet.forEach(m => {
      const deja = texteNote(notes, m.id);
      const texte = deja && deja.includes(m.ancien.trim()) ? deja : [deja, m.ancien.trim()].filter(Boolean).join('\n');
      const data = { organizationId, campaignId: campaignId || null, candidateId: null, interviewId: null, ...m.cible,
                     texte, updatedAt: serverTimestamp() };
      lot.set(doc(db, 'notes_internes', m.id), data, { merge: true });
      lot.update(m.source, { [m.champ]: deleteField() });
      m.data = data;
    });
    await lot.commit();
    paquet.forEach(m => notes.set(m.id, { id: m.id, data: m.data }));
  }
  return aDeplacer.length;
}
