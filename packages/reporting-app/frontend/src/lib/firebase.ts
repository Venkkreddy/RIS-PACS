import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyC1VRHBcDWlkdUfu3-qrG5_l9qDHaZ-doQ",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "ris-pacs-9859a.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "ris-pacs-9859a",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "ris-pacs-9859a.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "502102007740",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:502102007740:web:092fc6257497ddc86bd5b9",
};

const configEntries = Object.entries(firebaseConfig);
const invalidFirebaseValues = new Set(["", "placeholder", "placeholder.firebaseapp.com"]);

export const firebaseConfigIssues = configEntries
  .filter(([, value]) => invalidFirebaseValues.has(value))
  .map(([key]) => key);
export const firebaseConfigReady = firebaseConfigIssues.length === 0;

const app = initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
