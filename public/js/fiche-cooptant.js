/**
 * Fiche d'un cooptant : LE seul endroit où tout est réuni, ouvert depuis le
 * tableau de bord, la page Cooptants (liste et classement) et le planning.
 *
 * Trois onglets :
 *  - Profil : contact, entretien (Déplacer, vers le planning), salle, jury, réponses
 *    au formulaire, dispos déclarées ; « Modifier le profil » se fait ici ;
 *  - Évaluations : score, critères, retours du jury, « Remplir la fiche » ;
 *  - Note interne : la note privée du bureau (et celle de l'entretien).
 * En bas : statut, suppression (corbeille), ↑/↓ pour passer au suivant.
 * Salle et staffeurs se changent dans le Profil (« Changer ») ; `onChange(c,
 * { entretiens })` donne alors à la page les entretiens modifiés.
 *
 * La fiche relit elle-même entretien, évaluations et notes : la page qui
 * l'ouvre n'a besoin que du cooptant et de la campagne.
 */
import { app } from './auth.js';
import { getFirestore, collection, query, where, getDocs, getDoc, doc, updateDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { esc, showToast, formatDatetime, confirmDialog, telephoneCooptant, reponsesOrdonnees,
  reponseA, texteReponse, cleReponse, regrouperMembres, PARCOURS, parcoursCooptant, estQuestionParcours, normaliserParcours } from './utils.js';
import { calculerScores } from './score.js';
import { enregistrerNote, idNoteCooptant, idNoteEntretien } from './notes.js';
import { cooptantEnCorbeille, mettreEnCorbeille, DUREE_CORBEILLE_JOURS } from './corbeille.js';
import { getPlanningDays, campaignConfig } from './utils.js';
import { heuresGrille, enSecours, parleAnglais } from './capacite.js';
import { signalerAbsence, absencesDuCooptant, absentAuCreneau, libelleAbsences } from './absences.js';
import { icone } from './icones.js';

const db = getFirestore(app);

const STATUTS = [['recu', 'Reçu', 'badge-gray'], ['place', 'Placé', 'badge-blue'], ['entretien_fait', 'Entretien passé', 'badge-green']];

/** Couleur d'un score en %, comme sur la page Cooptants. */
export function couleurScore(pct) {
  if (pct == null) return 'var(--text-light)';
  if (pct >= 70) return 'var(--green)';
  if (pct >= 45) return 'var(--orange)';
  return 'var(--red)';
}

// ── Noms des jurés : liste du staff, puis dispos déposées ────────────
const cacheNoms = new Map();
export function nomJure(id) {
  if (!cacheNoms.has(id)) {
    cacheNoms.set(id, (async () => {
      try {
        const r = await getDoc(doc(db, 'roster_members', id));
        if (r.exists() && r.data().displayName) return r.data().displayName;
        const sa = await getDocs(query(collection(db, 'staff_availabilities'), where('userId', '==', id)));
        return sa.docs.map(d => d.data().displayName).find(Boolean) || null;
      } catch { return null; }
    })());
  }
  return cacheNoms.get(id);
}
export const nomsJures = ids => Promise.all(ids.map(nomJure));

// ── Fenêtre (créée une fois) ─────────────────────────────────────────
let racine = null;
function fenetre() {
  if (racine) return racine;
  racine = document.createElement('div');
  racine.className = 'fiche-overlay';
  racine.innerHTML = `
    <div class="fiche" role="dialog" aria-modal="true" aria-labelledby="fiche-nom">
      <div class="fiche-tete">
        <div style="min-width:0;flex:1;">
          <h3 id="fiche-nom"></h3>
          <div class="fiche-sous" id="fiche-sous"></div>
        </div>
        <div class="fiche-nav">
          <button type="button" class="fiche-btn-icone" data-nav="-1" title="Cooptant précédent (↑)" aria-label="Cooptant précédent">↑</button>
          <span class="fiche-pos" id="fiche-pos"></span>
          <button type="button" class="fiche-btn-icone" data-nav="1" title="Cooptant suivant (↓)" aria-label="Cooptant suivant">↓</button>
          <button type="button" class="fiche-btn-icone" data-fermer title="Fermer (Échap)" aria-label="Fermer">✕</button>
        </div>
      </div>
      <div class="fiche-onglets" role="tablist">
        <button type="button" role="tab" data-onglet="profil" aria-selected="true">Profil</button>
        <button type="button" role="tab" data-onglet="evals" aria-selected="false">Évaluations <span id="fiche-nb-evals"></span></button>
        <button type="button" role="tab" data-onglet="note" aria-selected="false">Note interne <span id="fiche-a-note"></span></button>
      </div>
      <div class="fiche-corps" id="fiche-corps"></div>
      <div class="fiche-pied">
        <label class="fiche-statut">Statut
          <select class="form-select" id="fiche-statut" aria-label="Statut du cooptant">
            ${STATUTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="btn btn-ghost btn-sm fiche-suppr" id="fiche-suppr">Supprimer</button>
        <button type="button" class="btn btn-secondary btn-sm" data-fermer style="margin-left:auto;">Fermer</button>
      </div>
    </div>`;
  document.body.appendChild(racine);

  racine.addEventListener('click', e => { if (e.target === racine) fermerFiche(); });
  racine.querySelectorAll('[data-fermer]').forEach(b => b.addEventListener('click', fermerFiche));
  racine.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => naviguer(Number(b.dataset.nav))));
  racine.querySelectorAll('[data-onglet]').forEach(b => b.addEventListener('click', () => montrerOnglet(b.dataset.onglet)));
  racine.querySelector('#fiche-statut').addEventListener('change', changerStatut);
  racine.querySelector('#fiche-suppr').addEventListener('click', supprimer);
  document.addEventListener('keydown', e => {
    if (!etat) return;
    // Échap en plein écran (délibération) : le navigateur en sort d'abord, on
    // ne ferme pas la fiche du même coup.
    if (e.key === 'Escape') { if (!document.fullscreenElement) fermerFiche(); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft')   { e.preventDefault(); naviguer(-1); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); naviguer(1); }
  });
  return racine;
}

/** État de la fiche ouverte. */
let etat = null;

/**
 * Ouvre la fiche d'un cooptant.
 * @param {object} c cooptant (document `candidates` avec son `id`)
 * @param {object} o
 * @param {object} o.org        asso courante ({ id, slug… })
 * @param {object} o.campaign   campagne (questions, critères)
 * @param {() => object[]} [o.liste] cooptants dans l'ordre affiché, pour ↑/↓
 * @param {(c: object) => void} [o.onChange]   après un changement (statut, profil, note)
 * @param {(id: string) => void} [o.onSupprime] après la mise en corbeille
 * @param {(c: object) => void} [o.ouvrirEvaluation] « Remplir la fiche d'entretien »
 * @param {string} [o.onglet] onglet à ouvrir ('profil', 'evals', 'note')
 * @param {string} [o.par] email de la personne connectée (corbeille)
 */
export async function ouvrirFiche(c, o = {}) {
  enregistrerNoteOuverte();
  const r = fenetre();
  document.getElementById('fiche-corps').innerHTML = '';
  etat = { c, o, ivs: [], evals: [], absences: [], note: '', notesIv: [], notes: new Map(), charge: false,
           declencheur: etat?.declencheur || document.activeElement };
  r.classList.add('open');
  document.body.classList.add('fiche-on');
  enTete();
  montrerOnglet(o.onglet || etat.ongletCourant || 'profil');
  await charger();
}

