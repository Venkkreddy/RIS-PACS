/**
 * Seed demo users into Firebase Authentication using the Firebase Auth REST API.
 * This does NOT require a service account with IAM permissions —
 * it uses the same client-side API key to create users via email/password signup.
 *
 * Usage: node scripts/seed-firebase-users-rest.js
 */

const FIREBASE_API_KEY = "AIzaSyDmu7IP4XkosRnoCOOj-yhG8Yv-NAgaz1Y";
const SIGN_UP_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`;
const SIGN_IN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
const UPDATE_URL = `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${FIREBASE_API_KEY}`;

const DEFAULT_PASSWORD = "TDAI#Demo1234";

const DEMO_USERS = [
  { role: "super_admin", displayName: "Dev Super Admin", email: "super_admin@example.com" },
  { role: "admin", displayName: "Dev Admin", email: "admin@example.com" },
  { role: "developer", displayName: "Dev Developer", email: "developer@example.com" },
  { role: "radiologist", displayName: "Dev Radiologist", email: "radiologist@example.com" },
  { role: "radiographer", displayName: "Dev Radiographer", email: "radiographer@example.com" },
  { role: "referring", displayName: "Dev Referring", email: "referring@example.com" },
  { role: "billing", displayName: "Dev Billing", email: "billing@example.com" },
  { role: "receptionist", displayName: "Dev Receptionist", email: "receptionist@example.com" },
  { role: "viewer", displayName: "Dev Viewer", email: "viewer@example.com" },
];

async function createOrSignIn(user) {
  const email = user.email.toLowerCase();

  // Try to sign up first
  const signUpRes = await fetch(SIGN_UP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: DEFAULT_PASSWORD,
      displayName: user.displayName,
      returnSecureToken: true,
    }),
  });

  const signUpData = await signUpRes.json();

  if (signUpRes.ok) {
    // Successfully created — now verify email
    await fetch(UPDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken: signUpData.idToken,
        emailVerified: true,
        displayName: user.displayName,
      }),
    });
    return { email, status: "CREATED", role: user.role };
  }

  // If user already exists, sign in to verify credentials work
  if (signUpData.error?.message === "EMAIL_EXISTS") {
    const signInRes = await fetch(SIGN_IN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: DEFAULT_PASSWORD,
        returnSecureToken: true,
      }),
    });

    const signInData = await signInRes.json();

    if (signInRes.ok) {
      // Update display name
      await fetch(UPDATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken: signInData.idToken,
          displayName: user.displayName,
          emailVerified: true,
        }),
      });
      return { email, status: "EXISTS (verified login works)", role: user.role };
    }

    return { email, status: `EXISTS (sign-in failed: ${signInData.error?.message})`, role: user.role };
  }

  return { email, status: `FAILED: ${signUpData.error?.message}`, role: user.role };
}

async function main() {
  console.log("🔐 Seeding Firebase demo users via REST API...\n");
  console.log(`   Firebase API Key: ${FIREBASE_API_KEY.substring(0, 12)}...`);
  console.log(`   Password for all: ${DEFAULT_PASSWORD}\n`);

  const results = [];

  for (const user of DEMO_USERS) {
    try {
      const result = await createOrSignIn(user);
      results.push(result);
      const icon = result.status.startsWith("CREATED") || result.status.startsWith("EXISTS (verified")
        ? "✅"
        : "⚠️";
      console.log(`   ${icon}  ${result.email.padEnd(30)} ${result.role.padEnd(15)} ${result.status}`);
    } catch (err) {
      results.push({ email: user.email, status: `ERROR: ${err.message}`, role: user.role });
      console.log(`   ❌  ${user.email.padEnd(30)} ${user.role.padEnd(15)} ERROR: ${err.message}`);
    }
  }

  console.log("\n📋 Summary:");
  console.table(results);

  const allOk = results.every(r => r.status.startsWith("CREATED") || r.status.includes("verified"));
  if (allOk) {
    console.log("\n✅ All demo users are ready! You can now login with:");
    console.log("   Email: any of the emails above");
    console.log(`   Password: ${DEFAULT_PASSWORD}`);
  } else {
    console.log("\n⚠️  Some users may have issues. Check the table above.");
  }
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exitCode = 1;
});
