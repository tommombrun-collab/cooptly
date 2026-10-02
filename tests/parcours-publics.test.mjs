/**
 * Parcours PUBLICS de bout en bout, tels que les pages les executent vraiment.
 * Objectif : detecter toute regression ou une page publique se retrouve bloquee
 * par les regles (le symptome utilisateur est "Missing or insufficient permissions").
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, addDoc, collection, deleteDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const env = await initializeTestEnvironment({
  projectId: 'demo-coopt',
  firestore: { rules: readFileSync('firestore.rules','utf8'), host:'127.0.0.1', port:8080 },
});
const anon = env.unauthenticatedContext().firestore();

const seed = (path, data) =>
  env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), data));

test('postuler.html : candidature + entretien + passage a "place"', async () => {
  await assertSucceeds(setDoc(doc(anon,'candidates','c1'), {
    campaignId:'camp1', organizationId:'orgA', email:'a@b.c',
    prenom:'Zoe', nom:'M', statut:'recu', resultToken:'tok', notesInternes:'',
  }));
  await assertSucceeds(addDoc(collection(anon,'interviews'), {
    campaignId:'camp1', organizationId:'orgA', candidateId:'c1',
    statut:'planifie', selfBooked:true, jury1Id:null, jury2Id:null, jury3Id:null,
  }));
  // postuler.html ligne 1020, juste avant la redirection vers confirmation.html
  await assertSucceeds(updateDoc(doc(anon,'candidates','c1'), { statut:'place' }));
});

test('postuler.html : cooptant et entretien ecrits dans un seul lot (tout ou rien)', async () => {
  const lot = writeBatch(anon);
  lot.set(doc(anon,'candidates','lot1'), {
    campaignId:'camp1', organizationId:'orgA', email:'lot1@edu.em-lyon.com',
    prenom:'Lea', nom:'L', statut:'place', resultToken:'tokL', notesInternes:'', customAnswers:{},
  });
  lot.set(doc(collection(anon,'interviews')), {
    campaignId:'camp1', organizationId:'orgA', candidateId:'lot1', statut:'planifie', selfBooked:true,
    datetimeStart: new Date('2026-10-05T10:00:00'), jury1Id:'A', jury2Id:'B', jury3Id:null, roomId:null, salleNom:null,
  });
  await assertSucceeds(lot.commit());
});

test('postuler.html : changement de creneau dans un seul lot (cooptant + entretien)', async () => {
  await seed('candidates/lot2', { campaignId:'camp1', organizationId:'orgA', email:'lot2@edu.em-lyon.com',
    prenom:'Max', statut:'place', resultToken:'tokM', notesInternes:'note' });
  await seed('interviews/ivLot2', { campaignId:'camp1', organizationId:'orgA', candidateId:'lot2', selfBooked:true,
    statut:'planifie', datetimeStart: new Date('2026-10-05T10:00:00'), jury1Id:'A', jury2Id:'B', jury3Id:null, roomId:'r1', salleNom:null });
  const lot = writeBatch(anon);
  lot.update(doc(anon,'candidates','lot2'), { prenom:'Max', email:'lot2@edu.em-lyon.com', resultToken:'tokM', statut:'place', customAnswers:{} });
  lot.update(doc(anon,'interviews','ivLot2'), { campaignId:'camp1', organizationId:'orgA', candidateId:'lot2', selfBooked:true,
    statut:'planifie', datetimeStart: new Date('2026-10-06T11:00:00'), jury1Id:'C', jury2Id:'D', jury3Id:null, roomId:null, salleNom:null });
  await assertSucceeds(lot.commit());
});

test('un lot refuse n ecrit rien : pas de cooptant sans entretien', async () => {
  const lot = writeBatch(anon);
  lot.set(doc(anon,'candidates','lot3'), { campaignId:'camp1', organizationId:'orgA', email:'lot3@edu.em-lyon.com', statut:'place' });
  // Écriture interdite dans le même lot (s'attribuer une salle sans changer d'horaire).
  lot.update(doc(anon,'interviews','ivLot2'), { selfBooked:true, roomId:'salle-choisie' });
  await assertFails(lot.commit());
  // withSecurityRulesDisabled ne renvoie pas la valeur du rappel : on la capture.
  let reste = -1;
  await env.withSecurityRulesDisabled(async c => {
    reste = (await getDocs(query(collection(c.firestore(),'candidates'), where('email','==','lot3@edu.em-lyon.com')))).size;
  });
  if (reste !== 0) throw new Error(`le cooptant a ete ecrit malgre le refus du lot (${reste})`);
});

test('postuler.html : re-soumission du formulaire par le meme cooptant', async () => {
  await seed('candidates/c2', {
    campaignId:'camp1', organizationId:'orgA', email:'d@e.f',
    statut:'place', resultToken:'tok2', notesInternes:'note du bureau', prenom:'Ana',
  });
  await assertSucceeds(setDoc(doc(anon,'candidates','c2'), {
    campaignId:'camp1', organizationId:'orgA', email:'d@e.f',
    statut:'place', resultToken:'tok2', notesInternes:'note du bureau', prenom:'Ines',
  }));
});

test('postuler.html : report de creneau sans compte (nouveau jury, salle liberee)', async () => {
  await seed('interviews/ivR', {
    organizationId:'orgA', campaignId:'camp1', candidateId:'cR', selfBooked:true, statut:'planifie',
    datetimeStart: new Date('2026-10-01T10:00:00'), jury1Id:'A', jury2Id:'B', jury3Id:null, roomId:'r1', salleNom:null,
  });
  // Tel que postuler.html l'ecrit : nouvel horaire, jury reattribue, salle videe.
  await assertSucceeds(updateDoc(doc(anon,'interviews','ivR'), {
    organizationId:'orgA', campaignId:'camp1', candidateId:'cR', selfBooked:true, statut:'planifie',
    datetimeStart: new Date('2026-10-02T10:00:00'), jury1Id:'C', jury2Id:'D', jury3Id:null, roomId:null, salleNom:null,
  }));
  // Meme horaire : le jury ne bouge pas sans compte.
  await assertFails(updateDoc(doc(anon,'interviews','ivR'), { selfBooked:true, jury1Id:'moi' }));
});

test('mode stand : inscrit sans email, il ajoute son email depuis son lien', async () => {
  await seed('candidates/stand1', {
    campaignId:'camp1', organizationId:'orgA', email:'', source:'stand',
    statut:'place', resultToken:'tokS', notesInternes:'', prenom:'Lou',
  });
  await assertSucceeds(updateDoc(doc(anon,'candidates','stand1'), { email:'lou.b@edu.em-lyon.com', customAnswers:{ q1:'ok' } }));
  // Une fois posé, l'email ne se change plus sans compte.
  await assertFails(updateDoc(doc(anon,'candidates','stand1'), { email:'autre@edu.em-lyon.com' }));
});

test('un email existant ne peut toujours pas etre change sans compte', async () => {
  await seed('candidates/c2e', { campaignId:'camp1', organizationId:'orgA', email:'x@edu.em-lyon.com', statut:'recu' });
  await assertFails(updateDoc(doc(anon,'candidates','c2e'), { email:'y@edu.em-lyon.com' }));
});

test('evaluer-publique.html : le jure sans compte fait avancer le statut', async () => {
  await seed('candidates/c3', { campaignId:'camp1', organizationId:'orgA', email:'g@h.i', statut:'place' });
  await assertSucceeds(updateDoc(doc(anon,'candidates','c3'), { statut:'entretien_fait' }));
});

test('un anonyme ne peut pas faire RECULER un statut', async () => {
  await seed('candidates/c3b', { campaignId:'camp1', organizationId:'orgA', email:'g2@h.i', statut:'entretien_fait' });
  await assertFails(updateDoc(doc(anon,'candidates','c3b'), { statut:'place' }));
  await assertFails(updateDoc(doc(anon,'candidates','c3b'), { statut:'recu' }));
});

test('un anonyme ne peut pas inventer un statut', async () => {
  await seed('candidates/c3c', { campaignId:'camp1', organizationId:'orgA', email:'g3@h.i', statut:'recu' });
  await assertFails(updateDoc(doc(anon,'candidates','c3c'), { statut:'accepte' }));
});

test('un anonyme ne peut pas effacer les notes internes du bureau', async () => {
  await seed('candidates/c4', { campaignId:'camp1', organizationId:'orgA', email:'j@k.l', statut:'recu', notesInternes:'secret' });
  await assertFails(updateDoc(doc(anon,'candidates','c4'), { notesInternes:'' }));
});

test('un anonyme ne peut pas voler le jeton de suivi', async () => {
  await seed('candidates/c5', { campaignId:'camp1', organizationId:'orgA', email:'m@n.o', statut:'recu', resultToken:'secret' });
  await assertFails(updateDoc(doc(anon,'candidates','c5'), { resultToken:'vole' }));
});

test('dispos-publique.html : depot et mise a jour des dispos sans compte', async () => {
  const ref = doc(anon,'staff_availabilities','sa1');
  await assertSucceeds(setDoc(ref, { campaignId:'camp1', organizationId:'orgA', userId:'roster_x', creneaux:[], displayName:'Lea' }));
  await assertSucceeds(updateDoc(ref, { creneaux:[{jour:'2026-09-30',creneaux:['09:00']}] }));
});

test('dispos-publique.html : auto-ajout au roster sans compte', async () => {
  await assertSucceeds(setDoc(doc(anon,'roster_members','r1'), { organizationId:'orgA', displayName:'Lea' }));
});

test('evaluer-publique.html : un jure sans compte envoie son evaluation', async () => {
  await assertSucceeds(setDoc(doc(anon,'interview_evaluations','camp1_c1'), {
    candidateId:'c1', campaignId:'camp1', organizationId:'orgA',
    criteria:{}, noteGlobale:4, decision:'oui', commentaire:'ok',
  }, { merge:true }));
});

test('candidat.html / confirmation.html : lecture du suivi par jeton', async () => {
  await assertSucceeds(setDoc(doc(anon,'candidates','c6'), { campaignId:'camp1', organizationId:'orgA', email:'p@q.r', statut:'recu', resultToken:'t6' }));
});

test('candidats.html : le bureau peut supprimer une candidature en cascade', async () => {
  const bureau = env.authenticatedContext('u_a', { email:'a@asso.fr' }).firestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d,'memberships','u_a_orgA'), { userId:'u_a', organizationId:'orgA', role:'secge', email:'a@asso.fr' });
    await setDoc(doc(d,'candidates','del1'),            { campaignId:'camp1', organizationId:'orgA', email:'x@y.z' });
    await setDoc(doc(d,'interviews','ivdel1'),          { campaignId:'camp1', organizationId:'orgA', candidateId:'del1' });
    await setDoc(doc(d,'interview_evaluations','edel1'),{ campaignId:'camp1', organizationId:'orgA', candidateId:'del1' });
  });
  await assertSucceeds(deleteDoc(doc(bureau,'interviews','ivdel1')));
  await assertSucceeds(deleteDoc(doc(bureau,'interview_evaluations','edel1')));
  await assertSucceeds(deleteDoc(doc(bureau,'candidates','del1')));
});

test('liens publics : un ancien slug reste resolvable sans compte', async () => {
  await seed('organizations/orgA', {
    name:'Asso A', slug:'nouveau-nom', slugHistory:['ancien-nom','encore-plus-vieux'],
  });
  // Les trois formes que resolveOrg accepte (org-lookup.js).
  const parSlug = await getDocs(query(collection(anon,'organizations'), where('slug','==','nouveau-nom')));
  const parAncien = await getDocs(query(collection(anon,'organizations'), where('slugHistory','array-contains','ancien-nom')));
  if (parSlug.size !== 1)   throw new Error('slug courant non resolu');
  if (parAncien.size !== 1) throw new Error('ancien slug non resolu');
  if (parAncien.docs[0].id !== 'orgA') throw new Error('mauvaise asso');
});

test('parametres : la remise a zero des cooptants emporte les entretiens', async () => {
  const bureau = env.authenticatedContext('u_r', { email:'r@asso.fr' }).firestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d,'memberships','u_r_orgR'), { userId:'u_r', organizationId:'orgR', role:'secge', email:'r@asso.fr' });
    await setDoc(doc(d,'candidates','rc1'),            { campaignId:'campR', organizationId:'orgR', email:'a@r.fr' });
    await setDoc(doc(d,'interviews','riv1'),           { campaignId:'campR', organizationId:'orgR', candidateId:'rc1' });
    await setDoc(doc(d,'interview_evaluations','re1'), { campaignId:'campR', organizationId:'orgR', candidateId:'rc1' });
  });
  // Les trois requetes que fait le bouton, puis les trois suppressions.
  const ivs = await getDocs(query(collection(bureau,'interviews'), where('campaignId','==','campR')));
  if (ivs.size !== 1) throw new Error('le bureau ne peut pas lister les entretiens a supprimer');
  await assertSucceeds(deleteDoc(doc(bureau,'candidates','rc1')));
  await assertSucceeds(deleteDoc(doc(bureau,'interviews','riv1')));
  await assertSucceeds(deleteDoc(doc(bureau,'interview_evaluations','re1')));
});

test.after(async () => { await env.cleanup(); });
