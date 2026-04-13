import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, type Auth } from "firebase/auth";

function readEnvOrFallback(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function debugFirebaseLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  runId = "run-3",
) {
  fetch("http://127.0.0.1:7829/ingest/0823df88-6411-4f3d-9920-ebf0779efd31", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b161f5",
    },
    body: JSON.stringify({
      sessionId: "b161f5",
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
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
const invalidFirebaseValues = new Set(["", "placeholder", "placeholder.firebaseapp.com"]);

const baseConfigIssues = configEntries
  .filter(([, value]) => invalidFirebaseValues.has(value))
  .map(([key]) => key);

let firebaseAuth: Auth | null = null;
let runtimeConfigIssue: string | null = null;

if (baseConfigIssues.length === 0) {
  try {
    const app = initializeApp(firebaseConfig);
    firebaseAuth = getAuth(app);
    // #region agent log
    debugFirebaseLog("H14", "firebase.ts:initSuccess", "firebase initialized successfully");
    // #endregion
  } catch (error) {
    runtimeConfigIssue =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "unknown";
    // #region agent log
    debugFirebaseLog("H14", "firebase.ts:initError", "firebase initialization failed", {
      runtimeConfigIssue,
    });
    // #endregion
  }
} else {
  // #region agent log
  debugFirebaseLog("H14", "firebase.ts:skipInit", "firebase initialization skipped due to config issues", {
    baseConfigIssues,
  });
  // #endregion
}

export const firebaseConfigIssues = runtimeConfigIssue
  ? [...baseConfigIssues, `runtime:${runtimeConfigIssue}`]
  : baseConfigIssues;

export const firebaseConfigReady = firebaseConfigIssues.length === 0 && firebaseAuth !== null;
export { firebaseAuth };
export const googleProvider = new GoogleAuthProvider();
