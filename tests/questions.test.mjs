/**
 * Ordre des questions du formulaire et rattachement des réponses.
 *
 * Ces fonctions vivent dans des pages HTML et ne sont pas importables : on les
 * extrait de la source par leur nom. Si l'une disparaît, le test échoue en le
 * disant, plutôt que de passer en silence sur du code qui ne serait plus couvert.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { reponseA, texteReponse, reponsesOrdonnees } from '../public/js/utils.js';

/** Extrait une fonction de premier niveau (`function nom(...) { ... }`). */
function extraireFonction(src, nom, fichier) {
  const debut = src.indexOf(`function ${nom}(`);
  assert.ok(debut >= 0, `${nom}() introuvable dans ${fichier} : remettre ce test à jour.`);
  let profondeur = 0, i = src.indexOf('{', debut);
  for (; i < src.length; i++) {
    if (src[i] === '{') profondeur++;
    else if (src[i] === '}' && --profondeur === 0) break;
  }
  return src.slice(debut, i + 1);
}

const PARAMS = readFileSync('public/parametres.html', 'utf8');

const { positionDeDepot, assurerIdsQuestions } = new Function(`
  ${extraireFonction(PARAMS, 'nouvelIdQuestion', 'parametres.html')}
  ${extraireFonction(PARAMS, 'assurerIdsQuestions', 'parametres.html')}
  ${extraireFonction(PARAMS, 'positionDeDepot', 'parametres.html')}
  return { positionDeDepot, assurerIdsQuestions };
`)();

// Logique partagée dans utils.js (page Cooptants et popup du planning).
const fabriquerLecteur = questions => ({
  reponseA, texteReponse,
  reponsesOrdonnees: c => reponsesOrdonnees(c, questions),
});

/** Applique un glisser-déposer comme le fait deplacerQuestion(). */
const deposer = (liste, de, cible, dessous) => {
  const vers = positionDeDepot(de, cible, dessous);
  const copie = [...liste];
  const [x] = copie.splice(de, 1);
  copie.splice(vers, 0, x);
  return copie;
};

// ─── Glisser-déposer ─────────────────────────────────────────────

test('monter une question au-dessus d une autre', () => {
  assert.deepEqual(deposer(['A', 'B', 'C', 'D'], 3, 1, false), ['A', 'D', 'B', 'C']);
});

test('descendre une question sous une autre : pas une ligne trop bas', () => {
  // Le piege : sans la correction, A atterrissait apres D.
  assert.deepEqual(deposer(['A', 'B', 'C', 'D'], 0, 2, true), ['B', 'C', 'A', 'D']);
});

test('descendre au-dessus d une ligne', () => {
  assert.deepEqual(deposer(['A', 'B', 'C', 'D'], 0, 2, false), ['B', 'A', 'C', 'D']);
});

test('tout en haut et tout en bas', () => {
  assert.deepEqual(deposer(['A', 'B', 'C', 'D'], 3, 0, false), ['D', 'A', 'B', 'C']);
  assert.deepEqual(deposer(['A', 'B', 'C', 'D'], 0, 3, true),  ['B', 'C', 'D', 'A']);
});

test('lacher juste a cote de sa position : ne bouge pas', () => {
  assert.deepEqual(deposer(['A', 'B', 'C'], 1, 0, true),  ['A', 'B', 'C']);
  assert.deepEqual(deposer(['A', 'B', 'C'], 1, 2, false), ['A', 'B', 'C']);
});

test('aucune question ne disparait, quel que soit le deplacement', () => {
  const base = ['A', 'B', 'C', 'D', 'E'];
  for (let de = 0; de < 5; de++)
    for (let cible = 0; cible < 5; cible++)
      for (const dessous of [true, false]) {
        if (de === cible) continue;
        const res = deposer(base, de, cible, dessous);
        assert.deepEqual([...res].sort(), base, `de ${de} vers ${cible} (${dessous})`);
      }
});

// ─── Identifiants ────────────────────────────────────────────────

test('les questions sans id en recoivent un, avec leur position d origine', () => {
  const res = assurerIdsQuestions([{ label: 'Nom' }, { label: 'Tel' }]);
  assert.ok(res[0].id && res[1].id && res[0].id !== res[1].id);
  assert.equal(res[0].legacyIndex, 0);
  assert.equal(res[1].legacyIndex, 1);
});

test('une question deja identifiee est laissee intacte', () => {
  const q = { id: 'q_abc', label: 'Nom' };
  const [res] = assurerIdsQuestions([q]);
  assert.equal(res, q, 'meme objet, rien de reecrit');
  assert.equal(res.legacyIndex, undefined);
});

// ─── Rattachement des réponses ───────────────────────────────────

