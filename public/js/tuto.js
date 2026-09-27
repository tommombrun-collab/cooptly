/**
 * Visite guidée affichée à la première connexion d'un membre du bureau.
 *
 * Montrée UNE fois par personne, pas à chaque connexion. Le « déjà vu » est
 * rangé dans le profil `users/{uid}.tutoVu`, donc il suit la personne d'un
 * appareil à l'autre. `localStorage` sert de cache pour ne pas relire le
 * profil sur chaque page.
 *
 * `TUTO_VERSION` permet de remontrer la visite à tout le monde après un gros
 * changement : il suffit de l'incrémenter. Les profils existants n'ont pas le
 * champ, donc la première version s'affiche à la prochaine connexion de chacun.
 */
import { app } from './auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const db = getFirestore(app);

export const TUTO_VERSION = 1;

const cleLocale = uid => `_tuto_${uid}`;

const ETAPES = [
  {
    icone: '👋',
    titre: 'Bienvenue sur Cooptly',
    texte: 'La plateforme qui organise vos cooptations de bout en bout : candidatures, entretiens, évaluations et délibérations. Voici l\'essentiel en une minute.',
  },
  {
    icone: '⚙️',
    titre: 'Réglez votre recrutement',
    texte: 'Tout commence dans <strong>Paramètres</strong> : période d\'entretiens, durée, nombre de jurés, questions du formulaire et critères d\'évaluation. Ça se règle une fois, au début.',
  },
  {
    icone: '🗓',
    titre: 'Récoltez les dispos du staff',
    texte: 'Partagez le <strong>lien de disponibilités</strong> à votre bureau : chacun coche ses créneaux, sans créer de compte. Vous pouvez aussi vous en passer, dans les paramètres.',
  },
  {
    icone: '📣',
    titre: 'Diffusez le formulaire',
    texte: 'Depuis le <strong>tableau de bord</strong>, copiez le lien de cooptation ou affichez son QR code. Les cooptants postulent et réservent leur entretien eux-mêmes.',
  },
  {
    icone: '🎙',
    titre: 'Entretiens et évaluations',
    texte: 'Le <strong>planning</strong> se remplit tout seul et les jurés sont attribués automatiquement. Après chaque entretien, le jury remplit la fiche d\'évaluation, même sans compte.',
  },
  {
    icone: '🗳',
    titre: 'Délibérez',
    texte: 'Dans <strong>Cooptants</strong>, le classement part des évaluations. Passez en mode délibération pour réordonner en réunion et relire chaque dossier.',
    pied: 'Tout est détaillé dans l\'<a href="/aide.html">aide</a>, accessible à tout moment par le bouton <strong>?</strong> en haut.',
  },
];

/**
 * Les pages où la visite a du sens : celles du bureau, affichées en pleine
 * page. Les pages admin parlent d'autre chose, et `evaluer.html` s'ouvre aussi
 * dans un panneau latéral en iframe, où une fenêtre modale n'aurait rien à faire.
 */
function pageAdaptee() {
  if (window.self !== window.top) return false;
  const p = location.pathname;
  return !p.startsWith('/admin/') && !p.endsWith('/rejoindre.html');
}

/** L'utilisateur a-t-il déjà vu la version courante ? */
async function dejaVu(user) {
  try {
    if (Number(localStorage.getItem(cleLocale(user.uid))) >= TUTO_VERSION) return true;
  } catch { /* stockage bloqué : on retombe sur Firestore */ }

  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const vu = Number(snap.data()?.tutoVu || 0) >= TUTO_VERSION;
    if (vu) { try { localStorage.setItem(cleLocale(user.uid), String(TUTO_VERSION)); } catch {} }
    return vu;
  } catch {
    // Profil illisible (réseau, règles) : mieux vaut ne rien montrer que de
    // risquer d'afficher la visite à chaque connexion.
    return true;
  }
}

