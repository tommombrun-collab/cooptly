/**
 * Absences (public/js/absences.js) : un cooptant qui ne s'est pas présenté.
 *
 * Signalées par le bureau (fiche du cooptant) ou par un staffeur SANS compte
 * (lien d'évaluation). Lisibles par le bureau de l'asso seulement. Un anonyme
 * ne peut viser qu'un vrai entretien de ce cooptant, déjà commencé, à son
 * horaire actuel.
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const env = await initializeTestEnvironment({
  projectId: 'demo-coopt',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const bureauA = env.authenticatedContext('u_abA', { email: 'a@asso.fr' }).firestore();
const bureauB = env.authenticatedContext('u_abB', { email: 'b@asso.fr' }).firestore();
const anonyme = env.unauthenticatedContext().firestore();

const passe  = Timestamp.fromMillis(Date.now() - 3600 * 1000);
const futur  = Timestamp.fromMillis(Date.now() + 24 * 3600 * 1000);
const autre  = Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);

await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'memberships', 'u_abA_orgAb'), { userId: 'u_abA', organizationId: 'orgAb', role: 'secge', email: 'a@asso.fr' });
  await setDoc(doc(d, 'memberships', 'u_abB_orgAc'), { userId: 'u_abB', organizationId: 'orgAc', role: 'secge', email: 'b@asso.fr' });
  await setDoc(doc(d, 'candidates', 'cAb'), { campaignId: 'campAb', organizationId: 'orgAb', email: 'louise@x.fr' });
  await setDoc(doc(d, 'interviews', 'ivPasse'), { campaignId: 'campAb', organizationId: 'orgAb', candidateId: 'cAb', datetimeStart: passe });
  await setDoc(doc(d, 'interviews', 'ivFutur'), { campaignId: 'campAb', organizationId: 'orgAb', candidateId: 'cAb', datetimeStart: futur });
});

const absence = (interviewId, datetimeStart, extra = {}) => ({
  organizationId: 'orgAb', campaignId: 'campAb', candidateId: 'cAb', interviewId, datetimeStart,
  par: 'Lien d\'évaluation', source: 'lien', ...extra,
});

test('un staffeur sans compte signale l\'absence à un entretien passé', async () => {
  await assertSucceeds(setDoc(doc(anonyme, 'absences', 'a1'), absence('ivPasse', passe)));
  // Un second staffeur signale la même : il réécrit la fiche.
  await assertSucceeds(setDoc(doc(anonyme, 'absences', 'a1'), absence('ivPasse', passe, { par: 'Autre' })));
});

test('sans compte : pas d\'absence avant l\'entretien, ni sur un autre horaire, ni pour un autre cooptant', async () => {
  await assertFails(setDoc(doc(anonyme, 'absences', 'a2'), absence('ivFutur', futur)));
  await assertFails(setDoc(doc(anonyme, 'absences', 'a3'), absence('ivPasse', autre)));
  await assertFails(setDoc(doc(anonyme, 'absences', 'a4'), absence('ivPasse', passe, { candidateId: 'cAutre' })));
  await assertFails(setDoc(doc(anonyme, 'absences', 'a5'), absence('ivInexistant', passe)));
  await assertFails(setDoc(doc(anonyme, 'absences', 'a6'), absence('ivPasse', passe, { organizationId: 'orgAc' })));
});

test('sans compte : on ne déplace pas une absence existante', async () => {
  await assertFails(setDoc(doc(anonyme, 'absences', 'a1'), absence('ivPasse', autre)));
});

test('champs inconnus refusés', async () => {
  await assertFails(setDoc(doc(anonyme, 'absences', 'a7'), absence('ivPasse', passe, { statut: 'refuse' })));
  await assertFails(setDoc(doc(bureauA, 'absences', 'a8'), absence('ivPasse', passe, { statut: 'refuse' })));
});

test('le bureau signale aussi un ancien horaire (restauration depuis la corbeille)', async () => {
  await assertSucceeds(setDoc(doc(bureauA, 'absences', 'a9'), absence('ivPasse', autre, { par: 'Camille', source: 'fiche' })));
});

test('lecture : le bureau de l\'asso seulement', async () => {
  await assertSucceeds(getDocs(query(collection(bureauA, 'absences'), where('organizationId', '==', 'orgAb'), where('campaignId', '==', 'campAb'))));
  await assertSucceeds(getDocs(query(collection(bureauA, 'absences'), where('organizationId', '==', 'orgAb'), where('candidateId', '==', 'cAb'))));
  await assertFails(getDoc(doc(anonyme, 'absences', 'a1')));
  await assertFails(getDoc(doc(bureauB, 'absences', 'a1')));
  await assertFails(getDocs(query(collection(bureauB, 'absences'), where('organizationId', '==', 'orgAb'))));
});

test('une autre asso ne signale ni ne supprime', async () => {
  await assertFails(setDoc(doc(bureauB, 'absences', 'a10'), absence('ivPasse', autre)));
  await assertFails(deleteDoc(doc(bureauB, 'absences', 'a1')));
  await assertFails(deleteDoc(doc(anonyme, 'absences', 'a1')));
  await assertSucceeds(deleteDoc(doc(bureauA, 'absences', 'a9')));
});

test.after(() => env.cleanup());
