/**
 * Calcul du score de classement, tel qu'il tourne vraiment dans candidats.html.
 *
 * Ce bloc vit dans une page HTML et n'est donc pas importable : on l'extrait de
 * la source entre deux ancres, on l'enveloppe dans une fonction et on l'exécute.
 * Si une ancre disparaît, le test échoue avec un message qui dit quoi faire,
 * plutôt que de passer en silence sur du code qui n'est plus testé.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ANCRE_DEBUT = "  const SCORED_TYPES = ['echelle', 'note'];";
const ANCRE_FIN   = '    // noteGlobale average';

const src = readFileSync('public/secge/candidats.html', 'utf8');
assert.ok(src.includes(ANCRE_DEBUT) && src.includes(ANCRE_FIN),
  `Ancres introuvables dans candidats.html. Le calcul du score a bougé : ` +
  `remettre les ancres à jour dans ce test, sinon il ne teste plus rien.`);

const bloc = src.slice(src.indexOf(ANCRE_DEBUT), src.indexOf(ANCRE_FIN)) + '  });\n';
const utils = pathToFileURL(resolve('public/js/utils.js')).href;
const fichier = join(mkdtempSync(join(tmpdir(), 'score-')), 'bloc.mjs');
writeFileSync(fichier,
  `import { normaliserNote } from ${JSON.stringify(utils)};\n` +
  `export function calculer(criteriaConfig, allCandidates, evalsByCandidate) {\n${bloc}\n` +
  `  return allCandidates;\n}\n`);
const { calculer } = await import(pathToFileURL(fichier).href);

const CRITERES = [
  { id: 'c1', type: 'echelle', max: 5,  label: 'Motivation' },
  { id: 'c2', type: 'echelle', max: 5,  label: 'Aisance' },
  { id: 'c3', type: 'note',    max: 20, label: 'Culture asso' },
];

/** Évalue un cooptant fictif et renvoie les champs calculés. */
const noter = (evals, criteres = CRITERES) => {
  const c = { id: 'x' };
  calculer(criteres, [c], { x: evals });
  return c;
};

test('grille remplie en entier : un score sort', () => {
  const c = noter([{ criteria: { c1: 4, c2: 4, c3: 16 } }]);
  assert.equal(c._score, 77);
  assert.equal(c._partiel, false);
});

test('grille incomplete : AUCUN score', () => {
  const c = noter([{ criteria: { c1: 5 } }]);
  assert.equal(c._score, null, 'un 5/5 sur un seul critere ne doit pas produire 100 %');
  assert.equal(c._partiel, true);
  assert.equal(c._nbCriteresNotes, 1);
  assert.equal(c._nbCriteresTotal, 3);
});

test('il manque un seul critere : toujours aucun score', () => {
  const c = noter([{ criteria: { c1: 5, c2: 5 } }]);
  assert.equal(c._score, null);
  assert.equal(c._nbCriteresNotes, 2);
});

test('une note globale ne remplace pas la grille manquante', () => {
  const c = noter([{ criteria: { c1: 5 }, noteGlobale: 18 }]);
  assert.equal(c._score, null);
  assert.equal(c._partiel, true);
});

test('tout au plancher vaut 0 %, pas 13 %', () => {
  // Avant la normalisation par le bas : echelle 1/5 comptait 20 %.
  const c = noter([{ criteria: { c1: 1, c2: 1, c3: 0 } }]);
  assert.equal(c._score, 0);
});

test('plusieurs jures : chaque critere est moyenne', () => {
  const c = noter([
    { criteria: { c1: 5, c2: 5, c3: 20 } },
    { criteria: { c1: 1, c2: 1, c3: 0  } },
  ]);
  assert.equal(c._score, 50, 'moyenne des deux extremes');
  assert.equal(c._nbEvals, 2);
});

test('aucune evaluation : pas de score et pas de drapeau partiel', () => {
  const c = noter([]);
  assert.equal(c._score, null);
  assert.equal(c._partiel, undefined, 'un dossier vide n est pas une evaluation incomplete');
});

test('grille sans critere chiffre : pas de score, pas de drapeau', () => {
  const c = noter([{ criteria: { t1: 'du texte' } }], [{ id: 't1', type: 'texte', max: 0 }]);
  assert.equal(c._score, null);
  assert.equal(c._partiel, false);
});
