import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
};

// 🔴 Database Firestore ESPLICITO:
// - se la variabile manca, è vuota o vale "(default)" → database di default (comportamento storico)
// - se contiene un id diverso (progetto con database "nominato") → passiamo l'id all'SDK
// Le virgolette vengono normalizzate: su Vercel un valore incollato come "(default)"
// diventerebbe altrimenti il nome di un database inesistente.
const rawDatabaseId = (import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID as string | undefined)
  ?.trim()
  .replace(/^["']|["']$/g, '');
const namedDatabaseId = rawDatabaseId && rawDatabaseId !== '(default)' ? rawDatabaseId : null;

const app = initializeApp(firebaseConfig);
export const db = namedDatabaseId ? getFirestore(app, namedDatabaseId) : getFirestore(app);
export const auth = getAuth(app);