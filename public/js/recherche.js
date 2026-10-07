/**
 * Recherche rapide (Ctrl K, ⌘ K, ou la loupe du menu) : depuis n'importe
 * quelle page du bureau, un cooptant, un staffeur ou une action.
 *
 *  - un cooptant ouvre sa fiche (js/fiche-cooptant.js) sans changer de page ;
 *  - un staffeur ouvre sa fiche de staffeur ;
 *  - une action mène à une page, un onglet, ou copie un lien public.
 *
 * Branchée par nav.js (`brancherRecherche`) une fois l'asso connue. Les données
 * ne sont lues qu'à la première ouverture, puis gardées pour la page.
 */
import { getFirestore, collection, query, where, getDocs, getDoc, doc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { app } from './auth.js';
import { esc, pourRecherche, showToast } from './utils.js';

const db = getFirestore(app);

let ctx = { orgId: null, role: null, par: null, rappels: {} };
let racine = null;
let donnees = null;          // { org, campaign, cooptants, staff, ivParCooptant } ou null
let chargement = null;       // promesse de la lecture en cours
let resultats = [];          // éléments affichés, dans l'ordre du clavier
let actif = 0;
let declencheur = null;

/**
 * @param {object} o
 * @param {string|null} o.orgId asso courante (null : pages admin, actions seulement)
 * @param {string} o.role       'secge' | 'admin'
 * @param {string} [o.par]      email de la personne connectée (corbeille de la fiche)
 * @param {object} [o.rappels]  { choisirTheme(t), revoirTuto(), changerMdp() }
 */
export function brancherRecherche(o) {
  if (ctx.orgId !== o.orgId) { donnees = null; chargement = null; }
  ctx = { ...ctx, ...o };
}

// Raccourci clavier : posé dès le chargement du module, avant même la
// lecture du rôle, pour que Ctrl K réponde tout de suite.
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    racine && !racine.hidden ? fermerRecherche() : ouvrirRecherche();
  }
});

export const raccourci = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ K' : 'Ctrl K';

function fenetre() {
  if (racine) return racine;
  racine = document.createElement('div');
  racine.className = 'rch-voile';
  racine.hidden = true;
  racine.innerHTML = `
    <div class="rch" role="dialog" aria-modal="true" aria-label="Rechercher">
      <div class="rch-champ">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input id="rch-q" type="text" autocomplete="off" spellcheck="false"
          placeholder="Un cooptant, un staffeur, une action…"
          role="combobox" aria-expanded="true" aria-controls="rch-liste" aria-autocomplete="list" />
        <button type="button" class="rch-esc" data-rch-fermer>Échap</button>
      </div>
      <div class="rch-liste" id="rch-liste" role="listbox" aria-label="Résultats"></div>
      <div class="rch-pied"><span><kbd>↑</kbd><kbd>↓</kbd> choisir</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>Échap</kbd> fermer</span></div>
    </div>`;
  document.body.append(racine);
  const q = racine.querySelector('#rch-q');
  q.addEventListener('input', () => { actif = 0; dessiner(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); bouger(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); bouger(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); choisir(resultats[actif]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerRecherche(); }
  });
  racine.addEventListener('mousedown', e => { if (e.target === racine) fermerRecherche(); });
  racine.querySelector('[data-rch-fermer]').addEventListener('click', fermerRecherche);
  racine.querySelector('#rch-liste').addEventListener('click', e => {
    const li = e.target.closest('[data-i]');
    if (li) choisir(resultats[Number(li.dataset.i)]);
  });
  racine.querySelector('#rch-liste').addEventListener('mousemove', e => {
    const li = e.target.closest('[data-i]');
    if (li && Number(li.dataset.i) !== actif) { actif = Number(li.dataset.i); marquerActif(false); }
  });
  return racine;
}

export function ouvrirRecherche() {
  const r = fenetre();
  declencheur = document.activeElement;
  r.hidden = false;
  document.body.classList.add('rch-on');
  const q = r.querySelector('#rch-q');
  q.value = '';
  actif = 0;
  dessiner();
  q.focus();
  if (ctx.orgId && !donnees) charger().then(() => { if (!r.hidden) dessiner(); });
}

