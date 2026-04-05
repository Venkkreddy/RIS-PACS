import admin from "firebase-admin";
import path from "path";
import fs from "fs";
import { env } from "../config/env";

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;

  if (admin.apps.length === 0) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    let credential: admin.credential.Credential | undefined;

    if (credPath) {
      const resolved = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
      if (fs.existsSync(resolved)) {
        const serviceAccount = JSON.parse(fs.readFileSync(resolved, "utf-8"));
        credential = admin.credential.cert(serviceAccount);
      }
    }

    admin.initializeApp({
      projectId: env.FIREBASE_PROJECT_ID,
      ...(credential ? { credential } : {}),
    });
  }
  initialized = true;
}

export function getFirebaseAuth(): admin.auth.Auth {
  ensureInitialized();
  return admin.auth();
}

export function getFirestore(): admin.firestore.Firestore {
  ensureInitialized();
  return admin.firestore();
}
