/**
 * Alertes de cohérence : ce qui n'est pas logique ou pas pratique dans les
 * réglages d'une asso ou dans son planning, signalé dans « À faire » du
 * tableau de bord (et en haut de Paramètres pour les réglages).
 *
 * Chaque alerte porte des `cles` (`genre:id`) : la croix « Masquer » du
 * tableau de bord les range dans `campaign.alertesIgnorees`. Une clé de
 * réglage contient les valeurs en cause : changer le réglage puis le
 * remettre fait réapparaître l'alerte.
 *
 * Module sans dépendance Firebase : testé par `tests/coherence.test.mjs`.
 */
import { creneauxPourDeplacer } from './deplacer.js';
import { enSecours, parleAnglais } from './capacite.js';

const JOUR_MS = 86400000;
const jourDe = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateLocale = s => { const [a, m, j] = String(s || '').split('-').map(Number); return a && m && j ? new Date(a, m - 1, j) : null; };
const court = d => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const hm = d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const duree = min => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ' ' + String(min % 60).padStart(2, '0') : ''}` : `${min} min`);
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const toutesLes = min => (min === 60 ? 'heures' : duree(min));

/** Le formulaire accepte-t-il des candidatures ? (même règle que le badge du tableau de bord) */
export const formulaireOuvert = campaign => !campaign?.etat && campaign?.recrutementOuvert !== false && campaign?.statut !== 'fermee';

/**
 * Équilibre de la charge entre staffeurs : moyenne et écart type du nombre
 * d'entretiens. Seul est mis de côté qui a très peu de dispos (moins du quart
 * de la médiane du staff) sur un seul jour : arrivé tard, revenu de stage, ce
 * n'est pas un déséquilibre. Très peu de dispos sur plusieurs jours, c'est un
 * vrai staffeur à peine là : il compte, et il est dans `peuDispos`.
 * Inégal : écart type ≥ 35 % de la moyenne, ou quelqu'un sous la moitié de la moyenne.
 * @param {{id, entretiens: number, heures?: number, jours?: number}[]} lignes  heures absentes = dispos inconnues
 * @param {{toujoursDispo?: boolean}} [o]
 * @returns {{retenus, horsCalcul, peuDispos, loinDerriere, mediane, moyenne, ecartType, cv, niveau: 'bon'|'moyen'|'inegal'|null}}
 */
export function equilibreCharge(lignes, { toujoursDispo = false } = {}) {
  const connues = toujoursDispo ? [] : lignes.filter(l => l.heures > 0);
  const tri = connues.map(l => l.heures).sort((a, b) => a - b);
  const m = tri.length >> 1;
  const mediane = !tri.length ? 0 : tri.length % 2 ? tri[m] : (tri[m - 1] + tri[m]) / 2;
  // Petite équipe ou peu de dispos en tout : pas de « très peu » qui tienne.
  const peu = mediane >= 8 ? connues.filter(l => l.heures < mediane / 4) : [];
  const horsCalcul = peu.filter(l => !(l.jours >= 2));
  const peuDispos = peu.filter(l => l.jours >= 2);
  const retenus = lignes.filter(l => !horsCalcul.includes(l) && (connues.includes(l) || l.entretiens > 0));
  const vide = { retenus, horsCalcul, peuDispos, loinDerriere: [], mediane, moyenne: null, ecartType: null, cv: null, niveau: null };
  if (retenus.length < 2) return vide;
  const moyenne = retenus.reduce((t, l) => t + l.entretiens, 0) / retenus.length;
  const ecartType = Math.sqrt(retenus.reduce((t, l) => t + (l.entretiens - moyenne) ** 2, 0) / retenus.length);
  const cv = moyenne ? ecartType / moyenne : 0;
  const loinDerriere = moyenne >= 4 ? retenus.filter(l => l.entretiens < moyenne / 2) : [];
  const niveau = cv >= 0.35 || loinDerriere.length ? 'inegal' : cv < 0.2 ? 'bon' : 'moyen';
  return { ...vide, moyenne, ecartType, cv, loinDerriere, niveau };
}

/**
 * Réglages incohérents.
 * @param {object} o
 * @param {object} o.cfg       campaignConfig(campaign)
 * @param {object} o.campaign  { recrutementOuvert, statut, etat, nbPlaces, interviewCriteria }
 * @param {number} [o.nbEntretiensPasses]
 * @param {Date}   [o.maintenant]
 * @returns {{code: string, cles: string[], ton: string, titre: string, detail: string, onglet: string, lien?: string}[]}
 */
export function alertesReglages({ cfg, campaign, nbEntretiensPasses = 0, maintenant = new Date() }) {
  const res = [];
  if (!cfg.avecEntretien && cfg.avecEntretien !== undefined) return res;
  const d = Number(cfg.dureeMinutes) || 30;
  const pas = Number(cfg.pasCreneauxMinutes) || 30;
  const batt = Number(cfg.battementMinutes) || 0;
  const affiles = Number(cfg.maxEntretiensAffiles) || 0;
  const delai = Number(cfg.delaiReservationJours) || 0;
  const ajd = new Date(maintenant); ajd.setHours(0, 0, 0, 0);
  const fin = dateLocale(cfg.dateFin);
  const deadline = dateLocale(cfg.deadlineCandidature);
  const ouvert = formulaireOuvert(campaign);

  // 1. Entretiens plus longs que l'écart entre deux horaires proposés.
  if (cfg.modeRdv !== 'dispos' && d > pas) {
    res.push({ code: 'duree-pas', cles: [`reglage:duree-pas-${d}-${pas}`], ton: 'ambre', onglet: 'quand',
      titre: `Entretiens de ${duree(d)} proposés toutes les ${toutesLes(pas)}`,
      detail: `Un cooptant peut réserver 10:00 et un autre 10:${String(pas).padStart(2, '0')} : les entretiens se chevauchent et les journées du staff se morcellent. Proposer un horaire toutes les ${toutesLes(d >= 60 ? 60 : d)} ?` });
  }
  // 2. Longues séries sans pause. Un choix de l'asso : conseil de Paramètres
  //    seulement, le tableau de bord ne l'affiche pas.
  const serie = affiles > 0 ? affiles * d : Infinity;
  if (batt === 0 && serie >= 180) {
    res.push({ code: 'pause', cles: [`reglage:pause-${affiles}-${d}`], ton: 'ambre', onglet: 'qui',
      titre: affiles > 0 ? `Jusqu'à ${duree(serie)} d'entretiens d'affilée sans pause` : 'Entretiens d\'affilée sans limite ni pause',
      detail: affiles > 0
        ? `${affiles} entretiens de ${duree(d)} à la suite pour un même staffeur, sans pause entre deux. Baisser le maximum d'affilée (Qui ?) ou ajouter une pause (Quand ?) ?`
        : 'Un staffeur peut enchaîner autant d\'entretiens que ses dispos le permettent. Fixer un maximum d\'affilée (Qui ?) ?' });
  }
  // 3. Pas de grille d'évaluation alors que des entretiens ont eu lieu.
  if (!(campaign?.interviewCriteria || []).length && nbEntretiensPasses > 0) {
    res.push({ code: 'grille', cles: ['reglage:grille'], ton: 'ambre', onglet: 'evaluation',
      titre: 'Pas de grille d\'évaluation',
      detail: `${pluriel(nbEntretiensPasses, 'entretien')} déjà passé${nbEntretiensPasses > 1 ? 's' : ''}, mais aucun critère noté : pas de score, donc pas de classement automatique.` });
  }
  // 4. Places disponibles non renseignées.
  if (!(Number(campaign?.nbPlaces) > 0) && nbEntretiensPasses > 0) {
    res.push({ code: 'places', cles: ['reglage:places'], ton: '', onglet: 'evaluation',
      titre: 'Nombre de places non renseigné',
      detail: 'Sans lui, pas de ligne de coupe dans le classement ni de profil des retenus en délibération.' });
  }
  // 5. Inscriptions ouvertes trop tard : plus aucun créneau réservable à la fin.
  if (ouvert && cfg.modeRdv !== 'dispos' && fin && delai > 0) {
    const dernierUtile = new Date(fin.getTime() - delai * JOUR_MS);     // dernier jour où l'on peut encore réserver
    const fermeLe = deadline || fin;
    if (fermeLe > dernierUtile && dernierUtile >= ajd) {
      res.push({ code: 'deadline', cles: [`reglage:deadline-${cfg.deadlineCandidature || 'aucune'}-${cfg.dateFin}-${delai}`], ton: 'ambre', onglet: 'quand',
        titre: 'Inscriptions ouvertes après le dernier créneau réservable',
        detail: `Avec le délai de ${pluriel(delai, 'jour')}, plus rien n'est réservable après le ${court(dernierUtile)} : un cooptant inscrit ensuite reste sans entretien. Fixer la date limite des candidatures au ${court(dernierUtile)} ?` });
    }
  }
  // 6. Formulaire encore ouvert alors que la période ou la date limite est passée.
  if (ouvert && ((fin && fin < ajd) || (deadline && deadline < ajd))) {
    const quoi = fin && fin < ajd ? `la période d'entretiens est finie depuis le ${court(fin)}` : `la date limite était le ${court(deadline)}`;
    res.push({ code: 'ouvert', cles: [`reglage:ouvert-${cfg.dateFin}-${cfg.deadlineCandidature || ''}`], ton: '', onglet: 'quand',
      titre: 'Recrutement encore ouvert',
      detail: `Le recrutement est marqué ouvert alors que ${quoi}. Le fermer ?` });
  }
  return res;
}