export function fermerRecherche() {
  if (!racine || racine.hidden) return;
  racine.hidden = true;
  document.body.classList.remove('rch-on');
  declencheur?.focus?.();
}

// ── Données ──────────────────────────────────────────────────────────
function charger() {
  if (chargement) return chargement;
  chargement = (async () => {
    // La page a souvent déjà tout lu (tableau de bord, Cooptants, planning) :
    // elle le prête par `window.donneesRecherche()`. Sinon on relit (~200
    // lectures pour une asso d'une centaine de cooptants, sur un quota gratuit de 50 000 par jour).
    const fournies = (typeof window.donneesRecherche === 'function' && window.donneesRecherche()) || null;
    let org, campaign, rosDocs = fournies?.roster || null, dispos = fournies?.dispos || null;
    let cooptants = [], ivParCooptant = new Map();
    if (fournies?.org?.id && fournies.campaign && fournies.cooptants) {
      org = fournies.org;
      campaign = fournies.campaign;
      cooptants = fournies.cooptants;
      (fournies.entretiens || []).forEach(({ candidateId, debut }) => {
        if (!candidateId || !(debut instanceof Date) || isNaN(debut)) return;
        const deja = ivParCooptant.get(candidateId);
        if (!deja || debut < deja) ivParCooptant.set(candidateId, debut);
      });
    } else {
      // ?org= peut porter un slug (admin) : on retrouve l'identifiant.
      let orgDoc = await getDoc(doc(db, 'organizations', ctx.orgId));
      if (!orgDoc.exists()) {
        const parSlug = await getDocs(query(collection(db, 'organizations'), where('slug', '==', ctx.orgId))).catch(() => ({ docs: [] }));
        if (parSlug.docs[0]) orgDoc = parSlug.docs[0];
      }
      org = orgDoc.exists() ? { id: orgDoc.id, ...orgDoc.data() } : { id: ctx.orgId };
      const campSnap = await getDocs(query(collection(db, 'campaigns'), where('organizationId', '==', org.id)));
      campaign = campSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))[0] || null;
      if (campaign) {
        const [candSnap, ivSnap] = await Promise.all([
          getDocs(query(collection(db, 'candidates'), where('campaignId', '==', campaign.id))),
          getDocs(query(collection(db, 'interviews'), where('campaignId', '==', campaign.id))),
        ]);
        cooptants = candSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        ivSnap.docs.forEach(d => {
          const iv = d.data(), t = iv.datetimeStart?.toDate?.();
          if (!iv.candidateId || !t) return;
          const deja = ivParCooptant.get(iv.candidateId);
          if (!deja || t < deja) ivParCooptant.set(iv.candidateId, t);
        });
      }
    }
    const orgId = org.id;
    const [rosSnap, dispSnap] = await Promise.all([
      rosDocs ? null : getDocs(query(collection(db, 'roster_members'), where('organizationId', '==', orgId))).catch(() => ({ docs: [] })),
      dispos || !campaign ? null : getDocs(query(collection(db, 'staff_availabilities'), where('campaignId', '==', campaign.id))).catch(() => ({ docs: [] })),
    ]);
    if (!rosDocs) rosDocs = rosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!dispos) dispos = dispSnap ? dispSnap.docs.map(d => d.data()) : [];
    // Staffeurs : liste du staff et dispos déposées, une entrée par nom.
    // L'identifiant des dispos est celui que portent les entretiens : il passe
    // devant celui de la liste (voir « Une personne, deux identifiants »).
    const staff = new Map();
    dispos.forEach(d => {
      const nom = (d.displayName || '').trim();
      if (nom && d.userId && !staff.has(pourRecherche(nom))) staff.set(pourRecherche(nom), { id: d.userId, nom, aDispos: true });
    });
    rosDocs.forEach(r => {
      const nom = (r.displayName || r.name || [r.firstName, r.lastName].filter(Boolean).join(' ') || '').trim();
      if (nom && !staff.has(pourRecherche(nom))) staff.set(pourRecherche(nom), { id: r.id, nom, aDispos: false });
    });
    donnees = { org, campaign, cooptants, ivParCooptant, staff: [...staff.values()] };
  })().catch(e => {
    console.warn('Recherche : données illisibles', e);
    chargement = null;
    donnees = { org: { id: ctx.orgId }, campaign: null, cooptants: [], ivParCooptant: new Map(), staff: [], erreur: true };
  });
  return chargement;
}

