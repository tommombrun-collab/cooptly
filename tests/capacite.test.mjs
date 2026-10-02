/**
 * Capacité des créneaux pour le placement automatique.
 * Logique pure : ni Firestore ni émulateur (c'est pourquoi elle vit dans son
 * propre module plutôt que dans algo.js, qui importe db.js).
 */
import test from 'node:test';
import assert from 'node:assert';
import { buildCapacityMap, capaciteToutLeMonde, consommerStaff, HEURES_GRILLE } from '../public/js/capacite.js';

const HEURES = h => h.map(n => `${String(n).padStart(2, '0')}:00`);
const staff = (userId, heures) => ({ userId, creneaux: [{ jour: '2026-09-29', creneaux: HEURES(heures) }] });
const JOURS = new Set(['2026-09-29']);
const cle = h => new Date(`2026-09-29T${String(h).padStart(2, '0')}:00:00`).toISOString();

test('entretien de 30 min : une heure declaree suffit', () => {
  const map = buildCapacityMap([staff('A', [10]), staff('B', [10])], 2, JOURS, 30);
  assert.deepEqual(map[cle(10)].staffIds.sort(), ['A', 'B']);
  assert.equal(map[cle(10)].restant, 2);
});

test('entretien de 90 min : il faut etre libre sur les deux heures', () => {
  const map = buildCapacityMap([
    staff('A', [10, 11]),   // couvre 10:00 → 11:30
    staff('B', [10]),       // part a 11 h : ne doit PAS etre retenu sur 10:00
  ], 2, JOURS, 90);
  assert.deepEqual(map[cle(10)].staffIds, ['A'], 'B ne couvre pas la fin de l entretien');
  assert.equal(map[cle(11)], undefined, 'A seul sur 11:00 ne couvre pas 11:00 → 12:30');
});

test('entretien de 60 min : une seule heure suffit encore', () => {
  const map = buildCapacityMap([staff('A', [10]), staff('B', [10])], 2, JOURS, 60);
  assert.equal(map[cle(10)].staffIds.length, 2);
});

test('un placement ne consomme que les jures mobilises', () => {
  // 6 staffeurs sur 10 h et 11 h, 2 jures par entretien
  const dispos = ['A', 'B', 'C', 'D', 'E', 'F'].map(id => staff(id, [10, 11]));
  const map = buildCapacityMap(dispos, 2, JOURS, 30);
  assert.equal(map[cle(10)].restant, 6);
  assert.equal(map[cle(11)].restant, 6);

  consommerStaff(map, cle(10), 30, 2);
  assert.equal(map[cle(10)].restant, 4, 'deux jures mobilises sur 10:00');
  assert.equal(map[cle(11)].restant, 6, '30 min ne debordent pas sur 11:00');
});

test('un entretien qui deborde ne supprime pas tout le creneau suivant', () => {
  const dispos = ['A', 'B', 'C', 'D', 'E', 'F'].map(id => staff(id, [10, 11, 12]));
  const map = buildCapacityMap(dispos, 2, JOURS, 60);

  consommerStaff(map, cle(10), 75, 2);   // 60 min + 15 de battement → deborde sur 11:00
  assert.equal(map[cle(10)].restant, 4);
  assert.equal(map[cle(11)].restant, 4,
    'il reste 4 personnes a 11 h, soit deux entretiens : avant, tout etait mis a zero');
  assert.equal(map[cle(12)].restant, 6, 'le creneau d apres n est pas touche');
});

test('la capacite ne descend jamais sous zero', () => {
  const map = buildCapacityMap([staff('A', [10]), staff('B', [10])], 2, JOURS, 30);
  consommerStaff(map, cle(10), 30, 2);
  consommerStaff(map, cle(10), 30, 2);
  assert.equal(map[cle(10)].restant, 0);
});

test('hors periode : rien n est retenu', () => {
  const map = buildCapacityMap([staff('A', [10])], 2, new Set(['2026-10-01']), 30);
  assert.deepEqual(Object.keys(map), []);
});

// ─── Staff réputé disponible sur toute la période ────────────────

