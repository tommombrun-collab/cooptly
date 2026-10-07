/**
 * Vote des membres de l'asso pour la délibération (coups de cœur).
 *
 * Le bureau ouvre un SCRUTIN depuis Classement ; son id est un jeton
 * aléatoire, porté par le lien de vote (`voter.html?s=<jeton>`). Chaque membre
 * choisit son nom et coche jusqu'à `maxCoeurs` cooptants. Chaque envoi crée un
 * BULLETIN (jamais modifié) : seul le dernier de chaque votant compte, et le
 * bureau voit qu'un nom a voté plusieurs fois (garde-fou du lien commun).
 * Les bulletins restent secrets tant que le vote est ouvert (firestore.rules).
 * Un votant peut s'abstenir sur quelques cooptants (ami, coloc) : son vote ne
 * compte alors ni pour ni contre eux.
 *
 * Module sans dépendance : testé par `tests/vote.test.mjs`.
 */

const ms = v => (v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : v?.seconds ? v.seconds * 1000 : Number(v) || 0);

/** Jeton aléatoire du lien de vote (base 62, 24 caractères ≈ 143 bits). */
export function nouveauJeton(n = 24) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const octets = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(octets, o => alphabet[o % alphabet.length]).join('');
}

/** Abstentions permises par votant (conflit d'intérêts : ami, coloc). Même borne dans firestore.rules. */
export const MAX_ABSTENTIONS = 5;

/** Nombre de coups de cœur proposé : un tiers des places, entre 1 et 15 ; 5 sans places. */
export function maxCoeursConseille(nbPlaces) {
  const n = Number(nbPlaces) || 0;
  return n > 0 ? Math.min(15, Math.max(1, Math.round(n / 3))) : 5;
}

/**
 * Le dernier bulletin de chaque votant (le seul qui compte) et le nombre
 * d'envois par votant.
 * @param {{votantId: string, envoyeLe: any}[]} bulletins
 */
export function derniersBulletins(bulletins) {
  const dernier = new Map(), envois = new Map();
  for (const b of bulletins || []) {
    if (!b?.votantId) continue;
    envois.set(b.votantId, (envois.get(b.votantId) || 0) + 1);
    const avant = dernier.get(b.votantId);
    if (!avant || ms(b.envoyeLe) >= ms(avant.envoyeLe)) dernier.set(b.votantId, b);
  }
  return { dernier, envois };
}

/**
 * Coups de cœur reçus par chaque cooptant, d'après le dernier bulletin de
 * chaque votant. Un même cooptant coché deux fois dans un bulletin compte une
 * fois ; un cœur donné à quelqu'un sur qui le votant s'abstient ne compte pas.
 * @returns {{ coeurs: Map<string, number>, abstentions: Map<string, number>, votants: number,
 *   plusieursEnvois: {votantId: string, envois: number}[] }}
 */
export function compterCoeurs(bulletins) {
  const { dernier, envois } = derniersBulletins(bulletins);
  const coeurs = new Map(), abstentions = new Map();
  for (const b of dernier.values()) {
    const abst = new Set(b.abstentions || []);
    for (const id of abst) abstentions.set(id, (abstentions.get(id) || 0) + 1);
    for (const id of new Set(b.coeurs || [])) if (!abst.has(id)) coeurs.set(id, (coeurs.get(id) || 0) + 1);
  }
  const plusieursEnvois = [...envois].filter(([, n]) => n > 1).map(([votantId, n]) => ({ votantId, envois: n }));
  return { coeurs, abstentions, votants: dernier.size, plusieursEnvois };
}

/** Votants qui se sont prononcés sur ce cooptant (les abstentions retirées). */
export function votantsPour(id, r) {
  return Math.max(0, (r?.votants || 0) - (r?.abstentions?.get(id) || 0));
}

/** Part des votants (hors abstentions) qui lui ont donné un cœur, entre 0 et 1. */
export function tauxCoeurs(id, r) {
  const n = votantsPour(id, r);
  return n ? (r.coeurs.get(id) || 0) / n : 0;
}

/** Plébiscité : un cœur d'au moins deux tiers des votants, dont au moins 3. */
export function plebiscite(id, r) {
  return votantsPour(id, r) >= 3 && tauxCoeurs(id, r) >= 2 / 3;
}

/**
 * Classement provisoire : la plus grande part de coups de cœur d'abord (parmi
 * les votants qui ne se sont pas abstenus sur lui ; sans abstention, c'est le
 * nombre de cœurs), puis le plus de cœurs, puis le meilleur score (sans score
 * à la fin), puis le nom.
 * @param {object[]} cooptants  { id, prenom, nom }
 * @param {Map<string, number>} coeurs
 * @param {(c: object) => number|null} [score]
 * @param {{votants?: number, abstentions?: Map<string, number>}} [vote]  résultats de compterCoeurs
 * @returns {string[]} ids dans l'ordre
 */
export function classerParCoeurs(cooptants, coeurs, score = () => null, vote = {}) {
  const nom = c => `${c.prenom || ''} ${c.nom || ''}`.trim().toLowerCase();
  const r = { coeurs, votants: vote.votants || 0, abstentions: vote.abstentions || new Map() };
  return [...cooptants].sort((a, b) => {
    if (r.votants) {
      const ta = tauxCoeurs(a.id, r), tb = tauxCoeurs(b.id, r);
      if (Math.abs(ta - tb) > 1e-9) return tb - ta;
    }
    const ca = coeurs.get(a.id) || 0, cb = coeurs.get(b.id) || 0;
    if (ca !== cb) return cb - ca;
    const sa = score(a), sb = score(b);
    if (sa == null && sb != null) return 1;
    if (sb == null && sa != null) return -1;
    if (sa != null && sb != null && sa !== sb) return sb - sa;
    return nom(a).localeCompare(nom(b), 'fr');
  }).map(c => c.id);
}

/** Ce que le scrutin garde de chaque cooptant : le strict nécessaire pour voter. */
export function cooptantPourVote(c, parcours = '') {
  return { id: c.id, prenom: (c.prenom || '').trim(), nom: (c.nom || '').trim(), parcours: parcours || '' };
}
