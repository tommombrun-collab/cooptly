import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, updateDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { resolveOrgId } from './org-lookup.js';
import { paramLien } from './utils.js';

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

export { app, auth, db };

// ─── Cache module-level : évite les requêtes Firestore répétées par page ─────
// Réinitialisé à chaque rechargement de page (modules ES ne persistent pas entre navigations)
let _membershipCache = null; // { uid, snap }
let _adminCache      = null; // { uid, isAdmin }

/** Crée un compte (tout email accepté en bêta) */
export async function createAccount(email, password, displayName) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await updateProfile(result.user, { displayName });
  return result.user;
}

/** Connexion email + mot de passe */
export async function loginWithPassword(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

/**
 * Vide le cache des memberships.
 * À appeler après avoir rejoint une asso, sinon la liste affichée reste
 * celle d'avant, le cache étant gardé pour toute la durée de la page.
 */
export function clearMembershipCache() {
  _membershipCache = null;
}

/** Déconnexion */
export async function logout() {
  _membershipCache = null;
  _adminCache = null;
  await signOut(auth);
}

/** Résolution asynchrone de l'état d'auth */
export function getCurrentUser() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
  });
}

/**
 * Vérifie si l'utilisateur est admin plateforme (avec cache).
 */
async function isAdmin(user) {
  if (_adminCache?.uid === user.uid) return _adminCache.isAdmin;

  // Le cache mémoire ne survit pas à un changement de page : sans ce relais
  // en sessionStorage, chaque page du bureau relisait `platform_admins` avant
  // de pouvoir afficher quoi que ce soit. Durée courte, et sans risque : ce
  // statut ne sert qu'à l'affichage, les règles Firestore le revérifient à
  // chaque lecture et écriture.
  const cle = `_admin_${user.uid}`;
  try {
    const memo = JSON.parse(sessionStorage.getItem(cle) || 'null');
    if (memo && Date.now() - memo.t < 10 * 60 * 1000) {
      _adminCache = { uid: user.uid, isAdmin: memo.v };
      return memo.v;
    }
  } catch { /* stockage bloqué : on relit */ }

  const adminDoc = await getDoc(doc(db, 'platform_admins', user.uid));
  _adminCache = { uid: user.uid, isAdmin: adminDoc.exists() };
  try { sessionStorage.setItem(cle, JSON.stringify({ v: _adminCache.isAdmin, t: Date.now() })); } catch {}
  return _adminCache.isAdmin;
}

/**
 * Recherche le membership (avec cache).
 * Couvre 3 cas par ordre de priorité :
 *   1. userId == uid           (cas normal, déjà migré)
 *   2. email == user.email     (nouveau format, userId encore un email)
 *   3. userId == user.email    (ancien format sans champ email séparé)
 *
 * La migration userId email→UID est tentée en fire-and-forget :
 * elle n'a pas à réussir pour que l'auth fonctionne.
 */
async function resolveUserMembership(user) {
  if (_membershipCache?.uid === user.uid) return _membershipCache.snap;

  let snap = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user.uid)));

  if (snap.empty) {
    const byEmail = await getDocs(query(collection(db, 'memberships'), where('email', '==', user.email)));
    if (!byEmail.empty) {
      snap = byEmail;
      // Migration fire-and-forget sur TOUS les docs : un membre de deux
      // bureaux a deux memberships, et n'en migrer qu'un rendrait le second
      // définitivement introuvable (la branche 1 ne serait plus vide).
      byEmail.docs.forEach(d => updateDoc(d.ref, { userId: user.uid }).catch(() => {}));
    }
  }

  if (snap.empty) {
    const byUidAsEmail = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user.email)));
    if (!byUidAsEmail.empty) {
      snap = byUidAsEmail;
      byUidAsEmail.docs.forEach(d =>
        updateDoc(d.ref, { userId: user.uid, email: user.email }).catch(() => {}));
    }
  }

  // Doc canonique pour CHAQUE asso, pas seulement la première : les règles
  // Firestore vérifient `memberships/{uid}_{orgId}` org par org.
  snap.docs.forEach(d => ensureCanonicalMembership(user, d));

  _membershipCache = { uid: user.uid, snap };
  return snap;
}

/**
 * Memberships de l'utilisateur, dédupliqués par asso.
 *
 * Un même utilisateur peut avoir plusieurs documents pour la même asso
 * (doc pré-ajouté par email + doc canonique créé à la connexion). On garde
 * le canonique en priorité, c'est celui que les règles Firestore voient.
 *
 * @returns {Promise<Array<{id, organizationId, role, ...}>>}
 */
export async function getMyMemberships(user) {
  if (!user) return [];
  const snap = await resolveUserMembership(user);
  const byOrg = new Map();
  snap.docs.forEach(d => {
    const data  = { id: d.id, ...d.data() };
    const orgId = data.organizationId;
    if (!orgId) return;
    const canonical = d.id === `${user.uid}_${orgId}`;
    // Le doc canonique gagne ; sinon le premier trouvé fait l'affaire.
    if (!byOrg.has(orgId) || canonical) byOrg.set(orgId, data);
  });
  return [...byOrg.values()];
}

