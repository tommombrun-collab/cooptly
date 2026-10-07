/**
 * Sauvegarde complète (public/js/sauvegarde.js) : les dates Firestore restent
 * repérables dans le JSON, le reste passe tel quel.
 */
import test from 'node:test';
import assert from 'node:assert';
import { Timestamp } from 'firebase/firestore';

// Le module importe le SDK depuis le CDN : on ne teste que la conversion,
// recopiée ici depuis le fichier pour rester sans réseau.
const source = (await import('node:fs')).readFileSync(new URL('../public/js/sauvegarde.js', import.meta.url), 'utf8');
const versJSON = new Function(`${source.match(/export function versJSON[\s\S]*?\n}\n/)[0].replace('export ', '')}; return versJSON;`)();

test('dates Firestore et Date → { __date } ISO', () => {
  const t = Timestamp.fromDate(new Date('2026-10-04T09:00:00Z'));
  assert.deepEqual(versJSON({ a: t, b: new Date('2026-10-05T10:00:00Z') }),
    { a: { __date: '2026-10-04T09:00:00.000Z' }, b: { __date: '2026-10-05T10:00:00.000Z' } });
});

test('listes et objets imbriqués, valeurs simples inchangées', () => {
  const t = Timestamp.fromDate(new Date('2026-10-04T09:00:00Z'));
  assert.deepEqual(versJSON({ l: [1, 'x', { d: t }], n: null, ok: true, o: { p: 2 } }),
    { l: [1, 'x', { d: { __date: '2026-10-04T09:00:00.000Z' } }], n: null, ok: true, o: { p: 2 } });
});
