/**
 * Fiche d'un cooptant : LE seul endroit où tout est réuni, ouvert depuis le
 * tableau de bord, la page Cooptants (liste et classement) et le planning.
 *
 * Trois onglets :
 *  - Profil : contact, entretien (✏️ vers le planning), salle, jury, réponses
 *    au formulaire, dispos déclarées ; « Modifier le profil » se fait ici ;
 *  - Évaluations : score, critères, retours du jury, « Remplir la fiche » ;
 *  - Note interne : la note privée du bureau (et celle de l'entretien).
 * En bas : statut, suppression (corbeille), ↑/↓ pour passer au suivant.
 *
 * La fiche relit elle-même entretien, évaluations et notes : la page qui
 * l'ouvre n'a besoin que du cooptant et de la campagne.
 */
import { app } from './auth.js';
import { getFirestore, collection, query, where, getDocs, getDoc, doc, updateDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { esc, showToast, formatDatetime, confirmDialog, telephoneCooptant, reponsesOrdonnees,
  reponseA, texteReponse, cleReponse } from './utils.js';
import { calculerScores } from './score.js';
import { enregistrerNote, idNoteCooptant, idNoteEntretien } from './notes.js';
import { cooptantEnCorbeille, DUREE_CORBEILLE_JOURS } from './corbeille.js';

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
  etat = { c, o, ivs: [], evals: [], note: '', notesIv: [], notes: new Map(), charge: false,
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
    const [ivSnap, evalSnap, noteDoc] = await Promise.all([
      getDocs(query(collection(db, 'interviews'), where('candidateId', '==', c.id))),
      // Filtre par asso indispensable : les règles ne sont pas des filtres.
      getDocs(query(collection(db, 'interview_evaluations'),
        where('organizationId', '==', orgId), where('candidateId', '==', c.id))),
      getDoc(doc(db, 'notes_internes', idNoteCooptant(c.id))).catch(() => null),
    ]);
    if (etat !== moi) return;
    etat.ivs = ivSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(iv => iv.datetimeStart?.toDate)
      .sort((a, b) => a.datetimeStart.toMillis() - b.datetimeStart.toMillis());
    etat.evals = evalSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    etat.note = noteDoc?.exists?.() ? (noteDoc.data().texte || '') : '';
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
    + (c.source === 'stand' ? ' <span class="badge" title="Inscrit·e sur un stand">📍 Stand</span>' : '');
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

const tuile = (k, v) => `<div class="fiche-tuile"><div class="fiche-k">${k}</div><div class="fiche-v">${v}</div></div>`;
const section = t => `<div class="fiche-section">${t}</div>`;

function htmlProfil() {
  const { c, o } = etat;
  const questions = o.campaign?.formConfig?.customQuestions || [];
  const tel = telephoneCooptant(c, questions);
  const iv = etat.ivs[0];
  const crayon = libelle => `<a class="fiche-crayon" href="/planning.html?org=${encodeURIComponent(o.org?.id || '')}&allouer=${encodeURIComponent(c.id)}" title="${libelle}" aria-label="${libelle}">✏️</a>`;
  const tuiles = [];
  if (c.email) tuiles.push(tuile('Email', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`));
  if (tel) tuiles.push(tuile('Téléphone', `<a href="tel:${esc(tel.replace(/\s+/g, ''))}">${esc(tel)}</a>`));
  if (!etat.charge) {
    tuiles.push(tuile('Entretien', '<span class="text-muted">…</span>'));
  } else if (!iv) {
    tuiles.push(tuile('Entretien', `Pas encore planifié ${crayon('Placer ce cooptant dans le planning')}`));
  } else {
    const s = iv.datetimeStart.toDate(), e = iv.datetimeEnd?.toDate?.();
    const hm = d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    tuiles.push(tuile('Entretien', `${esc(s.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}, ${hm(s)}${e ? ' - ' + hm(e) : ''} ${crayon('Changer le créneau')}`));
    tuiles.push(tuile('Salle', '<span data-fiche-salle class="text-muted">…</span>'));
    tuiles.push(tuile('Jury', '<span data-fiche-jury class="text-muted">…</span>'));
  }

  const reps = reponsesOrdonnees(c, questions).filter(({ value }) => {
    const v = String(value ?? '').trim();
    return v !== '' && v !== tel;
  });
  let html = `<div class="fiche-grille">${tuiles.join('')}</div>`;
  html += `<div class="fiche-titre-ligne">${section('Réponses au formulaire')}
    <button type="button" class="btn btn-ghost btn-sm" data-act="modifier">✏️ Modifier le profil</button></div>`;
  html += `<div data-zone="reponses">${reps.length
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
  const bouton = `<button type="button" class="btn btn-primary btn-sm" data-act="evaluer">🎙 Remplir la fiche d'entretien</button>`;
  if (!etat.evals.length) {
    return `<div class="fiche-vide"><p>Aucune évaluation pour le moment.</p>${bouton}</div>`;
  }
  let html = `<div class="fiche-titre-ligne"><div class="fiche-resume">
      ${c._score != null ? `<strong style="color:${couleurScore(c._score)};">${c._score} %</strong>` : ''}
      ${c._partiel ? `<span class="badge badge-orange" title="Le score apparaît quand la grille est remplie en entier">${c._nbCriteresNotes}/${c._nbCriteresTotal} critères notés</span>` : ''}
      ${c._noteGlobaleAvg != null ? `<span>Note globale : <strong>${c._noteGlobaleAvg}/20</strong></span>` : ''}
      <span class="text-muted">${c._nbEvals} évaluation${c._nbEvals > 1 ? 's' : ''}</span>
      ${c._decisions?.reserve ? `<span class="badge badge-orange">À revoir × ${c._decisions.reserve}</span>` : ''}
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
    html += section('Commentaires du jury') + c._comments.map(cm => `<div class="fiche-citation">${esc(cm.text)}</div>`).join('');
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
    if (o.ouvrirEvaluation) o.ouvrirEvaluation(c);
    else location.href = `/secge/evaluer.html?candidateId=${encodeURIComponent(c.id)}&campaignId=${encodeURIComponent(o.campaign?.id || '')}`;
  });
  corps.querySelector('[data-act="modifier"]')?.addEventListener('click', e => ouvrirEdition(corps, e.currentTarget));
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
  if (zj) { zj.className = ''; zj.innerHTML = ids.length ? esc(noms.map(n => n || 'Membre du jury').join(', ')) : '<span style="color:var(--red);">À définir</span>'; }
}

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
    ${questions.map(champ).join('')}
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
      await updateDoc(doc(db, 'candidates', c.id), { prenom, nom, email, customAnswers });
      Object.assign(c, { prenom, nom, email, customAnswers });
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

// ── Suppression (corbeille) ──────────────────────────────────────────
async function supprimer() {
  const { c, o } = etat;
  const nom = nomDe(c);
  const ok = await confirmDialog(
    `Supprimer la candidature de ${nom} ? Son entretien et son évaluation partent avec. `
    + `Tout reste récupérable ${DUREE_CORBEILLE_JOURS} jours dans Paramètres, onglet Corbeille.`,
    { title: 'Supprimer la candidature', confirmLabel: 'Supprimer', danger: true });
  if (!ok || etat?.c !== c) return;
  try {
    const orgId = c.organizationId || o.org?.id;
    const [candDoc, ivSnap, evalSnap] = await Promise.all([
      // Relu : la corbeille garde le document tel qu'il est en base.
      getDoc(doc(db, 'candidates', c.id)),
      getDocs(query(collection(db, 'interviews'), where('candidateId', '==', c.id))),
      getDocs(query(collection(db, 'interview_evaluations'),
        where('organizationId', '==', orgId), where('candidateId', '==', c.id))),
    ]);
    // Ses notes internes (sur lui et ses entretiens) partent avec lui.
    const idsNotes = [idNoteCooptant(c.id), ...ivSnap.docs.map(d => idNoteEntretien(d.id))];
    const notes = (await Promise.all(idsNotes.map(id => getDoc(doc(db, 'notes_internes', id)).catch(() => null))))
      .filter(n => n?.exists?.()).map(n => ({ id: n.id, data: n.data() }));
    await cooptantEnCorbeille(db, { id: c.id, ...(candDoc.exists() ? candDoc.data() : c) },
      ivSnap.docs, evalSnap.docs, orgId, o.par || null, notes);
    showToast(`Candidature de ${esc(nom)} mise à la corbeille (Paramètres › Corbeille).`, 'success');
    fermerFiche();
    o.onSupprime?.(c.id, notes.map(n => n.id));
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  }
}
