/**
 * Seed script — populates the in-memory store with sample patients,
 * radiologists, referring physicians, orders, and billing records
 * via the backend REST API.
 *
 * Usage:  npx ts-node scripts/seed-sample-data.ts
 */

const BASE = process.env.API_BASE ?? "http://localhost:8080";

interface ApiResponse {
  id?: string;
  [key: string]: unknown;
}

async function post(path: string, body: Record<string, unknown>): Promise<ApiResponse> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<ApiResponse>;
}

async function seed() {
  console.log("🏥  Seeding sample data against", BASE, "\n");

  // ── 0. Users (radiologists, radiographers, admin) ──────────
  console.log("👤  Creating users…");
  const users = [
    { id: "rad-dr-sanjay", email: "sanjay.verma@tdai.in", role: "radiologist", displayName: "Dr. Sanjay Verma" },
    { id: "rad-dr-deepa", email: "deepa.iyer@tdai.in", role: "radiologist", displayName: "Dr. Deepa Iyer" },
    { id: "rad-dr-arjun", email: "arjun.nambiar@tdai.in", role: "radiologist", displayName: "Dr. Arjun Nambiar" },
    { id: "rad-dr-sneha", email: "sneha.rao@tdai.in", role: "radiologist", displayName: "Dr. Sneha Rao" },
    { id: "tech-rajesh", email: "rajesh.tiwari@tdai.in", role: "radiographer", displayName: "Rajesh Tiwari" },
    { id: "tech-lakshmi", email: "lakshmi.pillai@tdai.in", role: "radiographer", displayName: "Lakshmi Pillai" },
    { id: "admin-tdai", email: "admin@tdai.in", role: "admin", displayName: "TDAI Admin" },
  ];

  for (const u of users) {
    await post("/users", u);
    console.log(`   ✔ ${u.displayName} (${u.role})`);
  }

  // ── 1. Referring Physicians ────────────────────────────────
  console.log("👨‍⚕️  Creating referring physicians…");
  const physicians = [
    { name: "Dr. Anil Kumar", specialty: "Cardiology", phone: "+91-98765-43210", email: "anil.kumar@apollohospitals.com", hospital: "Apollo Hospitals, Chennai" },
    { name: "Dr. Priya Sharma", specialty: "Orthopedics", phone: "+91-91234-56789", email: "priya.sharma@fortis.com", hospital: "Fortis Hospital, Delhi" },
    { name: "Dr. Ramesh Gupta", specialty: "Neurology", phone: "+91-99876-54321", email: "ramesh.gupta@manipal.com", hospital: "Manipal Hospital, Bangalore" },
    { name: "Dr. Kavita Joshi", specialty: "Oncology", phone: "+91-90000-12345", email: "kavita.joshi@tmc.gov.in", hospital: "Tata Memorial Hospital, Mumbai" },
    { name: "Dr. Suresh Patel", specialty: "Pulmonology", phone: "+91-88888-22222", email: "suresh.patel@medanta.org", hospital: "Medanta, Gurgaon" },
  ];

  const createdPhysicians: ApiResponse[] = [];
  for (const p of physicians) {
    const result = await post("/referring-physicians", p);
    createdPhysicians.push(result);
    console.log(`   ✔ ${p.name} (${p.specialty})`);
  }

  // ── 2. Patients ────────────────────────────────────────────
  console.log("\n🧑‍🤝‍🧑  Creating patients…");
  const patients = [
    { patientId: "MRN-IND-10001", firstName: "Amit", lastName: "Singh", dateOfBirth: "1985-03-14", gender: "M" as const, phone: "+91-98765-11111", email: "amit.singh@email.com", address: "12 MG Road, Delhi 110001" },
    { patientId: "MRN-IND-10002", firstName: "Neha", lastName: "Patel", dateOfBirth: "1972-08-22", gender: "F" as const, phone: "+91-91234-22222", email: "neha.patel@email.com", address: "45 Residency Road, Ahmedabad 380001" },
    { patientId: "MRN-IND-10003", firstName: "Ravi", lastName: "Kumar", dateOfBirth: "1990-11-05", gender: "M" as const, phone: "+91-99876-33333", email: "ravi.kumar@email.com", address: "78 Brigade Road, Bangalore 560001" },
    { patientId: "MRN-IND-10004", firstName: "Pooja", lastName: "Sharma", dateOfBirth: "1968-01-30", gender: "F" as const, phone: "+91-90000-44444", email: "pooja.sharma@email.com", address: "23 Marine Drive, Mumbai 400001" },
    { patientId: "MRN-IND-10005", firstName: "Suresh", lastName: "Reddy", dateOfBirth: "1995-06-18", gender: "M" as const, phone: "+91-88888-55555", email: "suresh.reddy@email.com", address: "67 Anna Salai, Chennai 600002" },
    { patientId: "MRN-IND-10006", firstName: "Anjali", lastName: "Mehta", dateOfBirth: "2001-12-01", gender: "F" as const, phone: "+91-77777-66666", email: "anjali.mehta@email.com", address: "89 Park Street, Kolkata 700016" },
    { patientId: "MRN-IND-10007", firstName: "Vikram", lastName: "Desai", dateOfBirth: "1958-04-10", gender: "M" as const, phone: "+91-66666-77777", email: "vikram.desai@email.com", address: "34 Law Garden, Surat 395003" },
    { patientId: "MRN-IND-10008", firstName: "Meena", lastName: "Nair", dateOfBirth: "1983-09-27", gender: "F" as const, phone: "+91-55555-88888", email: "meena.nair@email.com", address: "56 MG Road, Pune 411001" },
  ];

  const createdPatients: ApiResponse[] = [];
  for (const p of patients) {
    const result = await post("/patients", p);
    createdPatients.push(result);
    console.log(`   ✔ ${p.firstName} ${p.lastName} (${p.patientId})`);
  }

  // ── 3. Radiology Orders ────────────────────────────────────
  console.log("\n📋  Creating radiology orders…");
  const today = new Date();
  const iso = (daysOffset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + daysOffset);
    return d.toISOString();
  };

  const orders = [
    { patientId: "MRN-IND-10001", patientName: "Amit Singh", referringPhysicianName: "Dr. Anil Kumar", modality: "CT" as const, bodyPart: "Chest", clinicalHistory: "Persistent cough for 3 weeks, rule out pneumonia", priority: "urgent" as const, status: "scheduled" as const, scheduledDate: iso(1), notes: "Patient allergic to iodine contrast" },
    { patientId: "MRN-IND-10002", patientName: "Neha Patel", referringPhysicianName: "Dr. Priya Sharma", modality: "MR" as const, bodyPart: "Lumbar Spine", clinicalHistory: "Lower back pain radiating to left leg, 6 months duration", priority: "routine" as const, status: "scheduled" as const, scheduledDate: iso(2) },
    { patientId: "MRN-IND-10003", patientName: "Ravi Kumar", referringPhysicianName: "Dr. Ramesh Gupta", modality: "MR" as const, bodyPart: "Brain", clinicalHistory: "Recurrent headaches with visual disturbances", priority: "urgent" as const, status: "in-progress" as const, scheduledDate: iso(0) },
    { patientId: "MRN-IND-10004", patientName: "Pooja Sharma", referringPhysicianName: "Dr. Kavita Joshi", modality: "CT" as const, bodyPart: "Abdomen / Pelvis", clinicalHistory: "Follow-up for known hepatic lesion", priority: "routine" as const, status: "scheduled" as const, scheduledDate: iso(3) },
    { patientId: "MRN-IND-10005", patientName: "Suresh Reddy", referringPhysicianName: "Dr. Priya Sharma", modality: "XR" as const, bodyPart: "Right Knee", clinicalHistory: "Sports injury — acute pain after cricket match", priority: "stat" as const, status: "completed" as const, scheduledDate: iso(-1) },
    { patientId: "MRN-IND-10006", patientName: "Anjali Mehta", referringPhysicianName: "Dr. Suresh Patel", modality: "CR" as const, bodyPart: "Chest", clinicalHistory: "Pre-operative clearance for elective surgery", priority: "routine" as const, status: "scheduled" as const, scheduledDate: iso(5) },
    { patientId: "MRN-IND-10007", patientName: "Vikram Desai", referringPhysicianName: "Dr. Anil Kumar", modality: "US" as const, bodyPart: "Abdomen", clinicalHistory: "RUQ pain, evaluate for gallstones", priority: "routine" as const, status: "scheduled" as const, scheduledDate: iso(2) },
    { patientId: "MRN-IND-10008", patientName: "Meena Nair", referringPhysicianName: "Dr. Kavita Joshi", modality: "MG" as const, bodyPart: "Bilateral Breasts", clinicalHistory: "Annual screening mammography", priority: "routine" as const, status: "scheduled" as const, scheduledDate: iso(4) },
    { patientId: "MRN-IND-10001", patientName: "Amit Singh", referringPhysicianName: "Dr. Ramesh Gupta", modality: "MR" as const, bodyPart: "Brain", clinicalHistory: "Dizziness and occasional syncope", priority: "urgent" as const, status: "scheduled" as const, scheduledDate: iso(1) },
    { patientId: "MRN-IND-10004", patientName: "Pooja Sharma", referringPhysicianName: "Dr. Suresh Patel", modality: "CT" as const, bodyPart: "Chest", clinicalHistory: "Shortness of breath, rule out pulmonary embolism", priority: "stat" as const, status: "in-progress" as const, scheduledDate: iso(0) },
  ];

  for (const o of orders) {
    await post("/orders", o);
    console.log(`   ✔ ${o.modality} ${o.bodyPart} — ${o.patientName} [${o.priority}]`);
  }

  // ── 4. Billing Records ─────────────────────────────────────
  console.log("\n💰  Creating billing records…");
  const billingRecords = [
    { patientId: "MRN-IND-10001", patientName: "Amit Singh", description: "CT Chest w/ contrast", modality: "CT" as const, bodyPart: "Chest", amount: 9500.00, status: "pending" as const },
    { patientId: "MRN-IND-10002", patientName: "Neha Patel", description: "MRI Lumbar Spine w/o contrast", modality: "MR" as const, bodyPart: "Lumbar Spine", amount: 13500.00, status: "pending" as const },
    { patientId: "MRN-IND-10005", patientName: "Suresh Reddy", description: "X-Ray Right Knee (3 views)", modality: "XR" as const, bodyPart: "Right Knee", amount: 1200.00, status: "invoiced" as const, invoiceNumber: "INV-2026-0042" },
    { patientId: "MRN-IND-10003", patientName: "Ravi Kumar", description: "MRI Brain w/ & w/o contrast", modality: "MR" as const, bodyPart: "Brain", amount: 15500.00, status: "pending" as const },
    { patientId: "MRN-IND-10008", patientName: "Meena Nair", description: "Screening Mammography Bilateral", modality: "MG" as const, bodyPart: "Bilateral Breasts", amount: 2200.00, status: "pending" as const },
  ];

  for (const b of billingRecords) {
    await post("/billing", b);
    console.log(`   ✔ ${b.description} — $${b.amount.toFixed(2)} [${b.status}]`);
  }

  // ── Done ───────────────────────────────────────────────────
  console.log("\n✅  Seed complete!  Summary:");
  console.log(`     ${users.length} users (radiologists, radiographers, admin)`);
  console.log(`     ${physicians.length} referring physicians`);
  console.log(`     ${patients.length} patients`);
  console.log(`     ${orders.length} radiology orders`);
  console.log(`     ${billingRecords.length} billing records`);
  console.log("");
}

seed().catch((err) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