/**
 * Planning : entretiens à venir mal pourvus, staffeurs en conflit, créneaux
 * restants, charge, doublons.
 * @param {object} o
 * @param {object} o.cfg
 * @param {object} o.campaign
 * @param {{id, debut: Date, fin: Date, groupId?, jures: string[], candidateIds: string[]}[]} o.entretiens un par groupe
 * @param {object[]} o.dispos     fiches staff_availabilities
 * @param {Map<string,string>} o.noms identifiant de staffeur → nom
 * @param {object[]} o.cooptants  { id, prenom, nom, email, langue }
 * @param {string[]} [o.joursReservables] 'YYYY-MM-DD' encore réservables (période, délai, jours retirés)
 * @param {Date} [o.maintenant]
 */
export function alertesPlanning({ cfg, campaign, entretiens, dispos, noms, cooptants, joursReservables = [], maintenant = new Date() }) {
  const res = [];
  const t = maintenant.getTime();
  const nbJ = Math.min(3, Number(cfg.nbJurys) || 2);
  const batt = (Number(cfg.battementMinutes) || 0) * 60000;
  const nom = id => noms.get(id) || 'un staffeur';
  const cooptant = new Map(cooptants.map(c => [c.id, c]));
  const nomCoopt = id => { const c = cooptant.get(id); return c ? `${c.prenom || ''} ${c.nom || ''}`.trim() || c.email || 'Cooptant' : 'Cooptant'; };
  const quand = iv => `${iv.debut.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })} ${hm(iv.debut)}`;
  const aVenir = entretiens.filter(iv => iv.debut.getTime() > t).sort((a, b) => a.debut - b.debut);
  const disposDe = id => dispos.filter(sa => sa.userId === id);
  const liste = (items, n = 3) => items.slice(0, n).join(', ') + (items.length > n ? '…' : '');

  // 1. Entretiens à venir sans staffeurs, ou incomplets.
  const incomplets = aVenir.filter(iv => iv.jures.length < nbJ);
  if (incomplets.length) {
    const vides = incomplets.filter(iv => !iv.jures.length).length;
    res.push({ code: 'staff', cles: incomplets.map(iv => `staff:${iv.id}`), ton: vides ? 'rouge' : 'ambre',
      titre: `${pluriel(incomplets.length, 'entretien')} à venir ${vides === incomplets.length ? 'sans staffeurs' : 'sans assez de staffeurs'}`,
      detail: liste(incomplets.map(iv => `${quand(iv)} ${nomCoopt(iv.candidateIds[0])}${iv.jures.length ? ` (${iv.jures.length}/${nbJ})` : ''}`)),
      lien: 'planning' });
  }

  // 2. Un staffeur à deux entretiens en même temps (pause comprise), ou hors de ses dispos.
  const doubles = [];
  aVenir.forEach((a, i) => aVenir.slice(i + 1).forEach(b => {
    if (a.debut.getTime() < b.fin.getTime() + batt && b.debut.getTime() < a.fin.getTime() + batt) {
      a.jures.filter(id => b.jures.includes(id)).forEach(id => doubles.push({ id, a, b }));
    }
  }));
  const horsDispos = [];
  if (!cfg.staffToujoursDispo) {
    aVenir.forEach(iv => iv.jures.forEach(id => {
      const sas = disposDe(id);
      if (!sas.length) return;   // jamais rempli (ou autre identifiant) : on ne sait pas
      const jour = jourDe(iv.debut);
      const debutMin = iv.debut.getHours() * 60 + iv.debut.getMinutes();
      const finMin = debutMin + Math.round((iv.fin - iv.debut) / 60000);
      for (let h = Math.floor(debutMin / 60); h <= Math.floor((finMin - 1) / 60); h++) {
        const hh = `${String(h).padStart(2, '0')}:00`;
        if (!sas.some(sa => sa.creneaux?.find(x => x.jour === jour)?.creneaux?.includes(hh))) { horsDispos.push({ id, iv }); return; }
      }
    }));
  }
  const nbPersonnes = l => new Set(l.map(x => x.id)).size;
  if (doubles.length || horsDispos.length) {
    const textes = [
      ...doubles.map(x => `${nom(x.id)} à ${hm(x.a.debut)} et ${hm(x.b.debut)} le ${court(x.a.debut)}`),
      ...horsDispos.map(x => `${nom(x.id)} pas dispo ${quand(x.iv)}`),
    ];
    res.push({ code: 'conflit', ton: doubles.length ? 'rouge' : 'ambre',
      cles: [...doubles.map(x => `conflit:${x.id}_${x.a.id}_${x.b.id}`), ...horsDispos.map(x => `horsdispo:${x.id}_${x.iv.id}`)],
      titre: doubles.length && horsDispos.length ? 'Staffeurs en conflit sur des entretiens à venir'
        : doubles.length ? `${pluriel(nbPersonnes(doubles), 'staffeur')} à deux entretiens en même temps`
        : nbPersonnes(horsDispos) > 1 ? `${nbPersonnes(horsDispos)} staffeurs placés hors de leurs dispos` : `${nom(horsDispos[0].id)} placé·e hors de ses dispos`,
      detail: liste(textes, 2), lien: 'planning' });
  }

  // 3. Entretien en anglais avec un staffeur qui n'a pas coché l'anglais.
  if (cfg.jurysAnglaisRequis) {
    const anglais = [];
    aVenir.filter(iv => iv.candidateIds.some(id => cooptant.get(id)?.langue === 'en')).forEach(iv => iv.jures.forEach(id => {
      const sas = disposDe(id);
      if (sas.length && !sas.some(parleAnglais)) anglais.push({ id, iv });
    }));
    if (anglais.length) {
      res.push({ code: 'anglais', ton: 'ambre', cles: anglais.map(x => `anglais:${x.id}_${x.iv.id}`),
        titre: `${pluriel(anglais.length, 'entretien')} en anglais avec un staffeur non anglophone`,
        detail: liste(anglais.map(x => `${quand(x.iv)} ${nomCoopt(x.iv.candidateIds[0])} avec ${nom(x.id)}`), 2), lien: 'planning' });
    }
  }

  // 4. Plus assez de créneaux réservables alors que le formulaire est ouvert.
  if (formulaireOuvert(campaign) && cfg.modeRdv !== 'dispos' && joursReservables.length) {
    const d = Number(cfg.dureeMinutes) || 30, pas = Number(cfg.pasCreneauxMinutes) || 30;
    const finJ = (Number(cfg.heureFin) || 19) * 60;
    const heures = [];
    for (let m = 8 * 60; m + d <= finJ; m += pas) heures.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    const ids = cfg.staffToujoursDispo ? [...noms.keys()] : [...new Set(dispos.map(sa => sa.userId))];
    const cases = creneauxPourDeplacer({
      jours: joursReservables, heures, duree: d, battement: Number(cfg.battementMinutes) || 0, finJourneeMin: finJ,
      nbJurys: nbJ, maxParallele: Number(cfg.maxEntretiensParallele) || 0, staff: ids, maintenant,
      libre: (id, jour, debutMin, finMin) => {
        if (cfg.staffToujoursDispo) return true;
        const sas = disposDe(id);
        for (let h = Math.floor(debutMin / 60); h <= Math.floor((finMin - 1) / 60); h++) {
          const hh = `${String(h).padStart(2, '0')}:00`;
          if (!sas.some(sa => sa.creneaux?.find(x => x.jour === jour)?.creneaux?.includes(hh))) return false;
        }
        return sas.some(sa => enSecours(sa, jour, debutMin, finMin - debutMin)) ? 'secours' : true;
      },
      occupations: entretiens.map(iv => ({ jour: jourDe(iv.debut), startMin: iv.debut.getHours() * 60 + iv.debut.getMinutes(),
        endMin: iv.fin.getHours() * 60 + iv.fin.getMinutes(), ids: iv.jures })),
    });
    const libres = [...cases.values()].filter(c => !c.bloque && !c.manque).length;
    if (libres < 5) {
      res.push({ code: 'creneaux', cles: [`creneaux:${jourDe(maintenant)}-${libres}`], ton: libres ? 'ambre' : 'rouge',
        titre: libres ? `Plus que ${pluriel(libres, 'créneau')} réservable${libres > 1 ? 's' : ''}` : 'Plus aucun créneau réservable',
        detail: 'Le formulaire est ouvert, mais les dispos du staff sont presque toutes prises : les nouveaux inscrits resteront sans entretien. Relancer le staff pour des dispos, ou fermer le recrutement ?',
        lien: 'dispos' });
    }
  }

  // 5. Charge déséquilibrée entre staffeurs, mesurée par l'écart type.
  const charge = new Map();
  entretiens.forEach(iv => iv.jures.forEach(id => charge.set(id, (charge.get(id) || 0) + 1)));
  const lignesCharge = [...new Set([...charge.keys(), ...dispos.map(sa => sa.userId)])].filter(id => noms.has(id)).map(id => {
    const heures = new Set(), jours = new Set();
    disposDe(id).forEach(sa => (sa.creneaux || []).forEach(j => (j.creneaux || []).forEach(hh => { heures.add(j.jour + hh); jours.add(j.jour); })));
    return { id, entretiens: charge.get(id) || 0, heures: heures.size, jours: jours.size };
  });
  const eq = equilibreCharge(lignesCharge, { toujoursDispo: !!cfg.staffToujoursDispo });
  // Qui a très peu de dispos a sa propre alerte, courte : la charge se juge sans lui.
  const eqSans = equilibreCharge(lignesCharge.filter(l => !eq.peuDispos.includes(l)), { toujoursDispo: !!cfg.staffToujoursDispo });
  const chiffre = n => (Math.round(n * 10) / 10).toLocaleString('fr-FR');
  if (aVenir.length && eqSans.niveau === 'inegal' && eqSans.retenus.length >= 3) {
    const parCharge = eqSans.retenus.slice().sort((a, b) => b.entretiens - a.entretiens || a.heures - b.heures);
    const haut = parCharge[0], bas = parCharge[parCharge.length - 1];
    if (haut.entretiens - bas.entretiens >= 4) {
      res.push({ code: 'charge', cles: [`charge:${haut.id}-${haut.entretiens}-${bas.id}-${bas.entretiens}`], ton: '',
        titre: 'Charge inégale entre staffeurs',
        detail: `${nom(haut.id)} : ${pluriel(haut.entretiens, 'entretien')}, ${nom(bas.id)} : ${bas.entretiens} `
          + `(écart type ${chiffre(eqSans.ecartType)} pour une moyenne de ${chiffre(eqSans.moyenne)}). « Optimiser » dans le planning répartit mieux les entretiens à venir.`,
        lien: 'planning' });
    }
  }

  // 5 bis. Staffeur dispo sur plusieurs jours, mais à peine (quelques heures
  // éparpillées). Un seul jour (arrivé tard, revenu de stage) : rien à dire.
  if (eq.peuDispos.length && (aVenir.length || joursReservables.length)) {
    const un = eq.peuDispos.length === 1;
    res.push({ code: 'peu-dispos', ton: '', cles: eq.peuDispos.map(l => `peudispos:${l.id}-${l.heures}`),
      titre: un ? `${nom(eq.peuDispos[0].id)} a très peu de dispos` : `${eq.peuDispos.length} staffeurs ont très peu de dispos`,
      detail: un ? `${eq.peuDispos[0].heures} h sur ${eq.peuDispos[0].jours} jours.` : liste(eq.peuDispos.map(l => `${nom(l.id)} (${l.heures} h)`)) + '.',
      lien: 'dispos' });
  }

  // 6. Doublon probable : même prénom et nom, deux candidatures.
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const parNom = new Map();
  cooptants.forEach(c => {
    const cle = norm(c.prenom) + '|' + norm(c.nom);
    if (cle === '|') return;
    if (!parNom.has(cle)) parNom.set(cle, []);
    parNom.get(cle).push(c);
  });
  const doublons = [...parNom.values()].filter(l => l.length > 1);
  if (doublons.length) {
    res.push({ code: 'doublon', ton: '', cles: doublons.map(l => `doublon:${l.map(c => c.id).sort().join('_')}`),
      titre: `${pluriel(doublons.length, 'doublon')} probable${doublons.length > 1 ? 's' : ''}`,
      detail: `${liste(doublons.map(l => nomCoopt(l[0].id)))} : même nom, ${doublons.length > 1 ? 'deux candidatures chacun' : 'deux candidatures'} (emails différents ?). Garder la bonne, supprimer l'autre.`,
      lien: 'cooptants' });
  }
  return res;
}
