/**
 * nav.js : Burger menu partagé entre tous les portails.
 * Importer dans chaque page et appeler initBurgerMenu(user) après l'auth.
 */

// Applique le thème sauvegardé immédiatement (anti-FOUC côté JS)
(function () {
  const t = localStorage.getItem('_theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
})();
import { getUserRole, logout, getMyMemberships, getMembershipForOrg } from './auth.js';
import { applyContentProtection, paramLien } from './utils.js';
import { app } from './auth.js';
import { afficherTutoSiBesoin, ouvrirTuto } from './tuto.js';
import { brancherRecherche, ouvrirRecherche, raccourci } from './recherche.js';
import { installerIcones } from './icones.js';
import { getFirestore, collection, getDocs, getDoc, doc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const db = getFirestore(app);

// ── Barre du haut posée tout de suite ─────────────────────────────
// Avant, menu, aide, thème et nom de l'asso n'apparaissaient qu'après
// plusieurs lectures en base (rôle, assos, membership) : la barre se
// réorganisait sous les yeux, les liens se recentraient, le nom changeait.
// On pose donc la structure dès le chargement du module, avec la dernière
// identité connue (mémorisée dans ce navigateur), puis initBurgerMenu
// confirme ou corrige.
const NAV_CACHE_CLE = '_navIdentite';
const ROLE_LIBELLE = { president: 'Président(e)', secge: 'Sec-gé', admin: 'Admin plateforme' };

function _lireCacheNav() {
  try { return JSON.parse(localStorage.getItem(NAV_CACHE_CLE) || '{}'); } catch { return {}; }
}
function _ecrireCacheNav(orgKey, valeurs) {
  if (!orgKey) return;
  try {
    const c = _lireCacheNav();
    c[orgKey] = { ...(c[orgKey] || {}), ...valeurs };
    localStorage.setItem(NAV_CACHE_CLE, JSON.stringify(c));
  } catch { /* stockage indisponible : pas grave, juste moins rapide */ }
}
function _orgDuContexte() {
  // Pages admin sans ?org= : identité à part, sinon elles reprenaient d'abord
  // celle de la dernière asso visitée (nom de l'asso, « Président(e) »).
  if (location.pathname.startsWith('/admin/') && !paramLien('org')) return '__admin__';
  try { return paramLien('org') || sessionStorage.getItem('currentOrgId') || ''; } catch { return paramLien('org') || ''; }
}

/** Remplit badge, nom d'asso et nom de la personne (valeurs vides = masqués). */
function _afficherIdentite({ orgName, roleLabel, userName, logo } = {}) {
  const brand = document.querySelector('.nav-brand-name');
  if (brand && orgName) brand.textContent = orgName;
  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = roleLabel || '';
    badge.style.visibility = roleLabel ? 'visible' : 'hidden';
    // Rouge pour l'admin plateforme, comme l'ancien badge des pages admin.
    badge.className = `badge ${roleLabel === ROLE_LIBELLE.admin ? 'badge-red' : 'badge-indigo'}`;
  }
  const nom = document.getElementById('user-name');
  if (nom) nom.textContent = userName || '';
  // Menu latéral et barre du téléphone
  const sideOrg = document.getElementById('side-org');
  if (sideOrg && orgName) { sideOrg.textContent = orgName; sideOrg.title = orgName; }
  const telTitre = document.getElementById('tel-titre');
  if (telTitre && orgName) telTitre.textContent = orgName;
  // Logo de l'ASSO (plus celui de la plateforme) ; sans logo, un rond vide
  // avec une icône photo, qui invite à l'ajouter dans Paramètres.
  if (orgName) afficherLogoAsso(logo);
  const sideRole = document.getElementById('side-role');
  if (sideRole) sideRole.textContent = roleLabel || '';
  const sideNom = document.getElementById('side-nom');
  if (sideNom && userName) sideNom.textContent = userName;
  const ini = userName ? userName.split(/\s+/).filter(Boolean).slice(0, 2).map(m => m[0]).join('').toUpperCase() : '';
  document.querySelectorAll('.side-av').forEach(a => { if (ini) a.textContent = ini; });
}

function _preparerNav() {
  const nav = document.querySelector('.nav');
  if (!nav || !nav.querySelector('.nav-links')) return;   // pages publiques : rien à faire
  _construireSide();

  // Un seul badge de rôle et un seul nom, identiques sur toutes les pages
  // du bureau. Certaines pages avaient leur propre badge (« Sec-gé » écrit en
  // dur), d'autres rien, et le nom n'apparaissait que sur le tableau de bord.
  nav.querySelectorAll('.nav-badge-wrap').forEach(el => el.remove());
  const brand = nav.querySelector('.nav-brand');
  if (brand && !document.getElementById('role-badge')) {
    const badge = document.createElement('span');
    badge.id = 'role-badge';
    badge.className = 'badge badge-indigo';
    badge.style.cssText = 'font-size:11px;visibility:hidden;flex-shrink:0;';
    brand.insertAdjacentElement('afterend', badge);
  }
  const right = nav.querySelector('.nav-right');
  if (right && !document.getElementById('user-name')) {
    const nom = document.createElement('span');
    nom.id = 'user-name';
    nom.style.cssText = 'font-size:13px;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const logout = right.querySelector('#btn-logout');
    right.insertBefore(nom, logout || null);
  }

  _afficherIdentite(_lireCacheNav()[_orgDuContexte()]);
}

/**
 * Injecte le burger menu dans la nav de la page.
 * @param {import('firebase/auth').User} user
 */
export async function initBurgerMenu(user) {
  if (!user) return;

  // Applique le logo plateforme immédiatement (cache) + refresh Firestore si absent
  _applyPlatformLogo();

  const role = await getUserRole(user);
  let orgs = [], myOrg = null;

  try {
    if (role === 'admin') {
      const snap = await getDocs(collection(db, 'organizations'));
      orgs = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    } else if (role === 'secge') {
      // TOUTES les assos de l'utilisateur : on peut être dans deux bureaux.
      // Memberships déjà en cache dans auth.js.
      const memberships = await getMyMemberships(user);
      const docs = await Promise.all(
        memberships.map(m => getDoc(doc(db, 'organizations', m.organizationId)))
      );
      orgs = docs.filter(d => d.exists()).map(d => ({ id: d.id, ...d.data() }));
      orgs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
  } catch (e) { /* silently ignore */ }

  // Propager ?org= sur tous les liens top nav (tous rôles)
  // - Pour secge/member : on utilise l'org du membership
  // - Pour admin sur une page secge : on préserve le ?org= de l'URL courante
  const urlOrgParam = paramLien('org');
  let navOrgId = urlOrgParam;
  if (!navOrgId && role === 'secge' && orgs.length) {
    // Sans ?org= dans l'URL, on retombe sur l'asso mémorisée si elle fait
    // partie des siennes, sinon la première. Évite de balader un membre de
    // deux bureaux vers la mauvaise asso à chaque clic.
    const remembered = sessionStorage.getItem('currentOrgId');
    navOrgId = orgs.some(o => o.id === remembered) ? remembered : orgs[0].id;
  }
  if (navOrgId) {
    document.querySelectorAll('.nav-links a, .nav-brand').forEach(a => {
      const href = a.getAttribute('href');
      if (href && !href.includes('?org=') && !href.startsWith('http') && !href.startsWith('#')) {
        a.setAttribute('href', href + '?org=' + navOrgId);
      }
    });
  }
  _syncLiens();

  // Nom effectif : préférer Firestore si disponible (admin peut changer le nom sans toucher Firebase Auth)
  let effectiveDisplayName = user.displayName || user.email.split('@')[0];
  if (role === 'secge') {
    try {
      // Le nom affiché vient du membership de l'asso COURANTE : il peut
      // différer d'une asso à l'autre.
      const md = (navOrgId && await getMembershipForOrg(user, navOrgId))
              || (await getMyMemberships(user))[0];
      if (md) {
        const fsName = md.displayName || [md.firstName, md.lastName].filter(Boolean).join(' ');
        if (fsName) effectiveDisplayName = fsName;
      }
    } catch(e) { /* ignore */ }
  }

  _construireCompte(role, { ...user, displayName: effectiveDisplayName }, orgs, navOrgId);
  brancherRecherche({
    orgId: navOrgId || null, role, par: user.email || null,
    rappels: {
      choisirTheme: _choisirTheme,
      revoirTuto: () => ouvrirTuto(user),
      changerMdp: async () => { const { ouvrirChangementMdp } = await import('./mot-de-passe.js'); ouvrirChangementMdp(); },
    },
  });

  // Identité affichée dans la barre, la même partout : nom de l'asso, rôle
  // DANS CETTE ASSO (on peut être président ici et bureau ailleurs), nom de
  // la personne. Mémorisée pour s'afficher d'emblée à la prochaine page.
  if (document.querySelector('.nav-links')) {
    const current = orgs.find(o => o.id === navOrgId || o.slug === navOrgId) || (role === 'secge' ? orgs[0] : null);
    let roleLabel = '';
    if (role === 'secge') {
      const md = current && await getMembershipForOrg(user, current.id).catch(() => null);
      roleLabel = ROLE_LIBELLE[md?.role] || ROLE_LIBELLE.secge;
    } else if (role === 'admin') {
      roleLabel = ROLE_LIBELLE.admin;
    }
    const identite = { orgName: current?.name || '', roleLabel, userName: effectiveDisplayName, logo: current?.logoBase64 || '' };
    _afficherIdentite(identite);
    _ecrireCacheNav(_orgDuContexte() || current?.id, identite);
    if (current?.id) _ecrireCacheNav(current.id, identite);
  }

  // Statistiques de connexion (lisibles par l'admin plateforme seulement).
  // Chargé à la demande, sans attendre : ne ralentit pas la page.
  {
    const orgAct = role === 'admin' ? null : (orgs.find(o => o.id === navOrgId || o.slug === navOrgId) || orgs[0] || null);
    import('./activite.js').then(({ noterActivite }) => noterActivite(user, {
      nom: effectiveDisplayName, role, orgId: orgAct?.id || null, orgName: orgAct?.name || '',
    })).catch(() => {});
  }

  // Protection anti-capture pour tous les rôles sauf admin
  if (role !== 'admin') applyContentProtection();

  // Visite guidée à la première connexion. Sans `await` : la page doit rester
  // utilisable pendant qu'on vérifie si la personne l'a déjà vue.
  afficherTutoSiBesoin(user);
  // Changer son mot de passe sans email (les adresses emlyon ne reçoivent
  // pas ceux de Firebase). Module chargé seulement au clic.
  document.getElementById('nav-mdp-btn')?.addEventListener('click', async () => {
    _close();
    const { ouvrirChangementMdp } = await import('./mot-de-passe.js');
    ouvrirChangementMdp();
  });
  document.getElementById('nav-tuto-btn')?.addEventListener('click', () => {
    _close();
    ouvrirTuto(user);
  });

  return effectiveDisplayName;
}

// ── Infobulles ────────────────────────────────────────────────────
// Tout élément qui porte un `title` (ou `data-info`) affiche une vraie bulle
// au survol, plus rapide et lisible que l'infobulle du navigateur. Au clavier,
// au focus. Au doigt, sur les éléments marqués `data-info-tap` (barres d'un
// graphique). Le `title` est retiré pour ne pas doubler la bulle.
function _installerInfobulles() {
  let bulle = null, cible = null, minuteur = null;
  const preparer = el => {
    const t = el.getAttribute('title');
    if (t) {
      el.dataset.info = t;
      if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t);
    }
    el.removeAttribute('title');
    return el.dataset.info || '';
  };
  const montrer = el => {
    const txt = el.dataset.info;
    // Rien à dire de plus que ce qui est déjà écrit dessus.
    if (!txt || el.innerText?.trim() === txt.trim()) return;
    if (!bulle) {
      bulle = document.createElement('div');
      bulle.className = 'infobulle';
      bulle.setAttribute('role', 'tooltip');
      document.body.append(bulle);
    }
    bulle.textContent = txt;
    bulle.hidden = false;
    const r = el.getBoundingClientRect(), b = bulle.getBoundingClientRect();
    let top = r.top - b.height - 8;
    if (top < 6) top = r.bottom + 8;
    const left = Math.max(6, Math.min(window.innerWidth - b.width - 6, r.left + r.width / 2 - b.width / 2));
    bulle.style.top = `${top}px`;
    bulle.style.left = `${left}px`;
  };
  const cacher = () => { clearTimeout(minuteur); if (bulle) bulle.hidden = true; cible = null; };
  const survol = window.matchMedia('(hover: hover)').matches;
  if (survol) {
    document.addEventListener('mouseover', e => {
      const el = e.target.closest?.('[title], [data-info]');
      if (!el || el === cible) return;
      if (!preparer(el)) return;
      cible = el;
      clearTimeout(minuteur);
      if (bulle) bulle.hidden = true;
      minuteur = setTimeout(() => montrer(el), 300);
    });
    document.addEventListener('mouseout', e => { if (cible && !cible.contains(e.relatedTarget)) cacher(); });
  }
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.('[title], [data-info]');
    if (!el || !el.matches(':focus-visible') || !preparer(el)) return;
    cible = el; montrer(el);
  });
  document.addEventListener('click', e => {
    const el = e.target.closest?.('[data-info-tap]');
    if (el && preparer(el)) { cible = el; montrer(el); } else if (bulle && !bulle.hidden) cacher();
  }, true);
  document.addEventListener('focusout', cacher);
  window.addEventListener('scroll', cacher, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cacher(); });
}

