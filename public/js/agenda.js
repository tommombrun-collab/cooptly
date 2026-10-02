/**
 * Entretiens vers un agenda personnel, et comptage des entretiens par staffeur.
 * Module sans dépendance (testé par tests/agenda.test.mjs).
 *
 * Un événement : { id, debut: Date, fin: Date, titre, lieu?, description? }.
 */

const deuxChiffres = n => String(n).padStart(2, '0');

/** Date au format iCalendar, en UTC : 20261002T083000Z. */
export function dateIcs(d) {
  return `${d.getUTCFullYear()}${deuxChiffres(d.getUTCMonth() + 1)}${deuxChiffres(d.getUTCDate())}`
    + `T${deuxChiffres(d.getUTCHours())}${deuxChiffres(d.getUTCMinutes())}${deuxChiffres(d.getUTCSeconds())}Z`;
}

/** Texte iCalendar : virgules, points-virgules, antislashs et retours à la ligne échappés. */
export function texteIcs(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Ligne repliée à 75 caractères (norme iCalendar), suite préfixée d'une espace. */
function plier(ligne) {
  if (ligne.length <= 75) return ligne;
  const morceaux = [ligne.slice(0, 75)];
  for (let i = 75; i < ligne.length; i += 74) morceaux.push(' ' + ligne.slice(i, i + 74));
  return morceaux.join('\r\n');
}

/**
 * Fichier .ics avec tous les événements. L'identifiant (UID) vient de
 * l'entretien : réimporter le fichier met à jour au lieu de dupliquer
 * (Apple Calendar, Outlook).
 * @param {object[]} evenements
 * @param {string} [nomCalendrier]
 * @returns {string}
 */
export function fichierIcs(evenements, nomCalendrier = 'Entretiens') {
  const maintenant = dateIcs(new Date());
  const lignes = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', "PRODID:-//Cooptly//FR", 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${texteIcs(nomCalendrier)}`,
  ];
  evenements.forEach(ev => {
    lignes.push(
      'BEGIN:VEVENT',
      `UID:${texteIcs(ev.id)}@cooptly`,
      `DTSTAMP:${maintenant}`,
      `DTSTART:${dateIcs(ev.debut)}`,
      `DTEND:${dateIcs(ev.fin)}`,
      `SUMMARY:${texteIcs(ev.titre)}`,
    );
    if (ev.lieu) lignes.push(`LOCATION:${texteIcs(ev.lieu)}`);
    if (ev.description) lignes.push(`DESCRIPTION:${texteIcs(ev.description)}`);
    lignes.push('END:VEVENT');
  });
  lignes.push('END:VCALENDAR');
  return lignes.map(plier).join('\r\n') + '\r\n';
}

/** Lien « ajouter à Google Agenda » pour UN événement (Google n'en accepte qu'un par lien). */
export function lienGoogleAgenda(ev) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.titre || '',
    dates: `${dateIcs(ev.debut)}/${dateIcs(ev.fin)}`,
  });
  if (ev.description) p.set('details', ev.description);
  if (ev.lieu) p.set('location', ev.lieu);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/**
 * Entretiens de chaque staffeur : passés (fin avant `maintenant`) et à venir.
 * Un entretien à plusieurs (même `groupId`) compte pour UN entretien.
 * @param {object[]} interviews { jury1Id, jury2Id, jury3Id, groupId?, debut: Date, fin: Date }
 * @returns {Map<string, {passes: number, aVenir: number, total: number}>}
 */
export function entretiensParStaffeur(interviews, maintenant = new Date()) {
  const vus = new Set();
  const compte = new Map();
  interviews.forEach(iv => {
    if (iv.groupId) {
      if (vus.has(iv.groupId)) return;
      vus.add(iv.groupId);
    }
    const passe = iv.fin && iv.fin.getTime() <= maintenant.getTime();
    [...new Set([iv.jury1Id, iv.jury2Id, iv.jury3Id].filter(Boolean))].forEach(id => {
      const c = compte.get(id) || { passes: 0, aVenir: 0, total: 0 };
      if (passe) c.passes++; else c.aVenir++;
      c.total++;
      compte.set(id, c);
    });
  });
  return compte;
}
