/**
 * Choix des jurés d'un entretien.
 *
 * Règle : on préfère que les mêmes personnes enchaînent. Immobiliser deux
 * membres trois heures d'affilée coûte moins cher à une asso que déranger six
 * personnes une heure chacune. L'ancienne règle faisait exactement l'inverse :
 * elle triait par charge croissante, donc ceux qui venaient de passer
 * repassaient en fin de file et un nouveau binôme était mobilisé à chaque
 * créneau.
 *
 * Un plafond (`maxEntretiensAffiles`) force la relève pour ne pas épuiser les
 * mêmes personnes.
 *
 * Module sans dépendance : utilisable par `algo.js` comme par la page publique
 * `postuler.html`, qui n'initialise pas Firebase Auth.
 */

/** Un entretien mobilise-t-il cette personne comme juré ? */
export function estJure(interview, userId) {
  return interview.jury1Id === userId
      || interview.jury2Id === userId
      || interview.jury3Id === userId;
}

/**
 * Nombre d'entretiens que `userId` vient d'enchaîner juste avant `debut`.
 *
 * On remonte le fil : un entretien compte comme « à la suite » si sa fin colle
 * au début du suivant, au battement près. Deux entretiens séparés d'une heure
 * de creux ne forment pas une chaîne, la personne a eu le temps de partir.
 *
 * @param {string} userId
 * @param {{datetimeStart: Date, datetimeEnd: Date}[]} interviews entretiens déjà posés
 * @param {Date}   debut       début du créneau à pourvoir
 * @param {number} battementMin creux toléré entre deux entretiens, en minutes
 * @returns {number}
 */
export function chaineAvant(userId, interviews, debut, battementMin = 0) {
  const tolerance = (battementMin + 1) * 60 * 1000;  // +1 min pour absorber les arrondis
  const siens = interviews
    .filter(iv => estJure(iv, userId) && iv.datetimeStart && iv.datetimeEnd)
    .sort((a, b) => b.datetimeEnd - a.datetimeEnd);

  let n = 0;
  let curseur = debut.getTime();

  // Borne dure : deux entretiens identiques en base boucleraient à l'infini.
  for (let garde = 0; garde < 24; garde++) {
    const precedent = siens.find(iv => {
      const fin = iv.datetimeEnd.getTime();
      return fin <= curseur && curseur - fin <= tolerance;
    });
    if (!precedent) break;
    n++;
    curseur = precedent.datetimeStart.getTime();
  }
  return n;
}

/**
 * Choisit les jurés d'un entretien.
 *
 * Trois rangs, dans cet ordre :
 *   1. ceux qui enchaînent et n'ont pas atteint le plafond, chaîne la plus
 *      longue d'abord, pour qu'un binôme déjà en place reste ensemble ;
 *   2. ceux qui n'enchaînent pas, les moins chargés d'abord ;
 *   3. ceux qui ont atteint le plafond, en dernier recours seulement, pour
 *      qu'un entretien garde un jury plutôt que d'en manquer faute de monde.
 *
 * @param {object}   o
 * @param {string[]} o.disponibles  ids des membres libres sur ce créneau
 * @param {object[]} o.interviews   entretiens déjà posés, `datetimeStart`/`datetimeEnd` en Date
 * @param {Date}     o.debut        début du créneau à pourvoir
 * @param {Date}     o.fin          fin du créneau à pourvoir
 * @param {number}   o.nbJurys      jurés voulus (borné à 3 par le modèle)
 * @param {number}   o.maxAffiles   entretiens consécutifs avant relève forcée (0 = pas de plafond)
 * @param {number}   o.battementMin pause imposée entre deux entretiens
 * @returns {string[]} ids retenus, au plus `nbJurys`.
 */
export function choisirJury({
  disponibles, interviews = [], debut, fin,
  nbJurys = 2, maxAffiles = 4, battementMin = 0,
}) {
  const voulus = Math.max(1, Math.min(3, nbJurys));
  const marge  = battementMin * 60 * 1000;

  // Personne ne peut tenir deux entretiens en même temps : on écarte d'abord
  // ceux qui sont déjà pris sur un créneau qui chevauche celui-ci.
  const pris = new Set();
  interviews.forEach(iv => {
    if (!iv.datetimeStart || !iv.datetimeEnd) return;
    const chevauche = iv.datetimeStart.getTime() < fin.getTime() + marge
                   && iv.datetimeEnd.getTime() + marge > debut.getTime();
    if (!chevauche) return;
    [iv.jury1Id, iv.jury2Id, iv.jury3Id].filter(Boolean).forEach(id => pris.add(id));
  });

  const libres = [...new Set(disponibles)].filter(id => id && !pris.has(id));
  if (!libres.length) return [];

  const plafond = maxAffiles > 0 ? maxAffiles : Infinity;

  const fiches = libres.map(id => {
    const chaine = chaineAvant(id, interviews, debut, battementMin);
    const charge = interviews.filter(iv => estJure(iv, id)).length;
    let rang;
    if (chaine >= plafond)   rang = 2;      // relève forcée
    else if (chaine > 0)     rang = 0;      // enchaîne, on le garde
    else                     rang = 1;      // frais
    return { id, chaine, charge, rang };
  });

  fiches.sort((a, b) =>
    a.rang - b.rang
    || (a.rang === 0 ? b.chaine - a.chaine : 0)
    || a.charge - b.charge
    || a.id.localeCompare(b.id)               // départage stable, jamais aléatoire
  );

  return fiches.slice(0, voulus).map(f => f.id);
}