/**
 * Membership de l'utilisateur POUR UNE ASSO DONNÉE.
 * À préférer partout où l'on connaît l'org : le rôle est propre à chaque asso
 * (on peut être président ici et simple membre là).
 *
 * @returns {Promise<object|null>}
 */
export async function getMembershipForOrg(user, orgId) {
  if (!user || !orgId) return null;
  const all = await getMyMemberships(user);
  return all.find(m => m.organizationId === orgId) || null;
}

/**
 * Garantit l'existence du doc `memberships/{uid}_{orgId}`.
 *
 * Les règles Firestore vérifient l'appartenance à une asso via `isSecge(orgId)`,
 * qui teste l'existence de ce chemin exact. Or les membres pré-ajoutés par email
 * (parametres.html, admin/permissions.html) obtiennent un doc à ID auto-généré :
 * l'app les résout par requête de champ, mais les règles ne les verraient pas.
 *
 * On crée donc le doc canonique à la volée. Ne rejette jamais : un échec
 * (réseau, règle) ne doit pas empêcher la connexion. Renvoie une promesse
 * pour que les appelants qui en dépendent (requireSecge) puissent l'attendre.
 *
 * @returns {Promise<void>}
 */
function ensureCanonicalMembership(user, memDoc) {
  if (!memDoc) return Promise.resolve();
  const data  = memDoc.data();
  const orgId = data.organizationId;
  if (!orgId) return Promise.resolve();

  const canonicalId = `${user.uid}_${orgId}`;
  if (memDoc.id === canonicalId) return Promise.resolve();   // déjà au bon format

  return setDoc(doc(db, 'memberships', canonicalId), {
    ...data,
    userId: user.uid,
    email:  data.email || user.email,
    // Justificatif exigé par les règles Firestore : prouve que ce rattachement
    // découle d'un membership existant pour la même asso, portant notre email.
    promotedFrom: memDoc.id,
  }, { merge: true }).catch(err => {
    // Ne bloque pas la connexion, mais reste diagnosticable : un refus ici
    // signifie que l'utilisateur n'aura pas les droits d'écriture sur cette asso.
    console.warn(`Rattachement à l'asso ${orgId} refusé :`, err?.code || err);
  });
}

const BUREAU_ROLES = ['secge', 'president'];

/**
 * Retourne le rôle de l'utilisateur : 'admin' | 'secge' | 'cooptant' | null
 *
 * @param {object} user
 * @param {string} [orgId] Asso concernée. Le rôle est propre à chaque asso :
 *   on peut être bureau ici et simple membre là. **Sans orgId**, on répond
 *   'secge' dès qu'AU MOINS UNE asso donne ce rôle, sinon un membre de deux
 *   bureaux pourrait être bloqué à la connexion selon l'asso tirée en premier.
 */
export async function getUserRole(user, orgId = null) {
  if (!user) return null;
  // Admin + memberships en parallèle pour éviter la latence séquentielle
  const [adminOk, memberships] = await Promise.all([isAdmin(user), getMyMemberships(user)]);
  if (adminOk) return 'admin';

  const relevant = orgId
    ? memberships.filter(m => m.organizationId === orgId)
    : memberships;
  if (relevant.some(m => BUREAU_ROLES.includes(m.role))) return 'secge';
  return 'cooptant';
}

/**
 * Détermine sur quelle asso travaille la page courante.
 *
 * Priorité : `?org=` dans l'URL → asso mémorisée dans la session → première
 * asso de l'utilisateur. Source unique de vérité : toutes les pages bureau
 * doivent passer par ici, sinon elles divergent (planning.html ne lisait même
 * pas `?org=` et restait bloquée sur une seule asso).
 *
 * Un orgId demandé qui n'appartient PAS à l'utilisateur est ignoré, sauf
 * pour un admin plateforme, qui peut consulter n'importe quelle asso.
 *
 * Mémorise le résultat dans `sessionStorage` pour les pages qui n'ont pas
 * `?org=` dans leur URL.
 *
 * @returns {Promise<string|null>} orgId, ou null si l'utilisateur n'a aucune asso
 */
