/**
 * Normalisation des notes de critères.
 * Le bas de l'échelle dépend du type : « échelle » part de 1, « note » de 0.
 */
import test from 'node:test';
import assert from 'node:assert';
import { normaliserNote } from '../public/js/utils.js';

const echelle = max => ({ type: 'echelle', max });
const note    = max => ({ type: 'note',    max });

test('echelle 1 a 5 : le plancher vaut 0 %, pas 20 %', () => {
  assert.equal(normaliserNote(1, echelle(5)), 0);
  assert.equal(normaliserNote(5, echelle(5)), 100);
  assert.equal(normaliserNote(3, echelle(5)), 50);
});

test('note 0 a 20 : inchangee', () => {
  assert.equal(normaliserNote(0,  note(20)), 0);
  assert.equal(normaliserNote(20, note(20)), 100);
  assert.equal(normaliserNote(10, note(20)), 50);
});

test('echelle et note sont enfin sur la meme base', () => {
  // Pire score possible de chaque type : les deux doivent donner 0 %.
  assert.equal(normaliserNote(1, echelle(5)), normaliserNote(0, note(20)));
  // Milieu de chaque echelle : les deux doivent donner 50 %.
  assert.equal(normaliserNote(3, echelle(5)), normaliserNote(10, note(20)));
});

test('une valeur hors bornes est ramenee dans 0-100', () => {
  assert.equal(normaliserNote(0,  echelle(5)), 0,   'sous le plancher');
  assert.equal(normaliserNote(99, echelle(5)), 100, 'au-dessus du plafond');
});

test('critere mal configure : 0 plutot qu une division par zero', () => {
  assert.equal(normaliserNote(3, echelle(1)), 0, 'max = min');
  assert.equal(normaliserNote(3, note(0)),    0);
  assert.equal(normaliserNote(3, {}),         0);
  assert.equal(normaliserNote(3, null),       0);
});

test('demi-points', () => {
  assert.equal(normaliserNote(2.5, echelle(5)), 37.5);
  assert.equal(normaliserNote(15.5, note(20)),  77.5);
});
