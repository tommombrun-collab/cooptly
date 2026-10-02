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
function _afficherIdentite({ orgName, roleLabel, userName } = {}) {
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
}

function _preparerNav() {
  const nav = document.querySelector('.nav');
  if (!nav || !nav.querySelector('.nav-links')) return;   // pages publiques : rien à faire
  _injectButton();

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
_preparerNav();

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

  _injectButton();
  _injectDrawer(role, { ...user, displayName: effectiveDisplayName }, orgs);

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
    const identite = { orgName: current?.name || '', roleLabel, userName: effectiveDisplayName };
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

function _themeIcon(theme) {
  if (theme === 'dark') {
    // Sun icon
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`;
  }
  // Moon icon
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
}

function _currentTheme() {
  return localStorage.getItem('_theme') || 'light';
}

function _toggleTheme() {
  const next = _currentTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem('_theme', next);
  document.documentElement.setAttribute('data-theme', next);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.innerHTML = _themeIcon(next);
}

function _injectButton() {
  const nav = document.querySelector('.nav');
  if (!nav || document.getElementById('burger-btn')) return;

  const btnStyle = 'display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:none;border:1.5px solid var(--border);cursor:pointer;color:var(--text-muted);border-radius:8px;flex-shrink:0;text-decoration:none;transition:background .15s,color .15s,border-color .15s;';

  // ── ? Help button ────────────────────────────────────────────
  const helpBtn = document.createElement('a');
  helpBtn.href = '/aide.html';
  helpBtn.setAttribute('aria-label', 'Aide');
  helpBtn.title = 'Aide & Documentation';
  helpBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  helpBtn.style.cssText = btnStyle;
  helpBtn.addEventListener('mouseenter', () => { helpBtn.style.background = 'var(--indigo-light)'; helpBtn.style.color = 'var(--indigo)'; helpBtn.style.borderColor = 'var(--indigo-mid)'; });
  helpBtn.addEventListener('mouseleave', () => { helpBtn.style.background = 'none'; helpBtn.style.color = 'var(--text-muted)'; helpBtn.style.borderColor = 'var(--border)'; });

  // ── ☀/☾ Theme toggle button ─────────────────────────────────
  const themeBtn = document.createElement('button');
  themeBtn.id = 'theme-toggle-btn';
  themeBtn.setAttribute('aria-label', 'Basculer le thème');
  themeBtn.title = 'Thème clair / sombre';
  themeBtn.innerHTML = _themeIcon(_currentTheme());
  themeBtn.style.cssText = btnStyle + 'border:1.5px solid var(--border);';
  themeBtn.addEventListener('mouseenter', () => { themeBtn.style.background = 'var(--indigo-light)'; themeBtn.style.color = 'var(--indigo)'; themeBtn.style.borderColor = 'var(--indigo-mid)'; });
  themeBtn.addEventListener('mouseleave', () => { themeBtn.style.background = 'none'; themeBtn.style.color = 'var(--text-muted)'; themeBtn.style.borderColor = 'var(--border)'; });
  themeBtn.addEventListener('click', _toggleTheme);

  const navRight = nav.querySelector('.nav-right');
  if (navRight) {
    navRight.insertBefore(themeBtn, navRight.firstChild);
    navRight.insertBefore(helpBtn, themeBtn);
    navRight.style.flex = '1';
    navRight.style.justifyContent = 'flex-end';
  } else {
    nav.appendChild(helpBtn);
    nav.appendChild(themeBtn);
  }

  // ── ☰ Burger button (top-left) ───────────────────────────────
  const btn = document.createElement('button');
  btn.id = 'burger-btn';
  btn.setAttribute('aria-label', 'Menu');
  btn.innerHTML = `<svg width="20" height="16" viewBox="0 0 20 16" fill="currentColor">
    <rect width="20" height="2.5" rx="1.25"/>
    <rect y="6.75" width="20" height="2.5" rx="1.25"/>
    <rect y="13.5" width="20" height="2.5" rx="1.25"/>
  </svg>`;
  btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:38px;height:38px;background:none;border:none;cursor:pointer;color:var(--text);border-radius:8px;flex-shrink:0;margin-right:4px;';
  btn.addEventListener('click', _open);
  nav.insertBefore(btn, nav.firstChild);

  // ── Groupe left : burger + brand + badge → flex:1 ────────────
  // Donne une 3e colonne symétrique à nav-right, ce qui centre naturellement nav-links.
  const navLinks = nav.querySelector('.nav-links');
  if (navLinks) {
    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;';
    while (nav.firstChild && nav.firstChild !== navLinks) {
      leftGroup.appendChild(nav.firstChild);
    }
    nav.insertBefore(leftGroup, navLinks);
  }
}

function _injectDrawer(role, user, orgs) {
  // Overlay
  const ov = document.createElement('div');
  ov.id = 'nav-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:999;display:none;backdrop-filter:blur(2px);';
  ov.addEventListener('click', _close);

  // Drawer
  const dr = document.createElement('div');
  dr.id = 'nav-drawer';
  dr.style.cssText = 'position:fixed;top:0;left:0;bottom:0;width:285px;background:var(--surface);box-shadow:6px 0 32px rgba(0,0,0,.18);z-index:1000;transform:translateX(-100%);transition:transform .26s cubic-bezier(.4,0,.2,1);overflow-y:auto;display:flex;flex-direction:column;';
  dr.innerHTML = _buildContent(role, user, orgs);

  document.body.appendChild(ov);
  document.body.appendChild(dr);

  // Swipe-to-close on mobile
  let startX = 0;
  dr.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  dr.addEventListener('touchend',   e => { if (e.changedTouches[0].clientX - startX < -60) _close(); }, { passive: true });
}

function _buildContent(role, user, orgs) {
  const ROLE_STYLE = {
    admin:    { label: 'Admin Plateforme', bg: '#FEE2E2', color: '#991B1B', dot: '#ef4444' },
    secge:    { label: 'Bureau',            bg: '#FFF7ED', color: '#C2410C', dot: '#f97316' },
    cooptant: { label: 'Cooptant',         bg: '#F0FDF4', color: '#166534', dot: '#22c55e' },
  };
  const rs = ROLE_STYLE[role] || { label: role, bg: '#F1F5F9', color: '#64748B', dot: '#94A3B8' };
  const initial = (user.displayName || user.email)[0].toUpperCase();

  // Admin sections
  let sections = '';

  if (role === 'admin') {
    sections += _section('🔴 Admin Plateforme', [
      { href: '/admin/dashboard.html',     icon: '🏠', label: 'Vue d\'ensemble' },
      { href: '/admin/organisations.html', icon: '🏢', label: 'Organisations' },
      { href: '/admin/permissions.html',   icon: '🔐', label: 'Permissions & Accès' },
    ]);
    if (orgs.length) {
      sections += _section('🏢 Associations', orgs.map(o => ({
        href: `/secge/dashboard.html?org=${o.id}`,
        icon: '→',
        label: o.name,
        color: o.primaryColor
      })));
    }

  } else if (role === 'secge') {
    // Asso active : celle de l'URL si elle est bien à l'utilisateur, sinon
    // celle mémorisée, sinon la première.
    const urlOrg     = paramLien('org');
    const remembered = sessionStorage.getItem('currentOrgId');
    const org = orgs.find(o => o.id === urlOrg)
             || orgs.find(o => o.id === remembered)
             || orgs[0];
    const oid = org?.id || '';

    sections += _section(`🏢 ${org?.name || 'Mon association'}`, [
      { href: `/secge/dashboard.html?org=${oid}`, icon: '📊', label: 'Tableau de bord' },
      { href: `/secge/candidats.html?org=${oid}`, icon: '👥', label: 'Cooptants & Réponses' },
      { href: `/planning.html?org=${oid}`,        icon: '📅', label: 'Planning des entretiens' },
      { href: `/parametres.html?org=${oid}`,      icon: '⚙️', label: 'Paramètres' },
    ]);

    // Membre de plusieurs bureaux : sélecteur d'asso. On n'affiche la section
    // que s'il y a réellement un choix à faire.
    if (orgs.length > 1) {
      sections += _section('🔄 Changer d\'association', orgs
        .filter(o => o.id !== oid)
        .map(o => ({
          href:  `/secge/dashboard.html?org=${o.id}`,
          icon:  '→',
          label: o.name,
          color: o.primaryColor,
        })));
    }

    sections += _section('➕ Rejoindre', [
      { href: '/rejoindre.html', icon: '🔑', label: 'Rejoindre une autre asso' },
    ]);
  }

  return `
    <!-- En-tête profil -->
    <div style="padding:0;border-bottom:1px solid var(--border);">
      <!-- Bandeau gradient -->
      <div style="height:72px;background:var(--indigo);position:relative;border-radius:0;display:flex;align-items:flex-start;justify-content:flex-end;padding:12px 14px;">
        <button onclick="document.getElementById('nav-drawer').style.transform='translateX(-100%)';document.getElementById('nav-overlay').style.display='none';"
          style="background:rgba(255,255,255,.18);border:none;cursor:pointer;color:#fff;font-size:15px;width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);">✕</button>
      </div>
      <!-- Avatar chevauchant -->
      <div style="padding:0 16px 16px;margin-top:-28px;">
        <div style="width:52px;height:52px;border-radius:13px;background:var(--indigo);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;border:3px solid #fff;box-shadow:var(--shadow-indigo);margin-bottom:10px;letter-spacing:0;">${initial}</div>
        <div style="font-size:15px;font-weight:700;color:var(--text);letter-spacing:-0.01em;">${user.displayName || user.email.split('@')[0]}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:1px;letter-spacing:0;">${user.email}</div>
        <div style="display:inline-flex;align-items:center;gap:5px;margin-top:8px;font-size:11.5px;font-weight:600;color:${rs.color};background:${rs.bg};border:1px solid ${rs.dot}33;padding:3px 9px;border-radius:99px;">
          <span style="width:6px;height:6px;border-radius:50%;background:${rs.dot};display:inline-block;flex-shrink:0;"></span>
          ${rs.label}
        </div>
      </div>
    </div>

    <!-- Navigation -->
    <nav style="padding:6px 0;flex:1;">${sections}</nav>

    <!-- Pied -->
    <div style="padding:12px 16px 20px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
      <button id="nav-tuto-btn" type="button"
        style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:9px;background:none;border:1.5px solid var(--border);cursor:pointer;color:var(--text-muted);font-size:13px;font-weight:500;width:100%;font-family:inherit;transition:all .15s;letter-spacing:-0.005em;"
        onmouseover="this.style.background='var(--indigo-light)';this.style.color='var(--indigo)';this.style.borderColor='var(--indigo-mid)'"
        onmouseout="this.style.background='none';this.style.color='var(--text-muted)';this.style.borderColor='var(--border)'">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Revoir la présentation
      </button>
      <button id="nav-mdp-btn" type="button"
        style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:9px;background:none;border:1.5px solid var(--border);cursor:pointer;color:var(--text-muted);font-size:13px;font-weight:500;width:100%;font-family:inherit;transition:all .15s;letter-spacing:-0.005em;"
        onmouseover="this.style.background='var(--indigo-light)';this.style.color='var(--indigo)';this.style.borderColor='var(--indigo-mid)'"
        onmouseout="this.style.background='none';this.style.color='var(--text-muted)';this.style.borderColor='var(--border)'">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Changer mon mot de passe
      </button>
      <a href="/aide.html"
        style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:9px;background:none;border:1.5px solid var(--border);cursor:pointer;color:var(--text-muted);font-size:13px;font-weight:500;width:100%;font-family:inherit;transition:all .15s;letter-spacing:-0.005em;text-decoration:none;"
        onmouseover="this.style.background='var(--indigo-light)';this.style.color='var(--indigo)';this.style.borderColor='var(--indigo-mid)'"
        onmouseout="this.style.background='none';this.style.color='var(--text-muted)';this.style.borderColor='var(--border)'">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Aide & Documentation
      </a>
      <button id="nav-logout-btn"
        style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:9px;background:none;border:1.5px solid var(--border);cursor:pointer;color:var(--text-muted);font-size:13px;font-weight:500;width:100%;font-family:inherit;transition:all .15s;letter-spacing:-0.005em;"
        onmouseover="this.style.background='#FEF2F2';this.style.color='var(--red)';this.style.borderColor='#FECACA'"
        onmouseout="this.style.background='none';this.style.color='var(--text-muted)';this.style.borderColor='var(--border)'">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Déconnexion
      </button>
    </div>`;
}

function _section(title, links) {
  const curFull = location.pathname + location.search;
  const curPath = location.pathname;
  const items = links.map(l => {
    const linkPath = l.href.split('?')[0];
    const hasQuery = l.href.includes('?');
    // Lien avec query param → comparaison exacte ; sans query → comparaison du pathname
    const active = hasQuery ? curFull === l.href : curPath === linkPath;
    return `<a href="${l.href}"
      style="display:flex;align-items:center;gap:10px;padding:9px 14px;margin:1px 8px;font-size:13.5px;color:${active ? 'var(--indigo)' : 'var(--text)'};text-decoration:none;border-radius:9px;font-weight:${active ? '600' : '450'};background:${active ? 'var(--indigo-light)' : 'transparent'};letter-spacing:-0.005em;transition:background .12s,color .12s;"
      onmouseover="if(!${active})this.style.background='var(--bg)'" onmouseout="if(!${active})this.style.background='transparent'">
      <span style="font-size:14px;width:22px;text-align:center;flex-shrink:0;">${l.icon}</span>
      <span style="flex:1;">${l.label}</span>
      ${active ? `<span style="width:7px;height:7px;border-radius:50%;background:var(--indigo);flex-shrink:0;"></span>` : ''}
      ${l.color && !active ? `<span style="width:8px;height:8px;border-radius:50%;background:${l.color};flex-shrink:0;"></span>` : ''}
    </a>`;
  }).join('');
  return `
    <div style="padding:10px 0 4px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--text-light);padding:0 24px 6px;">${title}</div>
      ${items}
    </div>`;
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

function _open() {
  // Le bouton existe dès le chargement, le tiroir seulement une fois le rôle
  // connu : un clic trop tôt ne fait rien plutôt que de planter.
  const drawer = document.getElementById('nav-drawer');
  const overlay = document.getElementById('nav-overlay');
  if (!drawer || !overlay) return;
  drawer.style.transform = 'translateX(0)';
  overlay.style.display = 'block';
  // Attach logout after render
  setTimeout(() => {
    const btn = document.getElementById('nav-logout-btn');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', async () => {
        await logout();
        window.location.href = '/index.html';
      });
    }
  }, 50);
}

function _close() {
  const d = document.getElementById('nav-drawer');
  const o = document.getElementById('nav-overlay');
  if (d) d.style.transform = 'translateX(-100%)';
  if (o) o.style.display = 'none';
}