/** Mémorise que la visite a été vue, dans le profil et en local. */
async function marquerVu(user) {
  try { localStorage.setItem(cleLocale(user.uid), String(TUTO_VERSION)); } catch {}
  try {
    await setDoc(doc(db, 'users', user.uid),
      { tutoVu: TUTO_VERSION, tutoVuLe: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.warn('Visite guidée : « déjà vu » non enregistré dans le profil', e);
  }
}

/**
 * Affiche la visite si la personne ne l'a pas encore vue. Sans effet sinon.
 * N'attend pas la fermeture : la page reste utilisable derrière.
 * @param {import('firebase/auth').User} user
 */
export async function afficherTutoSiBesoin(user) {
  if (!user || !pageAdaptee()) return;
  if (await dejaVu(user)) return;
  ouvrirTuto(user);
}

/**
 * Ouvre la visite, qu'elle ait été vue ou non (bouton « Revoir la présentation »).
 * @param {import('firebase/auth').User} user
 */
export function ouvrirTuto(user) {
  if (document.getElementById('tuto-overlay')) return;   // déjà ouverte

  const retourFocus = document.activeElement;
  let etape = 0;

  const overlay = document.createElement('div');
  overlay.id = 'tuto-overlay';
  overlay.innerHTML = `
    <div id="tuto" role="dialog" aria-modal="true" aria-labelledby="tuto-titre" aria-describedby="tuto-texte">
      <div class="tuto-icone" aria-hidden="true"></div>
      <div class="tuto-compteur"></div>
      <h2 id="tuto-titre"></h2>
      <p id="tuto-texte"></p>
      <p class="tuto-pied"></p>
      <div class="tuto-points" aria-hidden="true">
        ${ETAPES.map(() => '<span></span>').join('')}
      </div>
      <div class="tuto-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="passer">Passer</button>
        <div class="tuto-nav">
          <button type="button" class="btn btn-ghost btn-sm" data-act="prec">Précédent</button>
          <button type="button" class="btn btn-primary btn-sm" data-act="suiv">Suivant</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = sel => overlay.querySelector(sel);
  const btnPrec = $('[data-act="prec"]');
  const btnSuiv = $('[data-act="suiv"]');
  const btnPasser = $('[data-act="passer"]');

  const dessiner = () => {
    const e = ETAPES[etape];
    const derniere = etape === ETAPES.length - 1;
    $('.tuto-icone').textContent = e.icone;
    $('.tuto-compteur').textContent = `${etape + 1} / ${ETAPES.length}`;
    $('#tuto-titre').textContent = e.titre;
    $('#tuto-texte').innerHTML = e.texte;       // contenu statique, défini ci-dessus
    const pied = $('.tuto-pied');
    pied.innerHTML = e.pied || '';
    pied.hidden = !e.pied;
    overlay.querySelectorAll('.tuto-points span').forEach((p, i) =>
      p.classList.toggle('actif', i === etape));
    btnPrec.style.visibility = etape === 0 ? 'hidden' : 'visible';
    btnSuiv.textContent = derniere ? 'C\'est parti' : 'Suivant';
    // Sur la dernière étape, « Passer » n'a plus de sens : le bouton principal ferme.
    btnPasser.style.visibility = derniere ? 'hidden' : 'visible';
    btnSuiv.focus();
  };

  const fermer = () => {
    document.removeEventListener('keydown', surTouche);
    overlay.classList.add('sortie');
    setTimeout(() => overlay.remove(), 160);
    // « Passer » compte comme vu : sinon la visite revient à chaque connexion.
    marquerVu(user);
    retourFocus?.focus?.();
  };

  const surTouche = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); fermer(); }
    else if (ev.key === 'ArrowRight' && etape < ETAPES.length - 1) { etape++; dessiner(); }
    else if (ev.key === 'ArrowLeft' && etape > 0) { etape--; dessiner(); }
    else if (ev.key === 'Tab') {
      // Garder le focus dans la fenêtre tant qu'elle est ouverte.
      const cibles = [...overlay.querySelectorAll('button, a[href]')]
        .filter(el => el.offsetParent !== null && el.style.visibility !== 'hidden');
      if (!cibles.length) return;
      const premier = cibles[0], dernier = cibles[cibles.length - 1];
      if (ev.shiftKey && document.activeElement === premier) { ev.preventDefault(); dernier.focus(); }
      else if (!ev.shiftKey && document.activeElement === dernier) { ev.preventDefault(); premier.focus(); }
    }
  };

  btnPrec.addEventListener('click', () => { if (etape > 0) { etape--; dessiner(); } });
  btnSuiv.addEventListener('click', () => {
    if (etape < ETAPES.length - 1) { etape++; dessiner(); } else fermer();
  });
  btnPasser.addEventListener('click', fermer);
  // Un clic à côté ne ferme PAS : on ne veut pas perdre la visite par
  // inadvertance, surtout qu'elle ne réapparaîtra plus ensuite.
  document.addEventListener('keydown', surTouche);

  dessiner();
}
