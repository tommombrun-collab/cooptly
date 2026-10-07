/**
 * Assistant de démarrage : cinq écrans pour régler un recrutement sans
 * découvrir les Paramètres d'un coup. Ouvert par le tableau de bord pour un
 * recrutement en préparation (js/cloture.js), une asso toute neuve, ou à la
 * demande (`?assistant=1`, bouton du bandeau).
 *
 * Chaque écran part des réglages actuels : un nouveau bureau garde ceux de
 * l'an dernier d'un clic. Rien n'est écrit avant « Terminer », qui écrit
 * `config` en repartant de `campaignConfig` (il se remplace en entier).
 */
import { doc, updateDoc, deleteField } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { campaignConfig, esc, showToast } from './utils.js';

const JOURS = [[1, 'Lun.'], [2, 'Mar.'], [3, 'Mer.'], [4, 'Jeu.'], [5, 'Ven.'], [6, 'Sam.'], [0, 'Dim.']];

/** Questions proposées à une asso qui n'en a aucune (le parcours est déjà posé par la plateforme). */
const MODELES = [
  { cle: 'tel', label: 'Ton numéro de téléphone', labelEn: 'Your phone number', type: 'tel', required: true },
  { cle: 'fb', label: 'Ton nom sur Facebook (pour le groupe Messenger)', labelEn: 'Your Facebook name (for the Messenger group)', type: 'text', required: true },
  { cle: 'motivation', label: 'Pourquoi veux-tu nous rejoindre ?', labelEn: 'Why do you want to join us?', type: 'longtext', required: true },
];

const nouvelId = () => 'q_' + Math.random().toString(36).slice(2, 10);

/**
 * @param {object} o
 * @param {import('firebase/firestore').Firestore} o.db
 * @param {object} o.campaign
 * @param {() => void} [o.onFini]
 */