// ── Actions ──────────────────────────────────────────────────────────
function actions() {
  const liste = [];
  // Pages du menu (liens déjà complétés par ?org= par nav.js).
  document.querySelectorAll('.nav .nav-links a').forEach(a => {
    liste.push({ type: 'page', titre: a.textContent.trim(), mots: 'page aller ouvrir', href: a.getAttribute('href') });
  });
  const orgId = ctx.orgId;
  if (orgId) {
    const o = encodeURIComponent(orgId);
    const pub = encodeURIComponent(donnees?.org?.slug || orgId);
    const base = location.origin;
    const lien = (titre, url, mots) => ({ type: 'lien', titre, mots: `copier lien partager ${mots}`, copier: url });
    liste.push(
      { type: 'page', titre: 'Classement des cooptants', mots: 'classement délibération rang scores', href: `/secge/candidats.html?org=${o}&vue=classement` },
      { type: 'page', titre: 'Dispos des membres', mots: 'disponibilités staff planning grille', href: `/planning.html?org=${o}&onglet=dispos` },
      { type: 'page', titre: 'Placer un cooptant à la main', mots: 'allocation manuelle planning entretien', href: `/planning.html?org=${o}&onglet=allocation` },
      lien('Copier le lien du formulaire', `${base}/postuler.html?org=${pub}`, 'formulaire cooptation postuler'),
      lien('Copier le lien du formulaire en anglais', `${base}/postuler.html?org=${pub}&lang=en`, 'formulaire anglais english'),
      lien('Copier le lien des dispos du staff', `${base}/dispos-publique.html?org=${pub}`, 'dispos disponibilités staff'),
      lien("Copier le lien d'évaluation", `${base}/evaluer-publique.html?org=${pub}`, 'évaluation noter jury'),
      lien('Copier le lien du planning public', `${base}/planning-public.html?org=${pub}`, 'planning public'),
      { type: 'page', titre: 'Mode stand', mots: 'stand inscrire sur place', href: `${base}/postuler.html?org=${pub}&stand=1`, nouvelOnglet: true },
      { type: 'reglage', titre: 'Dates et créneaux des entretiens', mots: 'paramètres quand recrutement ouvert fermer période jours heure fin durée créneaux délai', href: `/parametres.html?org=${o}&onglet=quand` },
      { type: 'reglage', titre: 'Façon de prendre rendez-vous', mots: 'paramètres comment mode créneaux dispos entretien à plusieurs parallèle appartement', href: `/parametres.html?org=${o}&onglet=comment` },
      { type: 'reglage', titre: 'Staffeurs par entretien', mots: 'paramètres qui jurés staffeurs affilée anglais', href: `/parametres.html?org=${o}&onglet=qui` },
      { type: 'reglage', titre: 'Questions du formulaire', mots: 'paramètres formulaire questions anglais', href: `/parametres.html?org=${o}&onglet=formulaire` },
      { type: 'reglage', titre: "Grille d'évaluation", mots: 'paramètres évaluation entretien critères consignes places', href: `/parametres.html?org=${o}&onglet=evaluation` },
      { type: 'reglage', titre: 'Membres du staff', mots: 'paramètres staff membres rôles ajouter', href: `/parametres.html?org=${o}&onglet=qui` },
      { type: 'reglage', titre: 'Salles', mots: 'paramètres salles', href: `/parametres.html?org=${o}&onglet=comment` },
      { type: 'reglage', titre: "Codes d'accès", mots: 'paramètres codes invitation accès', href: `/parametres.html?org=${o}&onglet=acces` },
      { type: 'reglage', titre: 'Clôturer le recrutement', mots: 'fin clôture effacer données cooptants terminer recrutement suivant', href: `/parametres.html?org=${o}&onglet=quand` },
      { type: 'reglage', titre: 'Passation du bureau', mots: 'passation nouveau bureau ancien code retirer staff', href: `/parametres.html?org=${o}&onglet=acces` },
      { type: 'page', titre: 'Assistant de démarrage', mots: 'assistant démarrage démarrer régler commencer', href: `/secge/dashboard.html?org=${o}&assistant=1` },
      { type: 'reglage', titre: 'Corbeille', mots: 'paramètres corbeille restaurer supprimé', href: `/parametres.html?org=${o}&onglet=acces` },
    );
  }
  const { choisirTheme, revoirTuto, changerMdp } = ctx.rappels || {};
  if (choisirTheme) {
    liste.push(
      { type: 'action', titre: 'Thème sombre', mots: 'sombre nuit dark thème', faire: () => choisirTheme('dark') },
      { type: 'action', titre: 'Thème clair', mots: 'clair jour light thème', faire: () => choisirTheme('light') },
    );
  }
  if (revoirTuto) liste.push({ type: 'action', titre: 'Revoir la présentation', mots: 'tuto visite aide présentation', faire: revoirTuto });
  if (changerMdp) liste.push({ type: 'action', titre: 'Changer mon mot de passe', mots: 'mot de passe compte', faire: changerMdp });
  liste.push({ type: 'page', titre: 'Aide', mots: 'aide documentation question', href: '/aide.html' });
  liste.push({ type: 'action', titre: 'Se déconnecter', mots: 'déconnexion quitter logout', faire: () => document.getElementById('btn-logout')?.click() });
  return liste;
}

