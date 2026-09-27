/**
 * Suppression d'un cooptant depuis candidats.html, requêtes COMPRISES.
 *
 * Le test de cascade précédent ne faisait que des deleteDoc par identifiant.
 * Or la page commence par RECHERCHER l'entretien et l'évaluation du cooptant,
 * et Firestore refuse une requête s'il ne peut pas prouver, à partir de ses
 * seuls filtres, que chaque résultat serait lisible (« rules are not filters »).
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const env = await initializeTestEnvironment({
  projectId: 'demo-coopt',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const bureau = env.authenticatedContext('u_sup', { email: 'sup@asso.fr' }).firestore();

await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'memberships', 'u_sup_orgS'), { userId: 'u_sup', organizationId: 'orgS', role: 'secge', email: 'sup@asso.fr' });
  await setDoc(doc(d, 'candidates', 'cS'),  { campaignId: 'campS', organizationId: 'orgS', email: 'tom@x.fr' });
  await setDoc(doc(d, 'interviews', 'ivS'), { campaignId: 'campS', organizationId: 'orgS', candidateId: 'cS' });
  await setDoc(doc(d, 'interview_evaluations', 'campS_cS'), { campaignId: 'campS', organizationId: 'orgS', candidateId: 'cS' });
});

test('diagnostic : chercher les evaluations par cooptant SEUL est refuse', async () => {
  await assertFails(getDocs(query(collection(bureau, 'interview_evaluations'), where('candidateId', '==', 'cS'))));
});

test('en filtrant aussi par asso, la recherche passe', async () => {
  await assertSucceeds(getDocs(query(collection(bureau, 'interview_evaluations'),
    where('organizationId', '==', 'orgS'), where('candidateId', '==', 'cS'))));
});

test('suppression complete, telle que la fait candidats.html', async () => {
  const [ivs, evals] = await Promise.all([
    getDocs(query(collection(bureau, 'interviews'), where('candidateId', '==', 'cS'))),
    getDocs(query(collection(bureau, 'interview_evaluations'),
      where('organizationId', '==', 'orgS'), where('candidateId', '==', 'cS'))),
  ]);
  await assertSucceeds(Promise.all([
    ...ivs.docs.map(d => deleteDoc(d.ref)),
    ...evals.docs.map(d => deleteDoc(d.ref)),
  ]));
  await assertSucceeds(deleteDoc(doc(bureau, 'candidates', 'cS')));
});

test.after(async () => { await env.cleanup(); });
