/**
 * Choisir un créneau dans la grille (public/js/deplacer.js) : staffeurs libres
 * sur toute la durée, cases bloquées ou à avertissement, étoiles.
 */
import test from 'node:test';
import assert from 'node:assert';
import { creneauxPourDeplacer } from '../public/js/deplacer.js';

const J = '2026-10-12';
const base = {
  jours: [J], heures: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '18:30'],
  duree: 30, battement: 0, finJourneeMin: 19 * 60, nbJurys: 2, maxParallele: 0,
  staff: ['A', 'B', 'C'], libre: () => true, occupations: [],
  maintenant: new Date(2026, 9, 1, 8, 0),
};

test('staffeurs déjà en entretien : pas libres, la case manque de monde', () => {
  const r = creneauxPourDeplacer({ ...base, occupations: [{ jour: J, startMin: 600, endMin: 630, ids: ['A', 'B'] }] });
  assert.deepEqual(r.get(`${J}T10:00`).libres, ['C']);
  assert.match(r.get(`${J}T10:00`).manque, /manque 1 staffeur/);
  assert.equal(r.get(`${J}T10:00`).bloque, null);
  assert.deepEqual(r.get(`${J}T10:30`).libres, ['A', 'B', 'C']);
});

test('la pause compte : un staffeur ne finit pas à 10:30 pour recommencer à 10:30', () => {
  const r = creneauxPourDeplacer({ ...base, battement: 10, occupations: [{ jour: J, startMin: 600, endMin: 630, ids: ['A', 'B'] }] });
  assert.deepEqual(r.get(`${J}T10:30`).libres, ['C']);
  assert.deepEqual(r.get(`${J}T11:00`).libres, ['A', 'B', 'C']);
});

test('passé et après la fin de journée : bloqués', () => {
  const r = creneauxPourDeplacer({ ...base, maintenant: new Date(2026, 9, 12, 10, 5) });
  assert.ok(r.get(`${J}T09:30`).bloque);
  assert.equal(r.get(`${J}T10:30`).bloque, null);
  const tard = creneauxPourDeplacer({ ...base, finJourneeMin: 18 * 60 + 45 });
  assert.match(tard.get(`${J}T18:30`).bloque, /fin de journée/);
});

test('dispos sur toute la durée, et dispos de secours', () => {
  const libre = (id, jour, debut) => (id === 'C' ? debut >= 660 : id === 'B' && debut === 660 ? 'secours' : true);
  const r = creneauxPourDeplacer({ ...base, libre });
  assert.deepEqual(r.get(`${J}T10:00`).libres, ['A', 'B']);
  assert.deepEqual(r.get(`${J}T11:00`).secours, ['B']);
});

test('limite d\'entretiens en parallèle : avertissement, pas blocage', () => {
  const r = creneauxPourDeplacer({ ...base, staff: ['A', 'B', 'C', 'D'], maxParallele: 1,
    occupations: [{ jour: J, startMin: 600, endMin: 630, ids: ['A', 'B'] }] });
  assert.match(r.get(`${J}T10:00`).manque, /en même temps/);
  assert.equal(r.get(`${J}T10:00`).bloque, null);
});

test('étoiles : les cases qui collent à un entretien prévu, pas les autres', () => {
  const r = creneauxPourDeplacer({ ...base, staff: ['A', 'B', 'C', 'D'],
    occupations: [{ jour: J, startMin: 600, endMin: 630, ids: ['A', 'B'] }] });
  const etoiles = [...r.values()].filter(c => c.conseille).map(c => c.heure);
  assert.deepEqual(etoiles.sort(), ['09:30', '10:30']);
});

test('étoiles : jamais sur une case qui ne tient que grâce aux dispos de secours', () => {
  const libre = id => (id === 'B' ? 'secours' : true);
  const r = creneauxPourDeplacer({ ...base, staff: ['A', 'B'], occupations: [{ jour: J, startMin: 600, endMin: 630, ids: [] }] });
  assert.ok(r.get(`${J}T10:30`).conseille);
  const s = creneauxPourDeplacer({ ...base, staff: ['A', 'B'], libre, occupations: [{ jour: J, startMin: 600, endMin: 630, ids: [] }] });
  assert.ok(![...s.values()].some(c => c.conseille));
});

test('pas d\'étoile sur un jour encore vide', () => {
  const r = creneauxPourDeplacer({ ...base, jours: [J, '2026-10-13'], occupations: [{ jour: J, startMin: 600, endMin: 630, ids: [] }] });
  assert.ok(![...r.values()].some(c => c.conseille && c.jour === '2026-10-13'));
  assert.ok([...r.values()].some(c => c.conseille && c.jour === J));
});
