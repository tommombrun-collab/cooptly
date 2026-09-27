/**
 * Tests des règles Firestore de Cooptly.
 *
 * Objectif : prouver le cloisonnement entre assos, que les règles ne
 * vérifiaient pas avant l'audit du 2026-08-25.
 *
 * Lancer : cd tests && npm test
 * (nécessite Java pour l'émulateur Firestore)
 *
 * Quatre acteurs :
 *   anon    : personne non connectée (cooptant, juré, staff sans compte)
 *   bureauA : membre du bureau de l'asso A
 *   bureauB : membre du bureau de l'asso B
 *   admin   : admin plateforme
 */
import { readFileSync } from 'node:fs';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, query, where, addDoc,
} from 'firebase/firestore';

const ORG_A = 'orgA', ORG_B = 'orgB';
const UID_A = 'uidBureauA', UID_B = 'uidBureauB', UID_ADMIN = 'uidAdmin';

let env, anon, bureauA, bureauB, admin;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-coopt',
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  // Jeu de données minimal, écrit règles désactivées.
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'organizations', ORG_A), { name: 'Asso A', slug: 'a' });
    await setDoc(doc(db, 'organizations', ORG_B), { name: 'Asso B', slug: 'b' });

    // Memberships : l'ID composite {uid}_{orgId} est ce que isSecge() teste.
    await setDoc(doc(db, 'memberships', `${UID_A}_${ORG_A}`), {
      userId: UID_A, organizationId: ORG_A, role: 'secge', email: 'a@x.com',
    });
    await setDoc(doc(db, 'memberships', `${UID_B}_${ORG_B}`), {
      userId: UID_B, organizationId: ORG_B, role: 'secge', email: 'b@x.com',
    });
    await setDoc(doc(db, 'platform_admins', UID_ADMIN), { email: 'admin@x.com' });

    for (const org of [ORG_A, ORG_B]) {
      await setDoc(doc(db, 'campaigns', `camp${org}`), {
        organizationId: org, name: 'Recrutement', rankOrder: ['c1'],
      });
      await setDoc(doc(db, 'candidates', `cand${org}`), {
        organizationId: org, campaignId: `camp${org}`,
        email: `c@${org}.com`, nom: 'X', prenom: 'Y', statut: 'recu',
        resultToken: `tok${org}`, notesInternes: 'secret',
      });
      await setDoc(doc(db, 'interviews', `iv${org}`), {
        organizationId: org, campaignId: `camp${org}`, candidateId: `cand${org}`,
        selfBooked: true, jury1Id: null, statut: 'planifie',
      });
      await setDoc(doc(db, 'interview_evaluations', `ev${org}`), {
        organizationId: org, campaignId: `camp${org}`, candidateId: `cand${org}`,
        noteGlobale: 15, commentaire: 'confidentiel',
      });
      await setDoc(doc(db, 'invite_codes', `CODE${org}`), {
        organizationId: org, role: 'secge', active: true,
      });
      await setDoc(doc(db, 'rooms', `room${org}`), { organizationId: org, code: 'A1' });
      await setDoc(doc(db, 'room_bookings', `bk${org}`), { organizationId: org, roomId: `room${org}` });
      await setDoc(doc(db, 'staff_availabilities', `sa${org}`), {
        organizationId: org, campaignId: `camp${org}`, userId: 'staff1', creneaux: [],
      });
      await setDoc(doc(db, 'roster_members', `r${org}`), { organizationId: org, displayName: 'Z' });
    }

    // Évaluation legacy sans organizationId : teste le repli par campagne.
    await setDoc(doc(db, 'interview_evaluations', 'evLegacy'), {
      campaignId: `camp${ORG_A}`, candidateId: `cand${ORG_A}`, noteGlobale: 12,
    });
  });

  anon    = env.unauthenticatedContext().firestore();
  bureauA = env.authenticatedContext(UID_A,     { email: 'a@x.com' }).firestore();
  bureauB = env.authenticatedContext(UID_B,     { email: 'b@x.com' }).firestore();
  admin   = env.authenticatedContext(UID_ADMIN, { email: 'admin@x.com' }).firestore();
});

after(async () => { await env?.cleanup(); });

