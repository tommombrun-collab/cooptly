/**
 * Alertes de cohérence (public/js/coherence.js) : réglages et planning.
 */
import test from 'node:test';
import assert from 'node:assert';
import { alertesReglages, alertesPlanning, equilibreCharge } from '../public/js/coherence.js';

const maintenant = new Date(2026, 9, 4, 10, 0);   // dimanche 4 octobre 2026, 10:00
const base = { dureeMinutes: 30, pasCreneauxMinutes: 30, battementMinutes: 0, nbJurys: 2, maxEntretiensAffiles: 4,
  modeRdv: 'creneaux', delaiReservationJours: 2, heureFin: 19, dateDebut: '2026-09-30', dateFin: '2026-10-15', avecEntretien: true };
const ouvert = { recrutementOuvert: true, nbPlaces: 20, interviewCriteria: [{ id: 'c' }] };
const codes = r => r.map(a => a.code).sort();

test('réglages : un cas réel (60 min toutes les 30, 4 h sans pause, sans grille, inscriptions trop tardives)', () => {
  const r = alertesReglages({ cfg: { ...base, dureeMinutes: 60, deadlineCandidature: '2026-10-15' },
    campaign: { recrutementOuvert: true, nbPlaces: 20, interviewCriteria: [] }, nbEntretiensPasses: 17, maintenant });
  assert.deepEqual(codes(r), ['deadline', 'duree-pas', 'grille', 'pause']);
  assert.match(r.find(a => a.code === 'deadline').detail, /13 oct/);
});

test('réglages : un recrutement bien réglé ne déclenche rien', () => {
  const r = alertesReglages({ cfg: { ...base, battementMinutes: 10, deadlineCandidature: '2026-10-12' }, campaign: ouvert, nbEntretiensPasses: 5, maintenant });
  assert.deepEqual(r, []);
});

test('réglages : places non renseignées, recrutement ouvert après la période', () => {
  const r = alertesReglages({ cfg: { ...base, dateFin: '2026-10-01', battementMinutes: 10 }, campaign: { ...ouvert, nbPlaces: 0 }, nbEntretiensPasses: 3, maintenant });
  assert.deepEqual(codes(r), ['ouvert', 'places']);
});

const h = (hh, mm = 0, j = 5) => new Date(2026, 9, j, hh, mm);
const iv = (id, debut, minutes, jures, candidateIds = [id + '_c']) => ({ id, debut, fin: new Date(debut.getTime() + minutes * 60000), jures, candidateIds });
const dispo = (userId, jour, heures, extra = {}) => ({ userId, creneaux: [{ jour, creneaux: heures }], ...extra });
const noms = new Map([['A', 'Alice'], ['B', 'Bruno'], ['C', 'Chloé'], ['D', 'Dan']]);

test('planning : sans staffeurs, double placement, hors dispos, anglais', () => {
  const entretiens = [
    iv('e1', h(11), 60, []),
    iv('e2', h(14), 60, ['A', 'B']),
    iv('e3', h(14, 30), 60, ['A', 'C']),
    iv('e4', h(16), 60, ['C', 'D'], ['en_c']),
  ];
  const dispos = ['A', 'B', 'C'].map(id => dispo(id, '2026-10-05', ['14:00', '15:00', '16:00'], id === 'C' ? { langues: ['fr'] } : {}))
    .concat(dispo('D', '2026-10-05', ['10:00'], { langues: ['fr', 'en'] }));
  const r = alertesPlanning({ cfg: { ...base, jurysAnglaisRequis: true }, campaign: { recrutementOuvert: false }, entretiens, dispos, noms,
    cooptants: [{ id: 'en_c', prenom: 'Emily', nom: 'G', langue: 'en' }], maintenant });
  assert.deepEqual(codes(r), ['anglais', 'conflit', 'staff']);
  assert.match(r.find(a => a.code === 'conflit').detail, /Alice à 14:00 et 14:30/);
  assert.ok(r.find(a => a.code === 'conflit').cles.some(c => c.startsWith('horsdispo:D_e4')));
  assert.match(r.find(a => a.code === 'anglais').detail, /Chloé/);
});