// ── Recherche ────────────────────────────────────────────────────────
/**
 * 0 : pas trouvé ; plus c'est haut, mieux c'est (début de mot > milieu).
 * `debutDeMot` : pour un nom, seul le début d'un mot compte (« lien » ne
 * doit pas trouver « Julien »).
 */
function note(texte, mots, extra = '', debutDeMot = false) {
  if (!mots.length) return 1;
  const t = pourRecherche(texte), x = pourRecherche(extra);
  let total = 0;
  for (const m of mots) {
    if (t.startsWith(m)) total += 4;
    else if (t.includes(' ' + m) || t.includes('-' + m) || t.includes("'" + m)) total += 3;
    else if (!debutDeMot && t.includes(m)) total += 2;
    else if (x.includes(m)) total += 1;
    else return 0;
  }
  return total;
}

const STATUTS = { recu: 'Reçu', place: 'Placé', entretien_fait: 'Entretien passé' };
const jourHeure = d => `${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

function chercher(q) {
  const mots = pourRecherche(q).split(/\s+/).filter(Boolean);
  const groupes = [];
  const d = donnees;

  if (d) {
    let cooptants;
    if (!mots.length) {
      // Sans texte : les entretiens qui arrivent (ou en cours depuis moins d'une heure).
      const depuis = Date.now() - 3600000;
      cooptants = d.cooptants.filter(c => d.ivParCooptant.get(c.id)?.getTime() >= depuis)
        .sort((a, b) => d.ivParCooptant.get(a.id) - d.ivParCooptant.get(b.id)).slice(0, 5);
      if (cooptants.length) groupes.push({ titre: 'Prochains entretiens', items: cooptants.map(itemCooptant) });
    } else {
      cooptants = d.cooptants.map(c => ({ c, n: note(`${c.prenom || ''} ${c.nom || ''}`, mots, c.email || '', true) }))
        .filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 8).map(x => x.c);
      if (cooptants.length) groupes.push({ titre: 'Cooptants', items: cooptants.map(itemCooptant) });
      const staff = d.staff.map(s => ({ s, n: note(s.nom, mots, '', true) })).filter(x => x.n)
        .sort((a, b) => b.n - a.n).slice(0, 5).map(x => x.s);
      if (staff.length) groupes.push({ titre: 'Staffeurs', items: staff.map(s => ({
        type: 'staff', titre: s.nom, sous: s.aDispos ? 'Fiche du staffeur' : 'Fiche du staffeur · dispos non remplies', staff: s })) });
    }
  }

  const acts = actions().map(a => ({ a, n: note(a.titre, mots, a.mots) })).filter(x => x.n)
    .sort((a, b) => b.n - a.n).slice(0, mots.length ? 6 : 5).map(x => x.a);
  if (acts.length) groupes.push({ titre: mots.length ? 'Actions' : 'Raccourcis', items: acts.map(a => ({ ...a,
    sous: { page: 'Page', lien: 'Copie le lien', reglage: 'Paramètres', action: '' }[a.type] })) });
  return groupes;
}

function itemCooptant(c) {
  const t = donnees.ivParCooptant.get(c.id);
  return {
    type: 'cooptant', c,
    titre: `${c.prenom || ''} ${c.nom || ''}`.trim() || c.email || 'Cooptant',
    drapeau: c.langue === 'en',
    sous: [t ? `Entretien ${jourHeure(t)}` : "Pas d'entretien", STATUTS[c.statut] || ''].filter(Boolean).join(' · '),
  };
}

const ICONE = {
  cooptant: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
  staff: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  page: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  lien: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  reglage: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  action: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
};

function dessiner() {
  const liste = racine.querySelector('#rch-liste');
  const q = racine.querySelector('#rch-q').value;
  const groupes = chercher(q);
  resultats = groupes.flatMap(g => g.items);
  if (actif >= resultats.length) actif = 0;
  let i = 0;
  let html = groupes.map(g => `<div class="rch-groupe" role="presentation">${esc(g.titre)}</div>` + g.items.map(it => {
    const n = i++;
    return `<div class="rch-item" role="option" id="rch-o${n}" data-i="${n}" aria-selected="false">
      <svg viewBox="0 0 24 24" aria-hidden="true">${ICONE[it.type] || ICONE.action}</svg>
      <span class="rch-txt"><b>${esc(it.titre)}${it.drapeau ? ' <span title="Entretien en anglais">🇬🇧</span>' : ''}</b>${it.sous ? `<small>${esc(it.sous)}</small>` : ''}</span>
    </div>`;
  }).join('')).join('');
  if (ctx.orgId && !donnees) html = `<div class="rch-info">Chargement des cooptants…</div>` + html;
  else if (donnees?.erreur) html = `<div class="rch-info">Cooptants indisponibles pour le moment.</div>` + html;
  if (!resultats.length) html += `<div class="rch-info">Rien pour « ${esc(q)} ».</div>`;
  liste.innerHTML = html;
  marquerActif(true);
}

function marquerActif(defiler) {
  racine.querySelectorAll('.rch-item').forEach(el => el.setAttribute('aria-selected', String(Number(el.dataset.i) === actif)));
  const el = racine.querySelector(`#rch-o${actif}`);
  racine.querySelector('#rch-q').setAttribute('aria-activedescendant', el ? el.id : '');
  if (defiler) el?.scrollIntoView({ block: 'nearest' });
}

