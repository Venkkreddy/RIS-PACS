/**
 * Clears ALL data from the Firestore database collections.
 * Run this to remove old seed data so the dashboards start fresh.
 *
 * Usage: node scripts/clear-firestore-data.js
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// Initialize Firebase Admin
const credPath = path.resolve(__dirname, "..", "service-account.json");
let credential;
if (fs.existsSync(credPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(credPath, "utf-8"));
  credential = admin.credential.cert(serviceAccount);
}

admin.initializeApp({
  projectId: "ris-pacs-client",
  ...(credential ? { credential } : {}),
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// Collections that hold the app data (from store.ts)
const COLLECTIONS_TO_CLEAR = [
  "patients",
  "orders",
  "referringPhysicians",
  "billing",
  "studies",
  "reports",
  "templates",
  "scans",
  "users",
  "invites",
  "settings",
  "notifications",
];

async function deleteCollection(collectionName) {
  const collRef = db.collection(collectionName);
  const snapshot = await collRef.get();
  if (snapshot.empty) {
    console.log(`  ${collectionName}: empty (nothing to delete)`);
    return 0;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  console.log(`  ${collectionName}: deleted ${snapshot.size} documents`);
  return snapshot.size;
}

async function main() {
  console.log("==============================================");
  console.log("  Clearing old data from Firestore database");
  console.log("==============================================\n");

  let totalDeleted = 0;
  for (const collection of COLLECTIONS_TO_CLEAR) {
    try {
      totalDeleted += await deleteCollection(collection);
    } catch (err) {
      console.error(`  ERROR clearing ${collection}:`, err.message);
    }
  }

  console.log(`\nDone! Deleted ${totalDeleted} total documents.`);
  console.log("The dashboards will now start with a clean, empty database.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