export function fermerFiche() {
  if (!etat) return;
  enregistrerNoteOuverte();
  racine?.classList.remove('open');
  document.body.classList.remove('fiche-on');
  const retour = etat.declencheur;
  etat = null;
  retour?.focus?.();
}

/** Recharge la fiche ouverte (après une évaluation, par exemple). */
export function rafraichirFiche() { if (etat) charger(); }

async function charger() {
  const { c, o } = etat;
  const orgId = c.organizationId || o.org?.id;
  const moi = etat;
  try {
    const [ivSnap, evalSnap, noteDoc, absences] = await Promise.all([
      getDocs(query(collection(db, 'interviews'), where('candidateId', '==', c.id))),
      // Filtre par asso indispensable : les règles ne sont pas des filtres.
      getDocs(query(collection(db, 'interview_evaluations'),
        where('organizationId', '==', orgId), where('candidateId', '==', c.id))),
      getDoc(doc(db, 'notes_internes', idNoteCooptant(c.id))).catch(() => null),
      absencesDuCooptant(db, orgId, c.id),
    ]);
    if (etat !== moi) return;
    etat.absences = absences;
    etat.ivs = ivSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(iv => iv.datetimeStart?.toDate)
      .sort((a, b) => a.datetimeStart.toMillis() - b.datetimeStart.toMillis());
    etat.evals = evalSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    etat.note = noteDoc?.exists?.() ? (noteDoc.data().texte || '') : '';
    etat.ajustement = noteDoc?.exists?.() ? (Number(noteDoc.data().ajustement) || 0) : 0;
    if (noteDoc?.exists?.()) etat.notes.set(noteDoc.id, { id: noteDoc.id, data: noteDoc.data() });
    const notesIv = await Promise.all(etat.ivs.map(iv =>
      getDoc(doc(db, 'notes_internes', idNoteEntretien(iv.id))).catch(() => null)));
    if (etat !== moi) return;
    etat.notesIv = notesIv.filter(n => n?.exists?.() && n.data().texte).map(n => n.data().texte);
    calculerScores(o.campaign?.interviewCriteria || [], [c], etat.evals);
    etat.charge = true;
    enTete();
    montrerOnglet(etat.ongletCourant);
  } catch (err) {
    console.error(err);
    if (etat === moi) {
      document.getElementById('fiche-corps').innerHTML =
        `<p class="text-sm" style="color:var(--red);">Fiche incomplète : ${esc(err.message)}</p>`;
    }
  }
}

function nomDe(c) { return `${c.prenom || ''} ${c.nom || ''}`.trim() || c.email || 'Cooptant'; }

function enTete() {
  const { c, o } = etat;
  document.getElementById('fiche-nom').innerHTML = esc(nomDe(c))
    + (c.langue === 'en' ? ' <span class="badge" title="Entretien en anglais">🇬🇧 EN</span>' : '')
    + (c.source === 'stand' ? ` <span class="badge" title="Inscrit·e sur un stand">${icone('stand')} Stand</span>` : '')
    + (etat.absences.length ? ` <span class="badge badge-red" title="Ne s'est pas présenté·e à un entretien">${libelleAbsences(etat.absences.length)}</span>` : '');
  const score = c._score != null
    ? `<span class="fiche-score" style="color:${couleurScore(c._score)};">${c._score} %</span>`
    : (c._partiel ? `<span class="badge badge-orange">${c._nbCriteresNotes}/${c._nbCriteresTotal} critères</span>`
    : (c._noteGlobaleAvg != null ? `<span class="fiche-score">${c._noteGlobaleAvg}/20</span>` : ''));
  document.getElementById('fiche-sous').innerHTML = [
    score,
    c.createdAt ? `<span>Candidature reçue le ${esc(formatDatetime(c.createdAt))}</span>` : '',
  ].filter(Boolean).join('');
  document.getElementById('fiche-statut').value = c.statut || 'recu';
  document.getElementById('fiche-nb-evals').textContent = etat.charge ? `(${etat.evals.length})` : '';
  document.getElementById('fiche-a-note').textContent = etat.note ? '•' : '';

  const liste = o.liste?.() || [];
  const i = liste.findIndex(x => x.id === c.id);
  const nav = racine.querySelector('.fiche-nav');
  nav.querySelector('[data-nav="-1"]').disabled = i <= 0;
  nav.querySelector('[data-nav="1"]').disabled = i < 0 || i >= liste.length - 1;
  nav.querySelectorAll('[data-nav]').forEach(b => { b.hidden = liste.length < 2; });
  document.getElementById('fiche-pos').textContent = i >= 0 && liste.length > 1 ? `${i + 1}/${liste.length}` : '';
}

function naviguer(delta) {
  if (!etat?.o.liste) return;
  const liste = etat.o.liste();
  const i = liste.findIndex(x => x.id === etat.c.id);
  const suivant = liste[i + delta];
  if (suivant) ouvrirFiche(suivant, etat.o);
}

