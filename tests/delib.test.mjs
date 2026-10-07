/**
 * Aides à la délibération (js/delib.js) : correction de la sévérité des
 * staffeurs, zone grise autour de la ligne de coupe.
 */
import test from 'node:test';
import assert from 'node:assert';
import { severiteStaffeurs, zoneGrise, largeurZoneConseillee } from '../public/js/delib.js';

/** Cooptants de même niveau (60 %), notés par des jurys plus ou moins généreux. */
function jurys(liste) {
  return liste.map(([jures, score], i) => ({ id: `c${i}`, score, jures }));
}

test('un staffeur généreux est repéré, ses cooptants corrigés vers le bas', () => {
  // Jurys de deux qui tournent : gen siège avec chacun des autres, qui siègent
  // aussi entre eux. Cooptants de même niveau ; gen ajoute 20 points à lui seul.
  const avec = (jures, score) => Array.from({ length: 3 }, () => [jures, score]);
  const obs = jurys([
    ...avec(['gen', 'a'], 70), ...avec(['gen', 'b'], 70), ...avec(['gen', 'c'], 70), ...avec(['gen', 'd'], 70),
    ...avec(['a', 'b'], 60), ...avec(['c', 'd'], 60), ...avec(['a', 'c'], 60), ...avec(['b', 'd'], 60),
  ]);
  const r = severiteStaffeurs(obs);
  assert.equal(r.suffisant, true);
  const gen = r.effets.get('gen').effet;
  assert.ok(gen > 6, `généreux : ${gen}`);
  // Ceux qui siègent avec lui n'héritent pas de sa générosité : ils restent
  // égaux entre eux, loin derrière lui (effets comparés au staffeur moyen).
  const autres = ['a', 'b', 'c', 'd'].map(j => r.effets.get(j).effet);
  assert.ok(Math.max(...autres) - Math.min(...autres) < 0.5, `autres : ${autres}`);
  assert.ok(gen - autres[0] > 10);
  assert.equal(r.effets.get('gen').n, 12);
  assert.ok(r.corrections.get('c0') < -2, 'cooptant de gen corrigé vers le bas');
  assert.ok(r.corrections.get('c20') > 2, 'cooptant d\'un jury sans gen corrigé vers le haut');
  // La moyenne des notes ne bouge pas : seul l'ordre change.
  const total = [...r.corrections.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total) < 0.5, `somme des corrections : ${total}`);
});

test('un staffeur sévère : ses cooptants remontent', () => {
  const obs = jurys([
    ...Array.from({ length: 8 }, () => [['sev'], 45]),
    ...Array.from({ length: 8 }, () => [['a'], 60]),
    ...Array.from({ length: 8 }, () => [['b'], 60]),
  ]);
  const r = severiteStaffeurs(obs);
  assert.ok(r.effets.get('sev').effet < -5);
  assert.ok(r.corrections.get('c0') > 5);
  assert.ok(r.corrections.get('c10') < 0);   // un cooptant de « a » redescend un peu
  // Rappel vers zéro (8 entretiens chacun) : l'écart de 15 points se réduit sans s'inverser.
  const ecart = (60 + r.corrections.get('c10')) - (45 + r.corrections.get('c0'));
  assert.ok(ecart > 0 && ecart < 8, `écart corrigé : ${ecart}`);
});

test('peu d\'entretiens : moins corrigé ; trop peu de matière : aucune correction', () => {
  const peu = severiteStaffeurs(jurys([
    [['rare'], 80], [['rare'], 80],
    ...Array.from({ length: 10 }, () => [['a'], 60]),
    ...Array.from({ length: 10 }, () => [['b'], 60]),
  ]));
  const beaucoup = severiteStaffeurs(jurys([
    ...Array.from({ length: 12 }, () => [['souvent'], 80]),
    ...Array.from({ length: 10 }, () => [['a'], 60]),
    ...Array.from({ length: 10 }, () => [['b'], 60]),
  ]));
  assert.ok(Math.abs(peu.effets.get('rare').effet) < Math.abs(beaucoup.effets.get('souvent').effet));
  const maigre = severiteStaffeurs(jurys([[['a'], 60], [['b'], 70], [['a'], 50]]));
  assert.equal(maigre.suffisant, false);
  assert.equal(maigre.corrections.size, 0);
});

test('tous les staffeurs pareils : aucune correction ; notes absentes ou sans jury ignorées', () => {
  const r = severiteStaffeurs([
    ...jurys(Array.from({ length: 12 }, (_, i) => [[i % 2 ? 'a' : 'b'], 60])),
    { id: 'sansNote', score: null, jures: ['a'] },
    { id: 'sansJury', score: 90, jures: [] },
  ]);
  assert.equal(r.suffisant, true);
  assert.equal(r.corrections.get('c0'), 0);
  assert.equal(r.corrections.has('sansNote'), false);
  assert.equal(r.corrections.has('sansJury'), false);
  assert.equal(r.moyenne, 60);
});

test('correction bornée', () => {
  const r = severiteStaffeurs(jurys([
    ...Array.from({ length: 30 }, () => [['extreme'], 100]),
    ...Array.from({ length: 30 }, () => [['a'], 20]),
  ]), { plafond: 15 });
  assert.equal(r.corrections.get('c0'), -15);
  assert.equal(r.corrections.get('c40'), 15);
});

test('zone grise autour de la ligne de coupe', () => {
  assert.deepEqual(zoneGrise(90, 30, 6), { debut: 24, fin: 35 });
  assert.deepEqual(zoneGrise(10, 3, 5), { debut: 0, fin: 7 });
  assert.deepEqual(zoneGrise(32, 30, 6), { debut: 24, fin: 31 });
  assert.equal(zoneGrise(20, 0, 5), null);    // pas de places : pas de ligne
  assert.equal(zoneGrise(20, 25, 5), null);   // tout le monde est retenu
  assert.equal(zoneGrise(20, 10, 0), null);   // zone désactivée
  assert.equal(largeurZoneConseillee(30), 6);
  assert.equal(largeurZoneConseillee(5), 3);
  assert.equal(largeurZoneConseillee(100), 8);
});