test('sans aucune dispo declaree, tout le staff est libre partout', () => {
  const jours = new Set(['2026-09-29', '2026-09-30']);
  const map = capaciteToutLeMonde(['A', 'B', 'C'], jours, 30);

  assert.equal(Object.keys(map).length, 2 * HEURES_GRILLE.length,
    'chaque heure de chaque jour doit etre ouverte');
  assert.deepEqual(map[cle(8)].staffIds.sort(), ['A', 'B', 'C']);
  assert.equal(map[cle(18)].restant, 3, 'derniere heure de la grille comprise');
});

test('meme regime : un entretien long reste borne par la fin de grille', () => {
  // L heure '18:00' couvre le bloc 18 h → 19 h : la grille s arrete a 19 h.
  const map = capaciteToutLeMonde(['A', 'B'], new Set(['2026-09-29']), 120);
  assert.ok(map[cle(16)],  '16 h → 18 h tient');
  assert.ok(map[cle(17)],  '17 h → 19 h tient, 19 h est la fin de la grille');
  assert.equal(map[cle(18)], undefined, '18 h → 20 h depasse la grille');
});

test('aucun jure : carte vide, l algo saura le dire', () => {
  assert.deepEqual(capaciteToutLeMonde([], new Set(['2026-09-29']), 30), {});
  assert.deepEqual(capaciteToutLeMonde([null, ''], new Set(['2026-09-29']), 30), {});
});

test('les doublons d identifiant ne gonflent pas la capacite', () => {
  const map = capaciteToutLeMonde(['A', 'A', 'B'], new Set(['2026-09-29']), 30);
  assert.equal(map[cle(10)].restant, 2);
});

test('la consommation fonctionne aussi dans ce regime', () => {
  const map = capaciteToutLeMonde(['A', 'B', 'C', 'D'], new Set(['2026-09-29']), 30);
  consommerStaff(map, cle(10), 30, 2);
  assert.equal(map[cle(10)].restant, 2);
  assert.equal(map[cle(11)].restant, 4);
});

// ─── Créneaux du formulaire (mode « creneaux ») ──────────────────
import { juresEncoreLibres } from '../public/js/capacite.js';

test('cas réel : un entretien ne retire que ses jurés réellement dispos', () => {
  // 12:00 : Inès, Chloé, Julien dispos. Entretien 11:30-12:00 avec Chloé et
  // Camille (pause de 15 min, donc il chevauche). Camille n'est pas dispo à 12:00.
  const libres = juresEncoreLibres(['ines', 'chloe', 'julien'], [{ juryIds: ['chloe', 'tom'] }], 2);
  assert.equal(libres, 2);   // l'ancien calcul donnait 3 - 1 × 2 = 1 : « Complet »
});

test('les deux jurés de l entretien sont dispos : ils sont bien retirés', () => {
  assert.equal(juresEncoreLibres(['a', 'b', 'c'], [{ juryIds: ['a', 'b'] }], 2), 1);
});

test('jury pas encore attribué : ses places restent réservées', () => {
  assert.equal(juresEncoreLibres(['a', 'b', 'c', 'd'], [{ juryIds: [] }], 2), 2);
  assert.equal(juresEncoreLibres(['a', 'b', 'c', 'd'], [{ juryIds: ['a'] }], 2), 2);
});

test('un juré pris par deux entretiens n est compté qu une fois', () => {
  assert.equal(juresEncoreLibres(['a', 'b', 'c'], [{ juryIds: ['a', 'x'] }, { juryIds: ['a', 'y'] }], 2), 2);
});

test('jamais négatif', () => {
  assert.equal(juresEncoreLibres(['a'], [{ juryIds: [] }, { juryIds: [] }], 2), 0);
});

// ─── Heure de fin réglable (config.heureFin) ─────────────────────
import { heuresGrille, heureFinValide } from '../public/js/capacite.js';

test('grille par défaut : 8 h à 19 h, inchangée', () => {
  assert.deepEqual(heuresGrille(), HEURES_GRILLE);
  assert.equal(heuresGrille().at(-1), '18:00');
  assert.equal(heuresGrille(undefined).length, 11);
});

test('entretiens en visio le soir : grille prolongée jusqu à 21 h', () => {
  const h = heuresGrille(21);
  assert.equal(h[0], '08:00');
  assert.equal(h.at(-1), '20:00');   // la case 20:00 couvre 20 h-21 h
});

test('heure de fin bornée : ni avant 17 h ni après 23 h, 19 h si invalide', () => {
  assert.equal(heureFinValide(30), 23);
  assert.equal(heureFinValide(5), 17);
  assert.equal(heureFinValide('21'), 21);
  assert.equal(heureFinValide(null), 19);
  assert.equal(heureFinValide('n importe quoi'), 19);
});

