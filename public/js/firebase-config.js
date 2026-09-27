// ─────────────────────────────────────────────────────────────
//  Configuration Firebase
//
//  Version vitrine : aucune configuration n'est fournie. Pour faire tourner
//  le projet, crée un projet Firebase (Hosting, Firestore, Authentication
//  par email et mot de passe) et colle ici la configuration de l'appli web
//  (Console Firebase → Paramètres du projet → Vos applications).
//
//  Ces valeurs ne sont pas des secrets : elles sont servies à chaque
//  navigateur. La sécurité repose sur les règles Firestore (firestore.rules).
// ─────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            "VOTRE_API_KEY",
  authDomain:        "VOTRE_PROJET.firebaseapp.com",
  projectId:         "VOTRE_PROJET",
  storageBucket:     "VOTRE_PROJET.firebasestorage.app",
  messagingSenderId: "VOTRE_SENDER_ID",
  appId:             "VOTRE_APP_ID",
};

const isProd = true;

export { firebaseConfig, isProd };
