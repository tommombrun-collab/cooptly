/** firebase-app factice : la démo n'a qu'une « appli », sans serveur. */
const app = { name: '[DEFAULT]', options: {} };
export const initializeApp = () => app;
export const getApps = () => [app];
export const getApp = () => app;