// ── Menu latéral (grand écran), colonne d'icônes (portable), onglets en bas (téléphone) ──
// Construit à partir des liens de la barre du haut, qui reste dans la page mais
// masquée : les pages s'appuient dessus (#btn-logout, liens complétés par ?org=).

const ICONES = {
  accueil:   '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  cooptants: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  planning:  '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7.5 14h3M13.5 14h3M7.5 17.5h3"/>',
  reglages:  '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  assos:     '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 21v-4h6v4M8 7h2M14 7h2M8 11h2M14 11h2"/>',
  cle:       '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  courbe:    '<path d="M4 19V5M4 19h16"/><path d="m7 15 4-5 3 3 5-6"/>',
  base:      '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  plus:      '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  ajout:     '<path d="M12 5v14M5 12h14"/>',
  lecture:   '<path d="M7 4v16l13-8z"/>',
  aide:      '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.5"/><path d="M12 17h.01"/>',
  loupe:     '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  sortie:    '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  photo:     '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 8"/>',
};
const icone = nom => `<svg class="side-i" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nom] || ICONES.accueil}</svg>`;

function _iconeDuLien(href) {
  const p = (href || '').split('?')[0];
  if (p.includes('/admin/organisations')) return 'assos';
  if (p.includes('/admin/permissions')) return 'cle';
  if (p.includes('/admin/connexions')) return 'courbe';
  if (p.includes('/admin/data')) return 'base';
  if (p.includes('candidats')) return 'cooptants';
  if (p.includes('planning')) return 'planning';
  if (p.includes('parametres')) return 'reglages';
  return 'accueil';
}

