/**
 * Score de classement d'un cooptant, à partir des évaluations du jury.
 * Module sans dépendance Firebase (testé par tests/score-classement.test.mjs),
 * partagé par la page Cooptants et la fiche du cooptant.
 *
 * Enrichit chaque cooptant de champs calculés, préfixés `_` :
 * `_nbEvals`, `_criteriaAvgs`, `_score` (0-100, null tant que la grille n'est
 * pas complète), `_partiel`, `_nbCriteresNotes`, `_nbCriteresTotal`,
 * `_noteGlobaleAvg`, `_comments`, `_decisions`, `_textAnswers`,
 * `_yesnoAnswers`, `_choiceAnswers`.
 */
import { normaliserNote } from './utils.js';

/**
 * @param {object[]} criteriaConfig critères d'entretien de la campagne
 * @param {object[]} allCandidates  cooptants, modifiés sur place
 * @param {object[]} evaluations    évaluations (`candidateId`, `criteria`, `noteGlobale`…)
 * @returns {object[]} les mêmes cooptants
 */
export function calculerScores(criteriaConfig, allCandidates, evaluations) {
  const evalsByCandidate = {};
  evaluations.forEach(ev => {
    if (!evalsByCandidate[ev.candidateId]) evalsByCandidate[ev.candidateId] = [];
    evalsByCandidate[ev.candidateId].push(ev);
  });

  // Liste blanche explicite : seuls ces types sont chiffrés et entrent dans le
  // score. Un nouveau type de critère est hors score par défaut : il faut
  // l'ajouter ici sciemment, plutôt que de compter sur l'absence de `max`.
  const SCORED_TYPES = ['echelle', 'note'];

  const numericCriteria = criteriaConfig.filter(cr => SCORED_TYPES.includes(cr.type) && cr.max > 0);

  allCandidates.forEach(c => {
    const evals = evalsByCandidate[c.id] || [];
    c._nbEvals        = evals.length;
    c._criteriaAvgs   = {};
    c._score          = null;
    c._noteGlobaleAvg = null;
    c._comments       = [];
    c._decisions      = { reserve: 0 };

    if (!evals.length) return;

    // Decisions & comments
    evals.forEach(ev => {
      if (ev.decision === 'reserve') c._decisions.reserve = (c._decisions.reserve || 0) + 1;
      if (ev.commentaire) c._comments.push({ text: ev.commentaire });
    });

    // Per-criterion average (normalized 0-100)
    numericCriteria.forEach(cr => {
      const vals = evals
        .map(e => e.criteria?.[cr.id])
        .filter(v => v != null && typeof v === 'number');
      if (vals.length) {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        c._criteriaAvgs[cr.id] = {
          avg, max: cr.max, label: cr.label,
          normalized: normaliserNote(avg, cr),
        };
      }
    });
    // Couverture : sur combien de critères ce cooptant a-t-il été noté ?
    c._nbCriteresNotes = Object.keys(c._criteriaAvgs).length;
    c._nbCriteresTotal = numericCriteria.length;
    c._partiel = c._nbCriteresTotal > 0 && c._nbCriteresNotes < c._nbCriteresTotal;

    // Collect text criteria responses for display
    const textCriteria = criteriaConfig.filter(cr => cr.type === 'texte');
    c._textAnswers = [];
    textCriteria.forEach(cr => {
      const vals = evals.map(e => e.criteria?.[cr.id]).filter(v => v);
      if (vals.length) c._textAnswers.push({ id: cr.id, label: cr.label, values: vals });
    });

    // Score global = moyenne des critères, en %.
    //
    // Pas de score tant que la grille n'est pas remplie en entier : une moyenne
    // sur un seul critère à 90 % passait devant une moyenne sur cinq à 70 %,
    // alors qu'elle repose sur bien moins de matière. Mieux vaut ne rien
    // afficher qu'un chiffre qu'on ne peut pas comparer. Le badge
    // « 2/5 critères » dit pourquoi la case est vide.
    const normalized = Object.values(c._criteriaAvgs).map(s => s.normalized);
    if (normalized.length && !c._partiel) {
      c._score = Math.round(normalized.reduce((a, b) => a + b, 0) / normalized.length);
    }

    // noteGlobale average
    const notes = evals.map(e => e.noteGlobale).filter(v => v != null && typeof v === 'number');
    if (notes.length) {
      c._noteGlobaleAvg = Math.round((notes.reduce((a, b) => a + b, 0) / notes.length) * 10) / 10;
    }

    // Yesno criteria: collect oui/non counts
    const yesnoCriteria = criteriaConfig.filter(cr => cr.type === 'yesno');
    c._yesnoAnswers = [];
    yesnoCriteria.forEach(cr => {
      const vals = evals.map(e => e.criteria?.[cr.id]).filter(v => v);
      if (vals.length) {
        const oui = vals.filter(v => v === 'oui').length;
        c._yesnoAnswers.push({ id: cr.id, label: cr.label, oui, non: vals.length - oui, total: vals.length });
      }
    });

    // Case à cocher simple : combien de jurés l'ont cochée. Une case non
    // cochée vaut « non renseigné », donc on compare au nombre d'évaluations.
    criteriaConfig.filter(cr => cr.type === 'check').forEach(cr => {
      const coches = evals.filter(e => e.criteria?.[cr.id] === true).length;
      if (coches > 0) {
        c._yesnoAnswers.push({ id: cr.id, label: cr.label, oui: coches, non: 0, total: evals.length });
      }
    });

    // Choix unique / cases à cocher : on compte combien de jurés ont retenu
    // chaque option. Non chiffré, donc hors score : c'est une distribution.
    const choiceCriteria = criteriaConfig.filter(cr => cr.type === 'select' || cr.type === 'multi');
    c._choiceAnswers = [];
    choiceCriteria.forEach(cr => {
      const counts = {};
      let nbRepondants = 0;
      evals.forEach(e => {
        const v = e.criteria?.[cr.id];
        if (v == null) return;
        // 'select' stocke une chaîne, 'multi' un tableau
        const picked = Array.isArray(v) ? v : [v];
        if (!picked.length) return;
        nbRepondants++;
        picked.forEach(opt => { counts[opt] = (counts[opt] || 0) + 1; });
      });
      if (nbRepondants) {
        // Options dans l'ordre configuré, puis les valeurs orphelines
        // (option renommée ou supprimée après une évaluation).
        const ordered = [
          ...(cr.options || []).filter(o => counts[o]),
          ...Object.keys(counts).filter(o => !(cr.options || []).includes(o)),
        ];
        c._choiceAnswers.push({
          id: cr.id,
          label: cr.label,
          multi: cr.type === 'multi',
          total: nbRepondants,
          items: ordered.map(o => ({ option: o, n: counts[o] })),
        });
      }
    });
  });
  return allCandidates;
}

/** Score effectif pour classer : le score des critères, sinon la note globale ramenée à 100. */
export const scoreEffectif = c => c._score ?? (c._noteGlobaleAvg != null ? Math.round(c._noteGlobaleAvg * 5) : null);