function montrerOnglet(nom) {
  enregistrerNoteOuverte();
  etat.ongletCourant = nom;
  racine.querySelectorAll('[data-onglet]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.onglet === nom)));
  const corps = document.getElementById('fiche-corps');
  if (nom === 'evals') corps.innerHTML = htmlEvaluations();
  else if (nom === 'note') corps.innerHTML = htmlNote();
  else corps.innerHTML = htmlProfil();
  corps.scrollTop = 0;
  brancher(corps, nom);
}

// `action` (facultatif) se place à droite du libellé : dans la valeur, il
// passait à la ligne dès que la date était un peu longue.
const tuile = (k, v, action = '') => `<div class="fiche-tuile"><div class="fiche-k">${k}${action}</div><div class="fiche-v">${v}</div></div>`;
const section = t => `<div class="fiche-section">${t}</div>`;

function htmlProfil() {
  const { c, o } = etat;
  const questions = o.campaign?.formConfig?.customQuestions || [];
  const tel = telephoneCooptant(c, questions);
  const iv = etat.ivs[0];
  // Dans le planning (`o.deplacer`), la grille passe directement en mode choix ;
  // ailleurs, le lien y mène (?allouer=).
  const crayon = (texte, libelle) => o.deplacer
    ? `<button type="button" class="fiche-crayon" data-act="deplacer" title="${libelle}">${texte}</button>`
    : `<a class="fiche-crayon" href="/planning.html?org=${encodeURIComponent(o.org?.id || '')}&allouer=${encodeURIComponent(c.id)}" title="${libelle}">${texte}</a>`;
  const tuiles = [];
  if (c.email) tuiles.push(tuile('Email', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`));
  const parcours = parcoursCooptant(c);
  tuiles.push(tuile('Parcours', parcours ? esc(parcours) : '<span class="text-muted">Non renseigné</span>'));
  if (tel) tuiles.push(tuile('Téléphone', `<a href="tel:${esc(tel.replace(/\s+/g, ''))}">${esc(tel)}</a>`));
  // Son lien personnel : le formulaire se rouvre prérempli et il choisit
  // lui-même un (nouveau) créneau. Pratique après une absence.
  const boutonLien = c.resultToken
    ? '<button type="button" class="fiche-crayon" data-act="lien-creneau" title="Copier son lien personnel : il choisit lui-même un nouveau créneau, le formulaire est déjà rempli">Son lien</button>' : '';
  if (!etat.charge) {
    tuiles.push(tuile('Entretien', '<span class="text-muted">…</span>'));
  } else if (!iv) {
    tuiles.push(tuile('Entretien', 'Pas encore planifié', `<span class="fiche-actions">${crayon('Placer', 'Choisir son horaire dans le planning')}${boutonLien}</span>`));
  } else {
    const s = iv.datetimeStart.toDate(), e = iv.datetimeEnd?.toDate?.();
    const hm = d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    // Une fois l'heure passée : « Absent·e » marque le créneau manqué.
    const absent = absentAuCreneau(etat.absences, iv);
    // Déjà évalué : il est venu, pas de « Absent·e ? ». Proposé avant l'heure
    // aussi (le cooptant a prévenu qu'il ne viendrait pas).
    const actions = (!absent && !etat.evals.length
      ? `<button type="button" class="fiche-crayon" data-act="absent" title="Le cooptant ne s'est pas présenté, ou a prévenu qu'il ne viendrait pas">Absent·e ?</button>` : '')
      + crayon('Déplacer', 'Choisir un nouvel horaire dans le planning')
      + boutonLien;
    tuiles.push(tuile('Entretien', `${esc(s.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}, ${hm(s)}${e ? ' - ' + hm(e) : ''}`
      + (absent ? `<div class="fiche-absent">Ne s'est pas présenté·e · <button type="button" class="fiche-crayon" data-act="annuler-absence" title="Retirer l'absence de ce créneau">Annuler</button></div>` : ''), `<span class="fiche-actions">${actions}</span>`));
    const changer = `<button type="button" class="fiche-crayon" data-act="salle-staff" title="Changer la salle et les staffeurs de cet entretien">Changer</button>`;
    tuiles.push(tuile('Salle', '<span data-fiche-salle class="text-muted">…</span>', changer));
    tuiles.push(tuile('Staffeurs', '<span data-fiche-jury class="text-muted">…</span>', changer));
  }

  // L'ancienne question « Parcours » de l'asso, même supprimée du formulaire
  // (sa réponse garde son libellé) : déjà dans la case Parcours.
  const libellesParcours = new Set(questions.filter(estQuestionParcours).map(q => q.label));
  const doublonParcours = (label, v) => libellesParcours.has(label)
    || (estQuestionParcours({ type: 'select', label }) && parcours && normaliserParcours(v) === parcours);
  const reps = reponsesOrdonnees(c, questions).filter(({ label, value }) => {
    const v = String(value ?? '').trim();
    return v !== '' && v !== tel && !doublonParcours(label, v);
  });
  let html = `<div class="fiche-grille">${tuiles.join('')}</div><div data-zone="salle-staff" hidden></div>`;
  // Absences passées : elles restent après un nouveau créneau (classement).
  const anciennes = etat.absences.filter(a => !(iv && absentAuCreneau([a], iv)));
  if (anciennes.length) {
    html += `<div class="fiche-alerte">${anciennes.map(a =>
      `<div>Absent·e à l'entretien du ${esc(formatDatetime(a.datetimeStart))}${a.par ? ` <span class="text-muted">(signalé par ${esc(a.par)})</span>` : ''}</div>`).join('')}</div>`;
  }
  html += `<div class="fiche-titre-ligne">${section('Réponses au formulaire')}
    <button type="button" class="btn btn-ghost btn-sm" data-act="modifier">${icone('crayon')}Modifier le profil</button></div>`;
  html += `<div class="fiche-reps" data-zone="reponses">${reps.length
    ? reps.map(({ label, value }) => `<div class="fiche-rep"><div class="fiche-k">${esc(label)}</div><div class="fiche-v fiche-texte">${esc(value)}</div></div>`).join('')
    : '<p class="text-sm text-muted" style="margin:0;">Aucune réponse au formulaire.</p>'}</div>`;

  if (c.disponibilites?.length) {
    html += section('Disponibilités déclarées');
    html += `<div class="fiche-dispos">${c.disponibilites.map(d => {
      const j = new Date(d.jour + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
      return `<div><span class="fiche-k">${esc(j)}</span> ${(d.creneaux || []).map(h => `<span class="fiche-puce">${esc(h)}</span>`).join('')}</div>`;
    }).join('')}</div>`;
  }
  return html;
}

function htmlEvaluations() {
  const { c } = etat;
  if (!etat.charge) return '<p class="text-sm text-muted">Chargement…</p>';
  const bouton = `<button type="button" class="btn btn-primary btn-sm" data-act="evaluer">${icone('micro')}Remplir la fiche d'entretien</button>`;
  if (!etat.evals.length) {
    if (absentAuCreneau(etat.absences, etat.ivs[0])) {
      return `<div class="fiche-vide"><p>Ne s'est pas présenté·e à l'entretien : rien à évaluer.</p></div>`;
    }
    return `<div class="fiche-vide"><p>Aucune évaluation pour le moment.</p>${bouton}</div>`;
  }
  let html = `<div class="fiche-titre-ligne"><div class="fiche-resume">
      ${c._score != null ? `<strong style="color:${couleurScore(c._score)};">${c._score} %</strong>` : ''}
      ${c._partiel ? `<span class="badge badge-orange" title="Le score apparaît quand la grille est remplie en entier">${c._nbCriteresNotes}/${c._nbCriteresTotal} critères notés</span>` : ''}
      ${c._noteGlobaleAvg != null ? `<span>Note globale : <strong>${c._noteGlobaleAvg}/20</strong></span>` : ''}
      <span class="text-muted">${c._nbEvals} évaluation${c._nbEvals > 1 ? 's' : ''}</span>
      ${c._decisions?.reserve ? `<span class="badge badge-orange">À revoir × ${c._decisions.reserve}</span>` : ''}
      ${etat.ajustement ? `<span title="Décidé en délibération, depuis le classement">Ajustement : <strong>${etat.ajustement > 0 ? '+' : '−'}${String(Math.abs(etat.ajustement)).replace('.', ',')}</strong></span>` : ''}
    </div>${bouton}</div>`;

  const crits = Object.values(c._criteriaAvgs || {});
  if (crits.length) {
    html += crits.map(cr => {
      const pct = Math.round(cr.normalized), col = couleurScore(pct);
      return `<div class="fiche-crit"><span class="fiche-crit-l" title="${esc(cr.label)}">${esc(cr.label)}</span>
        <div class="fiche-crit-piste"><div style="width:${pct}%;background:${col};"></div></div>
        <span class="fiche-crit-v" style="color:${col};">${cr.avg.toFixed(1)}/${cr.max}</span></div>`;
    }).join('');
  }
  (c._yesnoAnswers || []).forEach(yn => {
    html += `<div class="fiche-crit"><span class="fiche-crit-l">${esc(yn.label)}</span>
      <span class="fiche-puce" style="background:var(--green-light);color:var(--green);">✓ ${yn.oui}</span>
      ${yn.non ? `<span class="fiche-puce" style="background:var(--red-light);color:var(--red);">✗ ${yn.non}</span>` : ''}</div>`;
  });
  (c._choiceAnswers || []).forEach(ch => {
    html += section(esc(ch.label)) + `<div class="fiche-puces">${ch.items.map(i =>
      `<span class="fiche-puce">${esc(i.option)} <b>${i.n}/${ch.total}</b></span>`).join('')}</div>`;
  });
  (c._textAnswers || []).forEach(t => {
    html += section(esc(t.label)) + t.values.map(v => `<div class="fiche-citation">${esc(v)}</div>`).join('');
  });
  if (c._comments?.length) {
    html += section('Commentaires des staffeurs') + c._comments.map(cm => `<div class="fiche-citation">${esc(cm.text)}</div>`).join('');
  }
  return html;
}

function htmlNote() {
  if (!etat.charge) return '<p class="text-sm text-muted">Chargement…</p>';
  let html = `<label class="fiche-section" for="fiche-note" style="display:block;">Note sur le cooptant
      <span id="fiche-note-etat" class="fiche-etat" aria-live="polite"></span></label>
    <textarea class="form-textarea" id="fiche-note" data-cand="${esc(etat.c.id)}" rows="6" placeholder="Visible uniquement par le bureau">${esc(etat.note)}</textarea>`;
  if (etat.notesIv.length) {
    html += section("Note sur l'entretien (planning)") + etat.notesIv.map(t => `<div class="fiche-citation">${esc(t)}</div>`).join('');
  }
  return html;
}

function brancher(corps, nom) {
  const { c, o } = etat;
  corps.querySelector('[data-act="evaluer"]')?.addEventListener('click', () => {
    if (o.ouvrirEvaluation) return o.ouvrirEvaluation(c);
    // Le formulaire d'évaluation s'ouvre dans la fiche (evaluer.html en mode
    // panneau) ; il prévient la fiche quand il a enregistré (« eval-saved »).
    montrerOnglet('evals');
    const src = `/secge/evaluer.html?candidateId=${encodeURIComponent(c.id)}&campaignId=${encodeURIComponent(o.campaign?.id || '')}&panel=1`;
    corps.innerHTML = `<div class="fiche-titre-ligne"><div class="fiche-section" style="margin:0;">Fiche d'entretien</div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="retour-evals">Annuler</button></div>
      <iframe class="fiche-eval" src="${src}" title="Fiche d'entretien de ${esc(nomDe(c))}"></iframe>`;
    corps.querySelector('[data-act="retour-evals"]').addEventListener('click', () => montrerOnglet('evals'));
  });
  corps.querySelectorAll('[data-staff]').forEach(b => b.addEventListener('click', () =>
    ouvrirFicheStaffeur(b.dataset.staff, { org: o.org, campaign: o.campaign, nom: b.textContent.trim() })));
  corps.querySelector('[data-act="modifier"]')?.addEventListener('click', e => ouvrirEdition(corps, e.currentTarget));
  corps.querySelector('[data-act="absent"]')?.addEventListener('click', e => marquerAbsent(e.currentTarget));
  corps.querySelector('[data-act="deplacer"]')?.addEventListener('click', () => {
    const { c, o } = etat;
    fermerFiche();
    o.deplacer(c);
  });
  corps.querySelector('[data-act="annuler-absence"]')?.addEventListener('click', e => annulerAbsence(e.currentTarget));
  corps.querySelector('[data-act="lien-creneau"]')?.addEventListener('click', copierLienCreneau);
  corps.querySelectorAll('[data-act="salle-staff"]').forEach(b => b.addEventListener('click', () => ouvrirSalleStaff(corps)));
  if (nom === 'profil' && etat.charge && etat.ivs[0]) remplirSalleJury(etat.ivs[0]);
  if (nom === 'note') corps.querySelector('#fiche-note')?.addEventListener('blur', enregistrerNoteOuverte);
}

async function remplirSalleJury(iv) {
  const moi = etat;
  const ids = [iv.jury1Id, iv.jury2Id, iv.jury3Id].filter(Boolean);
  const [salle, noms] = await Promise.all([
    iv.roomId
      ? getDoc(doc(db, 'rooms', iv.roomId)).then(r => r.exists() ? (r.data().code || r.data().nom || r.data().name) : iv.salleNom).catch(() => iv.salleNom)
      : Promise.resolve(iv.salleNom || ''),
    nomsJures(ids),
  ]);
  if (etat !== moi) return;
  const zs = racine.querySelector('[data-fiche-salle]'), zj = racine.querySelector('[data-fiche-jury]');
  if (zs) { zs.className = ''; zs.innerHTML = salle ? esc(salle) : '<span style="color:var(--orange);">À définir</span>'; }
  if (zj) {
    zj.className = '';
    zj.innerHTML = ids.length ? ids.map((id, i) => `<button type="button" class="fiche-staff" data-staff="${esc(id)}" title="Fiche du staffeur">${esc(noms[i] || 'Staffeur')}</button>`).join(', ')
      : '<span style="color:var(--red);">À définir</span>';
    zj.querySelectorAll('[data-staff]').forEach(b => b.addEventListener('click', () =>
      ouvrirFicheStaffeur(b.dataset.staff, { org: etat?.o.org, campaign: etat?.o.campaign, nom: b.textContent.trim() })));
  }
}

// ── Salle et staffeurs, modifiables depuis la fiche ──────────────────
// Même lecture que le popup d'entretien du planning : une personne peut avoir
// un compte ET une entrée dans la liste du staff ; l'entrée de la liste est la
// référence (c'est elle que portent les dispos), le compte en est un alias.
const normNom = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function chargerStaffDeLEntretien(iv) {
  const { c, o } = etat;
  const orgId = c.organizationId || o.org?.id;
  const campId = o.campaign?.id || iv.campaignId;
  const [rosterSnap, saSnap, ivSnap, membres, sallesSnap] = await Promise.all([
    getDocs(query(collection(db, 'roster_members'), where('organizationId', '==', orgId))),
    getDocs(query(collection(db, 'staff_availabilities'), where('campaignId', '==', campId))),
    getDocs(query(collection(db, 'interviews'), where('campaignId', '==', campId))),
    getDocs(query(collection(db, 'memberships'), where('organizationId', '==', orgId)))
      .then(sn => regrouperMembres(sn.docs.map(d => ({ id: d.id, ...d.data() })), orgId)).catch(() => []),
    getDocs(query(collection(db, 'rooms'), where('organizationId', '==', orgId))).catch(() => ({ docs: [] })),
  ]);
  const dispos = saSnap.docs.map(d => d.data());
  const parNom = new Map(), canon = new Map();
  const ajouter = (id, nom) => {
    if (!id) return;
    const cle = normNom(nom) || `#${id}`;
    const p = parNom.get(cle);
    if (p) canon.set(id, p.id);
    else { parNom.set(cle, { id, nom: nom || 'Staffeur' }); canon.set(id, id); }
  };
  rosterSnap.docs.forEach(d => ajouter(d.id, d.data().displayName));
  membres.forEach(m => ajouter(m.userId, m.displayName || [m.firstName, m.lastName].filter(Boolean).join(' ')));
  dispos.forEach(sa => { if (!canon.has(sa.userId)) ajouter(sa.userId, sa.displayName); });
  const ref = id => canon.get(id) || id;
  return {
    personnes: [...parNom.values()], ref, dispos,
    entretiens: ivSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    salles: sallesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

async function ouvrirSalleStaff(corps) {
  const zone = corps.querySelector('[data-zone="salle-staff"]');
  const iv = etat.ivs[0];
  if (!zone || !iv) return;
  if (!zone.hidden) { zone.hidden = true; return; }
  zone.hidden = false;
  zone.innerHTML = '<p class="text-sm text-muted">Chargement des staffeurs…</p>';
  const moi = etat;
  let d;
  try { d = await chargerStaffDeLEntretien(iv); }
  catch (err) { zone.innerHTML = `<p class="text-sm" style="color:var(--red);">Staffeurs illisibles : ${esc(err.message)}</p>`; return; }
  if (etat !== moi) return;

  const cfg = campaignConfig(etat.o.campaign);
  const debut = iv.datetimeStart.toDate();
  const fin = iv.datetimeEnd?.toDate?.() || new Date(debut.getTime() + cfg.dureeMinutes * 60000);
  const jour = `${debut.getFullYear()}-${String(debut.getMonth() + 1).padStart(2, '0')}-${String(debut.getDate()).padStart(2, '0')}`;
  const dMin = debut.getHours() * 60 + debut.getMinutes(), fMin = dMin + Math.round((fin - debut) / 60000);
  const batt = cfg.battementMinutes || 0;
  const groupe = iv.groupId ? d.entretiens.filter(x => x.groupId === iv.groupId) : [iv];
  const duGroupe = new Set(groupe.map(x => x.id));

  // Pour chaque personne : dispo sur toute la durée, de secours, déjà en entretien, anglais.
  const etatDe = p => {
    const sas = d.dispos.filter(sa => d.ref(sa.userId) === p.id);
    const occupe = d.entretiens.some(x => !duGroupe.has(x.id) && x.datetimeStart?.toDate
      && x.datetimeStart.toDate() < new Date(fin.getTime() + batt * 60000)
      && (x.datetimeEnd?.toDate?.() || new Date(x.datetimeStart.toDate().getTime() + cfg.dureeMinutes * 60000)) > new Date(debut.getTime() - batt * 60000)
      && [x.jury1Id, x.jury2Id, x.jury3Id].filter(Boolean).map(d.ref).includes(p.id));
    let dispo = cfg.staffToujoursDispo ? true : sas.length ? false : null;
    if (!cfg.staffToujoursDispo && sas.length) {
      const heures = [];
      for (let h = Math.floor(dMin / 60); h <= Math.floor((fMin - 1) / 60); h++) heures.push(`${String(h).padStart(2, '0')}:00`);
      dispo = heures.every(hh => sas.some(sa => sa.creneaux?.find(x => x.jour === jour)?.creneaux?.includes(hh)));
    }
    return { dispo, occupe, rempli: sas.length > 0, secours: dispo === true && sas.some(sa => enSecours(sa, jour, dMin, fMin - dMin)), anglais: sas.some(parleAnglais) };
  };
  const actuels = new Set([iv.jury1Id, iv.jury2Id, iv.jury3Id].filter(Boolean).map(d.ref));
  const lignes = d.personnes.map(p => ({ p, ...etatDe(p), coche: actuels.has(p.id) }))
    .filter(l => l.coche || l.rempli || cfg.staffToujoursDispo);
  const rang = l => (l.coche ? 0 : l.occupe ? 4 : l.dispo === true ? (l.secours ? 2 : 1) : 3);
  lignes.sort((a, b) => rang(a) - rang(b) || a.p.nom.localeCompare(b.p.nom, 'fr'));
  const badge = l => l.occupe ? '<span class="badge badge-red">en entretien</span>'
    : l.dispo === true ? (l.secours ? '<span class="badge badge-orange" title="A coché cette heure « si vraiment pas le choix »">si pas le choix</span>' : '<span class="badge badge-green">dispo</span>')
    : l.dispo === false ? '<span class="badge badge-gray">pas dispo</span>' : '<span class="badge badge-gray">pas de dispos</span>';
  const salleActuelle = (iv.roomId && d.salles.find(r => r.id === iv.roomId)?.code) || iv.salleNom || '';
  const nbJ = Math.min(3, cfg.nbJurys || 2);

  zone.innerHTML = `<div class="fiche-edition">
      ${section(`Salle et staffeurs <span style="text-transform:none;letter-spacing:0;font-weight:500;">· ${nbJ} staffeur${nbJ > 1 ? 's' : ''} par entretien</span>`)}
      <label class="fiche-k" for="fiche-salle-in">Salle</label>
      <input type="text" class="form-input" id="fiche-salle-in" list="fiche-salles" autocomplete="off" placeholder="Saisir ou choisir…" value="${esc(salleActuelle)}">
      <datalist id="fiche-salles">${d.salles.map(r => `<option value="${esc(r.code || r.id)}"></option>`).join('')}</datalist>
      <div class="fiche-k" style="margin-top:6px;">Staffeurs</div>
      <div class="ch-staff">${lignes.length ? lignes.map(l => `<label class="ch-staffeur">
          <input type="checkbox" value="${esc(l.p.id)}" ${l.coche ? 'checked' : ''}>
          <span>${esc(l.p.nom)}${l.anglais ? ' <span title="Parle anglais (page des dispos)">🇬🇧</span>' : ''}</span>${badge(l)}
        </label>`).join('') : '<p class="text-sm text-muted">Aucun staffeur n\'a encore donné ses dispos.</p>'}</div>
      ${groupe.length > 1 ? `<p class="text-sm text-muted" style="margin:0;">Entretien à plusieurs : la salle et les staffeurs changent pour tout le groupe.</p>` : ''}
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn btn-primary btn-sm" data-ss="ok">Enregistrer</button>
        <button type="button" class="btn btn-ghost btn-sm" data-ss="annuler">Annuler</button>
      </div>
    </div>`;
  zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const cases = [...zone.querySelectorAll('.ch-staff input')];
  const maj = () => { const n = cases.filter(x => x.checked).length; cases.forEach(x => { x.disabled = !x.checked && n >= 3; }); };
  cases.forEach(x => x.addEventListener('change', maj));
  maj();
  zone.querySelector('[data-ss="annuler"]').addEventListener('click', () => { zone.hidden = true; });
  zone.querySelector('[data-ss="ok"]').addEventListener('click', async e => {
    const bouton = e.currentTarget;
    const jures = cases.filter(x => x.checked).map(x => x.value).slice(0, 3);
    const texte = zone.querySelector('#fiche-salle-in').value.trim();
    const connue = d.salles.find(r => (r.code || r.id) === texte);
    const champs = {
      roomId: connue ? connue.id : null, salleNom: texte ? (connue ? (connue.code || connue.id) : texte) : null,
      jury1Id: jures[0] || null, jury2Id: jures[1] || null, jury3Id: jures[2] || null,
    };
    bouton.disabled = true; bouton.textContent = 'Enregistrement…';
    try {
      // Un groupe partage un seul jury et une seule salle.
      await Promise.all(groupe.map(x => updateDoc(doc(db, 'interviews', x.id), champs)));
      const { c } = etat;
      const nonAnglophones = c.langue === 'en' ? lignes.filter(l => jures.includes(l.p.id) && !l.anglais).map(l => l.p.nom) : [];
      showToast(nonAnglophones.length
        ? `Enregistré. Attention : entretien en anglais, mais ${nonAnglophones.join(', ')} n'a pas coché l'anglais sur la page des dispos.`
        : 'Enregistré.', nonAnglophones.length ? 'info' : 'success');
      jures.forEach(id => cacheNoms.delete(id));
      await charger();
      // La page qui a ouvert la fiche met à jour ses entretiens sans tout relire.
      etat?.o.onChange?.(etat.c, { entretiens: groupe.map(x => ({ ...x, ...champs })) });
    } catch (err) {
      showToast('Erreur : ' + err.message, 'error');
      bouton.disabled = false; bouton.textContent = 'Enregistrer';
    }
  });
}

// Évaluation enregistrée depuis la fiche : on relit et on montre le résultat.
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.data !== 'eval-saved' || !etat) return;
  showToast('Évaluation enregistrée.', 'success');
  etat.ongletCourant = 'evals';
  charger().then(() => etat?.o.onChange?.(etat.c));
});

// ── Note interne ─────────────────────────────────────────────────────
async function enregistrerNoteOuverte() {
  const zone = racine?.querySelector('#fiche-note');
  // La zone affichée doit être celle du cooptant ouvert : en passant au
  // suivant, l'ancienne reste un instant à l'écran.
  if (!etat || !zone || zone.dataset.cand !== etat.c.id || zone.value === etat.note) return;
  const { c, o } = etat, v = zone.value, moi = etat;
  const etiquette = racine.querySelector('#fiche-note-etat');
  if (etiquette) etiquette.textContent = '· Enregistrement…';
  try {
    await enregistrerNote(db, etat.notes, idNoteCooptant(c.id),
      { organizationId: c.organizationId || o.org?.id, campaignId: o.campaign?.id, candidateId: c.id }, v);
    moi.note = v;
    c._note = v;
    if (etiquette?.isConnected) etiquette.textContent = '· Enregistré';
    if (etat === moi) document.getElementById('fiche-a-note').textContent = v ? '•' : '';
    o.onChange?.(c);
  } catch (err) {
    console.error(err);
    if (etiquette?.isConnected) etiquette.textContent = '';
    showToast('Note non enregistrée : réessaie.', 'error');
  }
}

// ── Statut ───────────────────────────────────────────────────────────
async function changerStatut(e) {
  const sel = e.target, { c, o } = etat, avant = c.statut;
  sel.disabled = true;
  try {
    await updateDoc(doc(db, 'candidates', c.id), { statut: sel.value });
    c.statut = sel.value;
    showToast('Statut mis à jour.', 'success');
    o.onChange?.(c);
  } catch (err) {
    sel.value = avant || 'recu';
    showToast('Erreur : ' + err.message, 'error');
  } finally {
    sel.disabled = false;
  }
}

// ── Modifier le profil ───────────────────────────────────────────────
function ouvrirEdition(corps, bouton) {
  const { c, o } = etat;
  const questions = o.campaign?.formConfig?.customQuestions || [];
  const zone = corps.querySelector('[data-zone="reponses"]');
  const champ = (q, qi) => {
    const id = `fiche-edit-${qi}`;
    const v = String(texteReponse(reponseA(c, q, qi)) ?? '');
    let input;
    if (q.type === 'longtext') input = `<textarea class="form-textarea" id="${id}" rows="3">${esc(v)}</textarea>`;
    else if (q.type === 'select' && q.options?.length) {
      const opts = [...q.options];
      if (v && !opts.includes(v)) opts.unshift(v);   // ancienne option : on ne la perd pas
      input = `<select class="form-select" id="${id}"><option value="">·</option>${opts.map(op =>
        `<option value="${esc(op)}"${op === v ? ' selected' : ''}>${esc(op)}</option>`).join('')}</select>`;
    } else if (q.type === 'checkbox') {
      return `<label class="checkbox-wrap" style="cursor:pointer;"><input type="checkbox" id="${id}"${v === 'Oui' ? ' checked' : ''} /><span>${esc(q.label)}</span></label>`;
    } else input = `<input class="form-input" id="${id}" value="${esc(v)}" />`;
    return `<div class="form-group"><label class="form-label" for="${id}">${esc(q.label)}</label>${input}</div>`;
  };
  bouton.hidden = true;
  zone.innerHTML = `
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="fiche-edit-prenom">Prénom</label>
        <input class="form-input" id="fiche-edit-prenom" value="${esc(c.prenom || '')}" /></div>
      <div class="form-group"><label class="form-label" for="fiche-edit-nom">Nom</label>
        <input class="form-input" id="fiche-edit-nom" value="${esc(c.nom || '')}" /></div>
    </div>
    <div class="form-group"><label class="form-label" for="fiche-edit-email">Email</label>
      <input class="form-input" type="email" id="fiche-edit-email" value="${esc(c.email || '')}" />
      <span class="form-hint">S'il revient sur le formulaire, c'est avec cette adresse qu'il retrouvera sa candidature.</span></div>
    <div class="form-group"><label class="form-label" for="fiche-edit-parcours">Parcours</label>
      <select class="form-select" id="fiche-edit-parcours"><option value="">Non renseigné</option>${PARCOURS.map(p =>
        `<option value="${esc(p)}" ${parcoursCooptant(c) === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
    ${questions.map((q, qi) => estQuestionParcours(q) ? '' : champ(q, qi)).join('')}
    <div style="display:flex;gap:8px;">
      <button type="button" class="btn btn-primary btn-sm" data-act="enregistrer">Enregistrer</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="annuler">Annuler</button>
    </div>`;
  zone.querySelector('input')?.focus();
  zone.querySelector('[data-act="annuler"]').addEventListener('click', () => montrerOnglet('profil'));
  zone.querySelector('[data-act="enregistrer"]').addEventListener('click', async e => {
    const val = id => zone.querySelector(`#fiche-edit-${id}`);
    const prenom = val('prenom').value.trim(), nom = val('nom').value.trim();
    const email = val('email').value.trim().toLowerCase();
    if (!prenom || !nom) return showToast('Le prénom et le nom sont requis.', 'error');
    if (email && !email.includes('@')) return showToast('Adresse email invalide.', 'error');
    const customAnswers = { ...(c.customAnswers || {}) };
    questions.forEach((q, qi) => {
      const el = val(qi);
      if (!el) return;
      const v = el.type === 'checkbox' ? (el.checked ? 'Oui' : '') : el.value.trim();
      const cle = cleReponse(c, q, qi);
      if (!v && customAnswers[cle] === undefined) return;   // rien avant, rien maintenant
      customAnswers[cle] = { label: q.label, value: v };
    });
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Enregistrement…';
    try {
      const parcours = val('parcours').value || null;
      await updateDoc(doc(db, 'candidates', c.id), { prenom, nom, email, customAnswers, parcours });
      Object.assign(c, { prenom, nom, email, customAnswers, parcours });
      showToast('Profil mis à jour.', 'success');
      enTete();
      montrerOnglet('profil');
      o.onChange?.(c);
    } catch (err) {
      showToast('Erreur : ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Enregistrer';
    }
  });
}

// ── Lien personnel pour (re)prendre un créneau ───────────────────────
// postuler.html?modif=<jeton> : tout est prérempli, il ne reste qu'à choisir
// l'horaire. Après une absence, l'entretien est déplacé et l'absence reste
// notée (elle porte l'ancien horaire).
async function copierLienCreneau() {
  const { c, o } = etat;
  const asso = o.org?.slug || o.org?.id || c.organizationId;
  const lien = `${location.origin}/postuler.html?org=${encodeURIComponent(asso)}&modif=${encodeURIComponent(c.resultToken)}${c.langue === 'en' ? '&lang=en' : ''}`;
  try {
    await navigator.clipboard.writeText(lien);
  } catch {
    // Navigateur qui refuse le presse-papiers : copie à l'ancienne.
    const zone = document.createElement('textarea');
    zone.value = lien; zone.setAttribute('readonly', ''); zone.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(zone); zone.select();
    const ok = document.execCommand('copy');
    zone.remove();
    if (!ok) { showToast('Copie impossible : ' + lien, 'info'); return; }
  }
  showToast(`Lien copié. ${nomDe(c)} y choisira son nouveau créneau, avec le formulaire déjà rempli.`, 'success');
}

// ── Absence ──────────────────────────────────────────────────────────
// Le créneau actuel est marqué manqué. La marque reste si l'entretien est
// replanifié (elle porte l'ancien horaire) : le bureau la voit au classement.
async function marquerAbsent(btn) {
  const { c, o } = etat, iv = etat.ivs[0], moi = etat;
  if (!iv) return;
  btn.disabled = true;
  try {
    await signalerAbsence(db, { ...iv, organizationId: iv.organizationId || c.organizationId || o.org?.id },
      { par: o.par || null, source: 'fiche' });
    showToast(`${esc(nomDe(c))} marqué·e absent·e. Pour un nouveau créneau : « Déplacer ».`, 'success');
    if (etat !== moi) return;
    await charger();
    o.onChange?.(c);
  } catch (err) {
    btn.disabled = false;
    showToast('Erreur : ' + err.message, 'error');
  }
}

// Retirer une absence est une suppression : elle passe par la corbeille.
async function annulerAbsence(btn) {
  const { c, o } = etat, iv = etat.ivs[0], moi = etat;
  const a = etat.absences.find(x => absentAuCreneau([x], iv));
  if (!a) return;
  btn.disabled = true;
  try {
    const { id, ...data } = a;
    await mettreEnCorbeille(db, {
      organizationId: data.organizationId, type: 'absence', par: o.par || null,
      libelle: `Absence de ${nomDe(c)} (${formatDatetime(data.datetimeStart)})`,
      docs: [{ col: 'absences', id, data }],
    });
    showToast('Absence retirée.', 'success');
    if (etat !== moi) return;
    await charger();
    o.onChange?.(c);
  } catch (err) {
    btn.disabled = false;
    showToast('Erreur : ' + err.message, 'error');
  }
}

// ── Suppression (corbeille) ──────────────────────────────────────────
async function supprimer() {
  const { c, o } = etat;
  const nom = nomDe(c);
  const ok = await confirmDialog(
    `Supprimer la candidature de ${nom} ? Son entretien et son évaluation partent avec. `
    + `Tout reste récupérable ${DUREE_CORBEILLE_JOURS} jours dans Paramètres, onglet Accès et sécurité.`,
    { title: 'Supprimer la candidature', confirmLabel: 'Supprimer', danger: true });
  if (!ok || etat?.c !== c) return;
  try {
    const orgId = c.organizationId || o.org?.id;
    const [candDoc, ivSnap, evalSnap, absences] = await Promise.all([
      // Relu : la corbeille garde le document tel qu'il est en base.
      getDoc(doc(db, 'candidates', c.id)),
      getDocs(query(collection(db, 'interviews'), where('candidateId', '==', c.id))),
      getDocs(query(collection(db, 'interview_evaluations'),
        where('organizationId', '==', orgId), where('candidateId', '==', c.id))),
      absencesDuCooptant(db, orgId, c.id),
    ]);
    // Ses notes internes (sur lui et ses entretiens) partent avec lui.
    const idsNotes = [idNoteCooptant(c.id), ...ivSnap.docs.map(d => idNoteEntretien(d.id))];
    const notes = (await Promise.all(idsNotes.map(id => getDoc(doc(db, 'notes_internes', id)).catch(() => null))))
      .filter(n => n?.exists?.()).map(n => ({ id: n.id, data: n.data() }));
    await cooptantEnCorbeille(db, { id: c.id, ...(candDoc.exists() ? candDoc.data() : c) },
      ivSnap.docs, evalSnap.docs, orgId, o.par || null, notes,
      absences.map(({ id, ...data }) => ({ id, data })));
    showToast(`Candidature de ${esc(nom)} mise à la corbeille (Paramètres › Accès et sécurité).`, 'success');
    fermerFiche();
    o.onSupprime?.(c.id, notes.map(n => n.id));
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  }
}

// ── Fiche d'un staffeur ──────────────────────────────────────────────
// Même modèle de fenêtre que celle du cooptant : ses dispos sur la période,
// ses entretiens, ses langues. Elle s'ouvre par-dessus la fiche d'un cooptant
// (Fermer y ramène).
let racineStaff = null;
function fenetreStaff() {
  if (racineStaff) return racineStaff;
  racineStaff = document.createElement('div');
  racineStaff.className = 'fiche-overlay fiche-overlay-staff';
  racineStaff.innerHTML = `
    <div class="fiche" role="dialog" aria-modal="true" aria-labelledby="fs-nom">
      <div class="fiche-tete">
        <div style="min-width:0;flex:1;"><div class="fiche-type">Staffeur</div><h3 id="fs-nom"></h3><div class="fiche-sous" id="fs-sous"></div></div>
        <div class="fiche-nav"><button type="button" class="fiche-btn-icone" data-fs-fermer title="Fermer (Échap)" aria-label="Fermer">✕</button></div>
      </div>
      <div class="fiche-onglets" role="tablist">
        <button type="button" role="tab" data-fs-onglet="dispos" aria-selected="true">Dispos</button>
        <button type="button" role="tab" data-fs-onglet="entretiens" aria-selected="false">Entretiens <span id="fs-nb"></span></button>
      </div>
      <div class="fiche-corps" id="fs-corps"></div>
      <div class="fiche-pied">
        <button type="button" class="btn btn-secondary btn-sm" data-fs-act="lien">Copier le lien des dispos</button>
        <a class="btn btn-secondary btn-sm" data-fs-act="modifier" href="#">Modifier ses dispos</a>
        <button type="button" class="btn btn-secondary btn-sm" data-fs-fermer style="margin-left:auto;">Fermer</button>
      </div>
    </div>`;
  document.body.appendChild(racineStaff);
  racineStaff.addEventListener('click', e => { if (e.target === racineStaff) fermerFicheStaffeur(); });
  racineStaff.querySelectorAll('[data-fs-fermer]').forEach(b => b.addEventListener('click', fermerFicheStaffeur));
  racineStaff.querySelectorAll('[data-fs-onglet]').forEach(b => b.addEventListener('click', () => montrerOngletStaff(b.dataset.fsOnglet)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && etatStaff) { e.stopImmediatePropagation(); fermerFicheStaffeur(); } }, true);
  return racineStaff;
}
let etatStaff = null;

export function fermerFicheStaffeur() {
  racineStaff?.classList.remove('open');
  etatStaff = null;
}

/**
 * Ouvre la fiche d'un staffeur.
 * @param {string} id identifiant du staffeur (liste du staff ou compte)
 * @param {{org: object, campaign: object, nom?: string}} o
 */
export async function ouvrirFicheStaffeur(id, { org, campaign, nom } = {}) {
  if (!id || !campaign) return;
  const r = fenetreStaff();
  etatStaff = { id, org, campaign, charge: false };
  const moi = etatStaff;
  document.getElementById('fs-nom').textContent = nom || '…';
  document.getElementById('fs-sous').textContent = 'Chargement…';
  document.getElementById('fs-corps').innerHTML = '';
  r.querySelector('[data-fs-act="modifier"]').href = `/planning.html?org=${encodeURIComponent(org?.id || campaign.organizationId || '')}&dispos=${encodeURIComponent(id)}`;
  r.querySelector('[data-fs-act="lien"]').onclick = () => {
    const url = `${location.origin}/dispos-publique.html?org=${encodeURIComponent(org?.slug || org?.id || campaign.organizationId || '')}`;
    navigator.clipboard.writeText(url).then(() => showToast('Lien des dispos copié.', 'success')).catch(() => showToast('Impossible de copier.', 'error'));
  };
  r.classList.add('open');
  try {
    const orgId = org?.id || campaign.organizationId;
    const [sa, ivSnap, candSnap, evSnap, nomLu] = await Promise.all([
      getDocs(query(collection(db, 'staff_availabilities'), where('campaignId', '==', campaign.id), where('userId', '==', id))),
      getDocs(query(collection(db, 'interviews'), where('campaignId', '==', campaign.id))),
      getDocs(query(collection(db, 'candidates'), where('campaignId', '==', campaign.id))),
      getDocs(query(collection(db, 'interview_evaluations'), where('organizationId', '==', orgId), where('campaignId', '==', campaign.id))).catch(() => ({ docs: [] })),
      nom ? Promise.resolve(nom) : nomJure(id),
    ]);
    if (etatStaff !== moi) return;
    const cands = new Map(candSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    const evalues = new Set(evSnap.docs.map(d => d.data().candidateId));
    const fiches = sa.docs.map(d => d.data());
    const ivs = ivSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(iv => iv.datetimeStart?.toDate && [iv.jury1Id, iv.jury2Id, iv.jury3Id].includes(id))
      .map(iv => ({ ...iv, debut: iv.datetimeStart.toDate(), fin: iv.datetimeEnd?.toDate?.() || iv.datetimeStart.toDate() }))
      .sort((a, b) => a.debut - b.debut);
    // Un entretien à plusieurs ne compte qu'une fois.
    const vus = new Set();
    const uniques = ivs.filter(iv => { const k = iv.groupId || iv.id; if (vus.has(k)) return false; vus.add(k); return true; });
    Object.assign(moi, { fiches, ivs, uniques, cands, evalues, charge: true, nom: nomLu || fiches[0]?.displayName || 'Staffeur' });
    const passes = uniques.filter(iv => iv.fin.getTime() <= Date.now()).length;
    const langues = [...new Set(fiches.flatMap(f => f.langues || []))];
    document.getElementById('fs-nom').textContent = moi.nom;
    document.getElementById('fs-sous').textContent = `${uniques.length} entretien${uniques.length > 1 ? 's' : ''}, dont ${passes} passé${passes > 1 ? 's' : ''} · `
      + (langues.length ? langues.map(l => ({ fr: 'français', en: 'anglais' })[l] || l).join(' et ') : 'français (langues non renseignées)');
    document.getElementById('fs-nb').textContent = `(${uniques.length})`;
    montrerOngletStaff('dispos');
  } catch (err) {
    console.error(err);
    if (etatStaff === moi) document.getElementById('fs-corps').innerHTML = `<p class="text-sm" style="color:var(--red);">Fiche incomplète : ${esc(err.message)}</p>`;
  }
}

function montrerOngletStaff(nom) {
  const e = etatStaff;
  if (!e) return;
  racineStaff.querySelectorAll('[data-fs-onglet]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.fsOnglet === nom)));
  const corps = document.getElementById('fs-corps');
  if (!e.charge) { corps.innerHTML = '<p class="text-sm text-muted">Chargement…</p>'; return; }
  corps.innerHTML = nom === 'entretiens' ? htmlEntretiensStaff(e) : htmlDisposStaff(e);
  corps.querySelectorAll('[data-fs-cand]').forEach(b => b.addEventListener('click', () => {
    const c = e.cands.get(b.dataset.fsCand);
    if (!c) return;
    fermerFicheStaffeur();
    ouvrirFiche(c, { org: e.org, campaign: e.campaign, onglet: 'profil' });
  }));
}

function htmlDisposStaff(e) {
  if (campaignConfig(e.campaign).staffToujoursDispo) {
    return '<p class="text-sm text-muted" style="margin:0;">Le staff est réputé toujours disponible sur la période : pas de dispos à déclarer.</p>';
  }
  if (!e.fiches.length) {
    return '<div class="fiche-vide"><p>Pas encore de dispos déposées.</p><p class="text-sm" style="margin:0;">Envoie-lui le lien des dispos (en bas), ou saisis-les toi-même avec « Modifier ses dispos ».</p></div>';
  }
  const etat = new Map();
  e.fiches.forEach(f => (f.creneaux || []).forEach(j => (j.creneaux || []).forEach(h => etat.set(`${j.jour}|${h}`, 'd'))));
  e.fiches.forEach(f => (f.secours || []).forEach(j => (j.creneaux || []).forEach(h => etat.set(`${j.jour}|${h}`, 's'))));
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  e.ivs.forEach(iv => etat.set(`${iso(iv.debut)}|${String(iv.debut.getHours()).padStart(2, '0')}:00`, 'e'));
  const jours = getPlanningDays(e.campaign, e.ivs.map(iv => iv.debut));
  const heures = heuresGrille(campaignConfig(e.campaign).heureFin);
  let html = `<div class="fs-grille" style="grid-template-columns:44px repeat(${jours.length}, minmax(26px, 1fr));"><span></span>`
    + jours.map(j => `<span class="fs-jour">${j.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}<b>${j.getDate()}</b></span>`).join('');
  heures.forEach(h => {
    html += `<span class="fs-h">${h}</span>` + jours.map(j => {
      const v = etat.get(`${iso(j)}|${h}`);
      return `<i class="${v || ''}" title="${j.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })} ${h} : ${({ d: 'dispo', s: 'si pas le choix', e: 'en entretien' })[v] || 'pas dispo'}"></i>`;
    }).join('');
  });
  return html + `</div><div class="fs-legende"><span><i class="d"></i>dispo</span><span><i class="s"></i>si pas le choix</span><span><i class="e"></i>en entretien</span></div>`;
}

function htmlEntretiensStaff(e) {
  if (!e.uniques.length) return '<p class="text-sm text-muted" style="margin:0;">Aucun entretien pour l\'instant.</p>';
  const t = Date.now();
  return e.uniques.map(iv => {
    const groupe = e.ivs.filter(x => (iv.groupId && x.groupId === iv.groupId) || x.id === iv.id);
    const noms = groupe.map(x => e.cands.get(x.candidateId)).filter(Boolean);
    const etatIv = iv.fin.getTime() > t ? '<span class="text-muted">à venir</span>'
      : groupe.some(x => e.evalues.has(x.candidateId)) ? '<span style="color:var(--green);font-weight:600;">✓ évalué</span>' : '<span style="color:var(--red);font-weight:600;">✗ pas d\'évaluation</span>';
    return `<div class="fs-ligne"><span class="fs-quand">${esc(iv.debut.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }))}, ${iv.debut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="fs-qui">${noms.length ? noms.map(c => `<button type="button" class="fiche-staff" data-fs-cand="${esc(c.id)}">${esc(nomDe(c))}</button>`).join(', ') : '<span class="text-muted">Cooptant supprimé</span>'}</span>${etatIv}</div>`;
  }).join('');
}
