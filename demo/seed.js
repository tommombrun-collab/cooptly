/**
 * Données fictives de la démo : une association, son bureau, son staff, des
 * cooptants à différents stades (reçus, placés, évalués).
 *
 * Tout est calculé à partir du jour de la visite : la période d'entretiens
 * commence aujourd'hui, les entretiens passés ont eu lieu ces derniers jours.
 * Le tirage est déterministe (graine fixe) : deux visiteurs voient la même
 * démo. Aucune personne réelle : noms et réponses sont inventés.
 */
export const VERSION_SEED = 4;

export const DEMO_COMPTES = {
  bureau: { email: 'bureau@demo.cooptly', mdp: 'demo1234', libelle: 'Bureau du BDA' },
  admin:  { email: 'admin@demo.cooptly',  mdp: 'demo1234', libelle: 'Admin de la plateforme' },
};

const ORG = 'org_bda';
const CAMP = 'camp_bda';
const UID_BUREAU = 'uid_camille';
const UID_ADMIN = 'uid_admin';

// Générateur pseudo-aléatoire à graine fixe (mulberry32).
function hasard(graine) {
  return () => {
    graine |= 0; graine = (graine + 0x6D2B79F5) | 0;
    let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ts = d => ({ __ts: d.getTime() });
const jour = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const aHeure = (n, h, m = 0) => { const d = jour(n); d.setHours(h, m, 0, 0); return d; };
const hex = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');

const STAFF = [
  ['ros_camille', 'Camille', 'Martin'],
  ['ros_lea',     'Léa',     'Durand'],
  ['ros_julien',  'Julien',  'de la Fontaine'],
  ['ros_ines_l',  'Inès',    'Laurent'],
  ['ros_ines_p',  'Inès',    'Petit'],
  ['ros_chloe',   'Chloé',   'Garnier'],
  ['ros_hugo',    'Hugo',    'Bernard'],
  ['ros_sarah',   'Sarah',   'Lemoine'],
];

// Heures habituelles de chacun (jours de semaine) ; le samedi, moins de monde.
const HEURES_STAFF = {
  ros_camille: [9, 10, 11, 14, 15, 16],
  ros_lea:     [9, 10, 11, 12, 16, 17],
  ros_julien:  [10, 11, 14, 15, 16, 17, 18],
  ros_ines_l:  [9, 10, 13, 14, 15],
  ros_ines_p:  [11, 12, 14, 15, 16],
  ros_chloe:   [9, 10, 11, 15, 16, 17],
  ros_hugo:    [13, 14, 15, 16, 17, 18],
  ros_sarah:   [10, 11, 12, 13, 14],
};

const QUESTIONS = [
  { id: 'q_fb',       label: 'Quel est ton pseudo Facebook', type: 'text', required: true },
  { id: 'q_tel',      label: 'Numéro de téléphone', type: 'tel', required: true },
  { id: 'q_parcours', label: 'Parcours', type: 'select', required: true, options: ['Prépa', 'AST', 'ASTi', 'MSc', 'MS'] },
  { id: 'q_pole',     label: 'Quel pôle t\'attire le plus ?', type: 'select', required: true, options: ['Musique', 'Théâtre', 'Arts plastiques', 'Cinéma', 'Événementiel'] },
  { id: 'q_motiv',    label: 'Pourquoi veux-tu coopter BDA ? T\'as des motivations en particulier ?', type: 'longtext', required: true },
  { id: 'q_autre',    label: 'Autre chose ?', type: 'longtext', required: false },
];

const CRITERES = [
  { id: 'c_impression', label: 'Impression globale', type: 'echelle', max: 5 },
  { id: 'c_investi',    label: 'A-t-iel l\'air investi(e) ?', type: 'echelle', max: 5 },
  { id: 'c_ambiance',   label: 'Est-ce qu\'iel feat avec l\'ambiance du mandat ?', type: 'echelle', max: 5 },
  { id: 'c_competences', label: 'Quelles compétences peut-iel apporter à l\'asso ?', type: 'texte' },
  { id: 'c_events',     label: 'Quels événements l\'intéressent, et pourquoi ?', type: 'texte' },
];

const COOPTANTS = [
  ['Emma', 'Rousseau', 'AST', 'Théâtre', 'J\'ai monté deux pièces au lycée, et le BDA a l\'air d\'être l\'endroit parfait pour continuer.'],
  ['Nathan', 'Girard', 'Prépa', 'Musique', 'Guitariste depuis 10 ans, je rêve d\'organiser une scène ouverte sur le campus.'],
  ['Zoé', 'Faure', 'ASTi', 'Arts plastiques', 'Je fais de l\'illustration, je pourrais créer les affiches et les visuels des événements.'],
  ['Lucas', 'Mercier', 'MSc', 'Cinéma', 'Ciné-club dans mon ancienne fac : projections, débats, j\'aimerais relancer ça ici.'],
  ['Manon', 'Blanc', 'Prépa', 'Événementiel', 'J\'adore organiser, j\'ai géré la billetterie du gala de mon ancienne école.'],
  ['Adam', 'Guerin', 'AST', 'Musique', 'DJ le week-end, je peux m\'occuper du son des soirées du BDA.'],
  ['Jade', 'Boyer', 'MS', 'Arts plastiques', 'Peinture et photo argentique : j\'aimerais proposer une expo des étudiants.'],
  ['Louis', 'Chevalier', 'Prépa', 'Cinéma', 'Je réalise des courts-métrages, je peux filmer les événements et faire les aftermovies.'],
  ['Lina', 'Robin', 'MSc', 'Théâtre', 'Conservatoire pendant 6 ans, je veux partager ce que j\'ai appris.'],
  ['Hugo', 'Masson', 'AST', 'Événementiel', 'Pas artiste moi-même mais très motivé pour faire vivre la culture à l\'école.'],
  ['Chloé', 'Henry', 'ASTi', 'Musique', 'Chorale depuis toute petite, j\'aimerais créer un groupe vocal au BDA.'],
  ['Tom', 'Lefebvre', 'Prépa', 'Théâtre', 'J\'écris des courtes pièces et j\'aimerais en voir une jouée sur scène.'],
  ['Rose', 'Nicolas', 'MSc', 'Arts plastiques', 'Je viens d\'arriver à Lyon, je cherche une asso pour rencontrer des gens qui créent.'],
  ['Yanis', 'Perrin', 'AST', 'Cinéma', 'Passionné de cinéma d\'auteur, je veux organiser des sorties et des avant-premières.'],
];

export function genererBase() {
  const r = hasard(20260927);
  const b = {
    organizations: {}, campaigns: {}, memberships: {}, roster_members: {}, staff_availabilities: {},
    candidates: {}, interviews: {}, interview_evaluations: {}, rooms: {}, invite_codes: {},
    platform_admins: {}, users: {}, platform_settings: {}, corbeille: {},
    __comptes: {},
  };

  // ── Comptes de démo (pas de vrais mots de passe) ─────────────────
  b.__comptes[UID_BUREAU] = { uid: UID_BUREAU, email: DEMO_COMPTES.bureau.email, mdp: DEMO_COMPTES.bureau.mdp, displayName: 'Camille Martin' };
  b.__comptes[UID_ADMIN]  = { uid: UID_ADMIN,  email: DEMO_COMPTES.admin.email,  mdp: DEMO_COMPTES.admin.mdp,  displayName: 'Admin démo' };
  b.platform_admins[UID_ADMIN] = { email: DEMO_COMPTES.admin.email, createdAt: ts(jour(-30)) };

  // ── Association et espace de recrutement ─────────────────────────
  b.organizations[ORG] = { name: 'Bureau des Arts (BDA)', slug: 'bda', primaryColor: '#9C2F8C', createdAt: ts(jour(-40)) };
  b.campaigns[CAMP] = {
    organizationId: ORG, name: 'Recrutement', recrutementOuvert: true, statut: 'ouverte', createdAt: ts(jour(-20)),
    nbPlaces: 6, rankOrder: [], defaultRoomsSeeded: true,
    config: {
      dureeMinutes: 30, nbJurys: 2, permettreAppart: false, modeRdv: 'creneaux',
      dateDebut: iso(jour(-6)), dateFin: iso(jour(14)), battementMinutes: 0,
      heureFin: 19, pasCreneauxMinutes: 30, delaiReservationJours: 2,
      deadlineCandidature: null, avecEntretien: true, entretienCollectif: true, maxParGroupe: 2,
      maxEntretiensAffiles: 4, staffToujoursDispo: false,
    },
    formConfig: { customQuestions: QUESTIONS },
    interviewCriteria: CRITERES,
  };
  b.memberships[`${UID_BUREAU}_${ORG}`] = {
    userId: UID_BUREAU, organizationId: ORG, role: 'secge', email: DEMO_COMPTES.bureau.email,
    firstName: 'Camille', lastName: 'Martin', displayName: 'Camille Martin', createdAt: ts(jour(-40)),
  };
  b.invite_codes.DEMO1234 = { organizationId: ORG, role: 'secge', label: 'Code de démonstration', active: true, createdAt: ts(jour(-10)) };
  ['C1-109', 'B0-113', 'A2-124', 'D1-105'].forEach((code, i) => {
    b.rooms[`room_${i}`] = { organizationId: ORG, code, type: 'salle_emlyon', responsableUserId: null };
  });

  // ── Staff et disponibilités ──────────────────────────────────────
  STAFF.forEach(([id, prenom, nom]) => {
    b.roster_members[id] = { organizationId: ORG, firstName: prenom, lastName: nom, displayName: `${prenom} ${nom}`, createdAt: ts(jour(-15)) };
    const creneaux = [];
    for (let n = 0; n <= 14; n++) {
      const d = jour(n);
      if (d.getDay() === 0) continue;                 // personne le dimanche
      const heures = HEURES_STAFF[id].filter(h => d.getDay() !== 6 || h < 13);
      // Quelques absences pour que la carte de chaleur soit parlante.
      const retenues = heures.filter(() => r() > 0.25);
      if (retenues.length) creneaux.push({ jour: iso(d), creneaux: retenues.map(h => `${String(h).padStart(2, '0')}:00`) });
    }
    b.staff_availabilities[`sa_${id}`] = { userId: id, displayName: `${prenom} ${nom}`, campaignId: CAMP, organizationId: ORG, creneaux, createdAt: ts(jour(-5)) };
  });

  // ── Cooptants ────────────────────────────────────────────────────
  const libre = (idStaff, d, h) => {
    const j = b.staff_availabilities[`sa_${idStaff}`].creneaux.find(x => x.jour === iso(d));
    return j?.creneaux.includes(`${String(h).padStart(2, '0')}:00`);
  };
  const pris = new Set();          // `${jour}T${h}:${m}|${juré}`
  const juresPour = (n, h, m) => {
    const d = jour(n);
    const dispo = STAFF.map(s => s[0]).filter(id => (n < 0 || libre(id, d, h)) && !pris.has(`${n}T${h}:${m}|${id}`));
    return dispo.slice(0, 2);
  };

  // Plan : 5 entretiens passés (évalués), 5 à venir, 4 candidatures reçues.
  const PLAN = [
    [-5, 10, 0], [-4, 14, 30], [-3, 11, 0], [-2, 15, 0], [-1, 10, 30],
    [2, 10, 0], [2, 15, 0], [3, 11, 30], [4, 14, 0], [5, 16, 30],
  ];

  COOPTANTS.forEach(([prenom, nom, parcours, pole, motiv], i) => {
    const id = `cand_${i + 1}`;
    const email = `${prenom}.${nom}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@edu.em-lyon.com';
    const plan = PLAN[i];
    const recu = jour(plan ? Math.min(plan[0] - 3, -2) : -1 - (i % 3));
    recu.setHours(9 + (i * 3) % 11, (i * 17) % 60);
    const cand = {
      campaignId: CAMP, organizationId: ORG, prenom, nom, email,
      statut: !plan ? 'recu' : (plan[0] < 0 ? 'entretien_fait' : 'place'),
      resultToken: hex(r, 40), notesInternes: '', createdAt: ts(recu),
      customAnswers: {
        q_tel:      { label: 'Numéro de téléphone', value: `06 ${String(10 + i * 7).padStart(2, '0')} ${String(20 + i * 3).padStart(2, '0')} ${String(30 + i).padStart(2, '0')} ${String(40 + i * 2).padStart(2, '0')}` },
        q_fb:       { label: 'Quel est ton pseudo Facebook', value: `${prenom} ${nom}` },
        q_parcours: { label: 'Parcours', value: parcours },
        q_pole:     { label: 'Quel pôle t\'attire le plus ?', value: pole },
        q_motiv:    { label: 'Pourquoi veux-tu coopter BDA ? T\'as des motivations en particulier ?', value: motiv },
        ...(i % 4 === 0 ? { q_autre: { label: 'Autre chose ?', value: 'Dispo aussi le week-end pour les événements.' } } : {}),
      },
    };
    b.candidates[id] = cand;
    if (!plan) return;

    const [n, h, m] = plan;
    const jures = juresPour(n, h, m);
    jures.forEach(j => pris.add(`${n}T${h}:${m}|${j}`));
    const debut = aHeure(n, h, m), fin = new Date(debut.getTime() + 30 * 60000);
    b.interviews[`iv_${i + 1}`] = {
      campaignId: CAMP, organizationId: ORG, candidateId: id,
      datetimeStart: ts(debut), datetimeEnd: ts(fin), statut: n < 0 ? 'fait' : 'planifie', selfBooked: true,
      jury1Id: jures[0] || null, jury2Id: jures[1] || null, jury3Id: null,
      roomId: i % 3 === 2 ? null : `room_${i % 4}`, salleNom: null, notes: '', createdAt: ts(recu),
    };

    // Entretiens passés : évaluation complète, sauf une laissée incomplète
    // (pour montrer le badge « 2/3 critères » au lieu d'un score trompeur).
    if (n < 0) {
      const note = () => 2 + Math.floor(r() * 4);          // 2 à 5
      const partielle = i === 4;
      b.interview_evaluations[`${CAMP}_${id}`] = {
        campaignId: CAMP, organizationId: ORG, candidateId: id,
        evaluatorName: 'Jury', createdAt: ts(fin), updatedAt: ts(fin),
        criteria: {
          c_impression: note(), c_investi: note(),
          ...(partielle ? {} : { c_ambiance: note() }),
          c_competences: ['Graphisme, réseaux sociaux.', 'Organisation, gestion de budget.', 'Technique son et lumière.',
            'Photo et vidéo.', 'Contact facile, réseau dans les autres assos.'][i % 5],
          c_events: ['Les soirées concerts, pour la scène ouverte.', 'Le festival de fin d\'année.', 'Les sorties théâtre et cinéma.',
            'Les expos et le vernissage.', 'Un peu tout, surtout le gala.'][i % 5],
        },
        noteGlobale: 11 + Math.floor(r() * 8),
        decision: i === 3 ? 'reserve' : '',
        commentaire: '',
      };
    }
  });

  return b;
}
