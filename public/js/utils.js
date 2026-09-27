/** Retourne "YYYY-MM-DD" en heure LOCALE (évite le décalage UTC de toISOString). */
export function localDateStr(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Échappe les caractères HTML pour éviter les injections XSS. */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Génère un token hexadécimal aléatoire de longueur donnée.
 * @param {number} length
 * @returns {string}
 */
/**
 * Lit un identifiant dans l'URL (`?org=`, `?token=`, `?campaign=`…) en ignorant
 * tout ce qui a été collé derrière.
 *
 * Les liens circulent par copier-coller dans des messages : on reçoit par
 * exemple `?org=club-theatre%0A%0AViens` (retours à la ligne et texte du
 * message accrochés au lien). Tous nos identifiants (slugs, ID Firestore, jetons
 * hexadécimaux) ne contiennent que lettres, chiffres, tirets et soulignés : on
 * garde le début valide et on jette le reste.
 *
 * @param {string} nom nom du paramètre
 * @param {string} [search] chaîne de requête, `location.search` par défaut
 * @returns {string|null}
 */
export function paramLien(nom, search = location.search) {
  const brut = new URLSearchParams(search).get(nom);
  if (brut == null) return null;
  const m = String(brut).trim().match(/^[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}

export function generateToken(length = 32) {
  const array = new Uint8Array(length / 2);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Formate un timestamp Firestore ou Date en "DD/MM/YYYY HH:MM".
 * @param {Date|import('firebase/firestore').Timestamp} val
 * @returns {string}
 */
export function formatDatetime(val) {
  if (!val) return '';
  const d = val.toDate ? val.toDate() : new Date(val);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Formate une date en "lundi 3 janvier" pour les en-têtes de colonne.
 * @param {Date} date
 * @returns {string}
 */
export function formatDayHeader(date) {
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Retourne une liste de dates entre dateDebut et dateFin inclus.
 * @param {Date} start
 * @param {Date} end
 * @returns {Date[]}
 */
export function getDaysBetween(start, end) {
  const days = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endD = new Date(end);
  endD.setHours(23, 59, 59, 999);
  while (cur <= endD) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/**
 * Fenêtre glissante : les n prochains jours à partir d'aujourd'hui (inclus).
 * Remplace les dates de campagne : chaque asso recrute « en continu ».
 * @param {number} n nombre de jours (défaut 28 = 4 semaines)
 * @returns {Date[]} dates à minuit local
 */
export function getRollingDays(n = 28) {
  const days = [];
  const cur = new Date();
  cur.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/**
 * Réglages par défaut d'un espace de recrutement.
 *
 * ⚠️ Sert AUSSI de valeurs de repli à la lecture : les campagnes créées avant
 * l'ajout d'un réglage n'ont pas le champ en base. Toujours lire la config via
 * `campaignConfig(campaign)`, jamais `campaign.config.x` directement.
 *
 * Vit dans utils.js (et non db.js) pour rester importable par les pages
 * publiques, qui n'initialisent pas Firebase Auth.
 */
export const CAMPAIGN_CONFIG_DEFAULTS = {
  dureeMinutes:        30,    // durée d'un entretien
  nbJurys:             2,     // jurés requis par entretien (max 3 : jury1Id..jury3Id)
  permettreAppart:     true,  // autoriser un appart comme lieu
  modeRdv:             'creneaux', // 'creneaux' = le cooptant réserve un créneau libre
                                   // 'dispos'   = il dépose ses dispos, le bureau place
  dateDebut:           null,  // 'YYYY-MM-DD', début des entretiens (null = fenêtre glissante)
  dateFin:             null,  // 'YYYY-MM-DD', fin des entretiens
  battementMinutes:    0,     // pause imposée entre deux entretiens
  heureFin:            19,    // heure à laquelle le dernier entretien doit être fini
  pasCreneauxMinutes:  30,    // un créneau proposé toutes les 15, 30 ou 60 min (30 = XXh00 et XXh30).
                              // Voir pasCreneauxValide() dans capacite.js.
  delaiReservationJours: 2,   // délai minimum avant un entretien réservé par le cooptant :
                              // 0 = dès aujourd'hui, 1 = dès demain, 2 = pas avant après-demain.
                              // Voir premierJourReservable().
                              // (entretiens en visio le soir : jusqu'à 23). Voir heuresGrille().
  deadlineCandidature: null,  // 'YYYY-MM-DD', clôture des candidatures (null = aucune)
  avecEntretien:       true,  // false = recrutement sur dossier, sans entretien
  entretienCollectif:  false, // autoriser un cooptant à inviter un ami sur SON créneau
  maxParGroupe:        2,     // taille max d'un groupe (le cooptant + ses invités)
  maxEntretiensAffiles: 4,    // entretiens consécutifs d'un même juré avant relève
                              // forcée (0 = pas de plafond). Voir js/jury.js.
  staffToujoursDispo:  false, // true = le staff n'a pas à déclarer ses créneaux,
                              // tout le monde est réputé libre sur la période
};

/**
 * Ramène la note d'un critère sur 0-100, en tenant compte du BAS de l'échelle.
 *
 * Une « échelle » va de 1 à max, une « note » de 0 à max. Diviser simplement
 * par `max` donnait 20 % au pire score possible d'une échelle sur 5, contre 0 %
 * au pire score d'une note : mélanger les deux types dans une grille faussait
 * le poids relatif des critères dans le score global.
 *
 * @param {number} valeur moyenne des jurés sur ce critère
 * @param {{type: string, max: number}} critere
 * @returns {number} 0 à 100
 */
export function normaliserNote(valeur, critere) {
  const min = critere?.type === 'echelle' ? 1 : 0;
  const etendue = (critere?.max ?? 0) - min;
  if (etendue <= 0) return 0;                 // critère mal configuré
  return Math.max(0, Math.min(100, ((valeur - min) / etendue) * 100));
}

/**
 * Valeur de la réponse d'un cooptant à une question du formulaire.
 *
 * Les réponses sont rangées sous l'identifiant de la question, ou, pour celles
 * enregistrées avant que les questions en aient un, sous leur position
 * d'origine (`legacyIndex`), à défaut leur position actuelle.
 *
 * @param {object} customAnswers `candidate.customAnswers`
 * @param {object} q  question de `campaign.formConfig.customQuestions`
 * @param {number} i  position actuelle de la question
 * @returns {string} '' si pas de réponse
 */
export function valeurReponse(customAnswers, q, i) {
  const r = customAnswers || {};
  const brute = (q?.id && r[q.id] !== undefined) ? r[q.id]
              : r[String(q?.legacyIndex !== undefined ? q.legacyIndex : i)];
  if (brute == null) return '';
  return typeof brute === 'object' ? String(brute.value ?? '') : String(brute);
}

/**
 * Téléphone d'un cooptant. Il n'est plus un champ fixe du formulaire : on le
 * collecte par une question de type « tel ». L'ancien champ `telephone` est lu
 * en priorité pour les candidatures qui l'ont encore.
 *
 * @param {object} cand      cooptant
 * @param {object[]} questions `campaign.formConfig.customQuestions`
 * @returns {string} '' si inconnu
 */
export function telephoneCooptant(cand, questions = []) {
  if (cand?.telephone) return String(cand.telephone);

  // D'abord les questions de type « tel », puis celles dont le libellé parle
  // de téléphone : beaucoup ont été créées en simple texte, avant que le type
  // « tel » existe (c'est souvent le cas de « Numéro de téléphone »).
  const PARLE_DE_TEL = /t[ée]l[ée]phone|\bt[ée]l\b|portable|mobile/i;
  const ordre = [
    ...questions.map((q, i) => [q, i]).filter(([q]) => q?.type === 'tel'),
    ...questions.map((q, i) => [q, i]).filter(([q]) => q?.type !== 'tel' && PARLE_DE_TEL.test(q?.label || '')),
  ];
  for (const [q, i] of ordre) {
    const v = valeurReponse(cand?.customAnswers, q, i);
    if (v) return v;
  }
  return '';
}

/**
 * Nom court d'un membre du staff pour un planning : le prénom seul, ou le
 * prénom suivi de l'initiale du nom quand un autre membre porte le même prénom.
 *
 * Les prénoms seuls sont les plus lisibles, mais deux « Inès » dans le même
 * bureau rendaient « Inès, Julien » ambigu. La désambiguïsation se fait sur
 * tout le staff, pas seulement sur l'entretien affiché : une même personne
 * garde ainsi le même libellé partout.
 *
 * @param {string}   nom         nom complet (« Inès Laurent »)
 * @param {string[]} tousLesNoms noms complets de tout le staff
 * @returns {string} « Inès L. », ou « Julien » si le prénom est unique
 */
export function nomCourt(nom, tousLesNoms = []) {
  const morceaux = String(nom || '').trim().split(/\s+/).filter(Boolean);
  if (!morceaux.length) return '';
  const prenom = morceaux[0];
  const cle = prenom.toLowerCase();
  const homonymes = new Set(
    tousLesNoms
      .map(n => String(n || '').trim())
      .filter(n => n && n.split(/\s+/)[0].toLowerCase() === cle)
      .map(n => n.toLowerCase())
  );
  if (homonymes.size <= 1 || morceaux.length < 2) return prenom;
  return `${prenom} ${morceaux[1][0].toUpperCase()}.`;
}

/**
 * « Léa Durand » → « Léa D. ». Toujours l'initiale, contrairement à
 * `nomCourt` qui ne l'ajoute qu'en cas d'homonyme : sert aux listes copiées
 * et envoyées hors de l'appli, où l'on veut une forme stable.
 */
export function prenomInitiale(nom) {
  const morceaux = String(nom || '').trim().split(/\s+/).filter(Boolean);
  if (!morceaux.length) return '';
  if (morceaux.length < 2) return morceaux[0];
  return `${morceaux[0]} ${morceaux[1][0].toUpperCase()}.`;
}

// ─── Réponses au formulaire ───────────────────────────────────────

/**
 * Clé sous laquelle la réponse à une question est rangée dans `customAnswers`.
 *
 * Trois générations coexistent en base :
 *   - récente : clé = `q.id`, stable même si l'ordre des questions change ;
 *   - avant les identifiants : clé = index de la question au moment de la
 *     réponse, retrouvé grâce à `q.legacyIndex` posé lors de la bascule ;
 *   - question jamais réenregistrée depuis : pas de `legacyIndex`, on retombe
 *     sur sa position actuelle, qui est aussi sa position d'origine.
 *
 * @param {object} c  cooptant
 * @param {object} q  question
 * @param {number} qi position actuelle de la question
 * @returns {string}
 */
export function cleReponse(c, q, qi) {
  const r = c.customAnswers || {};
  if (q.id && r[q.id] !== undefined) return q.id;
  return String(q.legacyIndex !== undefined ? q.legacyIndex : qi);
}

/** Réponse d'un cooptant à une question, où qu'elle ait été rangée. */
export function reponseA(c, q, qi) {
  return (c.customAnswers || {})[cleReponse(c, q, qi)];
}

/** Valeur lisible d'une réponse : objet `{label, value}` ou chaîne brute. */
export function texteReponse(rep) {
  if (rep == null) return '';
  return typeof rep === 'object' ? (rep.value ?? '') : rep;
}

/**
 * Réponses d'un cooptant, dans l'ORDRE ACTUEL des questions du formulaire.
 *
 * Parcourir `customAnswers` tel quel les rendait dans l'ordre de saisie, qui ne
 * suit plus le formulaire dès qu'on réordonne les questions. Les réponses à
 * une question supprimée depuis restent affichées, à la fin, avec le libellé
 * enregistré au moment de la réponse.
 *
 * @param {object} c cooptant
 * @param {object[]} questions questions actuelles (`campaign.formConfig.customQuestions`)
 * @returns {{label: string, value: string}[]}
 */
export function reponsesOrdonnees(c, questions = []) {
  const brutes = c.customAnswers || {};
  const vues = new Set();
  const liste = [];

  questions.forEach((q, qi) => {
    const cle = cleReponse(c, q, qi);
    if (brutes[cle] === undefined) return;
    vues.add(cle);
    liste.push({ label: q.label, value: texteReponse(brutes[cle]) });
  });

  // Questions supprimées : on garde la réponse, sous le libellé d'origine.
  Object.entries(brutes).forEach(([cle, rep]) => {
    if (vues.has(cle)) return;
    const label = (typeof rep === 'object' && rep?.label) ? rep.label : 'Question retirée du formulaire';
    liste.push({ label, value: texteReponse(rep) });
  });

  return liste;
}

/**
 * Premier jour qu'un cooptant peut réserver, à minuit, selon le délai minimum
 * de l'asso (`config.delaiReservationJours`). Laisse au bureau le temps de
 * s'organiser : sans délai, un cooptant pouvait réserver pour le lendemain
 * matin, voire pour l'heure suivante.
 *
 * @param {number} delaiJours 0 = aujourd'hui, 1 = demain, 2 = après-demain…
 * @param {Date} [maintenant]
 * @returns {Date}
 */
export function premierJourReservable(delaiJours, maintenant = new Date()) {
  const n = Math.max(0, Math.min(14, parseInt(delaiJours, 10) || 0));
  const d = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Regroupe les documents `memberships` d'une asso : UN membre par personne.
 * Voir getMembersByOrg (db.js). Le document canonique `{uid}_{orgId}` donne
 * les valeurs affichées ; `_docIds` liste tous les documents de la personne.
 *
 * @param {object[]} docs `{ id, ...données }`
 * @param {string} orgId
 * @returns {object[]}
 */
export function regrouperMembres(docs, orgId) {
  const parPersonne = new Map();
  docs.forEach(m => {
    const email = String(m.email || (String(m.userId || '').includes('@') ? m.userId : '')).toLowerCase();
    const uid = m.userId && !String(m.userId).includes('@') ? m.userId : '';
    // Un doc pas encore migré (userId = email) et le doc canonique (userId =
    // UID) d'une même personne partagent l'email : on relie les deux clés.
    const cle = [...parPersonne.keys()].find(k => (uid && k.uid === uid) || (email && k.email === email));
    if (!cle) { parPersonne.set({ uid, email }, { ...m, _docIds: [m.id] }); return; }
    const deja = parPersonne.get(cle);
    if (uid && !cle.uid) cle.uid = uid;
    if (email && !cle.email) cle.email = email;
    const canonique = m.id === `${m.userId}_${orgId}`;
    parPersonne.set(cle, canonique
      ? { ...deja, ...m, _docIds: [...deja._docIds, m.id] }
      : { ...m, ...deja, _docIds: [...deja._docIds, m.id] });
  });
  return [...parPersonne.values()];
}

/** Config d'une campagne complétée par les défauts (champs absents en base). */
export function campaignConfig(campaign) {
  return { ...CAMPAIGN_CONFIG_DEFAULTS, ...(campaign?.config || {}) };
}

/**
 * Parse une date 'YYYY-MM-DD' en Date locale à minuit.
 * `new Date('2026-08-25')` est interprété en UTC par le navigateur et décale
 * la date d'un jour selon le fuseau : d'où le parsing manuel.
 * @param {string} str
 * @returns {Date|null}
 */
export function parseLocalDate(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Jours ouvrables du calendrier d'entretiens d'une asso.
 *
 * Si l'asso a défini `config.dateDebut` / `config.dateFin`, on renvoie cette
 * période (bornée à aujourd'hui pour ne jamais proposer de créneau passé).
 * Sinon on retombe sur la fenêtre glissante historique.
 *
 * Source unique de vérité pour postuler / dispos / planning.
 *
 * @param {object} campaign document campagne (peut être null)
 * @param {number} fallbackN taille de la fenêtre glissante si pas de dates
 * @returns {Date[]} dates à minuit local (tableau vide si la période est passée)
 */
export function getCampaignDays(campaign, fallbackN = 28) {
  const cfg   = campaign?.config || {};
  const start = parseLocalDate(cfg.dateDebut);
  const end   = parseLocalDate(cfg.dateFin);

  // Les deux bornes sont requises : une seule date ne définit pas une période.
  if (!start || !end) return getRollingDays(fallbackN);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const from = start < today ? today : start;
  if (end < from) return [];          // période entièrement passée
  return getDaysBetween(from, end);
}

/**
 * Lignes d'un planning, de startH à endH, toutes les `pasMin` minutes.
 * @param {number} startH heure de début (ex: 8)
 * @param {number} endH heure de fin (ex: 19)
 * @param {number} [pasMin=30] 15 ou 30 (les plannings ne descendent pas en dessous)
 * @returns {{label: string, hours: number, minutes: number}[]}
 */
export function getTimeSlots(startH = 8, endH = 19, pasMin = 30) {
  const slots = [];
  for (let m = startH * 60; m < endH * 60; m += pasMin) {
    const h = Math.floor(m / 60), mn = m % 60;
    slots.push({ label: `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`, hours: h, minutes: mn });
  }
  return slots;
}

/**
 * Affiche un message toast temporaire.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 */
export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  toast.innerHTML = `<span style="font-weight:800;font-size:15px;flex-shrink:0;">${icons[type]||'·'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity .3s ease, transform .3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(12px)';
    setTimeout(() => toast.remove(), 320);
  }, 3800);
}

/**
 * Retourne les initiales d'un prénom+nom.
 * @param {string} prenom
 * @param {string} nom
 * @returns {string}
 */
export function initials(prenom, nom) {
  return `${(prenom || '')[0] || ''}${(nom || '')[0] || ''}`.toUpperCase();
}

let _cdOverlay = null, _cdResolve = null;

function _ensureConfirmDialog() {
  if (_cdOverlay) return;
  _cdOverlay = document.createElement('div');
  _cdOverlay.className = 'confirm-dialog-overlay';
  _cdOverlay.style.display = 'none';
  _cdOverlay.innerHTML =
    '<div class="confirm-dialog" role="dialog" aria-modal="true">' +
      '<p class="confirm-dialog-title" id="_cd-title"></p>' +
      '<p class="confirm-dialog-message" id="_cd-message"></p>' +
      '<div class="confirm-dialog-actions">' +
        '<button class="btn btn-ghost btn-sm" id="_cd-cancel">Annuler</button>' +
        '<button class="btn btn-danger btn-sm" id="_cd-ok">Confirmer</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(_cdOverlay);
  document.getElementById('_cd-ok').addEventListener('click', () => _cdSettle(true));
  document.getElementById('_cd-cancel').addEventListener('click', () => _cdSettle(false));
  _cdOverlay.addEventListener('click', e => { if (e.target === _cdOverlay) _cdSettle(false); });
  document.addEventListener('keydown', e => {
    if (_cdOverlay && _cdOverlay.style.display !== 'none' && e.key === 'Escape') {
      e.preventDefault(); _cdSettle(false);
    }
  });
}

function _cdSettle(val) {
  if (!_cdOverlay) return;
  _cdOverlay.style.display = 'none';
  if (_cdResolve) { _cdResolve(val); _cdResolve = null; }
}

/**
 * Boîte de confirmation légère (remplace window.confirm).
 * @param {string} message
 * @param {{ title?: string, confirmLabel?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, { title = '', confirmLabel = 'Confirmer', danger = true } = {}) {
  _ensureConfirmDialog();
  const titleEl = document.getElementById('_cd-title');
  titleEl.textContent = title;
  titleEl.style.display = title ? '' : 'none';
  document.getElementById('_cd-message').textContent = message;
  const okBtn = document.getElementById('_cd-ok');
  okBtn.textContent = confirmLabel;
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm`;
  _cdOverlay.style.display = 'flex';
  setTimeout(() => document.getElementById('_cd-cancel').focus(), 30);
  return new Promise(resolve => { _cdResolve = resolve; });
}

/**
 * Protection anti-capture pour les rôles non-admin.
 *  • Bloque l'impression (Ctrl+P, @media print)
 *  • Ajoute un filigrane avec l'email + date (visible en capture, discret à l'écran)
 *
 * @param {{ email: string }} user
 */
export function applyContentProtection() {
  const printStyle = document.createElement('style');
  printStyle.textContent = `@media print {
    body * { visibility: hidden !important; }
    body::after {
      visibility: visible !important; content: "Impression désactivée.";
      position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
      font-size: 22px; font-family: sans-serif; color: #333;
    }
  }`;
  document.head.appendChild(printStyle);

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault(); e.stopPropagation();
    }
  }, true);
}
