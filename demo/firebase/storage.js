/**
 * firebase-storage factice : un fichier envoyé (logo, image de question) est
 * gardé en data URL, donc affichable sans aucun serveur.
 */
export const getStorage = () => ({ type: 'storage' });
export const ref = (storage, path) => ({ path });
export async function uploadBytes(r, file) {
  r._url = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file);
  });
  return { ref: r };
}
export async function getDownloadURL(r) { return r._url || ''; }
