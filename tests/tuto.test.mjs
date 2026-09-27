/**
 * Visite guidée : le « déjà vu » est rangé dans users/{uid}.tutoVu.
 * Chacun doit pouvoir lire et écrire SON profil, jamais celui des autres.
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const env = await initializeTestEnvironment({
  projectId: 'demo-coopt',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const moi    = env.authenticatedContext('u_moi',    { email: 'moi@asso.fr' }).firestore();
const autre  = env.authenticatedContext('u_autre',  { email: 'autre@asso.fr' }).firestore();
const anon   = env.unauthenticatedContext().firestore();

test('je lis mon propre profil (sinon la visite reviendrait a chaque connexion)', async () => {
  await env.withSecurityRulesDisabled(ctx =>
    setDoc(doc(ctx.firestore(), 'users', 'u_moi'), { email: 'moi@asso.fr', tutoVu: 1 }));
  await assertSucceeds(getDoc(doc(moi, 'users', 'u_moi')));
});

test('je marque la visite comme vue dans mon profil', async () => {
  await assertSucceeds(setDoc(doc(moi, 'users', 'u_moi'), { tutoVu: 1 }, { merge: true }));
});

test('je ne lis PAS le profil d un autre membre', async () => {
  await env.withSecurityRulesDisabled(ctx =>
    setDoc(doc(ctx.firestore(), 'users', 'u_autre'), { email: 'autre@asso.fr' }));
  await assertFails(getDoc(doc(moi, 'users', 'u_autre')));
});

test('je ne modifie PAS le profil d un autre membre', async () => {
  await assertFails(setDoc(doc(moi, 'users', 'u_autre'), { tutoVu: 1 }, { merge: true }));
});

test('un anonyme ne lit aucun profil', async () => {
  await assertFails(getDoc(doc(anon, 'users', 'u_moi')));
});

test.after(async () => { await env.cleanup(); });
