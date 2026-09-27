# Cooptly

Plateforme de **cooptation pour associations étudiantes** : les candidats postulent et réservent leur entretien en ligne, le staff dépose ses disponibilités, les jurys sont attribués automatiquement, et le bureau centralise évaluations, classement et délibérations.

Conçue et développée pour les associations étudiantes d'emlyon business school, où elle est utilisée en conditions réelles par plusieurs bureaux pendant leurs campagnes de recrutement.

> Dépôt vitrine : aucune configuration Firebase n'est fournie (voir [Lancer le projet](#lancer-le-projet)).

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

## Points techniques notables

- **Sécurité par les règles Firestore** (`firestore.rules`) : cloisonnement par association (`ownsOrg`, `isSecge`), écritures anonymes *bornées* plutôt qu'interdites (un candidat peut faire avancer son statut, jamais le faire reculer ni l'inventer), création de rôle conditionnée à un justificatif vérifiable (code d'invitation ou promotion d'un rattachement existant).
- **Attribution des jurés** (`public/js/jury.js`) : exclut les jurés déjà pris sur un créneau qui chevauche (pause comprise), privilégie la continuité (ceux qui viennent de passer), équilibre la charge et impose une relève au-delà d'un nombre d'entretiens d'affilée.
- **Capacité des créneaux** (`public/js/capacite.js`) : un juré n'est compté libre que s'il l'est sur toute la durée de l'entretien ; un créneau n'est « complet » qu'en retirant les personnes réellement mobilisées, pas un forfait par entretien.
- **Placement automatique** (`public/js/algo.js`) : greedy first-fit chronologique, idempotent, qui tient compte des entretiens déjà réalisés.
- **Opérations atomiques** : mise en corbeille et suppressions en un seul lot Firestore (tout ou rien), restauration limitée aux collections prévues.
- **Performance** : lectures indépendantes parallélisées, préchargement du SDK, barre de navigation posée avant toute lecture réseau.
- **Accessibilité** : navigation clavier, `aria-*`, contrastes AA, thème clair et sombre.

## Stack

- HTML5 + JavaScript (modules ES), sans framework ni étape de build.
- Firebase : Hosting, Firestore, Authentication (SDK v10 via CDN).
- Design system maison (variables CSS, `public/css/main.css`).

## Tests

164 tests, lancés avec `node:test` :
- **Règles de sécurité** sur l'émulateur Firestore (`@firebase/rules-unit-testing`) : cloisonnement inter-associations, parcours publics sans compte, cascades de suppression, corbeille.
- **Logique pure** : attribution des jurés, capacité des créneaux, score et classement, ordre des questions, paramètres d'URL.

```bash
cd tests
npm install
npm test          # démarre l'émulateur Firestore et lance les tests en série
```

Prérequis : Node 18+, Java (pour l'émulateur) et `firebase-tools`.

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
```

## Auteur

Tom Mombrun