test('reponse recente : retrouvee par l id, meme apres reordonnancement', () => {
  const questions = [{ id: 'q_tel', label: 'Tel' }, { id: 'q_nom', label: 'Nom' }];
  const c = { customAnswers: { q_nom: { label: 'Nom', value: 'Zoe' }, q_tel: { label: 'Tel', value: '06' } } };
  const L = fabriquerLecteur(questions);
  assert.equal(L.texteReponse(L.reponseA(c, questions[0], 0)), '06');
  assert.equal(L.texteReponse(L.reponseA(c, questions[1], 1)), 'Zoe');
});

test('reponse d avant les id : retrouvee par la position d origine', () => {
  // A l'epoque : Nom en 0, Tel en 1. Depuis, on a mis Tel en premier.
  const questions = [
    { id: 'q_tel', label: 'Tel', legacyIndex: 1 },
    { id: 'q_nom', label: 'Nom', legacyIndex: 0 },
  ];
  const c = { customAnswers: { 0: { label: 'Nom', value: 'Zoe' }, 1: { label: 'Tel', value: '06' } } };
  const L = fabriquerLecteur(questions);
  assert.equal(L.texteReponse(L.reponseA(c, questions[0], 0)), '06', 'Tel ne doit pas recuperer la reponse de Nom');
  assert.equal(L.texteReponse(L.reponseA(c, questions[1], 1)), 'Zoe');
});

test('le dossier suit l ordre ACTUEL du formulaire', () => {
  const questions = [{ id: 'q_b', label: 'B' }, { id: 'q_a', label: 'A' }];
  const c = { customAnswers: { q_a: { label: 'A', value: '1' }, q_b: { label: 'B', value: '2' } } };
  assert.deepEqual(fabriquerLecteur(questions).reponsesOrdonnees(c).map(r => r.label), ['B', 'A']);
});

test('une question supprimee garde sa reponse, a la fin', () => {
  const questions = [{ id: 'q_a', label: 'A' }];
  const c = { customAnswers: { q_a: { label: 'A', value: '1' }, q_vieux: { label: 'Ancienne', value: 'x' } } };
  const r = fabriquerLecteur(questions).reponsesOrdonnees(c);
  assert.deepEqual(r.map(x => x.label), ['A', 'Ancienne']);
});

test('le CSV sort la valeur, plus « [object Object] »', () => {
  const L = fabriquerLecteur([]);
  assert.equal(L.texteReponse({ label: 'Nom', value: 'Zoe' }), 'Zoe');
  assert.equal(L.texteReponse('brut'), 'brut');
  assert.equal(L.texteReponse(undefined), '');
  assert.equal(L.texteReponse(null), '');
});

// ─── Formulaire rouvert pour changer de créneau (postuler.html) ───

const POST = readFileSync('public/postuler.html', 'utf8');
const { reponseDe, remplirChamp } = new Function(`
  ${extraireFonction(POST, 'reponseDe', 'postuler.html')}
  ${extraireFonction(POST, 'remplirChamp', 'postuler.html')}
  return { reponseDe, remplirChamp };
`)();

test('reprise : reponse retrouvee par l id de la question', () => {
  const r = { q_tel: { label: 'Tel', value: '06 12' } };
  assert.equal(reponseDe(r, { id: 'q_tel' }, 3), '06 12');
});

test('reprise : reponse d avant les id, retrouvee par sa position d origine', () => {
  // Tel etait en 1 a l epoque, il est aujourd hui en 0
  const r = { 0: { label: 'Nom', value: 'Zoe' }, 1: { label: 'Tel', value: '06' } };
  assert.equal(reponseDe(r, { id: 'q_tel', legacyIndex: 1 }, 0), '06');
});

test('reprise : question jamais reenregistree, position actuelle = origine', () => {
  const r = { 2: { label: 'Parcours', value: 'AST' } };
  assert.equal(reponseDe(r, { label: 'Parcours' }, 2), 'AST');
});

test('reprise : ancien format texte brut, et reponse absente', () => {
  assert.equal(reponseDe({ 0: 'brut' }, {}, 0), 'brut');
  assert.equal(reponseDe({}, { id: 'q_x' }, 0), '');
  assert.equal(reponseDe(undefined, { id: 'q_x' }, 0), '');
});

test('reprise : une case a cocher est recochee, un texte est reposé', () => {
  const caseA = { type: 'checkbox', checked: false };
  const texte = { type: 'text', value: '' };
  remplirChamp(caseA, 'Oui');   remplirChamp(texte, 'Bonjour');
  assert.equal(caseA.checked, true);
  assert.equal(texte.value, 'Bonjour');
  remplirChamp(caseA, '');
  assert.equal(caseA.checked, false);
  remplirChamp(null, 'x');      // champ absent : pas d erreur
});
