/**
 * Stockage de la démo : une base JSON dans le localStorage du visiteur.
 *
 * Remplie au premier passage par seed.js (asso fictive, dates calculées à
 * partir d'aujourd'hui), puis modifiée par les actions du visiteur. Remise à
 * zéro par le bouton « Réinitialiser la démo », ou automatiquement quand le
 * jeu de données change de version ou date d'un autre jour (sinon les
 * créneaux proposés finiraient par être dans le passé).
 */
import { genererBase, VERSION_SEED } from './seed.js';

const CLE = 'cooptly_demo_base';
let cache = null;

const aujourdhui = () => new Date().toDateString();

export function chargerBase() {
  if (cache) return cache;
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) || 'null');
    if (brut && brut.__version === VERSION_SEED && brut.__jour === aujourdhui()) cache = brut;
  } catch { /* stockage illisible : on repart d'une base neuve */ }
  if (!cache) { cache = { ...genererBase(), __version: VERSION_SEED, __jour: aujourdhui() }; sauverBase(cache); }
  return cache;
}

export function sauverBase(base) {
  cache = base;
  try { localStorage.setItem(CLE, JSON.stringify(base)); } catch { /* navigation privée : la démo marche, sans mémoire */ }
}

/** Repart des données d'origine (et déconnecte). */
export function reinitialiser() {
  cache = null;
  try {
    localStorage.removeItem(CLE);
    localStorage.removeItem('cooptly_demo_session');
    sessionStorage.clear();
  } catch { /* rien */ }
}
