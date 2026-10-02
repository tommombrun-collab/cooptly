/**
 * Langue des pages du cooptant (formulaire, confirmation, suivi) : français
 * ou anglais. Choisir l'anglais veut dire « je passe l'entretien en anglais »
 * (le bureau le voit, et les jurés sont choisis en conséquence).
 *
 * La langue ne vient QUE du lien (`?lang=en`) : lien anglais partagé par le
 * bureau, ou clic sur le sélecteur FR / EN, qui recharge la page avec `?lang=`.
 * Elle suit la personne jusqu'à sa confirmation et sa page de suivi (les liens
 * portent `&lang=en`). Par défaut : français.
 *
 * ⚠️ Avant, la langue se choisissait aussi toute seule (navigateur sans langue
 * française) et restait mémorisée sur l'appareil : un étudiant français pouvait
 * être marqué « anglais » parce qu'un autre avait cliqué sur EN avant lui, sur
 * le même téléphone de stand. D'où ni détection, ni mémoire.
 *
 * Textes écrits dans la page : attributs `data-en` (contenu HTML),
 * `data-en-placeholder`, `data-en-aria-label`, posés par `traduirePage()`.
 * Textes calculés en JS : `tr('français', 'english')`.
 *
 * Les pages du bureau restent en français : seul le cooptant choisit sa langue.
 */
import { paramLien } from '/js/utils.js';

function langueChoisie() {
  return (paramLien('lang') || '').toLowerCase() === 'en' ? 'en' : 'fr';
}

export const LANGUE = langueChoisie();
export const EN     = LANGUE === 'en';
/** Locale des dates (`toLocaleDateString(LOCALE, …)`). */
export const LOCALE = EN ? 'en-GB' : 'fr-FR';

/** Texte dans la langue du cooptant. */
export const tr = (fr, en) => (EN ? en : fr);

/** Applique les attributs `data-en*` de la page (sans effet en français). */
export function traduirePage(racine = document) {
  document.documentElement.lang = LANGUE;
  if (!EN) return;
  racine.querySelectorAll('[data-en]').forEach(el => { el.innerHTML = el.dataset.en; });
  racine.querySelectorAll('[data-en-placeholder]').forEach(el => { el.placeholder = el.dataset.enPlaceholder; });
  racine.querySelectorAll('[data-en-aria-label]').forEach(el => el.setAttribute('aria-label', el.dataset.enAriaLabel));
}

/**
 * Sélecteur FR / EN. Changer de langue recharge la page avec `?lang=`,
 * pour que tous les textes calculés repartent dans la bonne langue.
 * @param {HTMLElement} conteneur
 */
export function selecteurLangue(conteneur) {
  if (!conteneur) return;
  const bloc = document.createElement('div');
  bloc.className = 'lang-switch';
  bloc.setAttribute('role', 'group');
  bloc.setAttribute('aria-label', 'Langue / Language');
  [['fr', 'FR', 'Français'], ['en', 'EN', 'English']].forEach(([code, court, long]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = court;
    b.title = long;
    b.lang = code;
    b.setAttribute('aria-pressed', String(code === LANGUE));
    b.addEventListener('click', () => {
      if (code === LANGUE) return;
      const url = new URL(location.href);
      url.searchParams.set('lang', code);
      location.href = url.toString();
    });
    bloc.appendChild(b);
  });
  conteneur.appendChild(bloc);
}

/** Libellé d'une question du formulaire dans la langue du cooptant. */
export const libelleQuestion = q => (EN && q.labelEn ? q.labelEn : q.label);

/**
 * Options d'une liste de choix : `{ valeur, texte }`. La valeur enregistrée
 * reste l'option française, pour que le bureau compare des réponses
 * identiques quelle que soit la langue du cooptant ; seul le texte affiché change.
 */
export function optionsQuestion(q) {
  const en = EN && Array.isArray(q.optionsEn) ? q.optionsEn : [];
  return (q.options || []).map((valeur, i) => ({ valeur, texte: en[i] || valeur }));
}
