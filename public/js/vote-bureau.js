/**
 * Vote des membres, côté bureau : la carte « Vote des membres » de l'onglet
 * Classement (candidats.html). Ouvrir un vote (qui vote, combien de coups de
 * cœur), copier le lien, suivre qui a voté, clore, rouvrir, supprimer, puis
 * classer selon les votes.
 *
 * Le lien de vote n'est proposé QUE ici (pas dans « Partager »). Les bulletins
 * restent illisibles tant que le vote est ouvert, même pour le bureau
 * (firestore.rules) : la carte ne montre alors que la participation.
 * Calculs : js/vote.js (testé).
 */
import { collection, doc, getDocs, setDoc, updateDoc, query, where, writeBatch, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { esc, showToast, confirmDialog } from './utils.js';
import { icone } from './icones.js';
import { nouveauJeton, maxCoeursConseille, compterCoeurs, MAX_ABSTENTIONS } from './vote.js';

/**
 * @param {object} o
 * @param {import('firebase/firestore').Firestore} o.db
 * @param {{id: string}} o.org
 * @param {{id: string, organizationId: string}} o.campaign
 * @param {HTMLElement} o.conteneur
 * @param {() => {id, prenom, nom, parcours}[]} o.cooptants   ce qui sera proposé au vote
 * @param {() => number} o.nbPlaces
 * @param {(r: null | {coeurs: Map<string, number>, abstentions: Map<string, number>, votants: number}) => void} o.onResultats
 * @param {(r: {coeurs: Map<string, number>, abstentions: Map<string, number>, votants: number}) => Promise<void>} o.classer
 */
export function brancherVote(o) {
  const { db, org, campaign, conteneur } = o;
  let scrutin = null, participations = [], resultats = null;

  const lien = () => `${location.origin}/voter.html?s=${scrutin.id}`;
  const nomVotant = id => scrutin?.votants?.find(v => v.id === id)?.nom || 'Un votant';

  async function charger() {
    const s = await getDocs(query(collection(db, 'scrutins'),
      where('organizationId', '==', org.id), where('campaignId', '==', campaign.id)));
    const tous = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.creeLe?.toMillis?.() ?? 0) - (a.creeLe?.toMillis?.() ?? 0));
    scrutin = tous[0] || null;
    participations = []; resultats = null;
    if (scrutin) {
      const p = await getDocs(query(collection(db, 'participations'),
        where('organizationId', '==', org.id), where('scrutinId', '==', scrutin.id)));
      participations = p.docs.map(d => d.data());
      if (!scrutin.ouvert) {
        const b = await getDocs(query(collection(db, 'bulletins'),
          where('organizationId', '==', org.id), where('scrutinId', '==', scrutin.id)));
        resultats = compterCoeurs(b.docs.map(d => d.data()));
      }
    }
    o.onResultats(resultats);
    dessiner();
  }

  function dessiner() {
    if (!scrutin) {
      conteneur.innerHTML = `<div class="vote-carte">
        <div class="vote-carte-tete">${icone('coeur')}<strong>Vote des membres</strong></div>
        <p class="vote-carte-texte">Fais voter les membres de l'asso par un lien, sans compte : chacun coche les cooptants qu'il veut absolument voir rejoindre l'asso. Les votes restent secrets jusqu'à la clôture, même pour le bureau.</p>
        <div class="vote-carte-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="organiser">Organiser un vote</button></div>
      </div>`;
    } else {
      const ont = new Set(participations.map(p => p.votantId));
      const nbVotants = (scrutin.votants || []).length;
      const max = scrutin.maxCoeurs;
      const qui = (scrutin.votants || []).slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
        .map(v => `<span class="vote-qui${ont.has(v.id) ? ' a-vote' : ''}" title="${ont.has(v.id) ? 'A voté' : 'Pas encore voté'}">${ont.has(v.id) ? '✓ ' : ''}${esc(v.nom)}</span>`).join('');
      const nbAbst = [...(resultats?.abstentions?.values() || [])].reduce((a, b) => a + b, 0);
      const envoisMultiples = scrutin.ouvert
        ? participations.filter(p => p.envois > 1).map(p => ({ votantId: p.votantId, envois: p.envois }))
        : (resultats?.plusieursEnvois || []);
      conteneur.innerHTML = `<div class="vote-carte">
        <div class="vote-carte-tete">${icone('coeur')}<strong>Vote des membres</strong>
          <span class="badge ${scrutin.ouvert ? 'badge-green' : 'badge-gray'}">${scrutin.ouvert ? 'Ouvert' : 'Clos'}</span>
          <span class="vote-carte-sous">${max} coup${max > 1 ? 's' : ''} de cœur par personne</span></div>
        ${scrutin.ouvert ? `<div class="vote-lien">
            <input class="form-input" type="text" readonly value="${esc(lien())}" aria-label="Lien de vote" />
            <button type="button" class="btn btn-primary btn-sm" data-act="copier">${icone('copier')} Copier le lien</button>
          </div>
          <p class="vote-carte-texte">À envoyer aux membres de l'asso. Chacun choisit son nom ; revoter remplace son vote précédent.</p>` : ''}
        <div class="vote-participation"><strong>${ont.size} sur ${nbVotants}</strong> ${ont.size > 1 ? 'ont' : 'a'} voté
          ${scrutin.ouvert ? '<button type="button" class="vote-lien-btn" data-act="actualiser">Actualiser</button>' : ''}</div>
        <div class="vote-quis">${qui}</div>
        ${envoisMultiples.length ? `<p class="vote-garde-fou">Plusieurs envois sous le même nom : ${envoisMultiples.map(x => `${esc(nomVotant(x.votantId))} (${x.envois})`).join(', ')}. Seul le dernier compte ; si c'est un abus, supprime le vote et recommence.</p>` : ''}
        ${!scrutin.ouvert && resultats ? `<p class="vote-carte-texte">${resultats.votants} vote${resultats.votants > 1 ? 's' : ''} compté${resultats.votants > 1 ? 's' : ''}${nbAbst ? `, ${nbAbst} abstention${nbAbst > 1 ? 's' : ''} (ami, coloc…)` : ''}. Les cœurs reçus s'affichent sur chaque ligne du classement ; « Plébiscité » marque ceux qui ont le cœur d'au moins deux tiers des votants.</p>` : ''}
        <div class="vote-carte-actions">
          ${scrutin.ouvert
            ? '<button type="button" class="btn btn-primary btn-sm" data-act="clore">Clore le vote</button>'
            : `<button type="button" class="btn btn-primary btn-sm" data-act="classer" ${resultats?.votants ? '' : 'disabled'}>Classer selon les votes</button>
               <button type="button" class="btn btn-secondary btn-sm" data-act="rouvrir">Rouvrir le vote</button>`}
          <button type="button" class="btn btn-ghost btn-sm vote-suppr" data-act="supprimer">Supprimer le vote</button>
        </div>
      </div>`;
    }
    conteneur.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => agir(b.dataset.act, b)));
  }

  async function agir(act, bouton) {
    try {
      if (act === 'organiser') return ouvrirDialogue();
      if (act === 'copier') {
        await navigator.clipboard.writeText(lien());
        return showToast('Lien de vote copié.', 'success');
      }
      if (act === 'actualiser') { bouton.disabled = true; return await charger(); }
      if (act === 'clore') {
        if (!await confirmDialog('Plus personne ne pourra voter, et le bureau verra les résultats. Tu pourras rouvrir le vote ensuite.',
          { title: 'Clore le vote ?', confirmLabel: 'Clore le vote', danger: false })) return;
        await updateDoc(doc(db, 'scrutins', scrutin.id), { ouvert: false, closLe: serverTimestamp() });
        showToast('Vote clos.', 'success');
        return await charger();
      }
      if (act === 'rouvrir') {
        await updateDoc(doc(db, 'scrutins', scrutin.id), { ouvert: true });
        showToast('Vote rouvert : les votes redeviennent secrets jusqu\'à la clôture.', 'success');
        return await charger();
      }
      if (act === 'classer') {
        if (!resultats) return;
        if (!await confirmDialog('Le classement est réordonné : le plus de coups de cœur d\'abord (en part des votants, sans compter ceux qui se sont abstenus sur la personne), puis le score pour départager. Tu pourras ensuite déplacer et ajuster comme d\'habitude.',
          { title: 'Classer selon les votes ?', confirmLabel: 'Classer', danger: false })) return;
        await o.classer(resultats);
        return showToast('Classement mis à jour selon les votes.', 'success');
      }
      if (act === 'supprimer') {
        if (!await confirmDialog('Le vote, tous les bulletins et le lien sont supprimés définitivement. Le classement actuel ne change pas.',
          { title: 'Supprimer le vote ?', confirmLabel: 'Supprimer' })) return;
        await supprimer();
        showToast('Vote supprimé.', 'success');
        return await charger();
      }
    } catch (e) {
      console.error(e);
      showToast('Erreur : ' + (e.message || e), 'error');
    }
  }

  /** Bulletins et participations d'abord : un scrutin supprimé ne doit pas laisser de bulletins orphelins. */
  async function supprimer() {
    // Fermer d'abord : les bulletins ne se lisent (donc ne se listent pour
    // être effacés) qu'une fois le vote clos.
    if (scrutin.ouvert) await updateDoc(doc(db, 'scrutins', scrutin.id), { ouvert: false });
    const [b, p] = await Promise.all([
      getDocs(query(collection(db, 'bulletins'), where('organizationId', '==', org.id), where('scrutinId', '==', scrutin.id))),
      getDocs(query(collection(db, 'participations'), where('organizationId', '==', org.id), where('scrutinId', '==', scrutin.id))),
    ]);
    const refs = [...b.docs, ...p.docs].map(d => d.ref);
    for (let i = 0; i < refs.length; i += 400) {
      const lot = writeBatch(db);
      refs.slice(i, i + 400).forEach(r => lot.delete(r));
      await lot.commit();
    }
    const fin = writeBatch(db);
    fin.delete(doc(db, 'scrutins', scrutin.id));
    await fin.commit();
  }

  async function ouvrirDialogue() {
    const roster = await getDocs(query(collection(db, 'roster_members'), where('organizationId', '==', org.id)));
    const votants = roster.docs.map(d => ({ id: d.id, nom: (d.data().displayName || d.data().name || '').trim() }))
      .filter(v => v.nom).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const cooptants = o.cooptants();
    const conseil = maxCoeursConseille(o.nbPlaces());

    const fond = document.createElement('div');
    fond.className = 'fiche-overlay open';
    fond.innerHTML = `<div class="fiche vote-dialogue" role="dialog" aria-modal="true" aria-labelledby="vote-dlg-titre">
      <div class="fiche-tete"><div style="flex:1;"><div class="fiche-k">Délibération</div><h3 id="vote-dlg-titre">Organiser un vote</h3></div>
        <button type="button" class="fiche-btn-icone" data-fermer aria-label="Fermer">✕</button></div>
      <div class="fiche-corps">
        <p class="vote-carte-texte" style="margin:0;">Chaque membre ouvre le lien, choisit son nom et coche les cooptants qu'il veut absolument voir rejoindre l'asso. Il peut aussi s'abstenir sur ${MAX_ABSTENTIONS} cooptants au plus (un ami, un coloc). Les ${cooptants.length} cooptants sont proposés avec leur nom et leur parcours, sans leur score.</p>
        <label class="vote-champ">Coups de cœur par personne
          <input class="form-input" type="number" id="vote-max" min="1" max="30" value="${conseil}" /></label>
        <div class="fiche-titre-ligne"><div class="fiche-section">Qui vote&nbsp;? <span id="vote-nb"></span></div>
          <button type="button" class="vote-lien-btn" id="vote-tous">Tout décocher</button></div>
        <div class="vote-votants" id="vote-votants">${votants.length ? votants.map(v => `<label class="checkbox-wrap"><input type="checkbox" value="${esc(v.id)}" data-nom="${esc(v.nom)}" checked><span>${esc(v.nom)}</span></label>`).join('')
          : '<p class="text-sm text-muted">La liste du staff est vide : ajoute les noms des membres ci-dessous.</p>'}</div>
        <div class="vote-ajout"><input class="form-input" type="text" id="vote-ajout" placeholder="Ajouter un nom (membre hors liste du staff)" maxlength="60" />
          <button type="button" class="btn btn-secondary btn-sm" id="vote-ajouter">Ajouter</button></div>
        <p class="text-sm text-muted" style="margin:0;">Seuls ces noms pourront voter : personne ne peut ajouter le sien depuis le lien.</p>
      </div>
      <div class="fiche-pied"><button type="button" class="btn btn-secondary btn-sm" data-fermer>Annuler</button>
        <button type="button" class="btn btn-primary btn-sm" id="vote-ouvrir" style="margin-left:auto;">Ouvrir le vote</button></div>
    </div>`;
    document.body.appendChild(fond);
    const $ = s => fond.querySelector(s);
    const fermer = () => { fond.remove(); document.removeEventListener('keydown', echap); };
    const echap = e => { if (e.key === 'Escape') fermer(); };
    document.addEventListener('keydown', echap);
    fond.addEventListener('click', e => { if (e.target === fond || e.target.closest('[data-fermer]')) fermer(); });
    const cases = () => [...fond.querySelectorAll('#vote-votants input[type=checkbox]')];
    const compter = () => { $('#vote-nb').textContent = `(${cases().filter(c => c.checked).length})`; };
    fond.querySelector('#vote-votants').addEventListener('change', compter);
    $('#vote-tous').addEventListener('click', () => {
      const tout = cases().some(c => !c.checked);
      cases().forEach(c => { c.checked = tout; });
      $('#vote-tous').textContent = tout ? 'Tout décocher' : 'Tout cocher';
      compter();
    });
    const ajouter = () => {
      const nom = $('#vote-ajout').value.trim();
      if (!nom) return;
      if (cases().some(c => c.dataset.nom.toLowerCase() === nom.toLowerCase())) { showToast('Ce nom est déjà dans la liste.', 'info'); return; }
      $('#vote-votants').querySelector('p')?.remove();
      $('#vote-votants').insertAdjacentHTML('beforeend', `<label class="checkbox-wrap"><input type="checkbox" value="v_${nouveauJeton(10)}" data-nom="${esc(nom)}" checked><span>${esc(nom)}</span></label>`);
      $('#vote-ajout').value = '';
      compter();
    };
    $('#vote-ajouter').addEventListener('click', ajouter);
    $('#vote-ajout').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ajouter(); } });
    compter();
    $('#vote-ouvrir').addEventListener('click', async e => {
      const bouton = e.currentTarget;
      const choisis = cases().filter(c => c.checked).map(c => ({ id: c.value, nom: c.dataset.nom }));
      const max = Math.round(Number($('#vote-max').value));
      if (!choisis.length) return showToast('Coche au moins une personne qui vote.', 'error');
      if (!(max >= 1 && max <= 30)) return showToast('Entre 1 et 30 coups de cœur par personne.', 'error');
      if (!cooptants.length) return showToast('Aucun cooptant à proposer au vote.', 'error');
      bouton.disabled = true; bouton.textContent = 'Ouverture…';
      try {
        await setDoc(doc(db, 'scrutins', nouveauJeton()), {
          organizationId: org.id, campaignId: campaign.id, methode: 'coeurs', ouvert: true, maxCoeurs: max,
          votants: choisis, votantIds: choisis.map(v => v.id),
          cooptants, cooptantIds: cooptants.map(c => c.id),
          creeLe: serverTimestamp(),
        });
        fermer();
        showToast('Vote ouvert : copie le lien et envoie-le aux membres.', 'success');
        await charger();
      } catch (err) {
        bouton.disabled = false; bouton.textContent = 'Ouvrir le vote';
        showToast('Vote non ouvert : ' + err.message, 'error');
      }
    });
    setTimeout(() => $('#vote-max').focus(), 30);
  }

  charger().catch(e => { console.warn('Vote des membres illisible :', e); conteneur.innerHTML = ''; });
  return { recharger: charger };
}
