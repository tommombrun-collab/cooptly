/**
 * Couleur de l'asso (public/js/utils.js) : texte lisible sur le bandeau,
 * accent assez sombre pour des boutons à texte blanc.
 */
import test from 'node:test';
import assert from 'node:assert';
import { contraste, texteSurFond, accentLisible, assombrir } from '../public/js/utils.js';

test('contraste WCAG : noir sur blanc 21, blanc sur blanc 1', () => {
  assert.equal(Math.round(contraste('#000000', '#ffffff')), 21);
  assert.equal(contraste('#ffffff', '#ffffff'), 1);
  assert.equal(contraste('#fff', 'pas une couleur'), null);
});

test('jaune vif : texte sombre ; violet : texte blanc', () => {
  assert.notEqual(texteSurFond('#e8ee00', assombrir('#e8ee00', 0.2)), '#ffffff');
  assert.equal(texteSurFond('#7b2d8b', assombrir('#7b2d8b', 0.2)), '#ffffff');
  assert.equal(texteSurFond('#7c9082'), texteSurFond('#7c9082'));
});

test('accent lisible : un jaune est assombri jusqu\'à 4,5:1 contre le blanc, un violet reste tel quel', () => {
  assert.ok(contraste(accentLisible('#e8ee00'), '#ffffff') >= 4.5);
  assert.equal(accentLisible('#5b2a86'), '#5b2a86');
});