test('staff réputé libre : la capacité suit l heure de fin', () => {
  const jours = new Set(['2026-09-29']);
  const tard  = capaciteToutLeMonde(['a', 'b'], jours, 30, 21);
  const defaut = capaciteToutLeMonde(['a', 'b'], jours, 30);
  const cle20h = Object.keys(tard).find(k => new Date(k).getHours() === 20);
  assert.ok(cle20h, 'un créneau à 20 h doit exister quand la fin est à 21 h');
  assert.ok(!Object.keys(defaut).some(k => new Date(k).getHours() >= 19), 'rien après 19 h par défaut');
});

// ─── Délai minimum avant un entretien (config.delaiReservationJours) ─
import { premierJourReservable } from '../public/js/utils.js';

test('délai de 2 jours : ni aujourd hui ni demain', () => {
  const vendredi = new Date(2026, 8, 25, 17, 30);   // vendredi 25 sept., 17 h 30
  const p = premierJourReservable(2, vendredi);
  assert.equal(p.getDate(), 27);
  assert.equal(p.getHours(), 0);                   // dès minuit le 27
  assert.ok(new Date(2026, 8, 26, 10) < p);        // samedi 26 : refusé
  assert.ok(new Date(2026, 8, 27, 8) >= p);        // dimanche 27 : accepté
});

test('délai 0 : dès aujourd hui ; valeurs farfelues ramenées dans les bornes', () => {
  const j = new Date(2026, 9, 31, 23, 0);
  assert.equal(premierJourReservable(0, j).getDate(), 31);
  assert.equal(premierJourReservable(1, j).getMonth(), 10);   // passe au mois suivant
  assert.equal(premierJourReservable('abc', j).getDate(), 31);
  assert.equal(premierJourReservable(-3, j).getDate(), 31);
});

// ─── Pas des créneaux (config.pasCreneauxMinutes) ────────────────
import { pasCreneauxValide, pasPlanning, ligneDuPlanning } from '../public/js/capacite.js';
import { getTimeSlots } from '../public/js/utils.js';

test('pas des créneaux : 15, 30 ou 60, sinon 30', () => {
  assert.equal(pasCreneauxValide(15), 15);
  assert.equal(pasCreneauxValide('60'), 60);
  assert.equal(pasCreneauxValide(20), 30);
  assert.equal(pasCreneauxValide(undefined), 30);
});

test('lignes des plannings : 15 min au quart d heure, 30 sinon', () => {
  assert.equal(pasPlanning(15), 15);
  assert.equal(pasPlanning(60), 30);
  assert.equal(getTimeSlots(8, 9, 15).map(s => s.label).join(' '), '08:00 08:15 08:30 08:45');
  assert.equal(getTimeSlots(8, 9).map(s => s.label).join(' '), '08:00 08:30');   // inchangé par défaut
});

test('un entretien hors de l heure ronde reste visible dans sa ligne', () => {
  assert.equal(ligneDuPlanning(new Date(2026, 9, 1, 10, 15), 30), '10:00');
  assert.equal(ligneDuPlanning(new Date(2026, 9, 1, 10, 45), 30), '10:30');
  assert.equal(ligneDuPlanning(new Date(2026, 9, 1, 10, 45), 15), '10:45');
});

// ── Entretiens en parallèle (config.maxEntretiensParallele) ──────────
import { pleinEnParallele } from '../public/js/capacite.js';
const occ = (a, b) => ({ startMin: a, endMin: b });

test('parallele : 0 = pas de limite', () => {
  assert.equal(pleinEnParallele([occ(540, 570), occ(540, 570), occ(540, 570)], 540, 570, 0), false);
});

test('parallele : plein quand le maximum est deja atteint au meme moment', () => {
  assert.equal(pleinEnParallele([occ(540, 570), occ(540, 570)], 540, 570, 2), true);
  assert.equal(pleinEnParallele([occ(540, 570)], 540, 570, 2), false);
});

test('parallele : deux entretiens qui se suivent ne comptent pas ensemble', () => {
  // 9:00-9:30 et 9:30-10:00, nouveau a 9:15 : un seul autre a la fois.
  assert.equal(pleinEnParallele([occ(540, 570), occ(570, 600)], 555, 585, 2), false);
  assert.equal(pleinEnParallele([occ(540, 570), occ(570, 600)], 555, 585, 1), true);
});

