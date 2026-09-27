/**
 * Corbeille (public/js/corbeille.js) : ce que le bureau supprime reste
 * récupérable. Elle contient données personnelles et avis du jury, elle doit
 * donc être aussi cloisonnée que les évaluations.
 *
 * Rejoue les écritures du module (lot unique copie + suppressions, puis
 * restauration), le module lui-même important le SDK depuis un CDN.
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert';

const env = await initializeTestEnvironment({
  projectId: 'demo-coopt',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const bureauA = env.authenticatedContext('u_cA', { email: 'a@asso.fr' }).firestore();
const bureauB = env.authenticatedContext('u_cB', { email: 'b@asso.fr' }).firestore();
const anonyme = env.unauthenticatedContext().firestore();

const cand = { campaignId: 'campC', organizationId: 'orgC', email: 'lea@x.fr', prenom: 'Léa', statut: 'place' };
const iv   = { campaignId: 'campC', organizationId: 'orgC', candidateId: 'cC' };
const ev   = { campaignId: 'campC', organizationId: 'orgC', candidateId: 'cC', criteria: { c1: 4 } };

await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'memberships', 'u_cA_orgC'), { userId: 'u_cA', organizationId: 'orgC', role: 'secge', email: 'a@asso.fr' });
  await setDoc(doc(d, 'memberships', 'u_cB_orgD'), { userId: 'u_cB', organizationId: 'orgD', role: 'secge', email: 'b@asso.fr' });
  await setDoc(doc(d, 'candidates', 'cC'), cand);
  await setDoc(doc(d, 'interviews', 'ivC'), iv);
  await setDoc(doc(d, 'interview_evaluations', 'campC_cC'), ev);
});

const entree = (orgId) => ({
  organizationId: orgId, type: 'cooptant', libelle: 'Léa', supprimePar: 'a@asso.fr', supprimeLe: serverTimestamp(),
  docs: [
    { col: 'candidates', id: 'cC', data: cand },
    { col: 'interviews', id: 'ivC', data: iv },
    { col: 'interview_evaluations', id: 'campC_cC', data: ev },
  ],
});

test('une autre asso ne peut pas remplir la corbeille de orgC', async () => {
  await assertFails(setDoc(doc(bureauB, 'corbeille', 'x1'), entree('orgC')));
  await assertFails(setDoc(doc(anonyme, 'corbeille', 'x2'), entree('orgC')));
});

test('mise en corbeille : copie et suppressions dans un seul lot', async () => {
  const lot = writeBatch(bureauA);
  lot.set(doc(bureauA, 'corbeille', 'e1'), entree('orgC'));
  lot.delete(doc(bureauA, 'candidates', 'cC'));
  lot.delete(doc(bureauA, 'interviews', 'ivC'));
  lot.delete(doc(bureauA, 'interview_evaluations', 'campC_cC'));
  await assertSucceeds(lot.commit());
  assert.equal((await getDoc(doc(bureauA, 'candidates', 'cC'))).exists(), false);
});

test('lecture : le bureau de l asso seulement, jamais public', async () => {
  await assertSucceeds(getDocs(query(collection(bureauA, 'corbeille'), where('organizationId', '==', 'orgC'))));
  await assertFails(getDoc(doc(bureauB, 'corbeille', 'e1')));
  await assertFails(getDoc(doc(anonyme, 'corbeille', 'e1')));
  await assertFails(getDocs(query(collection(bureauB, 'corbeille'), where('organizationId', '==', 'orgC'))));
});

test('une entree ne se modifie pas, et une autre asso ne la vide pas', async () => {
  await assertFails(updateDoc(doc(bureauA, 'corbeille', 'e1'), { libelle: 'autre' }));
  await assertFails(deleteDoc(doc(bureauB, 'corbeille', 'e1')));
});

test('restauration : les documents reviennent sous leur identifiant', async () => {
  const snap = await getDoc(doc(bureauA, 'corbeille', 'e1'));
  const lot = writeBatch(bureauA);
  snap.data().docs.forEach(d => lot.set(doc(bureauA, d.col, d.id), d.data));
  lot.delete(doc(bureauA, 'corbeille', 'e1'));
  await assertSucceeds(lot.commit());
  assert.equal((await getDoc(doc(bureauA, 'candidates', 'cC'))).data().prenom, 'Léa');
  assert.equal((await getDoc(doc(bureauA, 'interview_evaluations', 'campC_cC'))).data().criteria.c1, 4);
});

test.after(async () => { await env.cleanup(); });
