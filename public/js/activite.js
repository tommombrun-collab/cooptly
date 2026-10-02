/**
 * Statistiques de connexion des membres CONNECTÉS (bureau, admin), lisibles
 * par le seul admin plateforme (page admin/connexions.html, firestore.rules).
 *
 * Une fiche par compte, `activite/{uid}` : dernière activité, asso et rôle du
 * moment, et un compteur de sessions par jour (`jours.AAAA-MM-JJ`). Une
 * session = un onglet ouvert ce jour-là (sessionStorage), pas chaque page :
 * on veut savoir QUAND la personne vient, pas la suivre clic par clic.
 * Les personnes sans compte (liens publics du staff) ne sont jamais comptées.
 */
import { app } from './auth.js';
import { getFirestore, doc, setDoc, serverTimestamp, increment }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const db = getFirestore(app);

const aujourdhui = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Note l'activité de la personne connectée. Sans effet si elle a déjà été
 * notée dans cet onglet aujourd'hui (seule la date de dernière activité suit).
 * N'échoue jamais : une statistique ne doit pas gêner la page.
 */
export async function noterActivite(user, { nom = '', orgId = null, orgName = '', role = '' } = {}) {
  if (!user?.uid) return;
  const jour = aujourdhui();
  const cle = `_activite_${user.uid}_${jour}`;
  let nouvelleSession = true;
  try {
    nouvelleSession = !sessionStorage.getItem(cle);
    sessionStorage.setItem(cle, '1');
  } catch { /* navigation privée : on compte quand même */ }
  try {
    await setDoc(doc(db, 'activite', user.uid), {
      uid: user.uid,
      email: user.email || '',
      nom: nom || user.email || '',
      role, orgId, orgName,
      derniereActivite: serverTimestamp(),
      ...(nouvelleSession ? { jours: { [jour]: increment(1) }, sessions: increment(1) } : {}),
    }, { merge: true });
  } catch (e) {
    console.warn('Activité non enregistrée :', e);
  }
}
