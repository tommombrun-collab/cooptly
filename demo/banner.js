/**
 * Interface propre à la démo, injectée dans chaque page par build-demo.mjs :
 *  - une pastille « Demo · sample data » avec « Reset demo » ;
 *  - sur la page de connexion, un encadré pour entrer en un clic (bureau ou
 *    admin) et des raccourcis vers les parcours publics.
 */
import { reinitialiser } from './store.js';
import { DEMO_COMPTES } from './seed.js';

const BASE = new URL('..', import.meta.url).pathname.replace(/\/$/, '');   // ex. « /cooptly »
const lien = p => `${BASE}${p}`;

const css = `
.demo-pastille { position: fixed; left: 12px; bottom: 12px; z-index: 9000; display: flex; align-items: center; gap: 8px;
  padding: 6px 8px 6px 12px; border-radius: 99px; background: var(--surface, #fff); color: var(--text, #1c1b18);
  border: 1px solid var(--border, #ddd); box-shadow: 0 6px 20px rgba(0,0,0,.12); font: 500 12px/1.2 Inter, system-ui, sans-serif; }
.demo-pastille b { color: var(--indigo, #7c9082); font-weight: 700; }
.demo-pastille button { font: inherit; font-weight: 600; cursor: pointer; border-radius: 99px; padding: 5px 10px;
  border: 1px solid var(--border, #ddd); background: var(--bg, #f4f2ef); color: inherit; }
.demo-pastille button:hover { border-color: var(--indigo, #7c9082); }
.demo-accueil { margin: 0 0 22px; padding: 16px 18px; border-radius: 12px; text-align: left;
  background: var(--indigo-light, #eef1ee); border: 1.5px solid var(--indigo-mid, #c9d3cc);
  font: 14px/1.5 Inter, system-ui, sans-serif; color: var(--text, #1c1b18); }
.demo-accueil h2 { margin: 0 0 4px; font-size: 17px; }
.demo-accueil p { margin: 0 0 12px; color: var(--text-muted, #6b6560); font-size: 13px; }
.demo-accueil .demo-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.demo-accueil .demo-liens { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.demo-accueil a { color: var(--indigo-dark, #5d6f63); font-weight: 600; }
@media (max-width: 640px) { .demo-pastille { left: 8px; bottom: 8px; } }
`;

function pastille() {
  const el = document.createElement('div');
  el.className = 'demo-pastille';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span><b>Demo</b> · sample data</span><button type="button">Reset demo</button>`;
  el.querySelector('button').addEventListener('click', () => {
    reinitialiser();
    location.href = lien('/index.html');
  });
  document.body.appendChild(el);
}

function entrer(compte) {
  const email = document.getElementById('input-email');
  const mdp = document.getElementById('input-password');
  const btn = document.getElementById('btn-submit');
  if (!email || !mdp || !btn) return;
  // Onglet « Connexion » si l'inscription était affichée.
  document.getElementById('toggle-login')?.click();
  email.value = compte.email; mdp.value = compte.mdp;
  btn.click();
}

function accueil() {
  const carte = document.querySelector('.login-card');
  if (!carte) return;
  const bloc = document.createElement('section');
  bloc.className = 'demo-accueil';
  bloc.innerHTML = `
    <h2>Welcome to the Cooptly demo</h2>
    <p>The <strong>Bureau des Arts (BDA)</strong>, emlyon's arts society, is recruiting. Inspired by a real campaign, with made-up people and answers. Everything stays in your browser. <em>The app itself is in French.</em></p>
    <div class="demo-btns">
      <button type="button" class="btn btn-primary btn-sm" data-compte="bureau">Enter as the board</button>
      <button type="button" class="btn btn-ghost btn-sm" data-compte="admin">Platform admin</button>
    </div>
    <div class="demo-liens">
      <a href="${lien('/postuler.html?org=bda')}">Apply and book an interview (candidate) →</a>
      <a href="${lien('/dispos-publique.html?org=bda')}">Share your availability (staff) →</a>
      <a href="${lien('/planning-public.html?org=bda')}">See the public schedule →</a>
    </div>`;
  bloc.querySelectorAll('[data-compte]').forEach(b =>
    b.addEventListener('click', () => entrer(DEMO_COMPTES[b.dataset.compte])));
  carte.insertBefore(bloc, carte.firstChild);
}

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
pastille();
if (/\/index\.html$|\/$/.test(location.pathname)) accueil();