// ─────────────────────────────────────────────────────────────────────
describe('Parcours public : doit rester ouvert', () => {
  test('lit les orgs, campagnes, candidats, entretiens, dispos, roster, salles', async () => {
    for (const col of ['organizations','campaigns','candidates','interviews',
                       'staff_availabilities','roster_members','rooms']) {
      await assertSucceeds(getDocs(collection(anon, col)));
    }
  });

  test('valide un code d invitation par get unitaire (inscription)', async () => {
    await assertSucceeds(getDoc(doc(anon, 'invite_codes', `CODE${ORG_A}`)));
  });

  test('un cooptant peut reserver un entretien', async () => {
    await assertSucceeds(addDoc(collection(anon, 'interviews'), {
      organizationId: ORG_A, campaignId: `camp${ORG_A}`, candidateId: `cand${ORG_A}`,
      selfBooked: true,
    }));
  });

  test('un jure sans compte peut envoyer une evaluation', async () => {
    // ID deterministe : c'est ce qui permet l'upsert sans lecture.
    await assertSucceeds(setDoc(doc(anon, 'interview_evaluations', `camp${ORG_A}_cand${ORG_A}`), {
      organizationId: ORG_A, campaignId: `camp${ORG_A}`, candidateId: `cand${ORG_A}`,
      noteGlobale: 14,
    }, { merge: true }));
  });

  test('le staff sans compte peut deposer ses dispos', async () => {
    await assertSucceeds(setDoc(doc(anon, 'staff_availabilities', `sa${ORG_A}`), {
      creneaux: [{ jour: '2026-09-01', creneaux: ['09:00'] }],
    }, { merge: true }));
  });
});

describe('Parcours public : ne doit PAS lire les données internes', () => {
  test('memberships, evaluations, codes, room_bookings refuses en anonyme', async () => {
    for (const col of ['memberships','interview_evaluations','invite_codes','room_bookings']) {
      await assertFails(getDocs(collection(anon, col)));
    }
  });

  test('un anonyme ne peut pas supprimer une candidature', async () => {
    await assertFails(deleteDoc(doc(anon, 'candidates', `cand${ORG_A}`)));
  });

  test('un anonyme ne peut pas deplacer une dispo vers une autre asso', async () => {
    await assertFails(updateDoc(doc(anon, 'staff_availabilities', `sa${ORG_A}`), {
      organizationId: ORG_B,
    }));
  });

  test('un anonyme ne peut pas reaffecter une evaluation a une autre asso', async () => {
    await assertFails(updateDoc(doc(anon, 'interview_evaluations', `ev${ORG_A}`), {
      organizationId: ORG_B,
    }));
  });

  test('un anonyme ne peut pas s attribuer le jury d un entretien', async () => {
    await assertFails(updateDoc(doc(anon, 'interviews', `iv${ORG_A}`), {
      selfBooked: true, jury1Id: 'moi',
    }));
  });
});

describe('Cloisonnement : le bureau A ne voit pas l asso B', () => {
  test('A lit les donnees de SA propre asso', async () => {
    for (const col of ['interview_evaluations','invite_codes','rooms','room_bookings','memberships']) {
      await assertSucceeds(getDocs(query(collection(bureauA, col),
        where('organizationId','==',ORG_A))));
    }
  });

  test('A ne lit PAS les evaluations de B', async () => {
    await assertFails(getDocs(query(collection(bureauA, 'interview_evaluations'),
      where('organizationId','==',ORG_B))));
  });

  test('A ne lit PAS les codes d invitation de B (chaine de prise de controle)', async () => {
    await assertFails(getDocs(query(collection(bureauA, 'invite_codes'),
      where('organizationId','==',ORG_B))));
  });

  test('A ne lit PAS tous les codes sans filtre', async () => {
    await assertFails(getDocs(collection(bureauA, 'invite_codes')));
  });

  test('A ne lit PAS les memberships de B', async () => {
    await assertFails(getDocs(query(collection(bureauA, 'memberships'),
      where('organizationId','==',ORG_B))));
  });

  test('A ne lit PAS les reservations de salles de B', async () => {
    await assertFails(getDocs(query(collection(bureauA, 'room_bookings'),
      where('organizationId','==',ORG_B))));
  });
});

