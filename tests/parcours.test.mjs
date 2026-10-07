/**
 * Parcours, question commune (public/js/utils.js) : reprise des anciennes
 * réponses des assos et répartition pour les ratios.
 */
import test from 'node:test';
import assert from 'node:assert';
import { normaliserParcours, parcoursCooptant, repartitionParcours, estQuestionParcours } from '../public/js/utils.js';

test('anciennes options des assos ramenées à la liste commune', () => {
  assert.equal(normaliserParcours('Prépa'), 'Prépa');
  assert.equal(normaliserParcours('prepa'), 'Prépa');
  assert.equal(normaliserParcours('AST'), 'AST');
  assert.equal(normaliserParcours('ASTi'), 'ASTi');
  assert.equal(normaliserParcours('AST(I)'), 'AST');      // une asso : AST et ASTi regroupés
  assert.equal(normaliserParcours('MSc'), 'MSc');
  assert.equal(normaliserParcours('MS'), 'MS');
  assert.equal(normaliserParcours('Global BBA'), 'Autre');
  assert.equal(normaliserParcours(''), null);
});

test('le champ commun d\'abord, sinon l\'ancienne réponse « Parcours »', () => {
  assert.equal(parcoursCooptant({ parcours: 'MSc', customAnswers: { q1: { label: 'Parcours', value: 'AST' } } }), 'MSc');
  assert.equal(parcoursCooptant({ customAnswers: { q1: { label: 'Parcours / Background ?', value: 'AST(I)' } } }), 'AST');
  assert.equal(parcoursCooptant({ customAnswers: { q1: { label: 'Motivation', value: 'AST' } } }), null);
  assert.equal(parcoursCooptant({}), null);
});

test('répartition dans l\'ordre de la liste, non renseignés à la fin', () => {
  const r = repartitionParcours([{ parcours: 'AST' }, { parcours: 'Prépa' }, { parcours: 'Prépa' }, {}]);
  assert.deepEqual(r.map(x => [x.parcours, x.n, x.pct]), [['Prépa', 2, 50], ['AST', 1, 25], ['Non renseigné', 1, 25]]);
});

test('reconnaît les questions « Parcours » des assos', () => {
  assert.ok(estQuestionParcours({ type: 'select', label: 'Parcours' }));
  assert.ok(estQuestionParcours({ type: 'select', label: 'Parcours / Background ?' }));
  assert.ok(!estQuestionParcours({ type: 'longtext', label: 'Ton parcours associatif ?' }));
  assert.ok(estQuestionParcours({ type: 'select', label: 'Programme' }));
  assert.ok(!estQuestionParcours({ type: 'select', label: 'Promo' }));
  assert.ok(!estQuestionParcours({ type: 'text', label: 'Parcours' }));
});
