/**
 * Paramètres de lien : tout ce qui est collé derrière l'identifiant est ignoré.
 * Cas réel : un lien partagé dans un message arrivait avec « %0A%0AViens ».
 */
import test from 'node:test';
import assert from 'node:assert';
import { paramLien } from '../public/js/utils.js';

test('texte du message colle apres le slug', () => {
  assert.equal(paramLien('org', '?org=club-theatre%0A%0AViens'), 'club-theatre');
});

test('espaces, ponctuation, emoji apres le lien', () => {
  assert.equal(paramLien('org', '?org=asso%20Viens%20postuler'), 'asso');
  assert.equal(paramLien('org', '?org=asso!'), 'asso');
  assert.equal(paramLien('org', '?org=asso%F0%9F%8E%AD'), 'asso');
  assert.equal(paramLien('org', '?org=%20asso'), 'asso');
});

test('identifiants intacts : ID Firestore, jeton hexadecimal, soulignes', () => {
  assert.equal(paramLien('org', '?org=Ab12Cd34Ef56Gh78Ij90'), 'Ab12Cd34Ef56Gh78Ij90');
  assert.equal(paramLien('token', '?token=0f3a9c&campaign=x'), '0f3a9c');
  assert.equal(paramLien('campaign', '?token=0f3a9c&campaign=camp_1'), 'camp_1');
});

test('absent ou vide', () => {
  assert.equal(paramLien('org', '?campaign=x'), null);
  assert.equal(paramLien('org', '?org='), null);
});
