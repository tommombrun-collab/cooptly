/**
 * Visite guidée des pages du bureau : une courte visite PAR PAGE, qui éclaire
 * les vrais boutons un par un (le reste de l'écran est assombri) avec une bulle
 * et une flèche qui pointe dessus.
 *
 * Montrée une fois par personne et par page. Le « déjà vu » est rangé dans le
 * profil `users/{uid}.tutoPages.<page>` (il suit la personne d'un appareil à
 * l'autre), `localStorage` sert de cache.
 *
 * `TUTO_VERSION` remontre la visite à TOUT LE MONDE après un gros changement,
 * y compris à ceux qui l'avaient déjà vue : il suffit de l'incrémenter.
 * (Version 2 : nouvelle visite avec flèches, après la refonte du tableau de bord.
 *  Version 3 : refonte de l'interface, menu latéral, Paramètres par question.)
 * Une nouvelle visite (nouvelle clé de `VISITES`) n'a pas besoin d'incrémenter
 * la version : personne ne l'a encore vue, elle est montrée une fois à chacun.
 */
import { app } from './auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const db = getFirestore(app);

export const TUTO_VERSION = 3;

/**
 * Étapes par page. `cible` : sélecteur de l'élément à éclairer (étape sautée
 * s'il n'est pas à l'écran, par exemple un tableau vide), ou liste de
 * sélecteurs dont le premier visible gagne (menu latéral sur ordinateur,
 * onglets du bas sur téléphone). Sans `cible` : bulle au centre. Le texte est
 * statique, il peut contenir du HTML.
 */
