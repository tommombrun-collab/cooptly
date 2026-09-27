/**
 * Firestore factice pour la démo en ligne (GitHub Pages).
 *
 * Remplace le SDK Firebase via une import map (voir scripts/build-demo.mjs) :
 * l'application tourne SANS AUCUNE modification, mais ses lectures et écritures
 * vont dans une base en mémoire, sauvegardée dans le localStorage du visiteur
 * pour survivre au passage d'une page à l'autre. Rien ne quitte le navigateur.
 *
 * Seules les fonctions réellement utilisées par l'application sont imitées.
 * Les règles de sécurité ne sont PAS appliquées : elles sont couvertes par les
 * tests (tests/*.test.mjs), pas par la démo.
 */
import { chargerBase, sauverBase } from '../store.js';

// ─── Timestamp ────────────────────────────────────────────────────
export class Timestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
  static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static now() { return Timestamp.fromMillis(Date.now()); }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  isEqual(o) { return o instanceof Timestamp && o.toMillis() === this.toMillis(); }
  valueOf() { return this.toMillis(); }
  toJSON() { return { __ts: this.toMillis() }; }
}

const SERVER_TS = { __serverTimestamp: true };
export const serverTimestamp = () => SERVER_TS;

// ─── Références ───────────────────────────────────────────────────
const db = { type: 'firestore' };
export const getFirestore = () => db;

const nouvelId = () => Array.from(crypto.getRandomValues(new Uint8Array(15)),
  b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('').slice(0, 20);

function refDoc(colPath, id) {
  return { type: 'document', id, path: `${colPath}/${id}`, _col: colPath, parent: { id: colPath.split('/').pop(), path: colPath } };
}

export function collection(parent, ...segs) {
  const base = parent?.type === 'document' ? [parent.path] : [];
  return { type: 'collection', path: [...base, ...segs].join('/'), id: segs[segs.length - 1] };
}

export function doc(parent, ...segs) {
  if (parent?.type === 'collection') {
    return refDoc(parent.path, segs.length ? segs.join('/') : nouvelId());
  }
  const parts = segs.join('/').split('/');
  const id = parts.pop();
  return refDoc(parts.join('/'), id);
}

export const where   = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field, dir });
export const limit   = n => ({ kind: 'limit', n });
export const query   = (col, ...contraintes) => ({ type: 'query', path: col.path, contraintes });

// ─── (Dé)sérialisation ────────────────────────────────────────────
function revivre(v) {
  if (Array.isArray(v)) return v.map(revivre);
  if (v && typeof v === 'object') {
    if ('__ts' in v && Object.keys(v).length === 1) return Timestamp.fromMillis(v.__ts);
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = revivre(x);
    return o;
  }
  return v;
}
function figer(v) {
  if (v === SERVER_TS) return Timestamp.now().toJSON();
  if (v instanceof Timestamp) return v.toJSON();
  if (v instanceof Date) return Timestamp.fromDate(v).toJSON();
  if (Array.isArray(v)) return v.map(figer);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = figer(x);
    return o;
  }
  return v;
}
const valeur = (obj, champ) => champ.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const comparable = v => (v instanceof Timestamp ? v.toMillis() : v);

// ─── Instantanés ──────────────────────────────────────────────────
function instantane(ref, brut) {
  return {
    id: ref.id, ref, exists: () => brut !== undefined,
    data: () => (brut === undefined ? undefined : revivre(structuredClone(brut))),
    get: champ => (brut === undefined ? undefined : revivre(valeur(structuredClone(brut), champ))),
  };
}

// Latence simulée : sans elle, les états de chargement ne se verraient jamais
// et certains enchaînements (rendu puis mesure) se comportent autrement.
const latence = () => new Promise(r => setTimeout(r, 40 + Math.random() * 80));

export async function getDoc(ref) {
  await latence();
  const base = chargerBase();
  return instantane(ref, base[ref._col]?.[ref.id]);
}

