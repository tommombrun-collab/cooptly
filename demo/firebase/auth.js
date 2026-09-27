/**
 * firebase-auth factice. Les comptes vivent dans la base de démo
 * (collection interne `__comptes`) ; la session dans le localStorage.
 * Aucun mot de passe réel n'est demandé ni transmis.
 */
import { chargerBase, sauverBase } from '../store.js';

const CLE_SESSION = 'cooptly_demo_session';
const auth = { currentUser: null };
const ecouteurs = new Set();

const erreur = code => Object.assign(new Error(code), { code });
const utilisateur = c => c && ({
  uid: c.uid, email: c.email, displayName: c.displayName || null,
  getIdToken: async () => 'demo',
});

function restaurer() {
  let uid = null;
  try { uid = localStorage.getItem(CLE_SESSION); } catch { /* rien */ }
  const c = uid && chargerBase().__comptes?.[uid];
  auth.currentUser = c ? utilisateur(c) : null;
}
restaurer();

function changer(c) {
  auth.currentUser = c ? utilisateur(c) : null;
  try {
    if (c) localStorage.setItem(CLE_SESSION, c.uid); else localStorage.removeItem(CLE_SESSION);
  } catch { /* rien */ }
  ecouteurs.forEach(fn => setTimeout(() => fn(auth.currentUser), 0));
}

const comptes = () => chargerBase().__comptes || {};
const parEmail = email => Object.values(comptes()).find(c => c.email === String(email).trim().toLowerCase());

export const getAuth = () => auth;

export function onAuthStateChanged(a, fn) {
  ecouteurs.add(fn);
  setTimeout(() => fn(auth.currentUser), 0);
  return () => ecouteurs.delete(fn);
}

export async function signInWithEmailAndPassword(a, email, mdp) {
  await new Promise(r => setTimeout(r, 250));
  const c = parEmail(email);
  if (!c || c.mdp !== mdp) throw erreur('auth/invalid-credential');
  changer(c);
  return { user: auth.currentUser };
}

export async function createUserWithEmailAndPassword(a, email, mdp) {
  await new Promise(r => setTimeout(r, 250));
  if (parEmail(email)) throw erreur('auth/email-already-in-use');
  if (String(mdp).length < 6) throw erreur('auth/weak-password');
  const base = chargerBase();
  const uid = 'demo_' + Math.random().toString(36).slice(2, 10);
  base.__comptes = { ...(base.__comptes || {}), [uid]: { uid, email: String(email).trim().toLowerCase(), mdp } };
  sauverBase(base);
  changer(base.__comptes[uid]);
  return { user: auth.currentUser };
}

export async function signOut() { changer(null); }

export async function updateProfile(user, { displayName }) {
  const base = chargerBase();
  if (base.__comptes?.[user.uid]) { base.__comptes[user.uid].displayName = displayName; sauverBase(base); }
  if (auth.currentUser?.uid === user.uid) auth.currentUser.displayName = displayName;
}

export async function sendPasswordResetEmail() {
  // Démo : aucun email n'est envoyé, mais le parcours se déroule normalement.
}

export const EmailAuthProvider = { credential: (email, mdp) => ({ email, mdp }) };

export async function reauthenticateWithCredential(user, cred) {
  const c = comptes()[user.uid];
  if (!c || c.mdp !== cred.mdp) throw erreur('auth/invalid-credential');
}

export async function updatePassword(user, mdp) {
  const base = chargerBase();
  if (base.__comptes?.[user.uid]) { base.__comptes[user.uid].mdp = mdp; sauverBase(base); }
}
