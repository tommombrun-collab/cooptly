/**
 * Construit la démo en ligne (GitHub Pages) à partir de public/, sans toucher
 * au code de l'application.
 *
 *   node scripts/build-demo.mjs [base]      base par défaut : /cooptly
 *
 * Ce que fait la construction, pour chaque page HTML :
 *  1. une import map redirige les modules Firebase (SDK en CDN) vers les
 *     modules factices de demo/firebase/ : l'appli croit parler à Firebase,
 *     elle parle à une base en mémoire (demo/store.js, demo/seed.js) ;
 *  2. le préchargement du vrai SDK est retiré (inutile, et c'était du réseau) ;
 *  3. le bandeau de démo (demo/banner.js) est ajouté ;
 *  4. les chemins absolus (« /js/… », « /secge/… ») sont préfixés par la base,
 *     car un site de projet GitHub Pages est servi sous /<nom-du-dépôt>/.
 *
 * Résultat dans _site/, prêt à publier.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(RACINE, '_site');
const BASE = (process.argv[2] ?? '/cooptly').replace(/\/$/, '');
const SDK = 'https://www.gstatic.com/firebasejs/10.12.0/';

rmSync(SORTIE, { recursive: true, force: true });
mkdirSync(SORTIE, { recursive: true });
cpSync(join(RACINE, 'public'), SORTIE, { recursive: true });
cpSync(join(RACINE, 'demo'), join(SORTIE, 'demo'), { recursive: true });
writeFileSync(join(SORTIE, '.nojekyll'), '');   // GitHub Pages : servir les fichiers tels quels

// Entrées de premier niveau du site : seuls les chemins qui y mènent sont
// préfixés, pour ne jamais toucher à une URL externe ou à un « // » de commentaire.
const entrees = readdirSync(SORTIE).filter(n => !n.startsWith('.'));
const cibles = entrees.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const CHEMIN = new RegExp(`(["'\`(=}\\s])/(?=(?:${cibles})(?:[/?#"'\`)]|$))`, 'g');

const importMap = JSON.stringify({
  imports: {
    [`${SDK}firebase-app.js`]:       `${BASE}/demo/firebase/app.js`,
    [`${SDK}firebase-auth.js`]:      `${BASE}/demo/firebase/auth.js`,
    [`${SDK}firebase-firestore.js`]: `${BASE}/demo/firebase/firestore.js`,
    [`${SDK}firebase-storage.js`]:   `${BASE}/demo/firebase/storage.js`,
  },
}, null, 2);

function fichiers(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : [p];
  });
}

let pages = 0;
for (const f of fichiers(SORTIE)) {
  if (!/\.(html|js|mjs|css)$/.test(f)) continue;
  // Les modules de démo calculent eux-mêmes la base (import.meta.url).
  if (f.startsWith(join(SORTIE, 'demo') + '/')) continue;
  let s = readFileSync(f, 'utf8');
  if (f.endsWith('.html')) {
    s = s.replace(/\s*<link rel="modulepreload" href="https:\/\/www\.gstatic\.com\/[^"]+" \/>/g, '');
    // L'import map doit précéder tout script module : juste après <head>.
    s = s.replace(/<head>/i, `<head>\n  <script type="importmap">\n${importMap}\n  </script>`);
    s = s.replace(/<\/body>/i, `  <script type="module" src="/demo/banner.js"></script>\n</body>`);
    pages++;
  }
  s = s.replace(CHEMIN, `$1${BASE}/`);
  writeFileSync(f, s);
}

console.log(`Démo construite dans _site/ (${pages} pages, base « ${BASE} »).`);
