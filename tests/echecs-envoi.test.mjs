/**
 * Relevé anonyme des envois ratés du formulaire (collection `echecs_envoi`) :
 * écrit sans compte, borné, sans donnée personnelle ; lu par l'admin seulement.
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, updateDoc, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const env = await initializeTestEnvironment({
  projectId: 'demo-coopt',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});
const anonyme = env.unauthenticatedContext().firestore();
const bureau = env.authenticatedContext('u_eeBureau', { email: 'b@asso.fr' }).firestore();
const admin = env.authenticatedContext('u_eeAdmin', { email: 'admin@asso.fr' }).firestore();

await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'platform_admins', 'u_eeAdmin'), { email: 'admin@asso.fr' });
  await setDoc(doc(d, 'memberships', 'u_eeBureau_orgEe'), { userId: 'u_eeBureau', organizationId: 'orgEe', role: 'secge' });
});

const echec = (extra = {}) => ({
  organizationId: 'orgEe', campaignId: 'campEe', etape: 'envoi', code: 'unavailable',
  message: 'Failed to get document because the client is offline.', enLigne: false,
  navigateur: 'Mozilla/5.0 (iPhone)', createdAt: serverTimestamp(), ...extra,
});

test('un cooptant sans compte peut relever un envoi raté', async () => {
  await assertSucceeds(setDoc(doc(anonyme, 'echecs_envoi', 'e1'), echec()));
});

test('pas de champ en plus (donnée personnelle), pas de valeurs hors bornes', async () => {
  await assertFails(setDoc(doc(anonyme, 'echecs_envoi', 'e2'), echec({ email: 'x@edu.em-lyon.com' })));
  await assertFails(setDoc(doc(anonyme, 'echecs_envoi', 'e3'), echec({ etape: 'autre' })));
  await assertFails(setDoc(doc(anonyme, 'echecs_envoi', 'e4'), echec({ message: 'x'.repeat(301) })));
});

test('lecture : l\'admin seulement ; personne ne modifie', async () => {
  await assertSucceeds(getDoc(doc(admin, 'echecs_envoi', 'e1')));
  await assertSucceeds(getDocs(collection(admin, 'echecs_envoi')));
  await assertFails(getDoc(doc(anonyme, 'echecs_envoi', 'e1')));
  await assertFails(getDoc(doc(bureau, 'echecs_envoi', 'e1')));
  await assertFails(updateDoc(doc(anonyme, 'echecs_envoi', 'e1'), { code: 'x' }));
});

test.after(() => env.cleanup());
