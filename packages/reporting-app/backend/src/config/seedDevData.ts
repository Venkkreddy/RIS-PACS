import { InMemoryStoreService } from "../services/inMemoryStore";
import { logger } from "../services/logger";

/**
 * Seeds sample data directly into the in-memory store on startup.
 * Only runs in development when using InMemoryStoreService.
 */
export async function seedDevData(store: InMemoryStoreService): Promise<void> {
  // Skip if already seeded (check for existing users)
  const existingUsers = await store.listUsers();
  if (existingUsers.length > 0) return;

  logger.info({ message: "Seeding sample data for local development…" });

  // ── Users ──
  const users = [
    { id: "rad-dr-sanjay", email: "sanjay.verma@tdai.in", role: "radiologist" as const, displayName: "Dr. Sanjay Verma", approved: true, requestStatus: "approved" as const },
    { id: "rad-dr-deepa", email: "deepa.iyer@tdai.in", role: "radiologist" as const, displayName: "Dr. Deepa Iyer", approved: true, requestStatus: "approved" as const },
    { id: "rad-dr-arjun", email: "arjun.nambiar@tdai.in", role: "radiologist" as const, displayName: "Dr. Arjun Nambiar", approved: true, requestStatus: "approved" as const },
    { id: "rad-dr-sneha", email: "sneha.rao@tdai.in", role: "radiologist" as const, displayName: "Dr. Sneha Rao", approved: true, requestStatus: "approved" as const },
    { id: "tech-rajesh", email: "rajesh.tiwari@tdai.in", role: "radiographer" as const, displayName: "Rajesh Tiwari", approved: true, requestStatus: "approved" as const },
    { id: "tech-lakshmi", email: "lakshmi.pillai@tdai.in", role: "radiographer" as const, displayName: "Lakshmi Pillai", approved: true, requestStatus: "approved" as const },
    { id: "admin-tdai", email: "admin@tdai.in", role: "admin" as const, displayName: "TDAI Admin", approved: true, requestStatus: "approved" as const },
    { id: "demo-super-admin", email: "super_admin@example.com", role: "super_admin" as const, displayName: "Dev Super Admin", approved: true, requestStatus: "approved" as const },
    { id: "demo-admin", email: "admin@example.com", role: "admin" as const, displayName: "Dev Admin", approved: true, requestStatus: "approved" as const },
    { id: "demo-developer", email: "developer@example.com", role: "developer" as const, displayName: "Dev Developer", approved: true, requestStatus: "approved" as const },
    { id: "demo-radiologist", email: "radiologist@example.com", role: "radiologist" as const, displayName: "Dev Radiologist", approved: true, requestStatus: "approved" as const },
    { id: "demo-radiographer", email: "radiographer@example.com", role: "radiographer" as const, displayName: "Dev Radiographer", approved: true, requestStatus: "approved" as const },
    { id: "demo-referring", email: "referring@example.com", role: "referring" as const, displayName: "Dev Referring", approved: true, requestStatus: "approved" as const },
    { id: "demo-billing", email: "billing@example.com", role: "billing" as const, displayName: "Dev Billing", approved: true, requestStatus: "approved" as const },
    { id: "demo-receptionist", email: "receptionist@example.com", role: "receptionist" as const, displayName: "Dev Receptionist", approved: true, requestStatus: "approved" as const },
    { id: "demo-viewer", email: "viewer@example.com", role: "viewer" as const, displayName: "Dev Viewer", approved: true, requestStatus: "approved" as const },
  ];
  for (const u of users) {
    await store.upsertUser(u);
  }

  // ── Referring Physicians ──
  const physicians = [
    { name: "Dr. Anil Kumar", specialty: "Cardiology", phone: "+91-98765-43210", email: "anil.kumar@apollohospitals.com", hospital: "Apollo Hospitals, Chennai" },
    { name: "Dr. Priya Sharma", specialty: "Orthopedics", phone: "+91-91234-56789", email: "priya.sharma@fortis.com", hospital: "Fortis Hospital, Delhi" },
    { name: "Dr. Ramesh Gupta", specialty: "Neurology", phone: "+91-99876-54321", email: "ramesh.gupta@manipal.com", hospital: "Manipal Hospital, Bangalore" },
    { name: "Dr. Kavita Joshi", specialty: "Oncology", phone: "+91-90000-12345", email: "kavita.joshi@tmc.gov.in", hospital: "Tata Memorial Hospital, Mumbai" },
    { name: "Dr. Suresh Patel", specialty: "Pulmonology", phone: "+91-88888-22222", email: "suresh.patel@medanta.org", hospital: "Medanta, Gurgaon" },
  ];
  for (const p of physicians) {
    await store.createReferringPhysician(p);
  }

  // ── Patients ──
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
  for (const p of patients) {
    await store.createPatient(p);
  }

  // ── Radiology Orders ──
  const today = new Date();
  const iso = (daysOffset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + daysOffset);
    return d.toISOString();
  };

  const orders = [
    { patientId: "MRN-IND-10001", patientName: "Amit Singh", referringPhysicianName: "Dr. Anil Kumar", modality: "CT" as const, bodyPart: "Chest", clinicalHistory: "Persistent cough for 3 weeks, rule out pneumonia", priority: "urgent" as const, status: "scheduled" as const, scheduledDate: iso(1), notes: "Patient allergic to iodine contrast", createdBy: "tech-rajesh" },
    { patientId: "MRN-IND-10002", patientName: "Neha Patel", referringPhysicianName: "Dr. Priya Sharma", modality: "MR" as const, bodyPart: "Lumbar Spine", clinicalHistory: "Lower back pain radiating to left leg, 6 months duration", priority: "routine" as const, status: "scheduled" as const, scheduledDate: iso(2), createdBy: "tech-rajesh" },
    { patientId: "MRN-IND-10003", patientName: "Ravi Kumar", referringPhysicianName: "Dr. Ramesh Gupta", modality: "MR" as const, bodyPart: "Brain", clinicalHistory: "Recurrent headaches with visual disturbances", priority: "urgent" as const, status: "in-progress" as const, scheduledDate: iso(0), createdBy: "tech-lakshmi" },
    { patientId: "MRN-IND-10004", patientName: "Pooja Sharma", referringPhysicianName: "Dr. Kavita Joshi", modality: "CT" as const, bodyPart: "Abdomen / Pelvis", clinicalHistory: "Follow-up for known hepatic lesion", priority: "routine" as const, status: "scheduled" as const, scheduledDate: iso(3), createdBy: "tech-lakshmi" },
    { patientId: "MRN-IND-10005", patientName: "Suresh Reddy", referringPhysicianName: "Dr. Priya Sharma", modality: "XR" as const, bodyPart: "Right Knee", clinicalHistory: "Sports injury — acute pain after cricket match", priority: "stat" as const, status: "completed" as const, scheduledDate: iso(-1), createdBy: "tech-rajesh" },
    { patientId: "MRN-IND-10006", patientName: "Anjali Mehta", referringPhysicianName: "Dr. Suresh Patel", modality: "CR" as const, bodyPart: "Chest", clinicalHistory: "Pre-operative clearance for elective surgery", priority: "routine" as const, status: "scheduled" as const, scheduledDate: iso(5), createdBy: "tech-rajesh" },
    { patientId: "MRN-IND-10007", patientName: "Vikram Desai", referringPhysicianName: "Dr. Anil Kumar", modality: "US" as const, bodyPart: "Abdomen", clinicalHistory: "RUQ pain, evaluate for gallstones", priority: "routine" as const, status: "scheduled" as const, scheduledDate: iso(2), createdBy: "tech-lakshmi" },
    { patientId: "MRN-IND-10008", patientName: "Meena Nair", referringPhysicianName: "Dr. Kavita Joshi", modality: "MG" as const, bodyPart: "Bilateral Breasts", clinicalHistory: "Annual screening mammography", priority: "routine" as const, status: "scheduled" as const, scheduledDate: iso(4), createdBy: "tech-lakshmi" },
    { patientId: "MRN-IND-10001", patientName: "Amit Singh", referringPhysicianName: "Dr. Ramesh Gupta", modality: "MR" as const, bodyPart: "Brain", clinicalHistory: "Dizziness and occasional syncope", priority: "urgent" as const, status: "scheduled" as const, scheduledDate: iso(1), createdBy: "tech-rajesh" },
    { patientId: "MRN-IND-10004", patientName: "Pooja Sharma", referringPhysicianName: "Dr. Suresh Patel", modality: "CT" as const, bodyPart: "Chest", clinicalHistory: "Shortness of breath, rule out pulmonary embolism", priority: "stat" as const, status: "in-progress" as const, scheduledDate: iso(0), createdBy: "tech-lakshmi" },
  ];
  for (const o of orders) {
    await store.createOrder(o);
  }

  // ── Billing Records ──
  const billingRecords = [
    { patientId: "MRN-IND-10001", patientName: "Amit Singh", description: "CT Chest w/ contrast", modality: "CT" as const, bodyPart: "Chest", amount: 9500.00, status: "pending" as const, createdBy: "tech-rajesh" },
    { patientId: "MRN-IND-10002", patientName: "Neha Patel", description: "MRI Lumbar Spine w/o contrast", modality: "MR" as const, bodyPart: "Lumbar Spine", amount: 13500.00, status: "pending" as const, createdBy: "tech-rajesh" },
    { patientId: "MRN-IND-10005", patientName: "Suresh Reddy", description: "X-Ray Right Knee (3 views)", modality: "XR" as const, bodyPart: "Right Knee", amount: 1200.00, status: "invoiced" as const, invoiceNumber: "INV-2026-0042", createdBy: "tech-lakshmi" },
    { patientId: "MRN-IND-10003", patientName: "Ravi Kumar", description: "MRI Brain w/ & w/o contrast", modality: "MR" as const, bodyPart: "Brain", amount: 15500.00, status: "pending" as const, createdBy: "tech-lakshmi" },
    { patientId: "MRN-IND-10008", patientName: "Meena Nair", description: "Screening Mammography Bilateral", modality: "MG" as const, bodyPart: "Bilateral Breasts", amount: 2200.00, status: "pending" as const, createdBy: "tech-lakshmi" },
  ];
  for (const b of billingRecords) {
    await store.createBilling(b);
  }

  // ── Study Records (worklist) ──
  // Real DICOM StudyInstanceUIDs indexed in Dicoogle
  const studies = [
    { studyId: "1.3.6.1.4.1.44316.6.102.1.2023091384336494.746252101381252750643", patientName: "Vikram Desai", studyDate: "2026-03-10", modality: "PX", description: "Panoramic X-Ray — Jaw", bodyPart: "Jaw", location: "Apollo Diagnostics, Chennai", status: "assigned" as const, assignedTo: "rad-dr-sanjay", assignedAt: new Date().toISOString(), uploaderId: "tech-rajesh" },
    { studyId: "1.2.826.0.1.3680043.8.1055.1.20111103111148288.98361414.79379639", patientName: "Meena Nair", studyDate: "2026-03-09", modality: "MR", description: "MRI Knee (R)", bodyPart: "Knee", location: "Apollo Diagnostics, Chennai", status: "unassigned" as const, uploaderId: "tech-rajesh" },
    { studyId: "1.2.826.0.1.3680043.8.498.25078228286114488662691612626295400838", patientName: "Amit Singh", studyDate: "2026-03-14", modality: "CT", description: "CT Chest w/ contrast", bodyPart: "Chest", location: "Apollo Hospitals, Delhi", status: "unassigned" as const, uploaderId: "tech-rajesh" },
    { studyId: "1.2.826.0.1.3680043.8.498.33671051009637181933407679879111779118", patientName: "Neha Patel", studyDate: "2026-03-13", modality: "MR", description: "MRI Lumbar Spine w/o contrast", bodyPart: "Lumbar Spine", location: "Fortis Hospital, Ahmedabad", status: "assigned" as const, assignedTo: "rad-dr-deepa", assignedAt: new Date().toISOString(), uploaderId: "tech-rajesh" },
    { studyId: "1.2.826.0.1.3680043.8.498.7650919683101803526004408509422926761", patientName: "Ravi Kumar", studyDate: "2026-03-15", modality: "MR", description: "MRI Brain w/ & w/o contrast", bodyPart: "Brain", location: "Manipal Hospital, Bangalore", status: "assigned" as const, assignedTo: "rad-dr-arjun", assignedAt: new Date().toISOString(), uploaderId: "tech-lakshmi" },
    { studyId: "1.2.826.0.1.3680043.8.498.12452783231387736129149000279779292065", patientName: "Pooja Sharma", studyDate: "2026-03-12", modality: "CT", description: "CT Abdomen / Pelvis", bodyPart: "Abdomen / Pelvis", location: "Tata Memorial Hospital, Mumbai", status: "unassigned" as const, uploaderId: "tech-lakshmi" },
    { studyId: "1.2.826.0.1.3680043.8.498.38295520635455189473067266483083688997", patientName: "Suresh Reddy", studyDate: "2026-03-14", modality: "CR", description: "X-Ray Right Knee (3 views)", bodyPart: "Right Knee", location: "Apollo Diagnostics, Chennai", status: "assigned" as const, assignedTo: "rad-dr-sneha", assignedAt: new Date().toISOString(), uploaderId: "tech-rajesh" },
    { studyId: "1.2.826.0.1.3680043.8.498.30846453286534628577940689408376587200", patientName: "Anjali Mehta", studyDate: "2026-03-11", modality: "CR", description: "Chest X-Ray PA & Lateral", bodyPart: "Chest", location: "Medanta, Kolkata", status: "assigned" as const, assignedTo: "rad-dr-sanjay", assignedAt: new Date().toISOString(), uploaderId: "tech-rajesh" },
  ];
  const patientMrnByName = new Map<string, string>();
  for (const p of patients) {
    patientMrnByName.set(`${p.firstName} ${p.lastName}`, p.patientId.toUpperCase());
  }

  for (const s of studies) {
    const mrn = patientMrnByName.get(s.patientName);
    await store.upsertStudyRecord(s.studyId, {
      patientName: s.patientName,
      studyDate: s.studyDate,
      modality: s.modality,
      description: s.description,
      bodyPart: s.bodyPart,
      location: s.location,
      status: s.status,
      assignedTo: s.assignedTo,
      assignedAt: s.assignedAt,
      uploaderId: s.uploaderId,
      metadata: mrn ? { patientId: mrn } : undefined,
    });
  }

  logger.info({
    message: `Seed complete: ${users.length} users, ${physicians.length} physicians, ${patients.length} patients, ${orders.length} orders, ${billingRecords.length} billing records, ${studies.length} studies`,
  });
}