/** Les liens de la page : ceux de la barre du haut d'origine. */
function _liensDeLaPage() {
  return [...document.querySelectorAll('.nav .nav-links a')].map(a => ({
    href: a.getAttribute('href'), label: a.textContent.trim(), actif: a.classList.contains('active'),
  }));
}

function _construireSide() {
  if (document.querySelector('.side-nav')) return;
  const liens = _liensDeLaPage();
  const brand = document.querySelector('.nav .nav-brand');
  const lien = l => `<a class="side-lien${l.actif ? ' actif' : ''}" href="${l.href}" title="${l.label}"${l.actif ? ' aria-current="page"' : ''}>${icone(_iconeDuLien(l.href))}<span>${l.label}</span></a>`;

  const side = document.createElement('aside');
  side.className = 'side-nav';
  side.setAttribute('aria-label', 'Navigation');
  side.innerHTML = `
    <a class="side-asso" href="${brand?.getAttribute('href') || '/'}">
      <span class="side-logo">C</span>
      <span class="side-asso-txt"><b id="side-org">Cooptly</b><small id="side-role"></small></span>
    </a>
    <button type="button" class="side-cherche" data-recherche title="Rechercher (${raccourci})">${icone('loupe')}<span>Rechercher</span><kbd>${raccourci}</kbd></button>
    <nav class="side-liens">${liens.map(lien).join('')}</nav>
    <div class="side-bas">
      <button type="button" class="side-moi" id="side-moi" aria-haspopup="menu" aria-expanded="false" aria-controls="side-compte">
        <i class="side-av"></i><span class="side-moi-txt"><b id="side-nom"></b><small>Compte et réglages</small></span>
      </button>
    </div>`;

  // Téléphone : barre en haut, onglets en bas (4 pages au plus, puis « Plus »).
  const haut = document.createElement('header');
  haut.className = 'tel-haut';
  haut.innerHTML = `<span class="side-logo">C</span><b id="tel-titre">Cooptly</b>
    <button type="button" class="tel-cherche" data-recherche aria-label="Rechercher">${icone('loupe')}</button>
    <button type="button" class="tel-moi" aria-label="Compte et réglages" aria-haspopup="menu" aria-controls="side-compte"><i class="side-av"></i></button>`;
  const bas = document.createElement('nav');
  bas.className = 'tel-onglets';
  bas.setAttribute('aria-label', 'Navigation');
  bas.innerHTML = liens.slice(0, 4).map(l => `<a class="tel-onglet${l.actif ? ' actif' : ''}" href="${l.href}"${l.actif ? ' aria-current="page"' : ''}>${icone(_iconeDuLien(l.href))}<span>${_libelleCourt(l.label)}</span></a>`).join('')
    + `<button type="button" class="tel-onglet" aria-haspopup="menu" aria-controls="side-compte">${icone('plus')}<span>Plus</span></button>`;

  const compte = document.createElement('div');
  compte.className = 'side-compte';
  compte.id = 'side-compte';
  compte.setAttribute('role', 'menu');
  compte.hidden = true;
  compte.innerHTML = _contenuCompte({ role: null, user: null, orgs: [], navOrgId: null });

  document.body.prepend(side, haut);
  document.body.append(bas, compte);
  document.body.classList.add('avec-side');

  document.querySelectorAll('[aria-controls="side-compte"]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    compte.hidden ? _ouvrirCompte(b) : _close();
  }));
  document.addEventListener('click', e => { if (!compte.hidden && !e.target.closest('#side-compte')) _close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !compte.hidden) _close(); });
  _brancherCompte();
  document.querySelectorAll('[data-recherche]').forEach(b => b.addEventListener('click', () => { _close(); ouvrirRecherche(); }));

  // Pages admin sans asso : le logo de la plateforme. Ailleurs, celui de
  // l'asso arrive avec l'identité (_afficherIdentite).
  const logoCache = localStorage.getItem('_platformLogo');
  if (logoCache && _orgDuContexte() === '__admin__') document.querySelectorAll('.side-logo').forEach(l => { l.innerHTML = `<img src="${logoCache}" alt="" />`; });
}

