/**
 * « Optimiser » le planning : redistribue les staffeurs des entretiens à venir
 * pour resserrer les journées du staff et équilibrer la charge.
 *
 * Ne change JAMAIS l'heure d'un entretien (c'est le cooptant qui l'a choisie),
 * seulement ses jurés. Rejoue `choisirJury` (js/jury.js, la règle du formulaire
 * et du placement automatique) dans l'ordre chronologique, sur les seuls
 * staffeurs libres pendant tout l'entretien. Une proposition n'est retenue que
 * si elle améliore le planning (`noteGlobale`), et un entretien qu'on ne sait
 * pas mieux pourvoir garde ses jurés.
 *
 * Module sans dépendance Firebase : testé par `tests/optimiser.test.mjs`.
 */
import { choisirJury } from './jury.js';

const jures = iv => [iv.jury1Id, iv.jury2Id, iv.jury3Id].filter(Boolean);
const jourDe = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Un entretien à plusieurs (`groupId`) n'occupe le jury qu'une fois. */
export function unParGroupe(interviews) {
  const vus = new Set();
  return interviews.filter(iv => {
    const cle = iv.groupId || iv.id;
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

/**
 * Mesures d'un planning, sur les entretiens donnés (un par groupe).
 * @param {{datetimeStart: Date, datetimeEnd: Date, jury1Id?, jury2Id?, jury3Id?}[]} interviews
 * @param {string[]} staff ids des staffeurs comptés (ceux qui pouvaient être pris)
 * @param {object[]} [dejaFaits] entretiens fixes : ils comptent dans la charge de chacun, pas dans
 *   les journées à resserrer
 * @returns {{ecart: number, seuls: number, trousMin: number, charges: Map<string, number>}}
 *   ecart : charge du plus chargé moins celle du moins chargé ;
 *   seuls : fois où un staffeur vient pour un seul entretien dans la journée ;
 *   trousMin : minutes d'attente entre deux entretiens d'un même staffeur, le même jour.
 */
export function mesurer(interviews, staff, dejaFaits = []) {
  const charges = new Map(staff.map(id => [id, 0]));
  unParGroupe(dejaFaits).forEach(iv => jures(iv).forEach(id => { if (charges.has(id)) charges.set(id, charges.get(id) + 1); }));
  const parPersonneJour = new Map();
  unParGroupe(interviews).forEach(iv => {
    jures(iv).forEach(id => {
      charges.set(id, (charges.get(id) || 0) + 1);
      const cle = `${id}|${jourDe(iv.datetimeStart)}`;
      if (!parPersonneJour.has(cle)) parPersonneJour.set(cle, []);
      parPersonneJour.get(cle).push(iv);
    });
  });
  let seuls = 0, trousMin = 0;
  parPersonneJour.forEach(liste => {
    if (liste.length === 1) { seuls++; return; }
    liste.sort((a, b) => a.datetimeStart - b.datetimeStart);
    for (let i = 1; i < liste.length; i++) {
      const creux = (liste[i].datetimeStart - liste[i - 1].datetimeEnd) / 60000;
      if (creux > 0) trousMin += creux;
    }
  });
  const valeurs = [...charges.values()];
  const ecart = valeurs.length ? Math.max(...valeurs) - Math.min(...valeurs) : 0;
  return { ecart, seuls, trousMin: Math.round(trousMin), charges };
}

/** Plus c'est bas, mieux c'est : les venues pour un seul entretien pèsent le plus. */
export const noteGlobale = m => m.seuls * 60 + m.trousMin + m.ecart * 20;

const memeEquipe = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const chevauche = (x, y, margeMs) =>
  x.datetimeStart.getTime() < y.datetimeEnd.getTime() + margeMs && x.datetimeEnd.getTime() + margeMs > y.datetimeStart.getTime();

/**
 * Propose de nouveaux jurés pour les entretiens modifiables.
 *
 * Deux pistes, on garde la meilleure :
 *  - repartir de zéro avec `choisirJury`, comme un placement neuf ;
 *  - partir du planning actuel et ne faire que les changements qui l'améliorent
 *    (reprendre l'équipe de l'entretien voisin, ou celle du premier calcul).
 * À note égale, celle qui change le moins d'entretiens : le staff a déjà son
 * planning en tête.
 *
 * @param {object} o
 * @param {object[]} o.aOptimiser  entretiens à venir qu'on peut changer (Date pour datetimeStart/End)
 * @param {object[]} o.fixes       entretiens qu'on ne touche pas (passés, aujourd'hui) : ils comptent
 *                                 pour la continuité et les chevauchements
 * @param {string[]} o.staff       staffeurs pouvant être jurés
 * @param {(id: string, iv: object) => boolean|'secours'} o.libre  libre pendant tout l'entretien ?
 * @param {(iv: object) => string[]} [o.autorises] staffeurs admis pour CET entretien (anglais)
 * @param {object} o.cfg { nbJurys, maxEntretiensAffiles, battementMinutes }
 * @returns {{changements: {iv: object, avant: string[], apres: string[]}[], avant: object, apres: object, inchange: boolean}}
 */
export function optimiserJurys({ aOptimiser, fixes = [], staff, libre, autorises = () => staff, cfg = {} }) {
  const groupes = unParGroupe(aOptimiser).slice().sort((a, b) => a.datetimeStart - b.datetimeStart);
  const deja = unParGroupe(fixes);
  const margeMs = (cfg.battementMinutes || 0) * 60000;
  const plafond = cfg.maxEntretiensAffiles > 0 ? cfg.maxEntretiensAffiles : Infinity;
  const voulus = iv => Math.max(Math.min(3, cfg.nbJurys || 2), jures(iv).length);
  const avecJury = (iv, j) => ({ ...iv, jury1Id: j[0] || null, jury2Id: j[1] || null, jury3Id: j[2] || null });
  const note = sol => noteGlobale(mesurer(sol, staff, deja));

  // 1. Repartir de zéro.
  const poses = [...deja];
  const neuf = groupes.map(iv => {
    const candidats = staff.filter(id => autorises(iv).includes(id) && libre(id, iv));
    const choix = choisirJury({
      disponibles: candidats, interviews: poses, debut: iv.datetimeStart, fin: iv.datetimeEnd,
      nbJurys: voulus(iv), maxAffiles: cfg.maxEntretiensAffiles ?? 4, battementMin: cfg.battementMinutes || 0,
      secours: candidats.filter(id => libre(id, iv) === 'secours'),
    });
    // Moins de jurés qu'aujourd'hui : on garde l'équipe actuelle.
    const n = avecJury(iv, choix.length >= Math.min(voulus(iv), Math.max(jures(iv).length, 1)) ? choix : jures(iv));
    poses.push(n);
    return n;
  });

  // 2. Partir du planning actuel, changement par changement.
  /** L'équipe `j` peut-elle tenir l'entretien k de la solution `sol` ? */
  const valide = (sol, k, j) => {
    const iv = sol[k];
    if (j.length < Math.min(voulus(iv), 3)) return false;
    if (!j.every(id => autorises(iv).includes(id) && libre(id, iv))) return false;
    const autres = [...deja, ...sol.filter((_, x) => x !== k)];
    if (autres.some(o => chevauche(o, iv, margeMs) && jures(o).some(id => j.includes(id)))) return false;
    if (plafond === Infinity) return true;
    // Entretiens d'affilée : la chaîne qui contient celui-ci ne dépasse pas le plafond.
    const essai = avecJury(iv, j);
    return j.every(id => {
      const siens = [...autres.filter(o => jures(o).includes(id)), essai].sort((a, b) => a.datetimeStart - b.datetimeStart);
      let run = 1, max = 1;
      for (let x = 1; x < siens.length; x++) {
        const colle = siens[x].datetimeStart - siens[x - 1].datetimeEnd <= margeMs + 60000;
        run = colle ? run + 1 : 1;
        max = Math.max(max, run);
      }
      return max <= plafond;
    });
  };
  let actuel = groupes.map(iv => ({ ...iv }));
  let noteActuelle = note(actuel);
  for (let tour = 0, mieux = true; mieux && tour < 20; tour++) {
    mieux = false;
    for (let k = 0; k < actuel.length; k++) {
      const jour = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const options = [jures(neuf[k]), ...actuel
        .filter((o, x) => x !== k && jour(o.datetimeStart) === jour(actuel[k].datetimeStart))
        .map(jures)];
      for (const j of options) {
        if (memeEquipe(j, jures(actuel[k])) || !valide(actuel, k, j)) continue;
        const essai = actuel.map((o, x) => x === k ? avecJury(o, j) : o);
        const n = note(essai);
        if (n < noteActuelle) { actuel = essai; noteActuelle = n; mieux = true; }
      }
    }
  }

  const nbChangements = sol => sol.filter((n, k) => !memeEquipe(jures(n), jures(groupes[k]))).length;
  const noteNeuf = note(neuf);
  const retenu = noteActuelle < noteNeuf || (noteActuelle === noteNeuf && nbChangements(actuel) <= nbChangements(neuf))
    ? actuel : neuf;

  const avant = mesurer(groupes, staff, deja);
  const apres = mesurer(retenu, staff, deja);
  // Rien de mieux : aucun changement proposé.
  if (noteGlobale(apres) >= noteGlobale(avant)) {
    return { changements: [], avant, apres: avant, inchange: true };
  }
  const changements = retenu
    .map((n, k) => ({ iv: groupes[k], avant: jures(groupes[k]), apres: jures(n) }))
    .filter(c => !memeEquipe(c.avant, c.apres));
  return { changements, avant, apres, inchange: false };
}
