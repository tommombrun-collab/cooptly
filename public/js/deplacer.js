/**
 * Choisir un créneau dans la grille du planning : déplacer un entretien,
 * replacer un absent, placer un cooptant qui n'en a pas.
 *
 * Pour chaque case (jour × ligne de la grille) : les staffeurs libres pendant
 * TOUT l'entretien (dispo déclarée, pas déjà en entretien, pause comprise),
 * si la case suffit pour un entretien, et l'étoile ⭐ du formulaire
 * (`creneauxConseilles`) : la case colle à un entretien déjà prévu, le staff
 * enchaîne (jamais sur un jour encore vide). D'autres staffeurs que ceux
 * d'avant, c'est normal.
 *
 * Une case qui manque de staffeurs ou dépasse la limite d'entretiens en
 * parallèle reste choisissable (le bureau sait parfois mieux), avec un
 * avertissement ; seuls le passé et l'après-fin de journée sont bloqués.
 *
 * Module sans dépendance Firebase : testé par `tests/deplacer.test.mjs`.
 */
import { creneauxConseilles, pleinEnParallele } from './capacite.js';

const versMin = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };

/**
 * @param {object} o
 * @param {string[]} o.jours          'YYYY-MM-DD' affichés
 * @param {string[]} o.heures         lignes de la grille ('HH:MM')
 * @param {number} o.duree            minutes
 * @param {number} [o.battement]      pause entre deux entretiens d'un même staffeur
 * @param {number} o.finJourneeMin    heure de fin de journée, en minutes
 * @param {number} o.nbJurys          staffeurs nécessaires
 * @param {number} [o.maxParallele]   0 = pas de limite
 * @param {string[]} o.staff          staffeurs possibles (anglais déjà filtré)
 * @param {(id: string, jour: string, debutMin: number, finMin: number) => boolean|'secours'} o.libre
 * @param {{jour: string, startMin: number, endMin: number, ids: string[]}[]} o.occupations
 *   entretiens posés, un par groupe, SANS celui qu'on déplace
 * @param {Date} [o.maintenant]
 * @returns {Map<string, {jour: string, heure: string, startMin: number, endMin: number,
 *   libres: string[], secours: string[], bloque: string|null, manque: string|null, conseille: boolean}>}
 *   clé `${jour}T${heure}`. `bloque` : raison qui interdit la case ; `manque` :
 *   raison d'un avertissement (case choisissable quand même).
 */
export function creneauxPourDeplacer(o) {
  const { jours, heures, duree, battement = 0, finJourneeMin, nbJurys, maxParallele = 0,
    staff, libre, occupations, maintenant = new Date() } = o;
  const res = new Map();
  const jourAuj = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-${String(maintenant.getDate()).padStart(2, '0')}`;
  const minAuj = maintenant.getHours() * 60 + maintenant.getMinutes();

  jours.forEach(jour => {
    const duJour = occupations.filter(x => x.jour === jour);
    heures.forEach(heure => {
      const startMin = versMin(heure), endMin = startMin + duree;
      const c = { jour, heure, startMin, endMin, libres: [], secours: [], bloque: null, manque: null, conseille: false };
      res.set(`${jour}T${heure}`, c);
      if (jour < jourAuj || (jour === jourAuj && startMin < minAuj)) { c.bloque = 'Ce créneau est passé.'; return; }
      if (endMin > finJourneeMin) { c.bloque = 'L\'entretien finirait après la fin de journée.'; return; }
      // Un staffeur en entretien (pause comprise) n'est pas libre.
      const pris = new Set(duJour.filter(x => x.startMin < endMin + battement && x.endMin + battement > startMin).flatMap(x => x.ids));
      staff.forEach(id => {
        if (pris.has(id)) return;
        const l = libre(id, jour, startMin, endMin);
        if (!l) return;
        c.libres.push(id);
        if (l === 'secours') c.secours.push(id);
      });
      if (c.libres.length < nbJurys) {
        const n = nbJurys - c.libres.length;
        c.manque = c.libres.length
          ? `Il manque ${n} staffeur${n > 1 ? 's' : ''} libre${n > 1 ? 's' : ''} à cette heure.`
          : 'Aucun staffeur n\'a dit être libre à cette heure.';
      } else if (pleinEnParallele(duJour.map(x => ({ startMin: x.startMin, endMin: x.endMin })), startMin, endMin, maxParallele)) {
        c.manque = `Déjà ${maxParallele} entretien${maxParallele > 1 ? 's' : ''} en même temps (limite des Paramètres).`;
      }
    });
  });

  // ⭐ : la règle du formulaire, sur les seules cases qui suffisent. Une case
  // qui ne tient que grâce aux dispos « si vraiment pas le choix » n'en a pas.
  const cases = [...res.values()];
  const conseil = creneauxConseilles(
    cases.map(c => ({ dateStr: c.jour, startMin: c.startMin, endMin: c.endMin,
      booked: !!(c.bloque || c.manque), secours: c.libres.length - c.secours.length < nbJurys })),
    occupations.map(x => ({ dateStr: x.jour, startMin: x.startMin, endMin: x.endMin })),
    battement);
  // Un jour encore vide : le formulaire étoile son premier créneau (démarrer un
  // bloc) ; pour un déplacement, ce serait faire venir le staff pour un seul.
  const joursOccupes = new Set(occupations.map(x => x.jour));
  conseil.forEach(i => { if (joursOccupes.has(cases[i].jour)) cases[i].conseille = true; });
  return res;
}
