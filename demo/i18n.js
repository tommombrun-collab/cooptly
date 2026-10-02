/**
 * Traduction de l'interface en anglais, pour la démo uniquement.
 *
 * L'application est écrite en français et n'est pas modifiée. Ce script,
 * chargé avant elle (voir build-demo.mjs), remplace à l'affichage :
 *  - les textes et attributs visibles (placeholder, title, aria-label, alt),
 *    y compris ceux ajoutés plus tard (fenêtres, messages, listes) grâce à un
 *    MutationObserver ;
 *  - les dates : la locale « fr-FR » demandée par l'appli devient « en-GB ».
 *
 * Le dictionnaire (window.__I18N_EN, généré à la construction depuis
 * demo/i18n/en.json) contient des textes exacts et des modèles à trous
 * (« {0} créneau{1} » → « {0} slot{1} »). Un texte absent du dictionnaire
 * reste tel quel : jamais d'erreur, au pire un mot en français.
 */
(function () {
  'use strict';
  const DICO = window.__I18N_EN || { exact: {}, patterns: {} };

  // ── Dates en anglais ────────────────────────────────────────────
  const versAnglais = loc => {
    if (loc === undefined) return 'en-GB';
    const l = Array.isArray(loc) ? loc[0] : loc;
    return typeof l === 'string' && /^fr/i.test(l) ? 'en-GB' : loc;
  };
  for (const m of ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']) {
    const orig = Date.prototype[m];
    Date.prototype[m] = function (loc, opts) { return orig.call(this, versAnglais(loc), opts); };
  }
  const DTF = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function (loc, opts) { return new DTF(versAnglais(loc), opts); };
  Intl.DateTimeFormat.prototype = DTF.prototype;
  Intl.DateTimeFormat.supportedLocalesOf = DTF.supportedLocalesOf;

  // ── Dictionnaire ────────────────────────────────────────────────
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const exact = new Map(Object.entries(DICO.exact).filter(([, en]) => en != null).map(([fr, en]) => [norm(fr), en]));

  // Modèles : « Choisis un créneau entre le {0} et le {1}. » devient une
  // expression régulière ancrée, les trous captant n'importe quel texte.
  const echap = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const modeles = Object.entries(DICO.patterns).filter(([, en]) => en != null).map(([fr, en]) => {
    const f = norm(fr), ordre = [];
    const source = f.split(/(\{\d+\})/).map(p => {
      const m = p.match(/^\{(\d+)\}$/);
      if (m) { ordre.push(m[1]); return '(.*?)'; }
      return echap(p);
    }).join('');
    return { re: new RegExp(`^${source}$`), ordre, en, poids: f.replace(/\{\d+\}/g, '').length };
  }).sort((a, b) => b.poids - a.poids);   // les modèles les plus précis d'abord

  // Traduction d'un texte normalisé : exact, sinon premier modèle qui colle.
  // Les trous d'un modèle sont traduits à leur tour (« Disponibles (créneau
  // de 10:00) » : le trou « (créneau de 10:00) » est lui-même un modèle).
  function brut(n, prof = 0) {
    const e = exact.get(n);
    if (e != null) return e;
    for (const m of modeles) {
      const r = n.match(m.re);
      if (!r) continue;
      const val = {}; m.ordre.forEach((idx, i) => { val[idx] = r[i + 1]; });
      return m.en.replace(/\{(\d+)\}/g, (_, i) => {
        const v = val[i] ?? '';
        const t = prof < 2 && /[A-Za-zÀ-ÿ]/.test(v) ? brut(norm(v), prof + 1) : null;
        if (t == null) return v;
        return v.match(/^\s*/)[0] + t + v.match(/\s*$/)[0];
      });
    }
    return null;
  }

  function traduire(texte) {
    const n = norm(texte);
    if (!n || !/[A-Za-zÀ-ÿ]/.test(n)) return null;
    const en = brut(n);
    if (en == null || en === n) return null;
    // Conserver les espaces autour : ils séparent souvent deux fragments.
    const debut = texte.match(/^\s*/)[0], fin = texte.match(/\s*$/)[0];
    return debut + en + fin;
  }

  const IGNORER = 'script, style, textarea, code, [contenteditable], [data-i18n-skip], .demo-pastille, .demo-accueil';
  // Attributs : le contenu d'une zone de texte reste tel quel, mais son
  // placeholder (l'exemple affiché quand elle est vide) se traduit.
  const IGNORER_ATTRS = 'script, style, code, [contenteditable], [data-i18n-skip], .demo-pastille, .demo-accueil';
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  function texteNoeud(t) {
    const p = t.parentElement;
    if (!p || p.closest(IGNORER)) return;
    const en = traduire(t.data);
    if (en != null) t.data = en;
  }
  function attributs(el) {
    if (el.closest(IGNORER_ATTRS) || el.parentElement?.closest('textarea')) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const en = traduire(v);
      if (en != null) el.setAttribute(a, en);
    }
    if (el.tagName === 'INPUT' && /^(button|submit)$/i.test(el.type) && el.value) {
      const en = traduire(el.value); if (en != null) el.value = en;
    }
  }
  function parcourir(racine) {
    if (racine.nodeType === 3) return texteNoeud(racine);
    if (racine.nodeType !== 1) return;
    attributs(racine);
    const w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) texteNoeud(n); else attributs(n); }
  }
  function titre() {
    const en = traduire(document.title);
    if (en != null) document.title = en;
  }

  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') texteNoeud(m.target);
      else if (m.type === 'attributes') attributs(m.target);
      else m.addedNodes.forEach(parcourir);
    }
    titre();
  }).observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS,
  });

  document.documentElement.lang = 'en';
  const init = () => { parcourir(document.body); titre(); };
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);

  // Heuristique du diagnostic : les noms propres (mots à majuscule, souvent
  // accentués : « Chloé », « Bureau des Arts ») ne comptent pas.
  const francais = t => {
    const sansNoms = t.replace(/\b\p{Lu}[\p{L}'-]*/gu, '').replace(/\bdes Arts\b|\bde la\b/g, '');
    return /[àâäéèêëîïôöùûüçœ]|\b(le|la|les|du|une|et|pour|avec|sans|pas|ton|ta|tes|ce|cette|est|sur|dans|aucun|aucune|ou|au|aux|vos|votre)\b/i.test(sansNoms);
  };
  // Exposé pour le diagnostic depuis la console : textes encore en français.
  window.__textesNonTraduits = () => {
    const reste = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = w.nextNode())) {
      const p = t.parentElement;
      if (!p || p.closest(IGNORER) || (p.checkVisibility && !p.checkVisibility())) continue;
      const n = norm(t.data);
      if (francais(n)) reste.add(n);
    }
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el => ATTRS.forEach(a => {
      const v = el.getAttribute(a);
      if (v && francais(v) && !el.closest(IGNORER_ATTRS)) reste.add(`[${a}] ${v}`);
    }));
    return [...reste];
  };
})();
