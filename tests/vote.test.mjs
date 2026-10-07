/**
 * Vote des membres (js/vote.js, voter.html) : règles des scrutins, bulletins
 * et participations, et calcul des coups de cœur.
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, serverTimestamp, writeBatch, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert';
import { derniersBulletins, compterCoeurs, classerParCoeurs, maxCoeursConseille, nouveauJeton, tauxCoeurs, plebiscite, votantsPour } from '../public/js/vote.js';

const env = await initializeTestEnvironment({
  projectId: 'demo-coopt',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});
const bureau = env.authenticatedContext('u_vA', { email: 'a@asso.fr' }).firestore();
const autre = env.authenticatedContext('u_vB', { email: 'b@asso.fr' }).firestore();
const anonyme = env.unauthenticatedContext().firestore();

const S = 'Jeton0123456789abcdefXYZ';   // 24 caractères
await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'memberships', 'u_vA_orgV'), { userId: 'u_vA', organizationId: 'orgV', role: 'secge' });
  await setDoc(doc(d, 'memberships', 'u_vB_orgAutreV'), { userId: 'u_vB', organizationId: 'orgAutreV', role: 'secge' });
  await setDoc(doc(d, 'scrutins', S), {
    organizationId: 'orgV', campaignId: 'campV', ouvert: true, methode: 'coeurs', maxCoeurs: 2,
    votantIds: ['ros1', 'ros2'], votants: [{ id: 'ros1', nom: 'Alice' }, { id: 'ros2', nom: 'Bruno' }],
    cooptantIds: ['c1', 'c2', 'c3'], cooptants: [],
  });
});

const bulletin = (extra = {}) => ({ scrutinId: S, organizationId: 'orgV', campaignId: 'campV', votantId: 'ros1', coeurs: ['c1', 'c2'], envoyeLe: serverTimestamp(), ...extra });
const participation = (envois, extra = {}) => ({ scrutinId: S, organizationId: 'orgV', campaignId: 'campV', votantId: 'ros1', envois, dernierEnvoi: serverTimestamp(), ...extra });

test('le lien suffit pour lire le scrutin, pas pour lister ceux des assos', async () => {
  await assertSucceeds(getDoc(doc(anonyme, 'scrutins', S)));
  await assertFails(getDocs(collection(anonyme, 'scrutins')));
  await assertSucceeds(getDocs(query(collection(bureau, 'scrutins'), where('organizationId', '==', 'orgV'))));
  await assertFails(getDocs(query(collection(autre, 'scrutins'), where('organizationId', '==', 'orgV'))));
});

test('seul le bureau de l\'asso crée un scrutin, avec un jeton long', async () => {
  const s = { organizationId: 'orgV', campaignId: 'campV', ouvert: true, maxCoeurs: 3, votantIds: [], cooptantIds: [] };
  await assertSucceeds(setDoc(doc(bureau, 'scrutins', nouveauJeton()), s));
  await assertFails(setDoc(doc(bureau, 'scrutins', 'court'), s));
  await assertFails(setDoc(doc(autre, 'scrutins', nouveauJeton()), s));
  await assertFails(setDoc(doc(anonyme, 'scrutins', nouveauJeton()), s));
});

test('un membre vote sans compte, dans les limites du scrutin', async () => {
  await assertSucceeds(setDoc(doc(anonyme, 'bulletins', 'b1'), bulletin()));
  await assertSucceeds(setDoc(doc(anonyme, 'bulletins', 'b0'), bulletin({ coeurs: [] })));
  await assertFails(setDoc(doc(anonyme, 'bulletins', 'b2'), bulletin({ votantId: 'inconnu' })));
  await assertFails(setDoc(doc(anonyme, 'bulletins', 'b3'), bulletin({ coeurs: ['c1', 'c2', 'c3'] })));   // plus que maxCoeurs
  await assertFails(setDoc(doc(anonyme, 'bulletins', 'b4'), bulletin({ coeurs: ['pirate'] })));          // cooptant hors scrutin
  await assertFails(setDoc(doc(anonyme, 'bulletins', 'b5'), bulletin({ organizationId: 'orgAutreV' })));
  await assertFails(setDoc(doc(anonyme, 'bulletins', 'b6'), bulletin({ commentaire: 'x' })));
  await assertFails(setDoc(doc(anonyme, 'bulletins', 'b7'), bulletin({ envoyeLe: Timestamp.fromMillis(0) })));
  // Un bulletin ne se modifie jamais : un nouveau vote est un nouvel envoi.
  await assertFails(updateDoc(doc(anonyme, 'bulletins', 'b1'), { coeurs: ['c3'] }));
});

test('abstentions : 5 au plus, des cooptants du scrutin, jamais avec un cœur', async () => {
  await assertSucceeds(setDoc(doc(anonyme, 'bulletins', 'ba1'), bulletin({ coeurs: ['c1'], abstentions: ['c2'] })));
  await assertSucceeds(setDoc(doc(anonyme, 'bulletins', 'ba2'), bulletin({ abstentions: [] })));
  await assertFails(setDoc(doc(anonyme, 'bulletins', 'ba3'), bulletin({ coeurs: ['c1'], abstentions: ['c1'] })));   // cœur ET abstention
  await assertFails(setDoc(doc(anonyme, 'bulletins', 'ba4'), bulletin({ coeurs: ['c1'], abstentions: Array(6).fill('c3') })));
  await assertFails(setDoc(doc(anonyme, 'bulletins', 'ba5'), bulletin({ abstentions: ['pirate'] })));
  await assertFails(setDoc(doc(anonyme, 'bulletins', 'ba6'), bulletin({ abstentions: 'c3' })));
});

test('participation : 1 au premier envoi, +1 ensuite, rien d\'autre', async () => {
  const ref = d => doc(d, 'participations', `${S}_ros1`);
  await assertFails(setDoc(doc(anonyme, 'participations', `${S}_ros2`), participation(1)));   // id d'un autre votant
  await assertFails(setDoc(ref(anonyme), participation(2)));
  await assertSucceeds(setDoc(ref(anonyme), participation(1)));
  await assertFails(setDoc(ref(anonyme), participation(5)));
  await assertSucceeds(setDoc(ref(anonyme), participation(2)));
  await assertSucceeds(getDoc(ref(anonyme)));   // « tu as déjà voté », sans le contenu
  // Bulletin et participation partent ensemble.
  const lot = writeBatch(anonyme);
  lot.set(doc(anonyme, 'bulletins', 'b8'), bulletin({ coeurs: ['c3'] }));
  lot.set(ref(anonyme), participation(3));
  await assertSucceeds(lot.commit());
});

test('vote ouvert : personne ne lit les bulletins, pas même le bureau', async () => {
  const q = d => query(collection(d, 'bulletins'), where('organizationId', '==', 'orgV'), where('scrutinId', '==', S));
  await assertFails(getDocs(q(bureau)));
  await assertFails(getDocs(q(anonyme)));
  await assertFails(getDoc(doc(bureau, 'bulletins', 'b1')));
  // Le bureau suit qui a voté (sans le contenu).
  await assertSucceeds(getDocs(query(collection(bureau, 'participations'), where('organizationId', '==', 'orgV'), where('scrutinId', '==', S))));
  await assertFails(getDocs(query(collection(autre, 'participations'), where('organizationId', '==', 'orgV'))));
});

test('vote clos : plus d\'envoi ; le bureau de l\'asso lit les bulletins, une autre asso non', async () => {
  await assertFails(updateDoc(doc(autre, 'scrutins', S), { ouvert: false }));
  await assertFails(updateDoc(doc(bureau, 'scrutins', S), { ouvert: false, organizationId: 'orgAutreV' }));
  await assertSucceeds(updateDoc(doc(bureau, 'scrutins', S), { ouvert: false }));
  await assertFails(setDoc(doc(anonyme, 'bulletins', 'b9'), bulletin()));
  await assertFails(setDoc(doc(anonyme, 'participations', `${S}_ros2`), participation(1, { votantId: 'ros2' })));
  const q = d => query(collection(d, 'bulletins'), where('organizationId', '==', 'orgV'), where('scrutinId', '==', S));
  const lus = await assertSucceeds(getDocs(q(bureau)));
  assert.equal(lus.size, 5);   // b1, b0, ba1, ba2 et b8 : les autres ont été refusés
  await assertFails(getDocs(q(autre)));
  await assertFails(getDocs(q(anonyme)));
});

test('le bureau efface le vote ; un anonyme ou une autre asso, non', async () => {
  await assertFails(deleteDoc(doc(anonyme, 'bulletins', 'b1')));
  await assertFails(deleteDoc(doc(autre, 'bulletins', 'b1')));
  await assertSucceeds(deleteDoc(doc(bureau, 'bulletins', 'b1')));
  await assertSucceeds(deleteDoc(doc(bureau, 'participations', `${S}_ros1`)));
  await assertSucceeds(deleteDoc(doc(bureau, 'scrutins', S)));
  // Scrutin supprimé : les bulletins restants se lisent encore pour être effacés.
  await assertSucceeds(getDoc(doc(bureau, 'bulletins', 'b0')));
});

test('clôture du recrutement : un vote encore ouvert est clos, puis tout est effacé (js/cloture.js)', async () => {
  const S2 = 'Cloture0123456789abcdefg';
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'scrutins', S2), { organizationId: 'orgV', campaignId: 'campV', ouvert: true, maxCoeurs: 2,
      votantIds: ['ros1'], cooptantIds: ['c1'] });
  });
  const lot0 = writeBatch(anonyme);
  lot0.set(doc(anonyme, 'bulletins', 'bc1'), bulletin({ scrutinId: S2, coeurs: ['c1'] }));
  lot0.set(doc(anonyme, 'participations', `${S2}_ros1`), participation(1, { scrutinId: S2 }));
  await assertSucceeds(lot0.commit());
  // Rejoue documentsDesVotes puis le lot d'effacement.
  const scrutins = await assertSucceeds(getDocs(query(collection(bureau, 'scrutins'), where('organizationId', '==', 'orgV'), where('campaignId', '==', 'campV'))));
  const lot1 = writeBatch(bureau);
  scrutins.docs.filter(d => d.data().ouvert === true).forEach(d => lot1.update(d.ref, { ouvert: false }));
  await assertSucceeds(lot1.commit());
  const docs = [];
  for (const sc of scrutins.docs) {
    for (const col of ['bulletins', 'participations']) {
      const r = await assertSucceeds(getDocs(query(collection(bureau, col), where('organizationId', '==', 'orgV'), where('scrutinId', '==', sc.id))));
      docs.push(...r.docs);
    }
  }
  docs.push(...scrutins.docs);
  const lot2 = writeBatch(bureau);
  docs.forEach(d => lot2.delete(d.ref));
  await assertSucceeds(lot2.commit());
  const reste = await getDocs(query(collection(bureau, 'scrutins'), where('organizationId', '==', 'orgV'), where('campaignId', '==', 'campV')));
  assert.equal(reste.size, 0);
});

// ── Calcul ─────────────────────────────────────────────────────
const t = h => new Date(2026, 9, 7, h);

test('seul le dernier envoi de chaque votant compte ; les envois multiples sont signalés', () => {
  const bulletins = [
    { votantId: 'a', coeurs: ['x', 'y'], envoyeLe: t(10) },
    { votantId: 'a', coeurs: ['z'], envoyeLe: t(12) },
    { votantId: 'b', coeurs: ['x', 'x'], envoyeLe: t(11) },
  ];
  const { dernier, envois } = derniersBulletins(bulletins);
  assert.deepEqual(dernier.get('a').coeurs, ['z']);
  assert.equal(envois.get('a'), 2);
  const r = compterCoeurs(bulletins);
  assert.equal(r.votants, 2);
  assert.equal(r.coeurs.get('x'), 1);   // b l'a coché deux fois : un seul cœur
  assert.equal(r.coeurs.get('y'), undefined);
  assert.equal(r.coeurs.get('z'), 1);
  assert.deepEqual(r.plusieursEnvois, [{ votantId: 'a', envois: 2 }]);
});

test('classement provisoire : cœurs, puis score, puis nom', () => {
  const cooptants = [
    { id: 'c1', prenom: 'Zoé', score: 80 }, { id: 'c2', prenom: 'Adam', score: 60 },
    { id: 'c3', prenom: 'Léa', score: null }, { id: 'c4', prenom: 'Bob', score: 90 }, { id: 'c5', prenom: 'Ali', score: 60 },
  ];
  const coeurs = new Map([['c2', 3], ['c3', 3], ['c1', 1]]);
  assert.deepEqual(classerParCoeurs(cooptants, coeurs, c => c.score), ['c2', 'c3', 'c1', 'c4', 'c5']);
});

test('abstentions : ni pour ni contre ; on classe sur la part des votants qui se sont prononcés', () => {
  const bulletins = [
    { votantId: 'a', coeurs: ['x', 'y'], abstentions: ['z'], envoyeLe: t(10) },
    { votantId: 'b', coeurs: ['x', 'z'], envoyeLe: t(10) },
    { votantId: 'c', coeurs: ['z'], abstentions: [], envoyeLe: t(10) },
    { votantId: 'd', coeurs: ['y', 'w'], abstentions: ['w'], envoyeLe: t(10) },   // cœur ET abstention : l'abstention gagne
  ];
  const r = compterCoeurs(bulletins);
  assert.equal(r.votants, 4);
  assert.equal(r.abstentions.get('z'), 1);
  assert.equal(r.coeurs.get('w'), undefined);
  assert.equal(votantsPour('z', r), 3);
  assert.equal(tauxCoeurs('z', r), 2 / 3);   // 2 cœurs sur 3 qui se sont prononcés
  assert.equal(tauxCoeurs('x', r), 2 / 4);
  // z (2 sur 3) passe devant x et y (2 sur 4) ; x devant y au score.
  const cooptants = [{ id: 'x', s: 70 }, { id: 'y', s: 60 }, { id: 'z', s: 50 }, { id: 'w', s: 90 }];
  assert.deepEqual(classerParCoeurs(cooptants, r.coeurs, c => c.s, r), ['z', 'x', 'y', 'w']);
  // Plébiscité : deux tiers des votants, dont au moins 3.
  assert.equal(plebiscite('z', r), true);
  assert.equal(plebiscite('x', r), false);
  assert.equal(plebiscite('z', { votants: 2, coeurs: new Map([['z', 2]]), abstentions: new Map() }), false);
});

test('nombre de coups de cœur conseillé et jeton', () => {
  assert.equal(maxCoeursConseille(24), 8);
  assert.equal(maxCoeursConseille(2), 1);
  assert.equal(maxCoeursConseille(90), 15);
  assert.equal(maxCoeursConseille(0), 5);
  const j = nouveauJeton();
  assert.match(j, /^[A-Za-z0-9]{24}$/);
  assert.notEqual(j, nouveauJeton());
});

test.after(() => env.cleanup());
