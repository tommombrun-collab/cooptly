/**
 * Entretiens vers l'agenda (.ics, Google) et comptage par staffeur.
 * Logique pure : ni Firestore ni émulateur.
 */
import test from 'node:test';
import assert from 'node:assert';
import { fichierIcs, lienGoogleAgenda, entretiensParStaffeur, texteIcs, dateIcs } from '../public/js/agenda.js';

const ev = (id, h) => ({ id, debut: new Date(`2026-10-02T${h}:00Z`), fin: new Date(`2026-10-02T${h.slice(0, 2)}:30:00Z`), titre: `Entretien ${id}` });

test('ics : un VEVENT par entretien, dates en UTC, fin de ligne CRLF', () => {
  const ics = fichierIcs([ev('a', '08:00'), ev('b', '09:00')], 'Asso');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(ics.includes('DTSTART:20261002T080000Z'));
  assert.ok(ics.includes('UID:a@cooptly'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
});

test('ics : virgules, points-virgules et retours a la ligne echappes', () => {
  assert.equal(texteIcs('Salle B0-113, 1er; ok\nsuite'), 'Salle B0-113\\, 1er\\; ok\\nsuite');
});

test('ics : les lignes longues sont repliees a 75 caracteres', () => {
  const ics = fichierIcs([{ ...ev('c', '10:00'), description: 'x'.repeat(200) }]);
  ics.split('\r\n').forEach(l => assert.ok(l.length <= 75, `ligne de ${l.length}`));
});

test('google : un lien par evenement, avec les dates', () => {
  const url = new URL(lienGoogleAgenda({ ...ev('d', '11:00'), lieu: 'C1-109' }));
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('dates'), `${dateIcs(new Date('2026-10-02T11:00:00Z'))}/${dateIcs(new Date('2026-10-02T11:30:00Z'))}`);
  assert.equal(url.searchParams.get('location'), 'C1-109');
});

test('comptage : passes et a venir, par staffeur', () => {
  const maintenant = new Date('2026-10-02T12:00:00Z');
  const ivs = [
    { jury1Id: 'tom', jury2Id: 'chloe', debut: new Date('2026-10-02T08:00:00Z'), fin: new Date('2026-10-02T08:30:00Z') },
    { jury1Id: 'tom', debut: new Date('2026-10-03T08:00:00Z'), fin: new Date('2026-10-03T08:30:00Z') },
  ];
  const c = entretiensParStaffeur(ivs, maintenant);
  assert.deepEqual(c.get('tom'), { passes: 1, aVenir: 1, total: 2 });
  assert.deepEqual(c.get('chloe'), { passes: 1, aVenir: 0, total: 1 });
});

test('comptage : un entretien a deux compte pour un', () => {
  const g = { jury1Id: 'tom', groupId: 'g1', debut: new Date('2026-10-03T08:00:00Z'), fin: new Date('2026-10-03T08:30:00Z') };
  const c = entretiensParStaffeur([g, { ...g }]);
  assert.equal(c.get('tom').total, 1);
});