export function ouvrirAssistant({ db, campaign, onFini }) {
  if (document.getElementById('assistant')) return;
  const cfg = campaignConfig(campaign);
  const questions = campaign.formConfig?.customQuestions || [];
  // Brouillon : modifié écran après écran, écrit à la fin seulement.
  const b = {
    dateDebut: cfg.dateDebut || '', dateFin: cfg.dateFin || '', deadline: cfg.deadlineCandidature || '',
    exclus: new Set(cfg.joursSemaineExclus || []),
    avecEntretien: cfg.avecEntretien !== false,
    duree: cfg.dureeMinutes || 30, battement: cfg.battementMinutes || 0, heureFin: cfg.heureFin || 19,
    nbJurys: Math.min(3, cfg.nbJurys || 2), staffLibre: !!cfg.staffToujoursDispo,
    modeRdv: cfg.modeRdv || 'creneaux', collectif: !!cfg.entretienCollectif,
    modeles: new Set(questions.length ? [] : MODELES.map(m => m.cle)),
    ouvrir: false,
  };
  let etape = 0;

  const r = document.createElement('div');
  r.id = 'assistant';
  r.className = 'fiche-overlay open';
  r.innerHTML = `<div class="fiche as-fiche" role="dialog" aria-modal="true" aria-labelledby="as-titre">
      <div class="fiche-tete">
        <div style="min-width:0;flex:1;"><div class="fiche-type" id="as-type"></div><h3 id="as-titre"></h3><div class="fiche-sous" id="as-sous"></div></div>
        <div class="fiche-nav"><button type="button" class="fiche-btn-icone" data-as="plus-tard" title="Plus tard" aria-label="Fermer">✕</button></div>
      </div>
      <div class="as-progres" aria-hidden="true"><i id="as-barre"></i></div>
      <div class="fiche-corps" id="as-corps"></div>
      <div class="fiche-pied">
        <button type="button" class="btn btn-ghost btn-sm" data-as="plus-tard">Plus tard</button>
        <button type="button" class="btn btn-secondary btn-sm" data-as="prec" style="margin-left:auto;">Précédent</button>
        <button type="button" class="btn btn-primary btn-sm" data-as="suiv">Suivant</button>
      </div>
    </div>`;
  document.body.append(r);
  const $ = s => r.querySelector(s);

  const ECRANS = [
    {
      titre: 'Quand ont lieu les entretiens ?',
      sous: 'Les dates de cette année. Les jours décochés ne sont jamais proposés.',
      html: () => `
        <div class="form-row-3">
          <div class="form-group"><label class="form-label" for="as-debut">Premier jour d'entretiens</label><input class="form-input" type="date" id="as-debut" value="${esc(b.dateDebut)}"></div>
          <div class="form-group"><label class="form-label" for="as-fin">Dernier jour</label><input class="form-input" type="date" id="as-fin" value="${esc(b.dateFin)}"></div>
          <div class="form-group"><label class="form-label" for="as-deadline">Fin des candidatures</label><input class="form-input" type="date" id="as-deadline" value="${esc(b.deadline)}"><span class="form-hint">Facultatif.</span></div>
        </div>
        <span class="form-label">Jours d'entretien</span>
        <div class="jours-semaine">${JOURS.map(([j, n]) => `<label><input type="checkbox" data-jour="${j}" ${b.exclus.has(j) ? '' : 'checked'}> ${n}</label>`).join('')}</div>
        <p class="form-hint">Sans dates, les entretiens sont proposés sur les quatre semaines à venir, qui avancent chaque jour.</p>`,
      lire: () => {
        b.dateDebut = $('#as-debut').value; b.dateFin = $('#as-fin').value; b.deadline = $('#as-deadline').value;
        b.exclus = new Set([...r.querySelectorAll('[data-jour]')].filter(c => !c.checked).map(c => Number(c.dataset.jour)));
        if ((b.dateDebut && !b.dateFin) || (!b.dateDebut && b.dateFin)) return 'Mettez les deux dates, ou aucune.';
        if (b.dateDebut && b.dateFin < b.dateDebut) return 'Le dernier jour est avant le premier.';
        return null;
      },
    },
    {
      titre: 'Les entretiens',
      sous: 'Leur durée et la plage horaire.',
      html: () => `
        <label class="checkbox-wrap" style="cursor:pointer;margin-bottom:12px;"><input type="checkbox" id="as-avec" ${b.avecEntretien ? 'checked' : ''}>
          <span><strong>Il y a des entretiens</strong><br><span class="text-sm text-muted">Décochez pour un recrutement sur dossier : le formulaire ne demandera aucun créneau.</span></span></label>
        <div class="form-row-3" id="as-entretiens">
          <div class="form-group"><label class="form-label" for="as-duree">Durée</label>
            <select class="form-select" id="as-duree">${[15, 20, 30, 45, 60, 90].map(m => `<option value="${m}" ${m === +b.duree ? 'selected' : ''}>${m} min</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label" for="as-batt">Pause entre deux</label>
            <select class="form-select" id="as-batt">${[0, 5, 10, 15].map(m => `<option value="${m}" ${m === +b.battement ? 'selected' : ''}>${m ? m + ' min' : 'Aucune'}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label" for="as-hfin">Dernier entretien fini à</label>
            <select class="form-select" id="as-hfin">${[17, 18, 19, 20, 21, 22, 23].map(h => `<option value="${h}" ${h === +b.heureFin ? 'selected' : ''}>${h} h</option>`).join('')}</select></div>
        </div>`,
      lire: () => {
        b.avecEntretien = $('#as-avec').checked;
        b.duree = +$('#as-duree').value; b.battement = +$('#as-batt').value; b.heureFin = +$('#as-hfin').value;
        return null;
      },
      apres: () => {
        const maj = () => { $('#as-entretiens').style.opacity = $('#as-avec').checked ? '' : '.4'; };
        $('#as-avec').addEventListener('change', maj); maj();
      },
    },
    {
      titre: 'Les staffeurs',
      sous: 'Combien font passer chaque entretien, et s\'ils donnent leurs dispos.',
      html: () => `
        <span class="form-label">Staffeurs par entretien</span>
        <div class="as-choix">${[1, 2, 3].map(n => `<label class="as-carte"><input type="radio" name="as-nb" value="${n}" ${n === b.nbJurys ? 'checked' : ''}><b>${n}</b><span>${n === 1 ? 'Un seul, pour aller vite' : n === 2 ? 'Le plus courant' : 'Pour un regard croisé'}</span></label>`).join('')}</div>
        <span class="form-label" style="margin-top:14px;display:block;">Les dispos du staff</span>
        <div class="as-choix">
          <label class="as-carte"><input type="radio" name="as-libre" value="non" ${b.staffLibre ? '' : 'checked'}><b>Chacun donne ses dispos</b><span>Avec le lien des dispos. Les créneaux suivent qui est libre. Conseillé.</span></label>
          <label class="as-carte"><input type="radio" name="as-libre" value="oui" ${b.staffLibre ? 'checked' : ''}><b>Tout le monde est libre</b><span>Pas de dispos à remplir : vous vous arrangez ensuite.</span></label>
        </div>`,
      lire: () => {
        b.nbJurys = +(r.querySelector('[name="as-nb"]:checked')?.value || 2);
        b.staffLibre = r.querySelector('[name="as-libre"]:checked')?.value === 'oui';
        return null;
      },
    },
    {
      titre: 'Le rendez-vous',
      sous: 'Qui fixe l\'heure de l\'entretien.',
      html: () => `
        <div class="as-choix">
          <label class="as-carte"><input type="radio" name="as-mode" value="creneaux" ${b.modeRdv !== 'dispos' ? 'checked' : ''}><b>Le cooptant choisit son créneau</b><span>Il réserve directement un créneau libre. Le planning se remplit tout seul. Conseillé.</span></label>
          <label class="as-carte"><input type="radio" name="as-mode" value="dispos" ${b.modeRdv === 'dispos' ? 'checked' : ''}><b>Le cooptant donne ses dispos</b><span>Vous placez tout le monde d'un coup depuis le tableau de bord.</span></label>
        </div>
        <label class="checkbox-wrap" style="cursor:pointer;margin-top:14px;"><input type="checkbox" id="as-collectif" ${b.collectif ? 'checked' : ''}>
          <span><strong>Entretiens à plusieurs</strong><br><span class="text-sm text-muted">Le cooptant peut inviter un ami sur son créneau.</span></span></label>`,
      lire: () => {
        b.modeRdv = r.querySelector('[name="as-mode"]:checked')?.value || 'creneaux';
        b.collectif = $('#as-collectif').checked;
        return null;
      },
    },
    {
      titre: 'Le formulaire',
      sous: 'Les questions posées aux cooptants.',
      html: () => (questions.length
        ? `<p class="text-sm">Vous gardez les <b>${questions.length} question${questions.length > 1 ? 's' : ''}</b> de l'an dernier :</p>
           <ul class="as-questions">${questions.map(q => `<li>${esc(q.label)}${q.required ? '' : ' <span class="text-muted">(facultative)</span>'}</li>`).join('')}</ul>
           <p class="form-hint">Pour en changer : Paramètres, Formulaire.</p>`
        : `<p class="text-sm">Questions de départ, à adapter ensuite dans Paramètres, Formulaire :</p>
           <div class="as-modeles">${MODELES.map(m => `<label class="checkbox-wrap"><input type="checkbox" data-modele="${m.cle}" ${b.modeles.has(m.cle) ? 'checked' : ''}> <span>${esc(m.label)}</span></label>`).join('')}</div>`)
        + `<label class="checkbox-wrap as-ouvrir"><input type="checkbox" id="as-ouvrir" ${b.ouvrir ? 'checked' : ''}>
            <span><strong>Ouvrir le recrutement maintenant</strong><br><span class="text-sm text-muted">Sinon, le formulaire reste en pause : vous l'ouvrez quand vous voulez depuis Paramètres, Quand ?</span></span></label>`,
      lire: () => {
        b.modeles = new Set([...r.querySelectorAll('[data-modele]')].filter(c => c.checked).map(c => c.dataset.modele));
        b.ouvrir = $('#as-ouvrir').checked;
        return null;
      },
    },
  ];

  const dessiner = () => {
    const e = ECRANS[etape];
    $('#as-type').textContent = `Démarrage · ${etape + 1} sur ${ECRANS.length}`;
    $('#as-titre').textContent = e.titre;
    $('#as-sous').textContent = e.sous;
    $('#as-corps').innerHTML = e.html();
    $('#as-barre').style.width = `${((etape + 1) / ECRANS.length) * 100}%`;
    $('[data-as="prec"]').style.visibility = etape ? 'visible' : 'hidden';
    $('[data-as="suiv"]').textContent = etape === ECRANS.length - 1 ? 'Terminer' : 'Suivant';
    e.apres?.();
    $('#as-corps').querySelector('input, select')?.focus();
  };

  const fermer = () => { r.remove(); document.removeEventListener('keydown', surTouche, true); };
  const surTouche = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); plusTard(); } };
  const plusTard = () => {
    try { sessionStorage.setItem(`_assistantPlusTard_${campaign.id}`, '1'); } catch { /* sans importance */ }
    fermer();
  };

  async function terminer(bouton) {
    bouton.disabled = true; bouton.textContent = 'Enregistrement…';
    const config = {
      ...campaignConfig(campaign),
      dateDebut: b.dateDebut || null, dateFin: b.dateFin || null, deadlineCandidature: b.deadline || null,
      joursSemaineExclus: [...b.exclus], avecEntretien: b.avecEntretien,
      dureeMinutes: b.duree, battementMinutes: b.battement, heureFin: b.heureFin,
      nbJurys: b.nbJurys, staffToujoursDispo: b.staffLibre,
      modeRdv: b.modeRdv, entretienCollectif: b.collectif,
    };
    // Un minimum plus haut que le maximum : le maximum suit.
    if (config.nbJurysMax && config.nbJurysMax <= config.nbJurys) config.nbJurysMax = null;
    const maj = { config, assistantFait: true, etat: deleteField() };
    if (!questions.length && b.modeles.size) {
      maj['formConfig.customQuestions'] = MODELES.filter(m => b.modeles.has(m.cle))
        .map(({ cle, ...q }) => ({ ...q, id: nouvelId() }));
    }
    if (b.ouvrir) { maj.recrutementOuvert = true; maj.statut = 'ouverte'; }
    try {
      await updateDoc(doc(db, 'campaigns', campaign.id), maj);
      fermer();
      showToast(b.ouvrir ? 'C\'est réglé, et le recrutement est ouvert.' : 'C\'est réglé. Ouvrez le recrutement quand vous êtes prêts.', 'success');
      onFini?.();
    } catch (err) {
      bouton.disabled = false; bouton.textContent = 'Terminer';
      showToast('Erreur : ' + err.message, 'error');
    }
  }

  r.addEventListener('click', e => {
    const a = e.target.closest('[data-as]')?.dataset.as;
    if (!a) return;
    if (a === 'plus-tard') return plusTard();
    if (a === 'prec') { ECRANS[etape].lire(); etape--; return dessiner(); }
    if (a === 'suiv') {
      const erreur = ECRANS[etape].lire();
      if (erreur) return showToast(erreur, 'error');
      if (etape < ECRANS.length - 1) { etape++; return dessiner(); }
      terminer(e.target.closest('button'));
    }
  });
  document.addEventListener('keydown', surTouche, true);
  dessiner();
}

/** L'assistant doit-il s'ouvrir tout seul ? */
export function assistantAttendu(campaign, nbCooptants) {
  if (!campaign || campaign.assistantFait) return false;
  try { if (sessionStorage.getItem(`_assistantPlusTard_${campaign.id}`)) return false; } catch { /* stockage bloqué */ }
  if (campaign.etat === 'preparation') return true;
  // Asso toute neuve : rien n'a encore été réglé.
  return !nbCooptants && !(campaign.formConfig?.customQuestions || []).length
    && !(campaign.interviewCriteria || []).length && !campaignConfig(campaign).dateDebut;
}