describe('Cloisonnement : le bureau A n ecrit pas chez B', () => {
  test('A ne supprime pas une candidature de B', async () => {
    await assertFails(deleteDoc(doc(bureauA, 'candidates', `cand${ORG_B}`)));
  });

  test('A ne supprime pas un entretien de B', async () => {
    await assertFails(deleteDoc(doc(bureauA, 'interviews', `iv${ORG_B}`)));
  });

  test('A ne modifie pas la campagne de B', async () => {
    await assertFails(updateDoc(doc(bureauA, 'campaigns', `camp${ORG_B}`), { nbPlaces: 99 }));
  });

  test('A ne supprime pas une salle de B', async () => {
    await assertFails(deleteDoc(doc(bureauA, 'rooms', `room${ORG_B}`)));
  });

  test('A ne supprime pas les dispos de B', async () => {
    await assertFails(deleteDoc(doc(bureauA, 'staff_availabilities', `sa${ORG_B}`)));
  });

  test('A ne supprime pas un nom du roster de B', async () => {
    await assertFails(deleteDoc(doc(bureauA, 'roster_members', `r${ORG_B}`)));
  });

  test('A ne cree pas de code d invitation pour B', async () => {
    await assertFails(addDoc(collection(bureauA, 'invite_codes'), {
      organizationId: ORG_B, role: 'secge', active: true,
    }));
  });

  test('A modifie bien SA propre campagne', async () => {
    await assertSucceeds(updateDoc(doc(bureauA, 'campaigns', `camp${ORG_A}`), { nbPlaces: 25 }));
  });
});

describe('Escalade de privileges', () => {
  test('sans justificatif, on ne s octroie pas un membership', async () => {
    await assertFails(setDoc(doc(bureauA, 'memberships', `${UID_A}_${ORG_B}`), {
      userId: UID_A, organizationId: ORG_B, role: 'secge',
    }));
  });

  test('un code de B ne donne pas un role different de celui du code', async () => {
    await assertFails(setDoc(doc(bureauA, 'memberships', `${UID_A}_${ORG_B}`), {
      userId: UID_A, organizationId: ORG_B, role: 'president', viaCode: `CODE${ORG_B}`,
    }));
  });

  test('un code de B ne sert pas a rejoindre A', async () => {
    await assertFails(setDoc(doc(bureauB, 'memberships', `${UID_B}_${ORG_A}`), {
      userId: UID_B, organizationId: ORG_A, role: 'secge', viaCode: `CODE${ORG_B}`,
    }));
  });

  test('avec le bon code, on rejoint bien l asso (parcours rejoindre.html)', async () => {
    await assertSucceeds(setDoc(doc(bureauA, 'memberships', `${UID_A}_${ORG_B}`), {
      userId: UID_A, organizationId: ORG_B, role: 'secge', viaCode: `CODE${ORG_B}`,
      email: 'a@x.com',
    }));
  });

  test('on ne change pas son propre role', async () => {
    await assertFails(updateDoc(doc(bureauA, 'memberships', `${UID_A}_${ORG_A}`), {
      role: 'president',
    }));
  });

  // Ajouter un collegue a SA propre asso est le fonctionnement voulu
  // (c'est ce que fait parametres.html). Ce qui doit etre interdit, c'est de
  // le faire chez une AUTRE asso.
  test('le bureau ajoute bien un membre a SA propre asso', async () => {
    await assertSucceeds(setDoc(doc(bureauB, 'memberships', `autrui_${ORG_B}`), {
      userId: 'autrui', organizationId: ORG_B, role: 'secge', email: 'autrui@x.com',
    }));
  });

  test('le bureau n ajoute PAS un membre chez une autre asso', async () => {
    await assertFails(setDoc(doc(bureauB, 'memberships', `autrui_${ORG_A}`), {
      userId: 'autrui', organizationId: ORG_A, role: 'secge', email: 'autrui@x.com',
    }));
  });
});

describe('Admin plateforme', () => {
  test('lit les collections internes de toutes les assos', async () => {
    for (const col of ['memberships','interview_evaluations','invite_codes',
                       'room_bookings','platform_campaigns']) {
      await assertSucceeds(getDocs(collection(admin, col)));
    }
  });

  test('modifie la campagne de n importe quelle asso', async () => {
    await assertSucceeds(updateDoc(doc(admin, 'campaigns', `camp${ORG_B}`), { nbPlaces: 10 }));
  });
});

describe('Robustesse', () => {
  test('une evaluation sans organizationId reste lisible par son asso (repli campagne)', async () => {
    await assertSucceeds(getDoc(doc(bureauA, 'interview_evaluations', 'evLegacy')));
  });

  test('cette meme evaluation legacy reste invisible pour B', async () => {
    await assertFails(getDoc(doc(bureauB, 'interview_evaluations', 'evLegacy')));
  });

  test('platform_campaigns n est plus lisible par un simple bureau', async () => {
    await assertFails(getDocs(collection(bureauA, 'platform_campaigns')));
  });
});
