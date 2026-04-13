/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const admin = require("firebase-admin");

const DEFAULT_PASSWORD = process.env.DEMO_USER_PASSWORD || "TDAI#Demo1234";

const DEMO_USERS = [
  { role: "super_admin", displayName: "Dev Super Admin", email: "super_admin@example.com", password: DEFAULT_PASSWORD },
  { role: "admin", displayName: "Dev Admin", email: "admin@example.com", password: DEFAULT_PASSWORD },
  { role: "developer", displayName: "Dev Developer", email: "developer@example.com", password: DEFAULT_PASSWORD },
  { role: "radiologist", displayName: "Dev Radiologist", email: "radiologist@example.com", password: DEFAULT_PASSWORD },
  { role: "radiographer", displayName: "Dev Radiographer", email: "radiographer@example.com", password: DEFAULT_PASSWORD },
  { role: "referring", displayName: "Dev Referring", email: "referring@example.com", password: DEFAULT_PASSWORD },
  { role: "billing", displayName: "Dev Billing", email: "billing@example.com", password: DEFAULT_PASSWORD },
  { role: "receptionist", displayName: "Dev Receptionist", email: "receptionist@example.com", password: DEFAULT_PASSWORD },
  { role: "viewer", displayName: "Dev Viewer", email: "viewer@example.com", password: DEFAULT_PASSWORD },
];

function loadEnvironment() {
  const candidateEnvFiles = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "../.env"),
    path.resolve(__dirname, "../../.env"),
  ];

  for (const envFile of candidateEnvFiles) {
    if (fs.existsSync(envFile)) {
      dotenv.config({ path: envFile, override: false });
    }
  }
}

function resolveCredentialsPath(rawPath) {
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.resolve(process.cwd(), rawPath);
}

function initializeFirebaseAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT_ID || "ris-pacs-9859a";
  const credentialsPath = resolveCredentialsPath(process.env.GOOGLE_APPLICATION_CREDENTIALS);

  let credentialOptions = {};
  if (credentialsPath) {
    if (!fs.existsSync(credentialsPath)) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file not found at: ${credentialsPath}`);
    }
    const serviceAccount = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
    credentialOptions = { credential: admin.credential.cert(serviceAccount) };
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId,
      ...credentialOptions,
    });
  }

  return {
    auth: admin.auth(),
    firestore: admin.firestore(),
    projectId,
  };
}

async function ensureFirebaseAuthUser(auth, demoUser) {
  const normalizedEmail = demoUser.email.toLowerCase();
  try {
    const existing = await auth.getUserByEmail(normalizedEmail);
    const updated = await auth.updateUser(existing.uid, {
      password: demoUser.password,
      displayName: demoUser.displayName,
      emailVerified: true,
      disabled: false,
    });
    return { userRecord: updated, status: "updated" };
  } catch (error) {
    if (error && error.code === "auth/user-not-found") {
      const created = await auth.createUser({
        email: normalizedEmail,
        password: demoUser.password,
        displayName: demoUser.displayName,
        emailVerified: true,
      });
      return { userRecord: created, status: "created" };
    }
    throw error;
  }
}

async function upsertFirestoreUserProfile(firestore, userRecord, demoUser) {
  const now = new Date().toISOString();
  const docRef = firestore.collection("users").doc(userRecord.uid);
  const snapshot = await docRef.get();
  const existing = snapshot.exists ? snapshot.data() : {};

  const userProfile = {
    ...existing,
    id: userRecord.uid,
    email: demoUser.email.toLowerCase(),
    role: demoUser.role,
    approved: true,
    requestStatus: "approved",
    authProvider: "password",
    displayName: demoUser.displayName,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };

  await docRef.set(userProfile, { merge: true });
}

async function seedDemoUsers() {
  loadEnvironment();
  const { auth, firestore, projectId } = initializeFirebaseAdmin();

  console.log(`Seeding Firebase demo users in project: ${projectId}`);
  const seedRows = [];

  for (const demoUser of DEMO_USERS) {
    const { userRecord, status } = await ensureFirebaseAuthUser(auth, demoUser);
    await upsertFirestoreUserProfile(firestore, userRecord, demoUser);

    seedRows.push({
      role: demoUser.role,
      email: demoUser.email.toLowerCase(),
      password: demoUser.password,
      status,
    });
  }

  console.log("\nFirebase demo users ready:");
  console.table(seedRows);
  console.log("\nYou can now login with any email above and its listed password.");
}

seedDemoUsers().catch((error) => {
  console.error("Failed to seed Firebase demo users.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
