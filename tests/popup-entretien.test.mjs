/**
 * Popup d'entretien du planning : téléphone, disponibilité des jurés.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { valeurReponse, telephoneCooptant } from '../public/js/utils.js';

// ─── Téléphone ───────────────────────────────────────────────────

test('telephone : l ancien champ fixe reste lu en priorite', () => {
  assert.equal(telephoneCooptant({ telephone: '06 00' }, []), '06 00');
});

test('telephone : question de type tel', () => {
  const questions = [{ id: 'q_tel', type: 'tel', label: 'Portable' }];
  const cand = { customAnswers: { q_tel: { label: 'Portable', value: '06 12 34' } } };
  assert.equal(telephoneCooptant(cand, questions), '06 12 34');
});

test('telephone : question en simple texte, reconnue a son libelle (cas réel)', () => {
  const questions = [
    { label: 'Quel est ton pseudo Facebook', type: 'text' },
    { label: 'Numéro de téléphone', type: 'text' },
  ];
  const cand = { customAnswers: { 0: { value: 'zoe.fb' }, 1: { value: '07 88' } } };
  assert.equal(telephoneCooptant(cand, questions), '07 88', 'pas le pseudo Facebook');
});

test('telephone : le type tel passe avant un libelle ressemblant', () => {
  const questions = [
    { id: 'a', type: 'text', label: 'Téléphone des parents' },
    { id: 'b', type: 'tel',  label: 'Ton numéro' },
  ];
  const cand = { customAnswers: { a: { value: 'parents' }, b: { value: 'perso' } } };
  assert.equal(telephoneCooptant(cand, questions), 'perso');
});

test('telephone : rien de connu, chaine vide', () => {
  assert.equal(telephoneCooptant({}, []), '');
  assert.equal(telephoneCooptant({ customAnswers: {} }, [{ type: 'tel', id: 'x' }]), '');
  assert.equal(telephoneCooptant(null, undefined), '');
});

test('valeurReponse : identifiant, position d origine, format brut', () => {
  assert.equal(valeurReponse({ q: { value: 'a' } }, { id: 'q' }, 5), 'a');
  assert.equal(valeurReponse({ 1: { value: 'b' } }, { id: 'q', legacyIndex: 1 }, 0), 'b');
  assert.equal(valeurReponse({ 2: 'brut' }, {}, 2), 'brut');
  assert.equal(valeurReponse(undefined, { id: 'q' }, 0), '');
});

// ─── Disponibilité des jurés (planning.html) ──────────────────────

function extraireFonction(src, nom) {
  const debut = src.indexOf(`function ${nom}(`);
  assert.ok(debut >= 0, `${nom}() introuvable dans planning.html : remettre ce test à jour.`);
  let p = 0, i = src.indexOf('{', debut);
  for (; i < src.length; i++) { if (src[i] === '{') p++; else if (src[i] === '}' && --p === 0) break; }
  return src.slice(debut, i + 1);
}
const PLANNING = readFileSync('public/planning.html', 'utf8');
const planning = (config, staffAvailabilities, members) => new Function(
  'cfg', 'staffAvailabilities', 'members', `
  ${extraireFonction(PLANNING, 'isMemberAvailable')}
  ${extraireFonction(PLANNING, 'juresListables')}
  return { isMemberAvailable, juresListables };
`)(() => config, staffAvailabilities, members);

const DISPOS = [
  { userId: 'julien', creneaux: [{ jour: '2026-09-28', creneaux: ['10:00'] }] },
  { userId: 'chloe',    creneaux: [{ jour: '2026-09-29', creneaux: ['10:00'] }] },  // rien le lundi
];
const MEMBRES = [{ userId: 'julien' }, { userId: 'chloe' }, { userId: 'luc' }];

test('dispo sur le creneau', () => {
  assert.equal(planning({}, DISPOS, MEMBRES).isMemberAvailable('julien', '2026-09-28', '10:30'), true);
});

test('grille remplie mais jour laisse vide : NON dispo, plus « aucune info »', () => {
  // Le cas de Chloé Garnier : aucun badge, et on pouvait la designer sans alerte.
  assert.equal(planning({}, DISPOS, MEMBRES).isMemberAvailable('chloe', '2026-09-28', '10:30'), false);
});

test('jour rempli mais pas cette heure : non dispo', () => {
  assert.equal(planning({}, DISPOS, MEMBRES).isMemberAvailable('julien', '2026-09-28', '14:00'), false);
});

test('n a jamais rempli sa grille : on ne sait pas', () => {
  assert.equal(planning({}, DISPOS, MEMBRES).isMemberAvailable('luc', '2026-09-28', '10:00'), null);
});

test('listes de jures : ceux qui ont rempli leur grille', () => {
  assert.deepEqual(planning({}, DISPOS, MEMBRES).juresListables().map(m => m.userId), ['julien', 'chloe']);
});

test('staff sans dispos a declarer : tout le monde est listable et libre', () => {
  // Avant, les listes restaient vides : impossible de designer un jure a la main.
  const p = planning({ staffToujoursDispo: true }, [], MEMBRES);
  assert.deepEqual(p.juresListables().map(m => m.userId), ['julien', 'chloe', 'luc']);
  assert.equal(p.isMemberAvailable('luc', '2026-09-28', '10:00'), true);
});

// ─── Identité unique : compte + entrée roster (cas d'Léa) ───────

const identites = () => new Function(`
  const normNom = s => (s || '').trim().toLowerCase().replace(/\\s+/g, ' ');
  let aliasVersCanon = new Map();
  const canon = id => (id && aliasVersCanon.get(id)) || id;
  ${extraireFonction(PLANNING, 'fusionnerIdentites')}
  ${extraireFonction(PLANNING, 'normaliserJures')}
  return { fusionnerIdentites, normaliserJures, canon: id => canon(id) };
`)();

const COMPTES = [
  { userId: 'uid_lea', displayName: 'Léa Durand', role: 'secge' },
  { userId: 'uid_asso',   displayName: 'Compte Asso',      role: 'secge' },
];
const ROSTER = [
  { userId: 'ros_lea',    displayName: 'Léa Durand',           rosterOnly: true },
  { userId: 'ros_julien', displayName: 'Julien de la Fontaine', rosterOnly: true },
];

test('Léa n apparait qu une fois, sous l id de la liste du staff', () => {
  const I = identites();
  const membres = I.fusionnerIdentites(COMPTES, ROSTER);
  const leas = membres.filter(m => /léa/i.test(m.displayName));
  assert.equal(leas.length, 1, 'une seule Léa');
  assert.equal(leas[0].userId, 'ros_lea', 'l id que portent ses dispos et ses entretiens');
  assert.equal(leas[0].role, 'secge', 'le compte lui apporte son role');
});

test('son compte devient un alias vers la meme personne', () => {
  const I = identites();
  I.fusionnerIdentites(COMPTES, ROSTER);
  assert.equal(I.canon('uid_lea'), 'ros_lea');
  assert.equal(I.canon('ros_lea'), 'ros_lea');
  assert.equal(I.canon('inconnu'),   'inconnu', 'un id inconnu reste tel quel');
});

test('un entretien qui cite l id du compte retombe sur la meme personne', () => {
  const I = identites();
  I.fusionnerIdentites(COMPTES, ROSTER);
  const iv = I.normaliserJures({ jury1Id: 'uid_lea', jury2Id: 'ros_julien', jury3Id: null });
  assert.deepEqual([iv.jury1Id, iv.jury2Id, iv.jury3Id], ['ros_lea', 'ros_julien', null]);
});

test('le cas du popup : Léa listee, cochee, et dispo', () => {
  const I = identites();
  const members = I.fusionnerIdentites(COMPTES, ROSTER);
  const staffAvailabilities = [
    { userId: I.canon('ros_lea'),    creneaux: [{ jour: '2026-09-28', creneaux: ['10:00'] }] },
    { userId: I.canon('ros_julien'), creneaux: [{ jour: '2026-09-28', creneaux: ['10:00'] }] },
  ];
  const iv = I.normaliserJures({ jury1Id: 'ros_lea', jury2Id: 'ros_julien' });
  const p = planning({}, staffAvailabilities, members);

  const listes = p.juresListables().map(m => m.userId);
  assert.ok(listes.includes('ros_lea'), 'avant : absente de la liste du popup');
  const coches = new Set([iv.jury1Id, iv.jury2Id].filter(Boolean));
  assert.ok(coches.has(members.find(m => /léa/i.test(m.displayName)).userId), 'et cochee comme jurée');
  assert.equal(p.isMemberAvailable('ros_lea', '2026-09-28', '10:30'), true);
});

test('les comptes sans entree roster restent listes a part', () => {
  const I = identites();
  const membres = I.fusionnerIdentites(COMPTES, ROSTER);
  assert.ok(membres.some(m => m.userId === 'uid_asso'));
  assert.equal(membres.length, 3, 'Léa, Julien, Compte Asso');
});

// ─── Noms courts des jurés dans les plannings ─────────────────────
import { nomCourt } from '../public/js/utils.js';

const STAFF = ['Inès Laurent', 'Inès PETIT', 'Julien de la Fontaine', 'Léa Durand'];

test('nomCourt : prenom seul quand il est unique', () => {
  assert.equal(nomCourt('Julien de la Fontaine', STAFF), 'Julien');
  assert.equal(nomCourt('Léa Durand', STAFF), 'Léa');
});

test('nomCourt : initiale du nom quand deux membres partagent le prenom', () => {
  assert.equal(nomCourt('Inès Laurent', STAFF), 'Inès L.');
  assert.equal(nomCourt('Inès PETIT', STAFF), 'Inès P.');
});

test('nomCourt : cas limites', () => {
  assert.equal(nomCourt('', STAFF), '');
  assert.equal(nomCourt('Camille', ['Camille', 'Camille Martin']), 'Camille', 'pas de nom de famille a abreger');
  assert.equal(nomCourt('Hugo Bernard', []), 'Hugo');
});
