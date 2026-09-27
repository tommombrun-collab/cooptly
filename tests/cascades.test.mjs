/**
 * Cascades de suppression.
 *
 * Cette famille de bugs se ressemble toujours : on supprime le document
 * principal et on laisse derriere lui ceux qui le referencent. Le symptome
 * cote utilisateur est une donnee fantome qu'aucun ecran ne sait plus nommer
 * ni effacer (un entretien affiche « . », un jure affiche « ? »).
 *
 * On verifie ici que les regles laissent bien l'admin et le bureau supprimer
 * TOUT ce que les pages doivent nettoyer.
 */
import { initializeTestEnvironment, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert';

const env = await initializeTestEnvironment({
  projectId: 'demo-coopt',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const sansRegles = fn => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore()));

/** Les dix collections qu'une suppression d'asso doit emporter. */
const COLLECTIONS_ORG = [
  'candidates', 'interviews', 'interview_evaluations', 'staff_availabilities',
  'roster_members', 'rooms', 'room_bookings', 'invite_codes', 'memberships', 'campaigns',
];

test("admin : supprimer une asso emporte les dix collections rattachees", async () => {
  const admin = env.authenticatedContext('adm', { email: 'adm@x.fr' }).firestore();

  await sansRegles(async d => {
    await setDoc(doc(d, 'platform_admins', 'adm'), { email: 'adm@x.fr' });
    await setDoc(doc(d, 'organizations', 'orgZ'), { name: 'Asso Z', slug: 'asso-z' });
    for (const c of COLLECTIONS_ORG) {
      await setDoc(doc(d, c, `z_${c}`), { organizationId: 'orgZ', campaignId: 'campZ' });
    }
    // Document ancien : campaignId seul, sans organizationId. C'est le cas que
    // le rattrapage par campagne doit couvrir.
    await setDoc(doc(d, 'interviews', 'z_legacy'), { campaignId: 'campZ' });
    await setDoc(doc(d, 'campaigns', 'campZ'), { organizationId: 'orgZ' });
  });

  for (const c of COLLECTIONS_ORG) {
    await assertSucceeds(deleteDoc(doc(admin, c, `z_${c}`)));
  }
  await assertSucceeds(deleteDoc(doc(admin, 'interviews', 'z_legacy')));
  await assertSucceeds(deleteDoc(doc(admin, 'campaigns', 'campZ')));
  await assertSucceeds(deleteDoc(doc(admin, 'organizations', 'orgZ')));
});

test("admin : l'inventaire par campagne voit les documents sans organizationId", async () => {
  const admin = env.authenticatedContext('adm2', { email: 'adm2@x.fr' }).firestore();
  await sansRegles(async d => {
    await setDoc(doc(d, 'platform_admins', 'adm2'), { email: 'adm2@x.fr' });
    await setDoc(doc(d, 'interviews', 'legacy1'), { campaignId: 'campL' });
  });
  const trouves = await getDocs(query(collection(admin, 'interviews'), where('campaignId', '==', 'campL')));
  assert.equal(trouves.size, 1, 'un entretien sans organizationId doit rester trouvable par campagne');
});

test('bureau : retirer un membre emporte ses fiches de dispos', async () => {
  const bureau = env.authenticatedContext('u_m', { email: 'm@asso.fr' }).firestore();
  await sansRegles(async d => {
    await setDoc(doc(d, 'memberships', 'u_m_orgM'), { userId: 'u_m', organizationId: 'orgM', role: 'secge', email: 'm@asso.fr' });
    await setDoc(doc(d, 'memberships', 'u_parti_orgM'), { userId: 'u_parti', organizationId: 'orgM', role: 'membre', email: 'p@asso.fr' });
    await setDoc(doc(d, 'staff_availabilities', 'sa_parti'), { userId: 'u_parti', campaignId: 'campM', organizationId: 'orgM', creneaux: [] });
  });

  // La requete que fait `disposDe()` avant de supprimer.
  const dispos = await getDocs(query(
    collection(bureau, 'staff_availabilities'),
    where('userId', '==', 'u_parti'), where('campaignId', '==', 'campM')
  ));
  assert.equal(dispos.size, 1, 'le bureau doit pouvoir retrouver les dispos de la personne');

  await assertSucceeds(deleteDoc(doc(bureau, 'staff_availabilities', 'sa_parti')));
  await assertSucceeds(deleteDoc(doc(bureau, 'memberships', 'u_parti_orgM')));
});

test('bureau : retirer un nom du roster emporte ses fiches de dispos', async () => {
  const bureau = env.authenticatedContext('u_n', { email: 'n@asso.fr' }).firestore();
  await sansRegles(async d => {
    await setDoc(doc(d, 'memberships', 'u_n_orgN'), { userId: 'u_n', organizationId: 'orgN', role: 'secge', email: 'n@asso.fr' });
    await setDoc(doc(d, 'roster_members', 'ros1'), { organizationId: 'orgN', displayName: 'Lea M' });
    await setDoc(doc(d, 'staff_availabilities', 'sa_ros1'), { userId: 'ros1', campaignId: 'campN', organizationId: 'orgN', creneaux: [] });
  });
  await assertSucceeds(deleteDoc(doc(bureau, 'staff_availabilities', 'sa_ros1')));
  await assertSucceeds(deleteDoc(doc(bureau, 'roster_members', 'ros1')));
});

test('bureau : la fusion des doublons peut rattacher les dispos au nom conserve', async () => {
  const bureau = env.authenticatedContext('u_f', { email: 'f@asso.fr' }).firestore();
  await sansRegles(async d => {
    await setDoc(doc(d, 'memberships', 'u_f_orgF'), { userId: 'u_f', organizationId: 'orgF', role: 'secge', email: 'f@asso.fr' });
    await setDoc(doc(d, 'roster_members', 'garde'), { organizationId: 'orgF', displayName: 'Camille M' });
    await setDoc(doc(d, 'roster_members', 'sosie'), { organizationId: 'orgF', displayName: 'tom m' });
    await setDoc(doc(d, 'staff_availabilities', 'sa_sosie'), { userId: 'sosie', campaignId: 'campF', organizationId: 'orgF', creneaux: [] });
  });
  // Rattachement plutot que suppression : la dispo suit la personne conservee.
  await assertSucceeds(setDoc(doc(bureau, 'staff_availabilities', 'sa_sosie'),
    { userId: 'garde', displayName: 'Camille M', campaignId: 'campF', organizationId: 'orgF', creneaux: [] }));
  await assertSucceeds(deleteDoc(doc(bureau, 'roster_members', 'sosie')));
});

test.after(async () => { await env.cleanup(); });