function correspond(d, c) {
  const v = comparable(valeur(d, c.field));
  const x = comparable(c.value);
  switch (c.op) {
    case '==': return v === x;
    case '!=': return v !== x;
    case '<':  return v < x;
    case '<=': return v <= x;
    case '>':  return v > x;
    case '>=': return v >= x;
    case 'in': return Array.isArray(x) && x.includes(v);
    case 'array-contains': return Array.isArray(v) && v.map(comparable).includes(x);
    default: throw new Error(`Opérateur non géré par la démo : ${c.op}`);
  }
}

export async function getDocs(q) {
  await latence();
  const base = chargerBase();
  const table = base[q.path] || {};
  let lignes = Object.entries(table).map(([id, brut]) => ({ id, brut, d: revivre(structuredClone(brut)) }));
  const contraintes = q.contraintes || [];
  contraintes.filter(c => c.kind === 'where').forEach(c => { lignes = lignes.filter(l => correspond(l.d, c)); });
  contraintes.filter(c => c.kind === 'orderBy').reverse().forEach(c => {
    lignes.sort((a, b) => {
      const x = comparable(valeur(a.d, c.field)), y = comparable(valeur(b.d, c.field));
      const r = x < y ? -1 : x > y ? 1 : 0;
      return c.dir === 'desc' ? -r : r;
    });
  });
  const lim = contraintes.find(c => c.kind === 'limit');
  if (lim) lignes = lignes.slice(0, lim.n);
  const docs = lignes.map(l => instantane(refDoc(q.path, l.id), l.brut));
  return { docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn) };
}

// ─── Écritures ────────────────────────────────────────────────────
function ecrire(base, ref, data, { merge = false, maj = false } = {}) {
  const table = (base[ref._col] ||= {});
  const actuel = table[ref.id];
  if (maj && actuel === undefined) {
    const e = new Error(`No document to update: ${ref.path}`); e.code = 'not-found'; throw e;
  }
  if (!merge && !maj) { table[ref.id] = figer(data); return; }
  const cible = structuredClone(actuel || {});
  for (const [k, v] of Object.entries(data)) {
    // Mise à jour à chemin pointé ('config.x') comme dans Firestore.
    if (maj && k.includes('.')) {
      const parts = k.split('.'); let o = cible;
      parts.slice(0, -1).forEach(p => { o = (o[p] && typeof o[p] === 'object') ? o[p] : (o[p] = {}); });
      o[parts.at(-1)] = figer(v);
    } else {
      cible[k] = figer(v);
    }
  }
  table[ref.id] = cible;
}

export async function setDoc(ref, data, options = {}) {
  await latence();
  const base = chargerBase(); ecrire(base, ref, data, { merge: !!options.merge }); sauverBase(base);
}
export async function updateDoc(ref, data) {
  await latence();
  const base = chargerBase(); ecrire(base, ref, data, { maj: true }); sauverBase(base);
}
export async function addDoc(col, data) {
  await latence();
  const ref = doc(col);
  const base = chargerBase(); ecrire(base, ref, data); sauverBase(base);
  return ref;
}
export async function deleteDoc(ref) {
  await latence();
  const base = chargerBase();
  if (base[ref._col]) delete base[ref._col][ref.id];
  sauverBase(base);
}

/** Lot atomique : toutes les écritures s'appliquent ensemble, ou aucune. */
export function writeBatch() {
  const ops = [];
  return {
    set(ref, data, options = {}) { ops.push(b => ecrire(b, ref, data, { merge: !!options.merge })); return this; },
    update(ref, data) { ops.push(b => ecrire(b, ref, data, { maj: true })); return this; },
    delete(ref) { ops.push(b => { if (b[ref._col]) delete b[ref._col][ref.id]; }); return this; },
    async commit() {
      await latence();
      const base = chargerBase();
      ops.forEach(op => op(base));   // une erreur ici annule tout : rien n'est sauvé
      sauverBase(base);
    },
  };
}
