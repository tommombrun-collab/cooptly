/**
 * Résolution d'une organisation depuis un `?org=` de lien public.
 *
 * Les liens de cooptation circulent en story Instagram, en groupe WhatsApp, sur
 * des affiches. Renommer une asso changeait son slug et cassait silencieusement
 * tout ce qui avait déjà été partagé : le cooptant tombait sur « Association
 * introuvable » sans que personne du bureau ne le sache.
 *
 * On accepte donc trois formes, dans cet ordre :
 *   1. l'ID du document,
 *   2. le slug courant,
 *   3. un ancien slug, conservé dans `slugHistory` lors des renommages.
 *
 * Ce module importe Firestore directement (et non `db.js`) pour rester
 * utilisable par les pages publiques, qui n'initialisent pas Firebase Auth.
 */
import { collection, doc, getDoc, getDocs, query, where }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {string|null} value ID, slug courant ou ancien slug
 * @returns {Promise<object|null>} `{ id, ...données }`, ou null si introuvable
 */
export async function resolveOrg(db, value) {
  if (!value) return null;

  // Identifiant et slug sont cherchés EN MÊME TEMPS. À la suite, un lien par
  // slug (le cas courant) attendait d'abord l'échec de la recherche par
  // identifiant : un aller-retour réseau perdu à chaque ouverture de page
  // publique, sur le chemin critique de l'affichage.
  const [byId, bySlug] = await Promise.all([
    getDoc(doc(db, 'organizations', value)),
    getDocs(query(collection(db, 'organizations'), where('slug', '==', value))),
  ]);
  if (byId.exists()) return { id: byId.id, ...byId.data() };
  if (!bySlug.empty) return { id: bySlug.docs[0].id, ...bySlug.docs[0].data() };

  // Ancien lien : l'asso a été renommée depuis que le lien a été partagé.
  // Rare, donc seulement si les deux premières pistes ont échoué.
  const byOldSlug = await getDocs(
    query(collection(db, 'organizations'), where('slugHistory', 'array-contains', value))
  );
  if (!byOldSlug.empty) return { id: byOldSlug.docs[0].id, ...byOldSlug.docs[0].data() };

  // Lien retapé avec des majuscules (« ?org=MonAsso ») : les slugs sont en
  // minuscules. Pas avant, car un ID Firestore, lui, distingue la casse.
  const minuscule = value.toLowerCase();
  if (minuscule !== value) return resolveOrg(db, minuscule);

  return null;
}

/**
 * Même résolution, mais ne renvoie que l'ID.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string|null} value
 * @returns {Promise<string|null>}
 */
export async function resolveOrgId(db, value) {
  const org = await resolveOrg(db, value);
  return org ? org.id : null;
}
