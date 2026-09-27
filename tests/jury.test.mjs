/**
 * Choix des jurés : logique pure, testable sans émulateur.
 */
import test from 'node:test';
import assert from 'node:assert';
import { choisirJury, chaineAvant, estJure } from '../public/js/jury.js';

const H = (h, m = 0) => new Date(2026, 8, 29, h, m, 0, 0);
const iv = (debut, fin, ...jures) => ({
  datetimeStart: debut, datetimeEnd: fin,
  jury1Id: jures[0] || null, jury2Id: jures[1] || null, jury3Id: jures[2] || null,
});

const CINQ = ['A', 'B', 'C', 'D', 'E'];

test('deux creneaux qui se suivent : le meme binome enchaine', () => {
  const premier = choisirJury({
    disponibles: CINQ, interviews: [], debut: H(10), fin: H(10, 30), nbJurys: 2,
  });
  assert.deepEqual(premier, ['A', 'B'], 'a charge egale, ordre stable');

  const poses = [iv(H(10), H(10, 30), ...premier)];
  const second = choisirJury({
    disponibles: CINQ, interviews: poses, debut: H(10, 30), fin: H(11), nbJurys: 2,
  });
  assert.deepEqual(second, premier, 'le binome du creneau precedent doit enchainer');
});

test('trois entretiens de suite mobilisent deux personnes, pas six', () => {
  let poses = [];
  const mobilises = new Set();
  for (let i = 0; i < 3; i++) {
    const debut = H(10, i * 30), fin = H(10, i * 30 + 30);
    const jury = choisirJury({ disponibles: CINQ, interviews: poses, debut, fin, nbJurys: 2 });
    jury.forEach(id => mobilises.add(id));
    poses = [...poses, iv(debut, fin, ...jury)];
  }
  assert.equal(mobilises.size, 2, `2 personnes attendues, ${[...mobilises]} mobilisees`);
});

test('le plafond force la releve', () => {
  let poses = [];
  const journal = [];
  for (let i = 0; i < 5; i++) {
    const debut = H(10, i * 30), fin = H(10, i * 30 + 30);
    const jury = choisirJury({
      disponibles: CINQ, interviews: poses, debut, fin, nbJurys: 2, maxAffiles: 3,
    });
    journal.push(jury.join('+'));
    poses = [...poses, iv(debut, fin, ...jury)];
  }
  assert.deepEqual(journal.slice(0, 3), ['A+B', 'A+B', 'A+B'], 'trois d affilee autorises');
  assert.ok(!journal[3].includes('A'), `releve attendue au 4e, obtenu ${journal[3]}`);
  assert.deepEqual(journal[3], 'C+D');
});

test('maxAffiles = 0 : pas de plafond, le binome enchaine indefiniment', () => {
  let poses = [];
  for (let i = 0; i < 8; i++) {
    const debut = H(9, i * 30), fin = H(9, i * 30 + 30);
    const jury = choisirJury({
      disponibles: CINQ, interviews: poses, debut, fin, nbJurys: 2, maxAffiles: 0,
    });
    poses = [...poses, iv(debut, fin, ...jury)];
  }
  const tous = new Set(poses.flatMap(p => [p.jury1Id, p.jury2Id]));
  assert.equal(tous.size, 2);
});

test('un creux casse la chaine : on repart sur les moins charges', () => {
  const poses = [iv(H(10), H(10, 30), 'A', 'B')];
  // 14h, plus rien a voir avec le matin
  const jury = choisirJury({
    disponibles: CINQ, interviews: poses, debut: H(14), fin: H(14, 30), nbJurys: 2,
  });
  assert.deepEqual(jury, ['C', 'D'], 'A et B ont deja donne, on equilibre');
});

test('on ne peut pas etre jure de deux entretiens en meme temps', () => {
  const poses = [iv(H(10), H(10, 30), 'A', 'B')];
  const jury = choisirJury({
    disponibles: CINQ, interviews: poses, debut: H(10), fin: H(10, 30), nbJurys: 2,
  });
  assert.ok(!jury.includes('A') && !jury.includes('B'), 'A et B sont deja pris sur ce creneau');
  assert.equal(jury.length, 2);
});

test('le battement compte dans le chevauchement', () => {
  const poses = [iv(H(10), H(10, 30), 'A', 'B')];
  // 10:30 colle a 10:30, mais avec 15 min de battement A et B ne sont pas libres
  const jury = choisirJury({
    disponibles: CINQ, interviews: poses, debut: H(10, 30), fin: H(11),
    nbJurys: 2, battementMin: 15,
  });
  assert.ok(!jury.includes('A'), 'le battement empeche d enchainer immediatement');
});

test('moins de monde que de jures voulus : on rend ce qu on a', () => {
  assert.deepEqual(choisirJury({
    disponibles: ['A'], interviews: [], debut: H(10), fin: H(10, 30), nbJurys: 2,
  }), ['A']);
  assert.deepEqual(choisirJury({
    disponibles: [], interviews: [], debut: H(10), fin: H(10, 30), nbJurys: 2,
  }), []);
});

test('plafond atteint mais personne d autre : on garde un jury plutot que rien', () => {
  const poses = [
    iv(H(9), H(9, 30), 'A', 'B'),
    iv(H(9, 30), H(10), 'A', 'B'),
  ];
  const jury = choisirJury({
    disponibles: ['A', 'B'], interviews: poses, debut: H(10), fin: H(10, 30),
    nbJurys: 2, maxAffiles: 2,
  });
  assert.deepEqual(jury, ['A', 'B'], 'dernier recours plutot qu un entretien sans jury');
});

test('chaineAvant compte bien les entretiens consecutifs', () => {
  const poses = [
    iv(H(9),     H(9, 30),  'A'),
    iv(H(9, 30), H(10),     'A'),
    iv(H(10),    H(10, 30), 'A'),
  ];
  assert.equal(chaineAvant('A', poses, H(10, 30)), 3);
  assert.equal(chaineAvant('B', poses, H(10, 30)), 0);
  assert.equal(chaineAvant('A', poses, H(14)), 0, 'un creux de 3 h casse la chaine');
});

test('estJure regarde les trois emplacements', () => {
  const e = iv(H(10), H(10, 30), 'A', 'B', 'C');
  ['A', 'B', 'C'].forEach(id => assert.ok(estJure(e, id)));
  assert.ok(!estJure(e, 'D'));
});
