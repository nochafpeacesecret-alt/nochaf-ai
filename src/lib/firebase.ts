import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  ConfirmationResult,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  updateProfile,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  doc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
  getDoc,
  arrayUnion,
  arrayRemove,
  increment,
  writeBatch,
} from 'firebase/firestore';
import {
  getDatabase,
  ref as rtdbRef,
  set as rtdbSet,
  update as rtdbUpdate,
  remove as rtdbRemove,
  onValue as rtdbOnValue,
  onDisconnect as rtdbOnDisconnect,
  serverTimestamp as rtdbServerTimestamp,
} from 'firebase/database';
import firebaseAppletConfig from '../../firebase-applet-config.json';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (firebaseAppletConfig as any).apiKey || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || (firebaseAppletConfig as any).authDomain || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || (firebaseAppletConfig as any).projectId || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || (firebaseAppletConfig as any).storageBucket || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || (firebaseAppletConfig as any).messagingSenderId || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || (firebaseAppletConfig as any).appId || '',
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || (firebaseAppletConfig as any).firestoreDatabaseId || '',
  oAuthClientId: (firebaseAppletConfig as any).oAuthClientId || '',
};

console.log("Using project:", firebaseConfig.projectId);

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

const auth = getAuth(app);
const dbId = firebaseConfig.firestoreDatabaseId || undefined;

// Initialize Firestore with experimentalForceLongPolling for instant reliable iframe/web connectivity
let db: ReturnType<typeof getFirestore>;
try {
  db = initializeFirestore(
    app,
    {
      experimentalForceLongPolling: true,
    },
    dbId && dbId !== '(default)' ? dbId : undefined
  );
} catch {
  db = dbId && dbId !== '(default)' ? getFirestore(app, dbId) : getFirestore(app);
}

// Test connection on boot
if (typeof window !== 'undefined') {
  getDoc(doc(db, 'test', 'connection')).catch((error) => {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline notice. Retrying connection...');
    }
  });
}

// Initialize Realtime Database for WhatsApp-style presence
let rtdb: ReturnType<typeof getDatabase> | null = null;
try {
  const rtdbUrl =
    (firebaseConfig as any).databaseURL ||
    `https://${(firebaseConfig as any).projectId}-default-rtdb.firebaseio.com`;
  rtdb = getDatabase(app, rtdbUrl);
} catch (e) {
  console.warn('RTDB initialization warning:', e);
}

export {
  app,
  auth,
  db,
  rtdb,
  getDatabase,
  rtdbRef,
  rtdbSet,
  rtdbUpdate,
  rtdbRemove,
  rtdbOnValue,
  rtdbOnDisconnect,
  rtdbServerTimestamp,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  updateProfile,
  onAuthStateChanged,
  doc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
  getDoc,
  arrayUnion,
  arrayRemove,
  increment,
  writeBatch,
};
export type { User, ConfirmationResult };
