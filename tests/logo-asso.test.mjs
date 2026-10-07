/**
 * Logo d'une asso : le bureau le change lui-même (Paramètres), rien d'autre
 * de l'asso ; une autre asso ou un anonyme ne peut pas.
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const env = await initializeTestEnvironment({
  projectId: 'demo-coopt',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});
const bureau = env.authenticatedContext('u_lgA', { email: 'a@asso.fr' }).firestore();
const autre = env.authenticatedContext('u_lgB', { email: 'b@asso.fr' }).firestore();
const anonyme = env.unauthenticatedContext().firestore();
const admin = env.authenticatedContext('u_lgAdmin', { email: 'admin@asso.fr' }).firestore();

await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'organizations', 'orgLg'), { name: 'Asso', slug: 'asso', primaryColor: '#7c9082' });
  await setDoc(doc(d, 'memberships', 'u_lgA_orgLg'), { userId: 'u_lgA', organizationId: 'orgLg', role: 'secge' });
  await setDoc(doc(d, 'memberships', 'u_lgB_orgAutre'), { userId: 'u_lgB', organizationId: 'orgAutre', role: 'secge' });
  await setDoc(doc(d, 'platform_admins', 'u_lgAdmin'), { email: 'admin@asso.fr' });
});

const LOGO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';

test('le bureau met et retire le logo de son asso', async () => {
  await assertSucceeds(updateDoc(doc(bureau, 'organizations', 'orgLg'), { logoBase64: LOGO }));
  await assertSucceeds(updateDoc(doc(bureau, 'organizations', 'orgLg'), { logoBase64: '' }));
});

test('le bureau ne change rien d\'autre, ni une image qui n\'en est pas une', async () => {
  await assertFails(updateDoc(doc(bureau, 'organizations', 'orgLg'), { name: 'Autre nom' }));
  await assertFails(updateDoc(doc(bureau, 'organizations', 'orgLg'), { logoBase64: LOGO, slug: 'pirate' }));
  await assertFails(updateDoc(doc(bureau, 'organizations', 'orgLg'), { logoBase64: 'javascript:alert(1)' }));
  await assertFails(updateDoc(doc(bureau, 'organizations', 'orgLg'), { logoBase64: 'data:image/jpeg;base64,' + 'A'.repeat(300000) }));
});

test('une autre asso ou un anonyme ne peut pas ; l\'admin peut tout', async () => {
  await assertFails(updateDoc(doc(autre, 'organizations', 'orgLg'), { logoBase64: LOGO }));
  await assertFails(updateDoc(doc(anonyme, 'organizations', 'orgLg'), { logoBase64: LOGO }));
  await assertSucceeds(updateDoc(doc(admin, 'organizations', 'orgLg'), { name: 'Asso renommée', logoBase64: LOGO }));
});

test.after(() => env.cleanup());
