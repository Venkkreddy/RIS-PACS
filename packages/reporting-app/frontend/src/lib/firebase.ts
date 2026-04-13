import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, type Auth } from "firebase/auth";

function isPlaceholderEnvValue(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) {
    return true;
  }

  const normalized = trimmed.toLowerCase();
  return (
    normalized === "placeholder" ||
    normalized === "placeholder.firebaseapp.com" ||
    normalized.startsWith("your-") ||
    normalized.includes("your-project") ||
    normalized.includes("your-firebase") ||
    normalized.includes("example.com") ||
    normalized.includes("change-me") ||
    normalized.includes("changeme")
  );
}

function readEnvOrFallback(value: string | undefined, fallback: string): string {
  return isPlaceholderEnvValue(value) ? fallback : value!.trim();
}

const firebaseConfig = {
  apiKey: readEnvOrFallback(import.meta.env.VITE_FIREBASE_API_KEY, "AIzaSyC1VRHBcDWlkdUfu3-qrG5_l9qDHaZ-doQ"),
  authDomain: readEnvOrFallback(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, "ris-pacs-9859a.firebaseapp.com"),
  projectId: readEnvOrFallback(import.meta.env.VITE_FIREBASE_PROJECT_ID, "ris-pacs-9859a"),
  storageBucket: readEnvOrFallback(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, "ris-pacs-9859a.firebasestorage.app"),
  messagingSenderId: readEnvOrFallback(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, "502102007740"),
  appId: readEnvOrFallback(import.meta.env.VITE_FIREBASE_APP_ID, "1:502102007740:web:092fc6257497ddc86bd5b9"),
};

const configEntries = Object.entries(firebaseConfig);
const baseConfigIssues = configEntries
  .filter(([, value]) => isPlaceholderEnvValue(value))
  .map(([key]) => key);

let firebaseAuth: Auth | null = null;
let runtimeConfigIssue: string | null = null;

if (baseConfigIssues.length === 0) {
  try {
    const app = initializeApp(firebaseConfig);
    firebaseAuth = getAuth(app);
  } catch (error) {
    runtimeConfigIssue =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "unknown";
  }
}

export const firebaseConfigIssues = runtimeConfigIssue
  ? [...baseConfigIssues, `runtime:${runtimeConfigIssue}`]
  : baseConfigIssues;

export const firebaseConfigReady = firebaseConfigIssues.length === 0 && firebaseAuth !== null;
export { firebaseAuth };
export const googleProvider = new GoogleAuthProvider();
