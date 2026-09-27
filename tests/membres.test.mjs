/**
 * Membres du bureau : une personne ajoutée par email puis connectée a DEUX
 * documents (le pré-ajout et le canonique `{uid}_{orgId}`). Cas réel :
 * Camille et Hugo apparaissaient en double dans Paramètres.
 */
import test from 'node:test';
import assert from 'node:assert';
import { regrouperMembres } from '../public/js/utils.js';

const ORG = 'orgB';

test('pré-ajout migré + doc canonique : une seule personne, les deux ids gardés', () => {
  const m = regrouperMembres([
    { id: 'auto1', userId: 'uidTom', email: 'tom@x.fr', organizationId: ORG, role: 'president', displayName: 'tom' },
    { id: 'uidTom_orgB', userId: 'uidTom', email: 'tom@x.fr', organizationId: ORG, role: 'president', displayName: 'Camille Martin' },
  ], ORG);
  assert.equal(m.length, 1);
  assert.equal(m[0].displayName, 'Camille Martin');     // le canonique l'emporte
  assert.equal(m[0].id, 'uidTom_orgB');
  assert.deepEqual(m[0]._docIds.sort(), ['auto1', 'uidTom_orgB']);
});

test('pré-ajout pas encore migré (userId = email) relié au canonique par l email', () => {
  const m = regrouperMembres([
    { id: 'uidLuc_orgB', userId: 'uidLuc', email: 'luc@x.fr', organizationId: ORG, role: 'secge' },
    { id: 'auto2', userId: 'LUC@x.fr', organizationId: ORG, role: 'secge' },
  ], ORG);
  assert.equal(m.length, 1);
  assert.equal(m[0]._docIds.length, 2);
});

test('deux personnes distinctes restent distinctes', () => {
  const m = regrouperMembres([
    { id: 'a', userId: 'u1', email: 'a@x.fr', organizationId: ORG },
    { id: 'b', userId: 'b@x.fr', email: 'b@x.fr', organizationId: ORG },
  ], ORG);
  assert.equal(m.length, 2);
});
