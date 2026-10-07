/**
 * « Optimiser » le planning (public/js/optimiser.js) : de nouveaux jurés pour
 * les entretiens à venir, sans jamais toucher à leur heure.
 */
import test from 'node:test';
import assert from 'node:assert';
import { optimiserJurys, mesurer, unParGroupe } from '../public/js/optimiser.js';

const h = (hh, mm = 0, jour = 12) => new Date(2026, 9, jour, hh, mm);
const iv = (id, debut, fin, j = [], extra = {}) => ({
  id, datetimeStart: debut, datetimeEnd: fin, jury1Id: j[0] || null, jury2Id: j[1] || null, jury3Id: j[2] || null, ...extra,
});
const tousLibres = () => true;
const cfg = { nbJurys: 2, maxEntretiensAffiles: 4, battementMinutes: 0 };

test('regroupe le staff : plus personne ne vient pour un seul entretien', () => {
  const ivs = [
    iv('a', h(10), h(10, 30), ['A', 'B']),
    iv('b', h(10, 30), h(11), ['C', 'D']),
    iv('c', h(11), h(11, 30), ['A', 'B']),
  ];
  const r = optimiserJurys({ aOptimiser: ivs, staff: ['A', 'B', 'C', 'D'], libre: tousLibres, cfg });
  assert.equal(r.inchange, false);
  assert.equal(r.avant.seuls, 2);
  assert.equal(r.apres.seuls, 0);
  assert.equal(r.apres.trousMin, 0);
  assert.deepEqual(r.changements.map(c => c.iv.id), ['b']);
  assert.deepEqual([...r.changements[0].apres].sort(), ['A', 'B']);
});

test("l'heure d'un entretien ne change jamais", () => {
  const ivs = [iv('a', h(10), h(10, 30), ['A', 'B']), iv('b', h(10, 30), h(11), ['C', 'D'])];
  const r = optimiserJurys({ aOptimiser: ivs, staff: ['A', 'B', 'C', 'D'], libre: tousLibres, cfg });
  r.changements.forEach(c => {
    const orig = ivs.find(x => x.id === c.iv.id);
    assert.equal(c.iv.datetimeStart, orig.datetimeStart);
    assert.equal(c.iv.datetimeEnd, orig.datetimeEnd);
  });
});

test('ne propose que des staffeurs libres pendant tout l\'entretien', () => {
  const ivs = [
    iv('a', h(10), h(10, 30), ['A', 'B']),
    iv('b', h(10, 30), h(11), ['C', 'D']),
  ];
  // A n'est pas libre à 10 h 30.
  const libre = (id, x) => !(id === 'A' && x.id === 'b');
  const r = optimiserJurys({ aOptimiser: ivs, staff: ['A', 'B', 'C', 'D'], libre, cfg });
  r.changements.forEach(c => { if (c.iv.id === 'b') assert.ok(!c.apres.includes('A')); });
});

test('un entretien fixe (passé, aujourd\'hui) compte : pas de staffeur en double', () => {
  const fixe = iv('f', h(10, 30), h(11), ['A', 'B']);
  const ivs = [iv('a', h(10), h(10, 30), ['C', 'D']), iv('b', h(10, 30), h(11), ['C', 'D'])];
  const r = optimiserJurys({ aOptimiser: ivs, fixes: [fixe], staff: ['A', 'B', 'C', 'D'], libre: tousLibres, cfg });
  r.changements.filter(c => c.iv.id === 'b').forEach(c => {
    assert.ok(!c.apres.includes('A') && !c.apres.includes('B'));
  });
});

test('déjà bien réparti : aucun changement', () => {
  const ivs = [iv('a', h(10), h(10, 30), ['A', 'B']), iv('b', h(10, 30), h(11), ['A', 'B'])];
  const r = optimiserJurys({ aOptimiser: ivs, staff: ['A', 'B'], libre: tousLibres, cfg });
  assert.equal(r.inchange, true);
  assert.equal(r.changements.length, 0);
});

test('entretien en anglais : seulement les staffeurs autorisés', () => {
  const ivs = [
    iv('a', h(10), h(10, 30), ['A', 'B']),
    iv('b', h(10, 30), h(11), ['C', 'D'], { langue: 'en' }),
  ];
  const autorises = x => x.langue === 'en' ? ['C', 'D'] : ['A', 'B', 'C', 'D'];
  const r = optimiserJurys({ aOptimiser: ivs, staff: ['A', 'B', 'C', 'D'], libre: tousLibres, autorises, cfg });
  r.changements.filter(c => c.iv.id === 'b').forEach(c => assert.ok(c.apres.every(id => ['C', 'D'].includes(id))));
});

test('un groupe ne compte qu\'une fois', () => {
  const ivs = [iv('a', h(10), h(10, 30), ['A', 'B'], { groupId: 'g' }), iv('b', h(10), h(10, 30), ['A', 'B'], { groupId: 'g' })];
  assert.equal(unParGroupe(ivs).length, 1);
  assert.equal(mesurer(ivs, ['A', 'B']).charges.get('A'), 1);
});

test('le moins de changements possible, et la charge passée compte', () => {
  // A et B ont déjà beaucoup d'entretiens : un seul changement suffit, et il
  // soulage A et B plutôt que de leur en donner un de plus.
  const fixes = [1, 2, 3].map(j => iv(`f${j}`, h(10, 0, j), h(10, 30, j), ['A', 'B']));
  const ivs = [
    iv('jade', h(14), h(14, 30), ['A', 'B']),
    iv('hugo', h(14, 30), h(15), ['C', 'D']),
  ];
  const r = optimiserJurys({ aOptimiser: ivs, fixes, staff: ['A', 'B', 'C', 'D', 'E', 'F'], libre: tousLibres, cfg });
  assert.equal(r.changements.length, 1);
  assert.equal(r.changements[0].iv.id, 'jade');
  assert.deepEqual([...r.changements[0].apres].sort(), ['C', 'D']);
  assert.equal(r.apres.seuls, 0);
});

test('respecte le plafond d\'entretiens d\'affilée', () => {
  const ivs = [0, 1, 2].map(k => iv(`i${k}`, h(10, 30 * k), h(10, 30 * k + 30), k === 2 ? ['C', 'D'] : ['A', 'B']));
  const r = optimiserJurys({ aOptimiser: ivs, staff: ['A', 'B', 'C', 'D'], libre: tousLibres, cfg: { ...cfg, maxEntretiensAffiles: 2 } });
  r.changements.forEach(c => { if (c.iv.id === 'i2') assert.ok(!c.apres.includes('A') && !c.apres.includes('B')); });
});
