// Jours retirés du calendrier : jours de la semaine décochés et dates précises
// (Paramètres → Recrutement → Jours d'entretien).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jourRetire, getCampaignDays, getPlanningDays } from '../public/js/utils.js';

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('jourRetire : week-end decoche et date precise', () => {
  const cfg = { joursSemaineExclus: [0, 6], joursExclus: ['2030-01-08'] };
  assert.equal(jourRetire(new Date(2030, 0, 5), cfg), true, 'samedi');
  assert.equal(jourRetire(new Date(2030, 0, 6), cfg), true, 'dimanche');
  assert.equal(jourRetire(new Date(2030, 0, 7), cfg), false, 'lundi');
  assert.equal(jourRetire(new Date(2030, 0, 8), cfg), true, 'date retiree');
  assert.equal(jourRetire(new Date(2030, 0, 5), {}), false, 'sans reglage, rien de retire');
});

test('getCampaignDays : la periode sans les jours retires', () => {
  const campagne = { config: { dateDebut: '2030-01-01', dateFin: '2030-01-14', joursSemaineExclus: [0, 6], joursExclus: ['2030-01-08'] } };
  const jours = getCampaignDays(campagne).map(iso);
  assert.equal(jours.length, 9, '10 jours ouvres moins le 8');
  assert.ok(!jours.includes('2030-01-05') && !jours.includes('2030-01-08'));
});

test('getPlanningDays : un jour retire qui porte un entretien reste affiche', () => {
  const campagne = { config: { dateDebut: '2030-01-01', dateFin: '2030-01-07', joursSemaineExclus: [0, 6] } };
  const jours = getPlanningDays(campagne, [new Date(2030, 0, 5, 10, 0)]).map(iso);
  assert.ok(jours.includes('2030-01-05'), 'samedi avec entretien garde');
  assert.ok(!jours.includes('2030-01-06'), 'dimanche vide retire');
});