const VISITES = {
  dashboard: [
    { titre: 'Bienvenue sur Cooptly 👋',
      texte: 'Petit tour de cette page en 30 secondes. Chaque page a sa mini-visite, la première fois que vous l\'ouvrez.' },
    { cible: '#btn-copy-link', titre: 'Le lien du formulaire',
      texte: 'Copiez le lien de cooptation et diffusez-le : réseaux, messageries, affiches. Les cooptants postulent et réservent leur entretien eux-mêmes.' },
    { cible: '#btn-partager', titre: 'Tous les autres liens',
      texte: 'Formulaire en anglais, QR code, et les liens du staff : <strong>dispos</strong>, <strong>évaluation</strong>, <strong>planning public</strong>, <strong>stand</strong>. Chacun dit à quoi il sert.' },
    { cible: '#btn-stand', titre: 'Sur un stand',
      texte: 'Inscrivez quelqu\'un sur place en quelques secondes, seul ou à deux, avec un QR code à la fin.' },
    { cible: '.tdb-bande', titre: 'L\'avancement',
      texte: 'Candidatures, entretiens réservés, passés et évalués. En dessous : ce qu\'il reste à faire et la journée.' },
    { cible: '#cands-wrap thead', titre: 'Les cooptants',
      texte: 'Cliquez sur une ligne pour voir le dossier. La colonne <strong>Messenger</strong> sert à suivre l\'ajout au groupe.' },
    { cible: ['.side-liens', '.tel-onglets'], titre: 'Le menu',
      texte: '<strong>Cooptants</strong> pour les évaluations et les délibérations, <strong>Planning</strong> pour les entretiens, <strong>Paramètres</strong> pour tout régler.' },
    { cible: ['.side-cherche', '.tel-cherche'], titre: 'Chercher',
      texte: 'Un cooptant, un staffeur ou une action, depuis n\'importe quelle page. Sur ordinateur : <strong>Ctrl K</strong>.' },
    { cible: ['#side-moi', '.tel-moi'], titre: 'Ton compte',
      texte: 'Changer d\'association, thème clair ou sombre, <strong>aide</strong>, et « Revoir la présentation » pour relancer cette visite.' },
  ],
  candidats: [
    { cible: '.view-toggle', titre: 'Deux vues',
      texte: '<strong>Cooptants</strong> : tout le monde dans un tableau. <strong>Classement</strong> : pour délibérer.' },
    { cible: '#filtres', titre: 'Rechercher, filtrer, trier',
      texte: 'La recherche ignore les accents. Les pastilles filtrent (statut, sans entretien, pas évalués, anglais), un clic sur un en-tête de colonne trie.' },
    { cible: '#cands-table tbody tr', titre: 'La fiche d\'un cooptant',
      texte: 'Cliquez sur une ligne : profil, entretien, staffeurs, évaluations et note interne, tout est dans la même fiche.' },
    { cible: '#btn-view-classement', titre: 'Le classement',
      texte: 'Pour délibérer : ligne de coupe, zone grise, correction des staffeurs et vote des membres. Une courte visite le présente à la première ouverture.' },
  ],
  // Vue Classement de candidats.html (`body[data-vue="classement"]`), lancée
  // par setView à la première ouverture.
  classement: [
    { cible: '#nb-places-input', titre: 'La ligne de coupe',
      texte: 'Le nombre de places trace la ligne. Glissez une ligne ou tapez un rang pour réordonner ; <strong>−</strong> et <strong>+</strong> ajustent une note sur le moment.' },
    { cible: '#zg-champ', titre: 'La zone grise',
      texte: 'Les derniers retenus et les premiers non retenus, surlignés : ceux dont il faut vraiment discuter. « Ne montrer que la zone grise » replie les autres pendant la réunion.' },
    { cible: '.sev-bascule', titre: 'Staffeurs sévères ou généreux',
      texte: 'Cochez pour corriger les notes : l\'écart d\'un staffeur plus sévère ou plus généreux que les autres est retiré à ses cooptants. « Voir le détail » montre l\'écart de chacun.' },
    { cible: '#vote-carte .vote-carte', titre: 'Faire voter les membres',
      texte: 'Un lien à envoyer aux membres de l\'asso : chacun coche ses coups de cœur, ou s\'abstient sur un ami. Secret jusqu\'à la clôture ; le tableau de bord dit qui n\'a pas encore voté.' },
    { cible: '#btn-delib', titre: 'Délibérer',
      texte: 'Le plein écran pour la réunion, avec le nombre de retenus et ceux qui restent à discuter.' },
  ],
  planning: [
    { cible: '#mode-planning', titre: 'Entretiens, dispos, ou les deux',
      texte: 'Les <strong>dispos</strong> colorent la grille : plus c\'est foncé, plus il y a de staffeurs libres. Juste à côté : un jour, la semaine ou toute la période.' },
    { cible: '.planning-cell[data-iv-id]', titre: 'Un entretien',
      texte: 'Cliquez pour choisir les staffeurs (🇬🇧 = parle anglais), la salle, cocher « en anglais » et prendre des notes privées.' },
    { cible: '#planning-table td.pl-libre', titre: 'Placer quelqu\'un ici',
      texte: 'Un clic sur une case libre : les staffeurs dispos, et les cooptants sans entretien à y placer. Les staffeurs sont proposés tout seuls.' },
    { cible: '#btn-optimiser', titre: 'Optimiser',
      texte: 'Redistribue les staffeurs des entretiens à venir pour éviter de faire venir quelqu\'un pour un seul entretien. Les heures ne bougent jamais, et vous validez chaque changement.' },
  ],
  parametres: [
    { cible: '[role="tablist"]', titre: 'Un onglet par question',
      texte: '<strong>Quand ?</strong> les dates et créneaux, <strong>Comment ?</strong> la prise de rendez-vous et les salles, <strong>Qui ?</strong> les staffeurs. Puis le formulaire, l\'évaluation, l\'accès et la corbeille.' },
    { cible: '#apercu-quand', titre: 'En clair',
      texte: 'Chaque bloc résume en phrases ce que donnent vos réglages, avant même de quitter la page.' },
    { cible: '.param-outils', titre: 'Chercher, sans rien enregistrer',
      texte: 'Tapez « anglais », « salle » ou « délai » : la page vous y emmène. Pas de bouton Enregistrer : chaque changement part tout seul, l\'heure s\'affiche ici.' },
  ],
};

/** Visite générale, pour « Revoir la présentation » sur une page sans visite propre. */
const GENERALE = [
  { titre: 'Cooptly en bref',
    texte: 'Paramètres pour régler, Tableau de bord pour diffuser les liens, Planning pour les entretiens, Cooptants pour évaluer et délibérer. Chaque page a sa mini-visite.' },
];