export async function resolveOrgContext(user) {
  if (!user) return null;

  const brut = paramLien('org')
            || sessionStorage.getItem('currentOrgId');

  // Déjà en cache après requireSecge : ces deux appels ne coûtent rien.
  const [adminOk, mine] = await Promise.all([isAdmin(user), getMyMemberships(user)]);

  if (adminOk) {
    // L'admin n'a pas de membership : on lui fait confiance sur l'org demandée,
    // mais un slug doit être traduit en ID (sinon campagne fantôme).
    const asked = await normalizeOrgId(brut);
    if (asked) sessionStorage.setItem('currentOrgId', asked);
    return asked || null;
  }

  if (!mine.length) return null;

  // Cas courant : l'identifiant demandé est déjà l'une de ses assos (il vient
  // de sessionStorage ou d'un lien interne). Inutile alors d'interroger le
  // réseau pour le « normaliser », ce que faisait chaque page du bureau avant
  // d'afficher quoi que ce soit. On ne traduit que ce qui ressemble à un slug.
  const siennes = new Set(mine.map(m => m.organizationId));
  const asked = (!brut || siennes.has(brut)) ? brut : await normalizeOrgId(brut);

  // On ne retient l'org demandée que si elle est bien à l'utilisateur : évite
  // qu'un `currentOrgId` périmé (autre asso, autre onglet) ne s'applique.
  const orgId = siennes.has(asked) ? asked : mine[0].organizationId;

  sessionStorage.setItem('currentOrgId', orgId);
  return orgId;
}

/**
 * Traduit un `?org=` en ID de document.
 *
 * Les liens publics acceptent indifféremment un slug ou un ID, et les pages
 * bureau partagent la même URL. Sans cette traduction, `?org=asso-test` faisait
 * travailler toute la page sur la chaîne « asso-test » : `getOrCreateOrgCampaign`
 * créait alors une campagne fantôme portant un slug en `organizationId`, que
 * personne ne pouvait plus écrire puisque `isSecge()` cherche
 * `memberships/{uid}_{orgId}`. Un tel document existe en base depuis ce bug.
 *
 * @param {string|null} value slug ou ID
 * @returns {Promise<string|null>} ID de document, ou la valeur d'origine si
 *   aucune asso ne correspond (l'appelant reste libre de la rejeter)
 */
export async function normalizeOrgId(value) {
  if (!value) return null;
  // Accepte aussi un ancien slug : voir org-lookup.js.
  return (await resolveOrgId(db, value)) || value;
}

/** Redirige vers login si non connecté, retourne user */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = '/index.html';
    throw new Error('Non authentifié');
  }
  // Synchro profil une fois par session → permet la recherche admin par email
  if (!sessionStorage.getItem('_ps')) {
    setDoc(doc(db, 'users', user.uid), {
      email:       user.email,
      displayName: user.displayName || user.email.split('@')[0],
      lastSeen:    serverTimestamp()
    }, { merge: true }).catch(() => {});
    sessionStorage.setItem('_ps', '1');
  }
  return user;
}

/** Vérifie que l'utilisateur est admin plateforme */
export async function requireAdmin() {
  const user = await requireAuth();
  if (!(await isAdmin(user))) { window.location.href = '/index.html'; throw new Error('Accès refusé'); }
  return user;
}

/**
 * Vérifie que l'utilisateur est membre (secge/president/member) d'une asso, ou admin.
 * Lance admin + membership en parallèle → latence réduite de moitié pour les membres.
 */
export async function requireOrgMember() {
  const user = await requireAuth();
  const [adminOk, memSnap] = await Promise.all([isAdmin(user), resolveUserMembership(user)]);
  if (adminOk || !memSnap.empty) return user;
  window.location.href = '/index.html';
  throw new Error('Accès refusé');
}

/**
 * Vérifie que l'utilisateur est sec-gé, président, ou admin plateforme.
 * Lance admin + membership en parallèle.
 */
export async function requireSecge(orgId = null) {
  const user = await requireAuth();
  const [adminOk, memberships] = await Promise.all([isAdmin(user), getMyMemberships(user)]);
  if (adminOk) return user;

  // Si la page sait de quelle asso il s'agit, on exige le rôle bureau POUR
  // CETTE asso. Sinon il suffit de l'être quelque part (la page résoudra
  // ensuite son org, et l'accès y sera vérifié par les règles Firestore).
  const bureau = memberships.filter(m => BUREAU_ROLES.includes(m.role));
  const allowed = orgId
    ? bureau.some(m => m.organizationId === orgId)
    : bureau.length > 0;
  if (!allowed) { window.location.href = '/index.html'; throw new Error('Accès refusé'); }

  // Les pages bureau écrivent la config de l'asso, et les règles Firestore
  // exigent `memberships/{uid}_{orgId}`. On attend ici que les docs canoniques
  // existent (contrairement au fire-and-forget de resolveUserMembership), pour
  // ne pas laisser un membre pré-ajouté par email se heurter à un refus
  // d'écriture. No-op pour les docs déjà au bon format.
  const snap = await resolveUserMembership(user);
  // Après migration, la recherche renvoie À LA FOIS l'ancien document (ajouté
  // par email) et le document canonique. Sans ce filtre, l'ancien déclenchait
  // une réécriture du canonique à chaque ouverture de page, attendue avant
  // d'afficher quoi que ce soit.
  const dejaCanoniques = new Set(snap.docs.map(d => d.id));
  const aRattacher = snap.docs.filter(d => {
    const orgId = d.data().organizationId;
    return orgId && !dejaCanoniques.has(`${user.uid}_${orgId}`);
  });
  await Promise.all(aRattacher.map(d => ensureCanonicalMembership(user, d)));
  return user;
}