test('planning : plus aucun créneau réservable avec le formulaire ouvert', () => {
  const entretiens = [iv('e1', h(14), 60, ['A', 'B'])];
  const dispos = ['A', 'B'].map(id => dispo(id, '2026-10-07', ['14:00']));
  const r = alertesPlanning({ cfg: { ...base, dureeMinutes: 60 }, campaign: { recrutementOuvert: true },
    entretiens: [iv('e1', h(14, 0, 7), 60, ['A', 'B'])], dispos, noms, cooptants: [], joursReservables: ['2026-10-07'], maintenant });
  assert.ok(r.some(a => a.code === 'creneaux' && /Plus aucun/.test(a.titre)));
  const libre = alertesPlanning({ cfg: { ...base, dureeMinutes: 60 }, campaign: { recrutementOuvert: true },
    entretiens: [], dispos: ['A', 'B'].map(id => dispo(id, '2026-10-07', ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00'])),
    noms, cooptants: [], joursReservables: ['2026-10-07'], maintenant });
  assert.ok(!libre.some(a => a.code === 'creneaux'));
  void entretiens;
});

test('planning : charge inégale, doublon probable', () => {
  const entretiens = [...Array(6)].map((_, k) => iv(`e${k}`, h(9 + k), 60, ['A', k === 0 ? 'B' : 'C']));
  const r = alertesPlanning({ cfg: base, campaign: {}, entretiens, dispos: [], noms,
    cooptants: [{ id: 'x', prenom: 'Léa', nom: 'Durand' }, { id: 'y', prenom: 'lea', nom: 'DURAND' }], maintenant });
  assert.ok(r.some(a => a.code === 'charge' && /^Alice : 6 entretiens, Bruno : 1 \(écart type 2,2 pour une moyenne de 4\)/.test(a.detail)));
  assert.ok(r.some(a => a.code === 'doublon' && a.cles[0] === 'doublon:x_y'));
});

// Dispos sur n jours, h heures en tout (réparties à partir de 9 h).
const disposSur = (userId, jours, heures) => ({ userId, creneaux: [...Array(jours)].map((_, k) => ({
  jour: `2026-10-${String(6 + k).padStart(2, '0')}`,
  creneaux: [...Array(Math.ceil(heures / jours))].map((_, i) => `${String(9 + i).padStart(2, '0')}:00`).slice(0, Math.max(0, heures - k * Math.ceil(heures / jours))),
})) });

test('charge : écart type ; très peu de dispos sur plusieurs jours compte, sur un seul jour non', () => {
  const equipe = [
    { id: 'a', entretiens: 29, heures: 72, jours: 11 }, { id: 'b', entretiens: 26, heures: 80, jours: 13 },
    { id: 'c', entretiens: 25, heures: 71, jours: 11 }, { id: 'd', entretiens: 24, heures: 49, jours: 8 },
    { id: 'e', entretiens: 21, heures: 68, jours: 11 },
  ];
  assert.equal(equilibreCharge(equipe).niveau, 'bon');
  // Cas réel : une vraie staffeuse à 15 h sur 2 jours, loin derrière.
  const reel = equilibreCharge([...equipe, { id: 'f', entretiens: 9, heures: 15, jours: 2 }]);
  assert.deepEqual(reel.peuDispos.map(l => l.id), ['f']);
  assert.equal(reel.retenus.length, 6);
  assert.deepEqual(reel.loinDerriere.map(l => l.id), ['f']);
  assert.equal(reel.niveau, 'inegal');
  // Revenu de stage : une heure sur un seul jour, mis de côté.
  const stage = equilibreCharge([...equipe, { id: 'l', entretiens: 1, heures: 1, jours: 1 }]);
  assert.deepEqual(stage.horsCalcul.map(l => l.id), ['l']);
  assert.equal(stage.niveau, 'bon');
  // Qui n'a ni dispos ni entretien n'entre nulle part.
  assert.equal(equilibreCharge([{ id: 'x', entretiens: 0, heures: 0 }, { id: 'y', entretiens: 3, heures: 10 }]).niveau, null);
});

test('planning : très peu de dispos sur plusieurs jours signalé, un seul jour (revenu de stage) non', () => {
  const noms2 = new Map([['A', 'Alice'], ['B', 'Bruno'], ['C', 'Chloé'], ['F', 'Fanny'], ['L', 'Léo']]);
  const dispos = [disposSur('A', 8, 40), disposSur('B', 8, 40), disposSur('C', 8, 40), disposSur('F', 2, 6), disposSur('L', 1, 1)];
  const entretiens = [...Array(12)].map((_, k) => iv(`e${k}`, h(9 + (k % 8), 0, 6 + (k >> 3)), 30, [['A', 'B'], ['B', 'C'], ['C', 'A']][k % 3]))
    .concat([iv('f1', h(9, 0, 7), 30, ['F', 'A']), iv('l1', h(9, 0, 6), 30, ['L', 'B'])]);
  const r = alertesPlanning({ cfg: base, campaign: {}, entretiens, dispos, noms: noms2, cooptants: [], maintenant });
  // Fanny loin derrière parce qu'à peine là : une alerte courte à son nom, pas d'alerte de charge.
  const peu = r.find(a => a.code === 'peu-dispos');
  assert.equal(peu?.titre, 'Fanny a très peu de dispos');
  assert.equal(peu.detail, '6 h sur 2 jours.');
  assert.equal(peu.lien, 'dispos');
  assert.ok(!r.some(a => a.code === 'charge'));
  assert.ok(!r.some(a => /Léo/.test(a.titre + a.detail)));
});
