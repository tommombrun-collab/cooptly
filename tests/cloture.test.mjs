/**
 * Clôture d'un recrutement (public/js/cloture.js) : le bureau efface TOUTES
 * les données des cooptants de l'année, pour que le bureau suivant (souvent
 * recruté parmi eux) ne voie pas leurs notes.
 *
 * Rejoue les requêtes et le lot du module (qui importe le SDK depuis un CDN)
 * avec les droits d'un membre du bureau : chaque requête doit passer les
 * règles (filtres par asso là où la collection est cloisonnée), et une autre
 * asso ne doit rien pouvoir effacer.
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, collection, query, where, writeBatch, Timestamp, arrayUnion, deleteField } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert';

const env = await initializeTestEnvironment({
  projectId: 'demo-coopt',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const bureau = env.authenticatedContext('u_clo', { email: 'clo@asso.fr' }).firestore();
const autre  = env.authenticatedContext('u_clo2', { email: 'autre@asso.fr' }).firestore();
const O = 'orgClo', C = 'campClo';
const passe = Timestamp.fromMillis(Date.now() - 86400000);

await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'memberships', `u_clo_${O}`), { userId: 'u_clo', organizationId: O, role: 'secge', email: 'clo@asso.fr' });
  await setDoc(doc(d, 'memberships', 'u_clo2_orgAutre'), { userId: 'u_clo2', organizationId: 'orgAutre', role: 'secge', email: 'autre@asso.fr' });
  await setDoc(doc(d, 'campaigns', C), { organizationId: O, config: { nbJurys: 2 }, recrutementOuvert: true });
  await setDoc(doc(d, 'candidates', 'cClo'), { organizationId: O, campaignId: C, email: 'x@edu.fr', prenom: 'Léa' });
  await setDoc(doc(d, 'interviews', 'ivClo'), { organizationId: O, campaignId: C, candidateId: 'cClo', datetimeStart: passe });
  await setDoc(doc(d, 'interview_evaluations', `${C}_cClo`), { organizationId: O, campaignId: C, candidateId: 'cClo', criteria: { a: 4 } });
  await setDoc(doc(d, 'notes_internes', 'c_cClo'), { organizationId: O, campaignId: C, candidateId: 'cClo', texte: 'avis' });
  await setDoc(doc(d, 'absences', `ivClo_${passe.toMillis()}`), { organizationId: O, campaignId: C, candidateId: 'cClo', interviewId: 'ivClo', datetimeStart: passe });
  await setDoc(doc(d, 'staff_availabilities', 'saClo'), { organizationId: O, campaignId: C, userId: 'r1', creneaux: [] });
  await setDoc(doc(d, 'corbeille', 'eClo'), { organizationId: O, type: 'cooptant', libelle: 'Léa', docs: [] });
  // Une autre asso : rien ne doit la toucher.
  await setDoc(doc(d, 'candidates', 'cAutre'), { organizationId: 'orgAutre', campaignId: 'campAutre', email: 'y@edu.fr' });
});

const requetes = db => [
  query(collection(db, 'candidates'), where('campaignId', '==', C)),
  query(collection(db, 'interviews'), where('campaignId', '==', C)),
  query(collection(db, 'interview_evaluations'), where('organizationId', '==', O), where('campaignId', '==', C)),
  query(collection(db, 'notes_internes'), where('organizationId', '==', O)),
  query(collection(db, 'absences'), where('organizationId', '==', O), where('campaignId', '==', C)),
  query(collection(db, 'staff_availabilities'), where('campaignId', '==', C)),
  query(collection(db, 'corbeille'), where('organizationId', '==', O)),
];

test('une autre asso ne lit pas les données privées à effacer', async () => {
  const [, , evals, notes, absences, , corbeille] = requetes(autre);
  for (const q of [evals, notes, absences, corbeille]) await assertFails(getDocs(q));
});

test('clôture : le bureau ferme le recrutement et garde des chiffres anonymes', async () => {
  await assertSucceeds(updateDoc(doc(bureau, 'campaigns', C), {
    etat: 'cloture', recrutementOuvert: false, statut: 'fermee',
    effacementPrevuLe: Timestamp.fromMillis(Date.now() + 30 * 86400000),
    historique: arrayUnion({ candidatures: 1, entretiens: 1, evalues: 1, absences: 1 }),
  }));
});

test('une autre asso ne peut ni clôturer ni effacer', async () => {
  await assertFails(updateDoc(doc(autre, 'campaigns', C), { etat: 'cloture' }));
  const lot = writeBatch(autre);
  lot.delete(doc(autre, 'interview_evaluations', `${C}_cClo`));
  await assertFails(lot.commit());
});

test('effacement : toutes les requêtes passent, puis un seul lot efface tout', async () => {
  const snaps = await Promise.all(requetes(bureau).map(q => assertSucceeds(getDocs(q))));
  const docs = snaps.flatMap(s => s.docs);
  assert.equal(docs.length, 7);
  const lot = writeBatch(bureau);
  docs.forEach(d => lot.delete(d.ref));
  await assertSucceeds(lot.commit());
  for (const [col, id] of [['candidates', 'cClo'], ['interview_evaluations', `${C}_cClo`], ['notes_internes', 'c_cClo'], ['corbeille', 'eClo']]) {
    let existe;
    await env.withSecurityRulesDisabled(async ctx => { existe = (await getDoc(doc(ctx.firestore(), col, id))).exists(); });
    assert.equal(existe, false, `${col}/${id} effacé`);
  }
  let intact;
  await env.withSecurityRulesDisabled(async ctx => { intact = (await getDoc(doc(ctx.firestore(), 'candidates', 'cAutre'))).exists(); });
  assert.equal(intact, true);
});

test('préparer le suivant : dates retirées, état « préparation »', async () => {
  await assertSucceeds(updateDoc(doc(bureau, 'campaigns', C), {
    etat: 'preparation', config: { nbJurys: 2, dateDebut: null, dateFin: null },
    effacementPrevuLe: deleteField(), assistantFait: false, rankOrder: [],
  }));
});

test.after(() => env.cleanup());
