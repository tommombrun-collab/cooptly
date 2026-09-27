# Cooptly

[![Tests et démo](https://github.com/tommombrun-collab/cooptly/actions/workflows/demo.yml/badge.svg)](https://github.com/tommombrun-collab/cooptly/actions/workflows/demo.yml)

Plateforme de **cooptation pour associations étudiantes** : les candidats postulent et réservent leur entretien en ligne, le staff dépose ses disponibilités, les jurys sont attribués automatiquement, et le bureau centralise évaluations, classement et délibérations.

Projet mené seul, de l'analyse du besoin à la mise en production (développement assisté par IA), pour les associations étudiantes d'emlyon business school. Mise en production pour la campagne de recrutement du Bureau des Arts (BDA) en septembre 2026.

### ▶ [Essayer la démo en ligne](https://tommombrun-collab.github.io/cooptly/)

Démo interactive, sans inscription : un clic sur « Entrer en tant que bureau », ou les parcours publics (postuler, déposer ses dispos, planning). L'exemple reprend le BDA, avec des personnes et des réponses inventées. Tout reste dans le navigateur, un bouton remet la démo à zéro.

> Dépôt vitrine : aucune configuration Firebase n'est fournie (voir [Lancer le projet](#lancer-le-projet)). La démo remplace Firebase par une base simulée, sans changer une ligne de l'application (voir [La démo](#la-démo)).

---

## Ce que fait la plateforme

**Côté candidat, sans compte**
- Formulaire de candidature configurable par l'asso (questions réordonnables, types texte, choix, téléphone, date…).
- Réservation d'un créneau dans un calendrier jours × heures, calculé en temps réel à partir des disponibilités du staff et des entretiens déjà pris.
- Page de suivi personnelle (lien à jeton), changement de créneau sans tout ressaisir, ajout à l'agenda (Google / `.ics`).

**Côté staff, sans compte**
- Dépôt de ses disponibilités sur une grille heure par heure.
- Évaluation des entretiens via un lien jury.
- Planning public en lecture seule, copie en un clic de la liste des entretiens d'une journée.

**Côté bureau**
- Tableau de bord, liste des candidats, fiche d'évaluation avec score normalisé, classement et mode délibération plein écran (glisser-déposer, ligne de coupe).
- Planning interne : carte de chaleur des disponibilités, placement manuel, entretiens simultanés côte à côte.
- Paramètres : période, durée et pas des créneaux, pause entre entretiens, délai minimum de réservation, nombre de jurés, entretiens en groupe, codes d'invitation, liste du staff.
- Corbeille : toute suppression reste récupérable 30 jours.

**Multi-associations** : un compte peut appartenir à plusieurs bureaux ; chaque asso est strictement cloisonnée.

---

## Démarche produit

### Le problème
Chaque rentrée, les bureaux d'associations recrutent des dizaines de « cooptants » en quelques semaines. Avant Cooptly, tout passait par des formulaires, des tableurs partagés et des messages de groupe : créneaux en double, jurys constitués à la main, notes éparpillées, délibérations sur un fichier que personne n'avait à jour.

### Les utilisateurs
| Qui | Ce qu'il lui faut | Contrainte |
|---|---|---|
| Le **cooptant** | Postuler et réserver un créneau en deux minutes, sur téléphone | Pas de compte à créer |
| Le **staff** (jurés) | Dire quand il est libre, savoir quand il fait passer un entretien | Pas de compte non plus |
| Le **bureau** (sec-gé, président) | Voir, planifier, évaluer, délibérer | Données de l'asso inaccessibles aux autres assos |
| L'**admin plateforme** | Créer les assos, donner les accès | |

Deux décisions en découlent : **tout ce qui est public se fait sans compte** (l'accès est porté par des liens et des jetons), et **la sécurité repose entièrement sur les règles Firestore**, puisque le client n'est pas digne de confiance.

### Méthode : des itérations courtes, pilotées par l'usage
Pas de Scrum au sens strict (projet solo, sans équipe ni cérémonies), mais les mêmes principes :
- **Incréments courts et livrables** : chaque changement est déployé en production dès qu'il est testé (131 versions en 15 semaines, du 15 juin au 27 septembre 2026).
- **Backlog alimenté par les utilisateurs** : les membres du bureau remontent un problème (souvent une capture d'écran), il est priorisé selon son impact sur la campagne en cours.
- **Cycles « audit puis correctifs »** en guise de rétrospectives : audit de sécurité, audit des algorithmes, audit des suppressions en cascade, chacun suivi d'un lot de corrections et de tests qui verrouillent le comportement.
- **Définition du « fini »** : le correctif est testé (tests automatisés quand la logique s'y prête), déployé, et documenté (aide utilisateur et notes techniques).

### Les itérations
| Période | Objectif | Livré |
|---|---|---|
| **Juin** | MVP puis simplification | Formulaire public, réservation, planning. Puis simplification : l'espace « membre » est retiré au profit de liens publics sans compte, et la réservation directe devient le parcours principal à la place de l'algorithme de placement. |
| **Juillet** | Qualité et expérience | Lots de sécurité (XSS, règles), correction d'un décalage de fuseau horaire, design system avec mode sombre, états de chargement et états vides, version mobile. |
| **Fin août** | Fonctionnalités de rentrée | Deux modes de prise de rendez-vous, délibérations plein écran, entretiens à plusieurs, un compte pour plusieurs bureaux, cloisonnement strict des assos. |
| **Début septembre** | Fiabilisation avant la campagne | 36 premiers tests des règles de sécurité, audit (12 bugs corrigés), suppressions en cascade, audit des algorithmes (5 bugs corrigés), continuité des jurés. |
| **Semaine de campagne** (21-27 sept.) | Boucle de retours quotidienne | **37 versions en 7 jours**, chacune issue d'un retour du bureau pendant la campagne réelle (exemples ci-dessous). |

### Exemples de retours traités pendant la campagne
| Retour du bureau | Cause trouvée | Correction |
|---|---|---|
| « Pourquoi ce créneau affiche *Complet* ? » | Le calcul retirait deux jurés par entretien voisin, même quand ces jurés n'étaient pas disponibles sur ce créneau. | On retire les personnes réellement mobilisées. Test reproduisant le cas exact. |
| « Impossible de supprimer un cooptant » | Une requête ne filtrait pas par association : refusée par les règles pour le bureau, acceptée pour l'admin, d'où un bug invisible en test manuel. | Filtre ajouté partout, test qui rejoue la suppression avec un compte bureau. |
| « Des gens apparaissent en double dans le staff » | Un membre invité par email puis connecté a deux fiches. | Regroupement par personne, et toute action touche toutes ses fiches. |
| « Le lien du formulaire ne marche pas » | Le lien avait été copié avec la suite du message (« %0A%0AViens… »). | Tout ce qui suit l'identifiant est ignoré, sur toutes les pages. |
| « L'export CSV n'a aucun sens » | Intitulés non protégés (une virgule décalait les colonnes), séparateur inadapté à Excel en français. | Export réécrit, colonnes vides retirées. |
| « Deux entretiens se superposent sur le planning » | Chaque carte prenait toute la hauteur de sa case. | Entretiens simultanés côte à côte, colonne du jour élargie. |

### Qualité en continu
- **171 tests automatisés** dans la version en production (164 dans cette vitrine), lancés à chaque envoi par l'intégration continue : règles de sécurité sur l'émulateur Firestore, et logique pure (jurés, capacité, score, questions).
- **Chaque bug de campagne devient un test** : le cas réel est rejoué, pour qu'il ne revienne pas.
- **Filets de sécurité en production** : corbeille de 30 jours sur toute suppression, protection contre la suppression de la base.

### Et ensuite
Backlog priorisé à l'issue de la campagne :
1. Sauvegardes automatiques et restauration à une date donnée (nécessite l'offre payante Firebase).
2. Notifications (confirmation et rappel d'entretien par email), bloquées aujourd'hui par le filtrage des emails de l'école.
3. Tests de bout en bout du parcours candidat dans un vrai navigateur.
4. Statistiques de campagne pour le bureau (taux de remplissage, charge des jurés).

---

## Points techniques notables

- **Sécurité par les règles Firestore** (`firestore.rules`) : cloisonnement par association (`ownsOrg`, `isSecge`), écritures anonymes *bornées* plutôt qu'interdites (un candidat peut faire avancer son statut, jamais le faire reculer ni l'inventer), création de rôle conditionnée à un justificatif vérifiable (code d'invitation ou promotion d'un rattachement existant).
- **Attribution des jurés** (`public/js/jury.js`) : exclut les jurés déjà pris sur un créneau qui chevauche (pause comprise), privilégie la continuité (ceux qui viennent de passer), équilibre la charge et impose une relève au-delà d'un nombre d'entretiens d'affilée.
- **Capacité des créneaux** (`public/js/capacite.js`) : un juré n'est compté libre que s'il l'est sur toute la durée de l'entretien ; un créneau n'est « complet » qu'en retirant les personnes réellement mobilisées, pas un forfait par entretien.
- **Placement automatique** (`public/js/algo.js`) : greedy first-fit chronologique, idempotent, qui tient compte des entretiens déjà réalisés.
- **Opérations atomiques** : mise en corbeille et suppressions en un seul lot Firestore (tout ou rien), restauration limitée aux collections prévues.
- **Performance** : lectures indépendantes parallélisées, préchargement du SDK, barre de navigation posée avant toute lecture réseau.
- **Accessibilité** : navigation clavier, `aria-*`, contrastes AA, thème clair et sombre.

## La démo

Le site de démo est construit à partir de `public/` par `scripts/build-demo.mjs`, **sans modifier l'application** :
- une *import map* redirige les modules Firebase vers des versions simulées (`demo/firebase/`) : Firestore, Auth et Storage imités sur les fonctions que l'appli utilise, avec une base gardée dans le `localStorage` du visiteur ;
- `demo/seed.js` génère un jeu de données cohérent (asso, staff, disponibilités, cooptants, entretiens, évaluations), daté à partir du jour de la visite ;
- les chemins sont adaptés à GitHub Pages, qui sert le site sous `/cooptly/`.

Le workflow `.github/workflows/demo.yml` lance les tests, puis construit et publie la démo à chaque envoi sur `main`.

```bash
node scripts/build-demo.mjs /cooptly    # résultat dans _site/
```

## Stack

- HTML5 + JavaScript (modules ES), sans framework ni étape de build pour l'application.
- Firebase : Hosting, Firestore, Authentication (SDK v10 via CDN).
- Design system maison (variables CSS, `public/css/main.css`).

## Tests

164 tests, lancés avec `node:test`, à chaque envoi par l'intégration continue :
- **Règles de sécurité** sur l'émulateur Firestore (`@firebase/rules-unit-testing`) : cloisonnement inter-associations, parcours publics sans compte, cascades de suppression, corbeille.
- **Logique pure** : attribution des jurés, capacité des créneaux, score et classement, ordre des questions, paramètres d'URL.

```bash
cd tests
npm install
npm test          # démarre l'émulateur Firestore et lance les tests en série
```

Prérequis : Node 22+, Java (pour l'émulateur) et `firebase-tools`.

---

## Lancer le projet

1. Créer un projet Firebase avec **Hosting**, **Firestore** et **Authentication** (email et mot de passe).
2. Renseigner la configuration de l'appli web dans `public/js/firebase-config.js`.
3. Déployer :

```bash
firebase use --add            # choisir le projet
firebase deploy               # hosting + règles + index
```

4. Créer un premier compte, puis l'ajouter dans la collection `platform_admins` pour accéder à l'administration.

## Structure

```
public/
  index.html              connexion / inscription
  postuler.html           formulaire de candidature et réservation   (public)
  dispos-publique.html    disponibilités du staff                    (public)
  evaluer-publique.html   évaluation par le jury                     (public)
  planning-public.html    planning en lecture seule                  (public)
  candidat.html           suivi de candidature                       (public)
  planning.html           planning interne du bureau
  parametres.html         paramètres de l'association
  secge/                  tableau de bord, candidats, fiche d'évaluation
  admin/                  administration de la plateforme
  js/                     logique partagée (auth, jurys, capacité, algorithme…)
firestore.rules           règles de sécurité
tests/                    tests des règles et de la logique
demo/                     Firebase simulé et données de la démo
scripts/build-demo.mjs    construction de la démo pour GitHub Pages
```

## Auteur

Tom Mombrun
