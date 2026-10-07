/**
 * Sauvegarde complète de la base (admin plateforme) : toutes les collections
 * dans un fichier JSON, téléchargé sur l'ordinateur de l'admin.
 *
 * La base n'a pas de sauvegardes automatiques tant que le projet est en
 * formule gratuite (Spark) : ce fichier est alors la seule copie. Les dates
 * Firestore sont écrites `{ "__date": "2026-10-04T09:00:00.000Z" }` pour
 * pouvoir être recréées à l'identique si un jour il faut recharger.
 *
 * `versJSON` est sans dépendance Firebase : testé par tests/sauvegarde.test.mjs.
 */
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/** Toutes les collections connues (voir firestore.rules). */
export const COLLECTIONS_SAUVEGARDEES = [
  'organizations', 'memberships', 'campaigns', 'candidates', 'interviews', 'interview_evaluations',
  'notes_internes', 'absences', 'staff_availabilities', 'roster_members', 'rooms', 'room_bookings',
  'invite_codes', 'corbeille', 'users', 'platform_admins', 'platform_settings', 'platform_campaigns',
  'activite', 'echecs_envoi', 'scrutins', 'participations',
  // Pas `bulletins` : secrets tant qu'un vote est ouvert, leurs règles
  // refusent une lecture de toute la collection, même à l'admin.
];

/** Valeur Firestore → JSON (dates repérables, le reste tel quel). */
export function versJSON(v) {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v?.toDate === 'function' && typeof v?.seconds === 'number') return { __date: v.toDate().toISOString() };
  if (v instanceof Date) return { __date: v.toISOString() };
  if (Array.isArray(v)) return v.map(versJSON);
  if (typeof v === 'object') {
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number') return { __geo: [v.latitude, v.longitude] };
    if (typeof v.path === 'string' && typeof v.id === 'string' && v.firestore) return { __ref: v.path };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, versJSON(x)]));
  }
  return v;
}

/**
 * Lit toutes les collections (en parallèle) et prépare le fichier.
 * @returns {Promise<{fichier: {nom: string, blob: Blob}, nbDocuments: number, erreurs: string[]}>}
 */
export async function sauvegardeComplete(db) {
  const maintenant = new Date();
  const contenu = { format: 'cooptly-sauvegarde', version: 1, faiteLe: maintenant.toISOString(), collections: {}, erreurs: {} };
  await Promise.all(COLLECTIONS_SAUVEGARDEES.map(async nom => {
    try {
      const snap = await getDocs(collection(db, nom));
      contenu.collections[nom] = Object.fromEntries(snap.docs.map(d => [d.id, versJSON(d.data())]));
    } catch (e) {
      contenu.erreurs[nom] = e.message;
    }
  }));
  const nbDocuments = Object.values(contenu.collections).reduce((n, c) => n + Object.keys(c).length, 0);
  const p = n => String(n).padStart(2, '0');
  const nom = `cooptly-sauvegarde-${maintenant.getFullYear()}-${p(maintenant.getMonth() + 1)}-${p(maintenant.getDate())}-${p(maintenant.getHours())}h${p(maintenant.getMinutes())}.json`;
  return {
    fichier: { nom, blob: new Blob([JSON.stringify(contenu)], { type: 'application/json' }) },
    nbDocuments,
    erreurs: Object.keys(contenu.erreurs),
  };
}