/**
 * Logo de l'asso dans le menu latéral et la barre du téléphone. Sans logo :
 * rond vide avec une icône photo. Appelé aussi par Paramètres après un
 * changement, qui met à jour le cache pour les pages suivantes.
 * @param {string} [logo] image en data URI, '' ou absent = pas de logo
 */
export function afficherLogoAsso(logo, { memoriser = false } = {}) {
  const sur = typeof logo === 'string' && /^data:image\//.test(logo);
  document.querySelectorAll('.side-logo').forEach(l => {
    l.classList.toggle('vide', !sur);
    l.title = sur ? '' : 'Pas encore de logo : à ajouter dans Paramètres → Formulaire';
    l.innerHTML = sur ? `<img src="${logo}" alt="" />` : icone('photo');
  });
  if (memoriser) {
    const cle = _orgDuContexte();
    if (cle && cle !== '__admin__') _ecrireCacheNav(cle, { logo: sur ? logo : '' });
  }
}

function _libelleCourt(label) {
  return ({ 'Tableau de bord': 'Accueil', "Vue d'ensemble": 'Accueil', 'Permissions': 'Accès', 'Base de données': 'Données' })[label] || label;
}

/** Recopie les liens de la barre du haut (complétés par ?org=) dans le menu latéral et les onglets. */
function _syncLiens() {
  const liens = _liensDeLaPage();
  document.querySelectorAll('.side-liens .side-lien').forEach((a, i) => { if (liens[i]) a.setAttribute('href', liens[i].href); });
  document.querySelectorAll('.tel-onglets a.tel-onglet').forEach((a, i) => { if (liens[i]) a.setAttribute('href', liens[i].href); });
  const brand = document.querySelector('.nav .nav-brand');
  const asso = document.querySelector('.side-asso');
  if (brand && asso) asso.setAttribute('href', brand.getAttribute('href'));
}