test('parallele : un entretien qui finit pile au debut ne gene pas', () => {
  assert.equal(pleinEnParallele([occ(510, 540)], 540, 570, 1), false);
});

// ── Langue des staffeurs (config.jurysAnglaisRequis) ────────────────
import { parleAnglais, staffPourEntretien } from '../public/js/capacite.js';

test('langue : sans reponse, un staffeur ne compte pas comme anglophone', () => {
  assert.equal(parleAnglais({ userId: 'a' }), false);
  assert.equal(parleAnglais({ userId: 'a', langues: ['fr'] }), false);
  assert.equal(parleAnglais({ userId: 'a', langues: ['fr', 'en'] }), true);
});

test('langue : entretien en anglais exige, seuls les anglophones restent', () => {
  const staff = [{ userId: 'fr', langues: ['fr'] }, { userId: 'en', langues: ['en'] }, { userId: 'rien' }];
  assert.deepEqual(staffPourEntretien(staff, { anglais: true, exigerAnglais: true }).map(s => s.userId), ['en']);
});

test('langue : reglage desactive ou entretien en francais, tout le monde reste', () => {
  const staff = [{ userId: 'fr', langues: ['fr'] }, { userId: 'en', langues: ['en'] }];
  assert.equal(staffPourEntretien(staff, { anglais: true, exigerAnglais: false }).length, 2);
  assert.equal(staffPourEntretien(staff, { anglais: false, exigerAnglais: true }).length, 2);
});

// ── Créneaux conseillés et dispos de secours ────────────────────────
import { enSecours, creneauxConseilles } from '../public/js/capacite.js';

test('secours : vrai des qu une heure couverte est en secours', () => {
  const sa = { secours: [{ jour: '2026-10-05', creneaux: ['11:00'] }] };
  assert.equal(enSecours(sa, '2026-10-05', 600, 60), false);   // 10:00-11:00
  assert.equal(enSecours(sa, '2026-10-05', 630, 60), true);    // 10:30-11:30 touche 11 h
  assert.equal(enSecours({}, '2026-10-05', 660, 30), false);
});

test('conseilles : les creneaux qui collent a un entretien pose', () => {
  const c = m => ({ dateStr: 'J', startMin: m, endMin: m + 30 });
  const creneaux = [c(540), c(570), c(600), c(630), c(660)];   // 9:00 a 11:00
  const poses = [{ dateStr: 'J', startMin: 600, endMin: 630 }]; // 10:00-10:30 deja pris
  const s = creneauxConseilles(creneaux.map((x, i) => i === 2 ? { ...x, booked: true } : x), poses);
  assert.deepEqual([...s].sort(), [1, 3], '9:30 (juste avant) et 10:30 (juste apres)');
});

test('conseilles : pause comprise', () => {
  const creneaux = [{ dateStr: 'J', startMin: 645, endMin: 675 }];
  assert.equal(creneauxConseilles(creneaux, [{ dateStr: 'J', startMin: 600, endMin: 630 }], 15).size, 1);
});

test('conseilles : jour vide, le premier creneau ; jamais un creneau de secours', () => {
  const creneaux = [
    { dateStr: 'J', startMin: 540, endMin: 570, secours: true },
    { dateStr: 'J', startMin: 570, endMin: 600 },
    { dateStr: 'J', startMin: 600, endMin: 630 },
  ];
  assert.deepEqual([...creneauxConseilles(creneaux, [])], [1]);
});

test('conseilles : au plus 3 par jour, les trous bouches d abord', () => {
  const c = m => ({ dateStr: 'J', startMin: m, endMin: m + 30 });
  // Entretiens a 9:00, 10:00, 12:00, 14:00 ; 9:30 bouche le trou entre 9:00 et 10:00.
  const poses = [540, 600, 720, 840].map(m => ({ dateStr: 'J', startMin: m, endMin: m + 30 }));
  const creneaux = [570, 630, 690, 750, 810, 870].map(c);
  const s = creneauxConseilles(creneaux, poses);
  assert.equal(s.size, 3);
  assert.ok(s.has(0), '9:30, entre deux entretiens, passe en premier');
  assert.equal(creneauxConseilles(creneaux, poses, 0, 15, 2).size, 2);
});
