/**
 * Changer son mot de passe sans passer par un email.
 *
 * « Mot de passe oublié ? » envoie un lien par email, que les adresses emlyon
 * ne reçoivent pas (Firebase y est bloqué). Ici, la personne connectée tape
 * son mot de passe actuel puis le nouveau : Firebase exige une connexion
 * récente pour ce changement, on la refait donc avec le mot de passe actuel.
 *
 * Effet sur les sessions : Firebase déconnecte ce compte sur les AUTRES
 * appareils (au plus tard à l'expiration de leur jeton, sous une heure) ;
 * la session courante reste ouverte. Les autres comptes ne sont pas touchés.
 */
import { auth } from './auth.js';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const LONGUEUR_MIN = 8;   // même règle qu'à la création du compte (index.html)

const MESSAGES = {
  'auth/wrong-password':         'Mot de passe actuel incorrect.',
  'auth/invalid-credential':     'Mot de passe actuel incorrect.',
  'auth/invalid-login-credentials': 'Mot de passe actuel incorrect.',
  'auth/too-many-requests':      'Trop de tentatives. Réessaie dans quelques minutes.',
  'auth/weak-password':          `Nouveau mot de passe trop simple (${LONGUEUR_MIN} caractères minimum).`,
  'auth/network-request-failed': 'Pas de connexion internet. Réessaie.',
  'auth/requires-recent-login':  'Reconnecte-toi puis réessaie.',
};

let overlay = null;

function construire() {
  overlay = document.createElement('div');
  overlay.className = 'confirm-dialog-overlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <form class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="mdp-titre" novalidate style="max-width:400px;">
      <p class="confirm-dialog-title" id="mdp-titre">Changer mon mot de passe</p>
      <p class="confirm-dialog-message" style="margin-bottom:14px;" id="mdp-compte"></p>
      <div class="form-group">
        <label class="form-label" for="mdp-actuel">Mot de passe actuel</label>
        <input class="form-input" type="password" id="mdp-actuel" autocomplete="current-password" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="mdp-nouveau">Nouveau mot de passe</label>
        <input class="form-input" type="password" id="mdp-nouveau" autocomplete="new-password" minlength="${LONGUEUR_MIN}" required />
        <span class="form-hint">${LONGUEUR_MIN} caractères minimum.</span>
      </div>
      <div class="form-group">
        <label class="form-label" for="mdp-confirme">Confirme le nouveau mot de passe</label>
        <input class="form-input" type="password" id="mdp-confirme" autocomplete="new-password" required />
      </div>
      <p class="text-sm text-muted" style="margin:0 0 14px;">
        Ce compte sera déconnecté sur tes autres appareils. Les autres membres ne sont pas concernés.
      </p>
      <p id="mdp-erreur" role="alert" style="display:none;margin:0 0 12px;font-size:13px;color:var(--red);"></p>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="mdp-annuler">Annuler</button>
        <button type="submit" class="btn btn-primary btn-sm" id="mdp-valider">Enregistrer</button>
      </div>
    </form>`;
  document.body.appendChild(overlay);

  const $ = id => overlay.querySelector('#' + id);
  $('mdp-annuler').addEventListener('click', fermer);
  overlay.addEventListener('click', e => { if (e.target === overlay) fermer(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') fermer();
  });

  overlay.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const erreur = msg => { $('mdp-erreur').textContent = msg; $('mdp-erreur').style.display = msg ? '' : 'none'; };
    const actuel = $('mdp-actuel').value;
    const nouveau = $('mdp-nouveau').value;
    erreur('');
    if (!actuel) return erreur('Tape ton mot de passe actuel.');
    if (nouveau.length < LONGUEUR_MIN) return erreur(`Nouveau mot de passe : ${LONGUEUR_MIN} caractères minimum.`);
    if (nouveau !== $('mdp-confirme').value) return erreur('Les deux nouveaux mots de passe ne correspondent pas.');
    if (nouveau === actuel) return erreur('Le nouveau mot de passe est identique à l’actuel.');

    const user = auth.currentUser;
    if (!user?.email) return erreur('Reconnecte-toi puis réessaie.');

    const btn = $('mdp-valider');
    btn.disabled = true; btn.textContent = 'Enregistrement…';
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, actuel));
      await updatePassword(user, nouveau);
      fermer();
      // showToast vit dans utils.js ; import dynamique pour garder ce module léger.
      const { showToast } = await import('./utils.js');
      showToast('Mot de passe modifié.', 'success');
    } catch (err) {
      erreur(MESSAGES[err?.code] || ('Erreur : ' + (err?.message || err)));
    } finally {
      btn.disabled = false; btn.textContent = 'Enregistrer';
    }
  });
}

function fermer() {
  if (!overlay) return;
  overlay.style.display = 'none';
  // Rien ne reste dans la page une fois la fenêtre fermée.
  overlay.querySelectorAll('input').forEach(i => { i.value = ''; });
  overlay.querySelector('#mdp-erreur').style.display = 'none';
}

/** Ouvre la fenêtre de changement de mot de passe pour la personne connectée. */
export function ouvrirChangementMdp() {
  if (!overlay) construire();
  overlay.querySelector('#mdp-compte').textContent = auth.currentUser?.email ? `Compte : ${auth.currentUser.email}` : '';
  overlay.style.display = 'flex';
  setTimeout(() => overlay.querySelector('#mdp-actuel').focus(), 30);
}