function pageCourante() {
  const p = location.pathname;
  if (p.endsWith('/secge/dashboard.html')) return 'dashboard';
  if (p.endsWith('/secge/candidats.html')) return document.body.dataset.vue === 'classement' ? 'classement' : 'candidats';
  if (p.endsWith('/planning.html'))        return 'planning';
  if (p.endsWith('/parametres.html'))      return 'parametres';
  return null;
}

/**
 * Pages où la visite a du sens : celles du bureau, en pleine page. Pas les
 * pages admin, ni `rejoindre.html`, ni les iframes (panneau d'évaluation).
 */
function pageAdaptee() {
  if (window.self !== window.top) return false;
  const p = location.pathname;
  return !p.startsWith('/admin/') && !p.endsWith('/rejoindre.html');
}

const cleLocale = (uid, page) => `_tuto_${uid}_${page}`;

async function dejaVu(user, page) {
  try {
    if (Number(localStorage.getItem(cleLocale(user.uid, page))) >= TUTO_VERSION) return true;
  } catch { /* stockage bloqué : on retombe sur Firestore */ }
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const vu = Number(snap.data()?.tutoPages?.[page] || 0) >= TUTO_VERSION;
    if (vu) { try { localStorage.setItem(cleLocale(user.uid, page), String(TUTO_VERSION)); } catch {} }
    return vu;
  } catch {
    // Profil illisible : mieux vaut ne rien montrer que de répéter la visite.
    return true;
  }
}

