# Tests des règles Firestore

Vérifient le cloisonnement entre assos. À lancer **avant tout déploiement de
`firestore.rules`** : un déploiement part directement en production.

## Prérequis, une seule fois

```bash
brew install openjdk          # l'émulateur Firestore tourne sur Java
cd tests && npm install
```

`openjdk` est keg-only, donc pas dans le PATH par défaut. Pour le rendre
permanent :

```bash
echo 'export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"' >> ~/.zshrc
```

## Lancer

Depuis la racine du dépôt :

```bash
PATH="/opt/homebrew/opt/openjdk/bin:$PATH" firebase emulators:exec --only firestore --project demo-coopt "node --test --test-concurrency=1 'tests/*.test.mjs'"
```

**`--test-concurrency=1` est indispensable.** Par défaut, `node --test` lance les
fichiers en parallèle. Ils partagent pourtant un seul émulateur : chacun y charge
les règles et y écrit en même temps que les autres, et un test finissait par
dépasser son délai de façon aléatoire (10 s pile). En série, tout passe.

```bash
# Équivalent, depuis tests/ :
npm test
```

Rien ne touche la production : l'émulateur est local et le projet
`demo-coopt` est fictif.

## Ce qui est couvert

117 tests, dont les règles de sécurité avec quatre acteurs (anonyme, bureau
de l'asso A, bureau de l'asso B, admin plateforme) :

- le parcours public reste ouvert (postuler, dispos, évaluation jury, planning)
- l'anonyme ne lit pas les données internes et ne peut rien déplacer d'une
  asso vers une autre
- le bureau de A ne lit ni n'écrit rien chez B
- aucune escalade : pas de membership sans justificatif, pas d'auto-promotion,
  un code ne vaut que pour son asso et son rôle
- l'admin plateforme garde son accès
- robustesse : une évaluation ancienne sans `organizationId` reste lisible par
  son asso via le repli sur la campagne

## Si un test échoue

Ne pas déployer. Le message indique la ligne de `firestore.rules` qui a
tranché, ce qui suffit en général à localiser la cause.