function _ouvrirCompte(declencheur) {
  const c = document.getElementById('side-compte');
  if (!c) return;
  c.hidden = false;
  c.dataset.depuis = declencheur.closest('.tel-onglets') ? 'bas' : declencheur.closest('.tel-haut') ? 'haut' : 'side';
  document.querySelectorAll('[aria-controls="side-compte"]').forEach(b => b.setAttribute('aria-expanded', String(b === declencheur)));
  c.querySelector('button, a')?.focus({ preventScroll: true });
}

function _close() {
  const c = document.getElementById('side-compte');
  if (!c || c.hidden) return;
  c.hidden = true;
  document.querySelectorAll('[aria-controls="side-compte"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

function _currentTheme() {
  return localStorage.getItem('_theme') || 'light';
}
function _choisirTheme(t) {
  localStorage.setItem('_theme', t);
  document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('[data-theme-choix]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeChoix === t)));
}

/** Contenu du menu du compte : assos, pages en plus, thème, présentation, mot de passe, aide, déconnexion. */
function _contenuCompte({ role, orgs, navOrgId }) {
  const esc = v => String(v ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  // Logo de l'asso s'il existe, sinon son initiale
  const pastille = o => /^data:image\//.test(o.logoBase64 || '')
    ? `<img class="sc-asso sc-asso-logo" src="${esc(o.logoBase64)}" alt="">`
    : `<span class="sc-asso">${esc((o.name || '?').trim()[0].toUpperCase())}</span>`;
  let html = '';
  // Pages qui ne tiennent pas dans les onglets du téléphone
  const enTrop = _liensDeLaPage().slice(4);
  if (enTrop.length) {
    html += `<div class="sc-t sc-tel">Pages</div>` + enTrop.map(l => `<a class="sc-opt sc-tel" role="menuitem" href="${l.href}">${icone(_iconeDuLien(l.href))}${esc(l.label)}</a>`).join('');
  }
  if (role === 'secge' && orgs.length) {
    const courant = orgs.find(o => o.id === navOrgId || o.slug === navOrgId)?.id || orgs[0].id;
    html += `<div class="sc-t">Mes associations</div>` + orgs.map(o => `<a class="sc-opt" role="menuitem" href="/secge/dashboard.html?org=${encodeURIComponent(o.id)}">${pastille(o)}${esc(o.name)}${o.id === courant ? '<span class="sc-coche" aria-label="association ouverte">✓</span>' : ''}</a>`).join('')
      + `<a class="sc-opt" role="menuitem" href="/rejoindre.html">${icone('ajout')}Rejoindre une association</a><hr>`;
  }
  if (role === 'admin') {
    html += `<div class="sc-t">Admin plateforme</div>`
      + [['/admin/dashboard.html', "Vue d'ensemble", 'accueil'], ['/admin/organisations.html', 'Organisations', 'assos'], ['/admin/permissions.html', 'Permissions et accès', 'cle'], ['/admin/connexions.html', 'Connexions', 'courbe'], ['/admin/data.html', 'Données', 'base']]
        .map(([h, l, i]) => `<a class="sc-opt" role="menuitem" href="${h}">${icone(i)}${l}</a>`).join('');
    if (orgs.length) {
      html += `<div class="sc-t">Associations</div><div class="sc-defile">` + orgs.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(o => `<a class="sc-opt" role="menuitem" href="/secge/dashboard.html?org=${encodeURIComponent(o.id)}">${pastille(o)}${esc(o.name)}${o.id === navOrgId || o.slug === navOrgId ? '<span class="sc-coche">✓</span>' : ''}</a>`).join('') + '</div>';
    }
    html += '<hr>';
  }
  const t = _currentTheme();
  html += `<div class="sc-t">Thème</div>
    <div class="sc-segment" role="group" aria-label="Thème">
      <button type="button" data-theme-choix="light" aria-pressed="${t !== 'dark'}">Clair</button>
      <button type="button" data-theme-choix="dark" aria-pressed="${t === 'dark'}">Sombre</button>
    </div><hr>
    <button type="button" class="sc-opt" role="menuitem" id="nav-tuto-btn">${icone('lecture')}Revoir la présentation</button>
    <button type="button" class="sc-opt" role="menuitem" id="nav-mdp-btn">${icone('cle')}Changer mon mot de passe</button>
    <a class="sc-opt" role="menuitem" href="/aide.html">${icone('aide')}Aide</a>
    <hr>
    <button type="button" class="sc-opt sc-sortie" role="menuitem" id="nav-logout-btn">${icone('sortie')}Se déconnecter</button>`;
  return html;
}

function _brancherCompte() {
  const c = document.getElementById('side-compte');
  if (!c) return;
  c.querySelectorAll('[data-theme-choix]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); _choisirTheme(b.dataset.themeChoix); }));
  c.querySelector('#nav-logout-btn')?.addEventListener('click', async () => {
    _close();
    // Le bouton de la page (s'il existe) garde sa logique propre.
    const btnPage = document.getElementById('btn-logout');
    if (btnPage) { btnPage.click(); return; }
    await logout();
    window.location.href = '/index.html';
  });
}

/** Remplit le menu du compte une fois le rôle et les assos connus. */
function _construireCompte(role, user, orgs, navOrgId) {
  if (!document.querySelector('.side-nav')) _construireSide();
  const c = document.getElementById('side-compte');
  if (!c) return;
  c.innerHTML = _contenuCompte({ role, user, orgs, navOrgId });
  _brancherCompte();
}

// ── Thème couleur organisation ────────────────────────────────────
function _hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// Luminance relative (sRGB) : sert à mesurer le contraste avec le texte blanc.
function _relLum(r, g, b) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// Assombrit une couleur trop claire (ex. jaune) jusqu'à ce que le texte blanc
// dessus soit lisible. Garde la teinte mais rend la couleur utilisable comme
// fond de bouton et comme couleur de texte sur fond clair.
function _readableBrand(r, g, b) {
  let guard = 0;
  // Contraste texte blanc / fond = 1.05 / (L + 0.05) ; on vise ≥ 3.6
  while ((1.05 / (_relLum(r, g, b) + 0.05)) < 3.6 && guard < 30) {
    r = Math.round(r * 0.9); g = Math.round(g * 0.9); b = Math.round(b * 0.9);
    guard++;
  }
  return { r, g, b };
}

function _applyOrgTheme(hex) {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
  const orig = _hexToRgb(hex);                       // couleur brute (pour les teintes claires)
  const { r, g, b } = _readableBrand(orig.r, orig.g, orig.b); // version lisible (texte/boutons)
  const D = (v, t) => Math.max(0, Math.round(v * (1 - t)));
  const toHex = (R, G, B) => '#' + [R, G, B].map(v => v.toString(16).padStart(2, '0')).join('');
  const root = document.documentElement;
  root.style.setProperty('--indigo',          toHex(r, g, b));
  root.style.setProperty('--indigo-dark',     `rgb(${D(r, .18)},${D(g, .18)},${D(b, .18)})`);
  root.style.setProperty('--indigo-hover',    `rgb(${D(r, .08)},${D(g, .08)},${D(b, .08)})`);
  // Teintes claires : on part de la couleur brute pour garder un fond vif et doux.
  root.style.setProperty('--indigo-light',    `rgba(${orig.r},${orig.g},${orig.b},.12)`);
  root.style.setProperty('--indigo-mid',      `rgba(${orig.r},${orig.g},${orig.b},.35)`);
  root.style.setProperty('--shadow-indigo',   `0 4px 16px rgba(${r},${g},${b},.38)`);
  root.style.setProperty('--shadow-colored',  `0 4px 16px rgba(${r},${g},${b},.22)`);
}

// ── Logo plateforme ───────────────────────────────────────────────
async function _applyPlatformLogo() {
  const icon = document.querySelector('.nav-brand-icon');
  if (!icon) return;

  // 1. Cache localStorage → instantané, zéro Firestore
  const cached = localStorage.getItem('_platformLogo');
  if (cached) { _setPlatformIcon(icon, cached); return; }

  // 2. Sinon fetch Firestore une seule fois et met en cache
  try {
    const d = await getDoc(doc(db, 'platform_settings', 'main'));
    if (d.exists() && d.data().logoBase64) {
      const b64 = d.data().logoBase64;
      localStorage.setItem('_platformLogo', b64);
      _setPlatformIcon(document.querySelector('.nav-brand-icon'), b64);
    }
  } catch(e) { /* réseau indisponible : on garde le "C" */ }
}

function _setPlatformIcon(icon, base64) {
  if (!icon) return;
  icon.innerHTML = `<img src="${base64}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;display:block;" />`;
  icon.style.background = 'transparent';
  icon.style.boxShadow = 'none';
  icon.style.padding = '0';
}

// Posée dès le chargement du module, une fois toutes les déclarations faites
// (les icônes du menu sont définies plus haut dans le fichier).
_preparerNav();
installerIcones();
if (document.querySelector('.nav .nav-links')) _installerInfobulles();