async function marquerVu(user, page) {
  if (!page) return;
  try { localStorage.setItem(cleLocale(user.uid, page), String(TUTO_VERSION)); } catch {}
  try {
    await setDoc(doc(db, 'users', user.uid),
      { tutoPages: { [page]: TUTO_VERSION }, tutoVuLe: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.warn('Visite guidée : « déjà vu » non enregistré dans le profil', e);
  }
}

/** L'élément est-il affiché (ni masqué, ni de taille nulle) ? */
function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** Premier élément visible parmi les sélecteurs de l'étape (sinon le premier présent). */
function trouver(cible) {
  const liste = [].concat(cible).map(s => document.querySelector(s)).filter(Boolean);
  return liste.find(visible) || liste[0] || null;
}

/** Attend qu'un élément apparaisse (données chargées après la visite). */
function attendre(selecteur, delaiMs) {
  return new Promise(res => {
    const debut = Date.now();
    const tour = () => {
      const el = trouver(selecteur);
      if (visible(el)) return res(el);
      if (Date.now() - debut > delaiMs) return res(null);
      setTimeout(tour, 150);
    };
    tour();
  });
}

/**
 * Affiche la visite de la page si la personne ne l'a pas encore vue.
 * @param {import('firebase/auth').User} user
 */
export async function afficherTutoSiBesoin(user) {
  const page = pageCourante();
  if (!user || !page || !pageAdaptee()) return;
  if (await dejaVu(user, page)) return;
  // Les éléments à éclairer arrivent avec les données de la page : on attend
  // que le premier soit là (au plus quelques secondes).
  const premiere = VISITES[page].find(e => e.cible);
  if (premiere) await attendre(premiere.cible, 6000);
  // La page vérifiée, pas celle du moment : la vue a pu changer entre-temps.
  if (pageCourante() === page) ouvrirTuto(user, page);
}

/**
 * Ouvre la visite de la page, vue ou non (menu ☰ → « Revoir la présentation »).
 * @param {import('firebase/auth').User} user
 */
export function ouvrirTuto(user, page = pageCourante()) {
  if (document.getElementById('tuto-overlay')) return;
  const etapes = page ? VISITES[page] : GENERALE;
  const retourFocus = document.activeElement;
  let i = 0;
  let cibleCourante = null;

  const overlay = document.createElement('div');
  overlay.id = 'tuto-overlay';
  overlay.className = 'tuto-spot-mode';
  overlay.innerHTML = `
    <div class="tuto-voile" data-v="haut" aria-hidden="true"></div>
    <div class="tuto-voile" data-v="bas" aria-hidden="true"></div>
    <div class="tuto-voile" data-v="gauche" aria-hidden="true"></div>
    <div class="tuto-voile" data-v="droite" aria-hidden="true"></div>
    <div class="tuto-spot" aria-hidden="true"></div>
    <div class="tuto-bulle" role="dialog" aria-modal="true" aria-labelledby="tuto-titre" aria-describedby="tuto-texte">
      <div class="tuto-fleche" aria-hidden="true"></div>
      <div class="tuto-compteur"></div>
      <h2 id="tuto-titre"></h2>
      <p id="tuto-texte"></p>
      <div class="tuto-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="passer">Passer</button>
        <div class="tuto-nav">
          <button type="button" class="btn btn-ghost btn-sm" data-act="prec">Précédent</button>
          <button type="button" class="btn btn-primary btn-sm" data-act="suiv">Suivant</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const $ = s => overlay.querySelector(s);
  const spot = $('.tuto-spot'), bulle = $('.tuto-bulle'), fleche = $('.tuto-fleche');
  const voiles = Object.fromEntries([...overlay.querySelectorAll('.tuto-voile')].map(v => [v.dataset.v, v]));
  /** Quatre voiles sombres autour de la zone éclairée (plus fiable qu'une ombre géante). */
  const voiler = (x, y, l, h) => {
    const vw = window.innerWidth, vh = window.innerHeight;
    Object.assign(voiles.haut.style,   { left: '0', top: '0', width: `${vw}px`, height: `${Math.max(0, y)}px` });
    Object.assign(voiles.bas.style,    { left: '0', top: `${y + h}px`, width: `${vw}px`, height: `${Math.max(0, vh - y - h)}px` });
    Object.assign(voiles.gauche.style, { left: '0', top: `${y}px`, width: `${Math.max(0, x)}px`, height: `${h}px` });
    Object.assign(voiles.droite.style, { left: `${x + l}px`, top: `${y}px`, width: `${Math.max(0, vw - x - l)}px`, height: `${h}px` });
  };

  /** Place l'éclairage autour de la cible, et la bulle dessous (ou dessus). */
  const placer = () => {
    if (!cibleCourante || !visible(cibleCourante)) {
      overlay.classList.add('sans-cible');
      spot.style.display = 'none'; fleche.style.display = 'none';
      voiler(0, 0, 0, 0);
      bulle.style.left = '50%'; bulle.style.top = '50%'; bulle.style.transform = 'translate(-50%, -50%)';
      return;
    }
    overlay.classList.remove('sans-cible');
    const vw = window.innerWidth, vh = window.innerHeight;
    // Zone éclairée bornée à l'écran : un grand élément (longue liste) ne doit
    // pas repousser la bulle hors de la vue.
    const brut = cibleCourante.getBoundingClientRect();
    const r = {
      left: Math.max(0, brut.left), right: Math.min(vw, brut.right),
      top: Math.max(0, brut.top),   bottom: Math.min(vh, brut.bottom),
    };
    r.width = Math.max(0, r.right - r.left); r.height = Math.max(0, r.bottom - r.top);
    const marge = 6;
    Object.assign(spot.style, {
      display: 'block', left: `${r.left - marge}px`, top: `${r.top - marge}px`,
      width: `${r.width + marge * 2}px`, height: `${r.height + marge * 2}px`,
    });
    voiler(r.left - marge, r.top - marge, r.width + marge * 2, r.height + marge * 2);
    const lb = bulle.offsetWidth, hb = bulle.offsetHeight;
    const placeDessous = vh - (r.bottom + marge + 14), placeDessus = r.top - marge - 14;
    const dessous = placeDessous >= hb + 8 || placeDessous >= placeDessus;
    let left = r.left + r.width / 2 - lb / 2;
    left = Math.max(10, Math.min(vw - lb - 10, left));
    let top = dessous ? r.bottom + marge + 14 : r.top - marge - 14 - hb;
    // Toujours entièrement visible, même si l'élément occupe tout l'écran.
    top = Math.max(10, Math.min(vh - hb - 10, top));
    Object.assign(bulle.style, { left: `${left}px`, top: `${top}px`, transform: 'none' });
    // La flèche vise le milieu de la cible, bornée aux bords de la bulle.
    const fx = Math.max(16, Math.min(lb - 16, r.left + r.width / 2 - left));
    fleche.style.display = 'block';
    fleche.style.left = `${fx - 8}px`;
    fleche.className = `tuto-fleche ${dessous ? 'haut' : 'bas'}`;
  };

  const dessiner = async () => {
    const e = etapes[i];
    cibleCourante = e.cible ? trouver(e.cible) : null;
    // Étape dont l'élément n'est pas à l'écran (tableau vide…) : on la saute.
    // Présent mais masqué (rien sur téléphone) : tout de suite. Absent : il
    // arrive peut-être avec les données, on l'attend un peu.
    if (e.cible && !visible(cibleCourante)) {
      cibleCourante = cibleCourante ? null : await attendre(e.cible, 600);
      if (!cibleCourante && i < etapes.length - 1) { i++; return dessiner(); }
    }
    if (cibleCourante) {
      // Élément plus haut que l'écran : on amène son HAUT en vue, avec de la
      // place au-dessus pour la bulle, plutôt que son milieu.
      const hEl = cibleCourante.getBoundingClientRect().height;
      if (hEl > window.innerHeight * 0.6) {
        const y = window.scrollY + cibleCourante.getBoundingClientRect().top - 220;
        window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
      } else {
        cibleCourante.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }
    // Compteur sur les étapes qu'on peut vraiment montrer ici (pas de « 6 / 8 »
    // suivi de « 8 / 8 » quand une étape n'existe pas sur cet écran).
    const montrables = etapes.filter((x, k) => k === i || !x.cible || visible(trouver(x.cible)));
    $('.tuto-compteur').textContent = `${montrables.indexOf(e) + 1} / ${montrables.length}`;
    $('#tuto-titre').textContent = e.titre;
    $('#tuto-texte').innerHTML = e.texte;   // contenu statique, défini ci-dessus
    const derniere = i === etapes.length - 1;
    $('[data-act="prec"]').style.visibility = i === 0 ? 'hidden' : 'visible';
    $('[data-act="suiv"]').textContent = derniere ? 'C\'est parti' : 'Suivant';
    $('[data-act="passer"]').style.visibility = derniere ? 'hidden' : 'visible';
    placer();
    $('[data-act="suiv"]').focus();
  };

  const fermer = () => {
    document.removeEventListener('keydown', surTouche);
    window.removeEventListener('resize', placer);
    window.removeEventListener('scroll', placer, true);
    overlay.classList.add('sortie');
    setTimeout(() => overlay.remove(), 160);
    // « Passer » compte comme vu : sinon la visite reviendrait à chaque fois.
    marquerVu(user, page);
    retourFocus?.focus?.();
  };
  const suivant   = () => { if (i < etapes.length - 1) { i++; dessiner(); } else fermer(); };
  const precedent = () => {
    if (i === 0) return;
    // Revenir en arrière en sautant les étapes sans élément à l'écran.
    let j = i - 1;
    while (j > 0 && etapes[j].cible && !visible(trouver(etapes[j].cible))) j--;
    i = j; dessiner();
  };

  const surTouche = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); fermer(); }
    else if (ev.key === 'ArrowRight') suivant();
    else if (ev.key === 'ArrowLeft') precedent();
    else if (ev.key === 'Tab') {
      const cibles = [...bulle.querySelectorAll('button')].filter(b => b.style.visibility !== 'hidden');
      if (!cibles.length) return;
      const premier = cibles[0], dernier = cibles[cibles.length - 1];
      if (ev.shiftKey && document.activeElement === premier) { ev.preventDefault(); dernier.focus(); }
      else if (!ev.shiftKey && document.activeElement === dernier) { ev.preventDefault(); premier.focus(); }
    }
  };

  $('[data-act="suiv"]').addEventListener('click', suivant);
  $('[data-act="prec"]').addEventListener('click', precedent);
  $('[data-act="passer"]').addEventListener('click', fermer);
  document.addEventListener('keydown', surTouche);
  window.addEventListener('resize', placer);
  window.addEventListener('scroll', placer, true);
  dessiner();
}