function bouger(delta) {
  if (!resultats.length) return;
  actif = (actif + delta + resultats.length) % resultats.length;
  marquerActif(true);
}

async function choisir(it) {
  if (!it) return;
  fermerRecherche();
  if (it.type === 'cooptant') {
    // La page sait mieux faire (liste pour ↑/↓, rechargement après une
    // modification) : on lui laisse la main si elle le propose.
    if (typeof window.ouvrirCooptant === 'function' && window.ouvrirCooptant(it.c.id)) return;
    const { ouvrirFiche } = await import('./fiche-cooptant.js');
    ouvrirFiche(it.c, { org: donnees.org, campaign: donnees.campaign, par: ctx.par || null });
  } else if (it.type === 'staff') {
    const { ouvrirFicheStaffeur } = await import('./fiche-cooptant.js');
    ouvrirFicheStaffeur(it.staff.id, { org: donnees.org, campaign: donnees.campaign, nom: it.staff.nom });
  } else if (it.copier) {
    navigator.clipboard.writeText(it.copier)
      .then(() => showToast('Lien copié.', 'success'))
      .catch(() => showToast('Impossible de copier.', 'error'));
  } else if (it.href) {
    if (it.nouvelOnglet) window.open(it.href, '_blank', 'noopener');
    else location.href = it.href;
  } else {
    it.faire?.();
  }
}
