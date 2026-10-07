/**
 * Aides à la délibération (onglet Classement de candidats.html), sans
 * dépendance : testées par `tests/delib.test.mjs`.
 *
 * - `severiteStaffeurs()` : correction des staffeurs sévères ou généreux ;
 * - `zoneGrise()` : les rangs à discuter autour de la ligne de coupe.
 */

/**
 * Sévérité des staffeurs, et la correction qui en découle pour chaque cooptant.
 *
 * Chaque cooptant n'a qu'une note, celle de SON jury : on ne peut pas comparer
 * deux staffeurs sur le même cooptant. On suppose donc que les cooptants sont
 * répartis à peu près au hasard entre les staffeurs, et on regarde si ceux d'un
 * staffeur ont, en moyenne, des notes plus hautes ou plus basses que les autres.
 *
 * Modèle : note = moyenne générale + moyenne des effets des staffeurs du jury.
 * Les effets sont estimés ensemble (un staffeur souvent associé à un autre plus
 * sévère n'en hérite pas), avec un rappel vers zéro qui vaut `prior` entretiens
 * neutres : un staffeur qui a fait 5 entretiens n'est corrigé qu'à moitié, il
 * en faut une vingtaine pour qu'il le soit aux quatre cinquièmes. Résolu par
 * coordonnées (Gauss-Seidel), sans matrice. Les effets sont ensuite comptés
 * par rapport à l'entretien moyen : la moyenne des notes corrigées est celle
 * des notes brutes, seul l'ordre change.
 *
 * @param {{id: string, score: number, jures: string[]}[]} observations
 *   un cooptant noté (score en %, ajustements non compris) et les staffeurs de son entretien
 * @param {{prior?: number, plafond?: number}} [options]
 * @returns {{
 *   suffisant: boolean,
 *   moyenne: number|null,
 *   effets: Map<string, {effet: number, n: number}>,
 *   corrections: Map<string, number>,
 * }} `effet` : points ajoutés par ce staffeur, comparé à l'entretien moyen
 *   (+ généreux, − sévère) ;
 *   `corrections` : ce qu'on ajoute à la note du cooptant (opposé de la
 *   moyenne des effets de son jury), arrondi au dixième et borné à ± `plafond`.
 */
export function severiteStaffeurs(observations, { prior = 5, plafond = 15 } = {}) {
  const obs = (observations || [])
    .map(o => ({ id: o.id, score: o.score, jures: [...new Set((o.jures || []).filter(Boolean))] }))
    .filter(o => Number.isFinite(o.score) && o.jures.length);
  const effets = new Map(), corrections = new Map();
  if (!obs.length) return { suffisant: false, moyenne: null, effets, corrections };

  const moyenne = obs.reduce((s, o) => s + o.score, 0) / obs.length;
  const parJure = new Map();
  obs.forEach(o => o.jures.forEach(j => {
    if (!parJure.has(j)) parJure.set(j, []);
    parJure.get(j).push(o);
  }));
  // Assez de matière : 8 cooptants notés, et 2 staffeurs avec au moins 2 entretiens.
  const suffisant = obs.length >= 8 && [...parJure.values()].filter(l => l.length >= 2).length >= 2;

  // Rappel vers zéro exprimé en entretiens : avec k staffeurs par jury, un
  // entretien pèse 1/k² dans l'estimation de chacun.
  const kMoyen = obs.reduce((s, o) => s + o.jures.length, 0) / obs.length;
  const lambda = prior / (kMoyen * kMoyen);
  // Le niveau commun est estimé en même temps que les effets, et non fixé à la
  // moyenne brute : sinon la générosité d'un seul staffeur ferait paraître
  // tous les autres sévères.
  const b = new Map([...parJure.keys()].map(j => [j, 0]));
  const somme = o => o.jures.reduce((s, j) => s + b.get(j), 0);
  let niveau = moyenne;
  for (let tour = 0; tour < 2000; tour++) {
    const n0 = obs.reduce((s, o) => s + o.score - somme(o) / o.jures.length, 0) / obs.length;
    let ecart = Math.abs(n0 - niveau);
    niveau = n0;
    for (const [j, liste] of parJure) {
      let num = 0, den = lambda;
      for (const o of liste) {
        const k = o.jures.length;
        num += (o.score - niveau - (somme(o) - b.get(j)) / k) / k;
        den += 1 / (k * k);
      }
      const v = num / den;
      ecart = Math.max(ecart, Math.abs(v - b.get(j)));
      b.set(j, v);
    }
    if (ecart < 1e-7) break;
  }
  // Recentrage : la correction moyenne sur les cooptants notés est nulle.
  const centre = obs.reduce((s, o) => s + somme(o) / o.jures.length, 0) / obs.length;
  for (const j of b.keys()) b.set(j, b.get(j) - centre);

  const arrondi = v => Math.round(v * 10) / 10 || 0;   // || 0 : pas de « -0 »
  for (const [j, liste] of parJure) effets.set(j, { effet: arrondi(b.get(j)), n: liste.length });
  if (suffisant) {
    obs.forEach(o => {
      const c = -somme(o) / o.jures.length;
      corrections.set(o.id, arrondi(Math.max(-plafond, Math.min(plafond, c))));
    });
  }
  return { suffisant, moyenne, effets, corrections };
}

/** Rangs de part et d'autre de la ligne de coupe : un cinquième des places, entre 3 et 8. */
export function largeurZoneConseillee(nbPlaces) {
  const n = Number(nbPlaces) || 0;
  return Math.min(8, Math.max(3, Math.round(n / 5)));
}

/**
 * Zone grise : les `largeur` derniers retenus et les `largeur` premiers
 * non retenus, ceux dont on discute en réunion.
 * @returns {{debut: number, fin: number} | null} indices (base 0, inclus) dans le classement
 */
export function zoneGrise(total, nbPlaces, largeur) {
  if (!(nbPlaces > 0) || !(largeur > 0) || nbPlaces >= total) return null;
  return { debut: Math.max(0, nbPlaces - largeur), fin: Math.min(total, nbPlaces + largeur) - 1 };
}
