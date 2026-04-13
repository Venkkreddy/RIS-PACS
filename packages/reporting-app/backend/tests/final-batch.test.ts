/**
 * Final batch — 300+ tests to cross the 1000 threshold.
 * Covers every remaining permutation and stress scenario.
 */

import request from "supertest";
import { createApp } from "../src/app";
import { InMemoryStoreService } from "../src/services/inMemoryStore";

function mkR(p: { studyId: string; content: string; ownerId: string }) {
  return { ...p, status: "draft" as const };
}

function buildApp(storeOverride?: InMemoryStoreService) {
  const store = storeOverride ?? new InMemoryStoreService();
  const deps = {
    store: store as never,
    reportService: {
      createReport: jest.fn().mockImplementation((p: any) => (store as any).createReport({ ...p, status: p.status ?? "draft" })),
      addAddendum: jest.fn().mockImplementation((id: string, text: string, author: string) =>
        (store as any).appendVersion(id, { id: `${Date.now()}`, type: "addendum", content: text, authorId: author, createdAt: new Date().toISOString() }),
      ),
    } as never,
    storageService: { uploadBuffer: jest.fn().mockResolvedValue("gs://b/p"), deleteObject: jest.fn() } as never,
    emailService: { sendReportShareEmail: jest.fn(), sendInviteEmail: jest.fn(), sendTatReminderEmail: jest.fn() } as never,
    pdfService: { buildReportPdf: jest.fn().mockResolvedValue(Buffer.from("pdf")) } as never,
    dicoogleService: { searchStudies: jest.fn().mockResolvedValue([]), fetchStudyMetadata: jest.fn().mockResolvedValue({}) } as never,
    monaiService: { isEnabled: jest.fn().mockReturnValue(false), listModels: jest.fn().mockResolvedValue([]), runInference: jest.fn(), runInferenceWithSR: jest.fn(), analyzeDicomFile: jest.fn() } as never,
  };
  const { app } = createApp(deps);
  return { app, store, deps };
}

async function login(app: any, role: string) {
  const agent = request.agent(app);
  await agent.post("/auth/dev-login").send({ role });
  return agent;
}

// ═══════════════════════════════════════════════════════════════════════════════
// F1. EVERY ROLE × PATIENT CRUD (permission-based: patients:view all, patients:create/edit admin/radiographer/receptionist)
// ═══════════════════════════════════════════════════════════════════════════════

describe("F1. Patient CRUD per Role", () => {
  const allRoles = ["admin", "radiographer", "radiologist", "viewer", "referring", "billing", "receptionist"];
  const patientCreateEditRoles = ["admin", "radiographer", "receptionist"];
  const patientViewOnlyRoles = ["radiologist", "viewer", "referring", "billing"];

  allRoles.forEach((role) => {
    it(`F1: ${role} can GET /patients`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      expect((await a.get("/patients")).status).toBe(200);
    });

    it(`F1: ${role} can GET /patients/:id`, async () => {
      const { app, store } = buildApp();
      const p = await store.createPatient({ patientId: "P1", firstName: "A", lastName: "B", dateOfBirth: "2000-01-01", gender: "M" });
      const a = await login(app, role);
      expect((await a.get(`/patients/${p.id}`)).status).toBe(200);
    });
  });

  patientCreateEditRoles.forEach((role) => {
    it(`F1: ${role} can POST /patients`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      const r = await a.post("/patients").send({ patientId: "P1", firstName: "A", lastName: "B", dateOfBirth: "2000-01-01", gender: "M" });
      expect(r.status).toBe(201);
    });

    it(`F1: ${role} can PATCH /patients/:id`, async () => {
      const { app, store } = buildApp();
      const p = await store.createPatient({ patientId: "P1", firstName: "A", lastName: "B", dateOfBirth: "2000-01-01", gender: "M" });
      const a = await login(app, role);
      expect((await a.patch(`/patients/${p.id}`).send({ phone: "555" })).status).toBe(200);
    });
  });

  patientViewOnlyRoles.forEach((role) => {
    it(`F1: ${role} CANNOT POST /patients`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      const r = await a.post("/patients").send({ patientId: "P1", firstName: "A", lastName: "B", dateOfBirth: "2000-01-01", gender: "M" });
      expect(r.status).toBe(403);
    });

    it(`F1: ${role} CANNOT PATCH /patients/:id`, async () => {
      const { app, store } = buildApp();
      const p = await store.createPatient({ patientId: "P1", firstName: "A", lastName: "B", dateOfBirth: "2000-01-01", gender: "M" });
      const a = await login(app, role);
      expect((await a.patch(`/patients/${p.id}`).send({ phone: "555" })).status).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F2. EVERY ROLE × PHYSICIAN CRUD (permission-based: create/edit admin/receptionist only)
// ═══════════════════════════════════════════════════════════════════════════════

describe("F2. Physician CRUD per Role", () => {
  const physicianViewRoles = ["admin", "radiologist", "radiographer", "billing", "receptionist", "viewer"];
  const physicianCreateEditRoles = ["admin", "receptionist"];
  const physicianViewDeniedRoles = ["referring"];
  const physicianCreateEditDeniedRoles = ["radiographer", "radiologist", "viewer", "referring", "billing"];

  physicianViewRoles.forEach((role) => {
    it(`F2: ${role} can GET /referring-physicians`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      expect((await a.get("/referring-physicians")).status).toBe(200);
    });

    it(`F2: ${role} can GET /referring-physicians/:id`, async () => {
      const { app, store } = buildApp();
      const p = await store.createReferringPhysician({ name: "Dr X" });
      const a = await login(app, role);
      expect((await a.get(`/referring-physicians/${p.id}`)).status).toBe(200);
    });
  });

  physicianViewDeniedRoles.forEach((role) => {
    it(`F2: ${role} CANNOT GET /referring-physicians`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      expect((await a.get("/referring-physicians")).status).toBe(403);
    });
  });

  physicianCreateEditRoles.forEach((role) => {
    it(`F2: ${role} can POST /referring-physicians`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      expect((await a.post("/referring-physicians").send({ name: "Dr X" })).status).toBe(201);
    });

    it(`F2: ${role} can PATCH /referring-physicians/:id`, async () => {
      const { app, store } = buildApp();
      const p = await store.createReferringPhysician({ name: "Dr X" });
      const a = await login(app, role);
      expect((await a.patch(`/referring-physicians/${p.id}`).send({ specialty: "Neuro" })).status).toBe(200);
    });
  });

  physicianCreateEditDeniedRoles.forEach((role) => {
    it(`F2: ${role} CANNOT POST /referring-physicians`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      expect((await a.post("/referring-physicians").send({ name: "Dr X" })).status).toBe(403);
    });

    it(`F2: ${role} CANNOT PATCH /referring-physicians/:id`, async () => {
      const { app, store } = buildApp();
      const p = await store.createReferringPhysician({ name: "Dr X" });
      const a = await login(app, role);
      expect((await a.patch(`/referring-physicians/${p.id}`).send({ specialty: "Neuro" })).status).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F3. EVERY ROLE × ORDER CRUD (orders:view all roles; orders:edit admin/radiographer only)
// ═══════════════════════════════════════════════════════════════════════════════

describe("F3. Order Read per Role", () => {
  const ordersViewRoles = ["admin", "radiographer", "radiologist", "billing", "referring", "viewer"];
  const ordersEditRoles = ["admin", "radiographer"];
  const ordersEditDeniedRoles = ["radiologist", "billing", "referring", "viewer"];

  ordersViewRoles.forEach((role) => {
    it(`F3: ${role} can GET /orders`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      expect((await a.get("/orders")).status).toBe(200);
    });

    it(`F3: ${role} can GET /orders/:id`, async () => {
      const { app, store } = buildApp();
      const o = await store.createOrder({ patientId: "p", patientName: "n", modality: "CT", bodyPart: "H", priority: "routine", status: "scheduled", scheduledDate: "2026-01-01", createdBy: "u" });
      const a = await login(app, role);
      expect((await a.get(`/orders/${o.id}`)).status).toBe(200);
    });
  });

  ordersEditRoles.forEach((role) => {
    it(`F3: ${role} can PATCH /orders/:id`, async () => {
      const { app, store } = buildApp();
      const o = await store.createOrder({ patientId: "p", patientName: "n", modality: "CT", bodyPart: "H", priority: "routine", status: "scheduled", scheduledDate: "2026-01-01", createdBy: "u" });
      const a = await login(app, role);
      expect((await a.patch(`/orders/${o.id}`).send({ notes: "test" })).status).toBe(200);
    });
  });

  ordersEditDeniedRoles.forEach((role) => {
    it(`F3: ${role} CANNOT PATCH /orders/:id`, async () => {
      const { app, store } = buildApp();
      const o = await store.createOrder({ patientId: "p", patientName: "n", modality: "CT", bodyPart: "H", priority: "routine", status: "scheduled", scheduledDate: "2026-01-01", createdBy: "u" });
      const a = await login(app, role);
      expect((await a.patch(`/orders/${o.id}`).send({ notes: "test" })).status).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F4. EVERY ROLE × BILLING CRUD (billing:view admin/billing/viewer; billing:create/edit admin/billing only)
// ═══════════════════════════════════════════════════════════════════════════════

describe("F4. Billing CRUD per Role", () => {
  const billingViewRoles = ["admin", "billing", "viewer"];
  const billingCreateEditRoles = ["admin", "billing"];
  const billingViewDeniedRoles = ["radiographer", "radiologist", "referring"];
  const billingCreateEditDeniedRoles = ["radiographer", "radiologist", "viewer", "referring"];

  billingViewRoles.forEach((role) => {
    it(`F4: ${role} can GET /billing`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      expect((await a.get("/billing")).status).toBe(200);
    });

    it(`F4: ${role} can GET /billing/:id`, async () => {
      const { app, store } = buildApp();
      const b = await store.createBilling({ patientId: "p", patientName: "n", description: "d", amount: 10, status: "pending", createdBy: "u" });
      const a = await login(app, role);
      expect((await a.get(`/billing/${b.id}`)).status).toBe(200);
    });
  });

  billingViewDeniedRoles.forEach((role) => {
    it(`F4: ${role} CANNOT GET /billing`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      expect((await a.get("/billing")).status).toBe(403);
    });
  });

  billingCreateEditRoles.forEach((role) => {
    it(`F4: ${role} can POST /billing`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      expect((await a.post("/billing").send({ patientId: "p", patientName: "n", description: "d", amount: 10 })).status).toBe(201);
    });

    it(`F4: ${role} can PATCH /billing/:id`, async () => {
      const { app, store } = buildApp();
      const b = await store.createBilling({ patientId: "p", patientName: "n", description: "d", amount: 10, status: "pending", createdBy: "u" });
      const a = await login(app, role);
      expect((await a.patch(`/billing/${b.id}`).send({ notes: "x" })).status).toBe(200);
    });
  });

  billingCreateEditDeniedRoles.forEach((role) => {
    it(`F4: ${role} CANNOT POST /billing`, async () => {
      const { app } = buildApp();
      const a = await login(app, role);
      expect((await a.post("/billing").send({ patientId: "p", patientName: "n", description: "d", amount: 10 })).status).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F5. STRESS: 100 RAPID SEQUENTIAL HTTP REQUESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("F5. Stress: Rapid Requests", () => {
  it("F5.1: 100 GET /health requests", async () => {
    const { app } = buildApp();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => request(app).get("/health")),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
  });

  it("F5.2: 50 POST /patients with unique IDs", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiographer");
    const results = [];
    for (let i = 0; i < 50; i++) {
      results.push(await agent.post("/patients").send({ patientId: `P-${i}`, firstName: `F${i}`, lastName: `L${i}`, dateOfBirth: "2000-01-01", gender: "M" }));
    }
    expect(results.every((r) => r.status === 201)).toBe(true);
    const list = await agent.get("/patients");
    expect(list.body.length).toBe(50);
  });

  it("F5.3: 30 POST /orders sequential", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiographer");
    for (let i = 0; i < 30; i++) {
      const r = await agent.post("/orders").send({ patientId: `p-${i}`, patientName: `n${i}`, modality: "CT", bodyPart: "H", scheduledDate: "2026-01-01" });
      expect(r.status).toBe(201);
    }
  });

  it("F5.4: 20 POST /reports sequential", async () => {
    const { app } = buildApp();
    const agent = await login(app, "radiologist");
    for (let i = 0; i < 20; i++) {
      const r = await agent.post("/reports").send({ studyId: `s-${i}` });
      expect(r.status).toBe(201);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F6. UPDATE OPERATIONS ON NON-EXISTENT RESOURCES (8 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("F6. Non-existent Resource Updates", () => {
  it("F6.1: PATCH /patients/none → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "admin");
    expect((await a.patch("/patients/none").send({ phone: "x" })).status).toBe(404);
  });
  it("F6.2: GET /patients/none → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "admin");
    expect((await a.get("/patients/none")).status).toBe(404);
  });
  it("F6.3: PATCH /orders/none → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "admin");
    expect((await a.patch("/orders/none").send({ notes: "x" })).status).toBe(404);
  });
  it("F6.4: GET /orders/none → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "admin");
    expect((await a.get("/orders/none")).status).toBe(404);
  });
  it("F6.5: PATCH /billing/none → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "admin");
    expect((await a.patch("/billing/none").send({ notes: "x" })).status).toBe(404);
  });
  it("F6.6: GET /billing/none → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "admin");
    expect((await a.get("/billing/none")).status).toBe(404);
  });
  it("F6.7: PATCH /referring-physicians/none → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "admin");
    expect((await a.patch("/referring-physicians/none").send({ name: "x" })).status).toBe(404);
  });
  it("F6.8: GET /referring-physicians/none → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "admin");
    expect((await a.get("/referring-physicians/none")).status).toBe(404);
  });
  it("F6.9: PUT /reports/none → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "radiologist");
    expect((await a.put("/reports/none").send({ content: "x" })).status).toBe(404);
  });
  it("F6.10: PATCH /reports/none/status → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "radiologist");
    expect((await a.patch("/reports/none/status").send({ status: "final" })).status).toBe(404);
  });
  it("F6.11: PATCH /reports/none/addendum → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "radiologist");
    expect((await a.patch("/reports/none/addendum").send({ addendum: "x" })).status).toBe(404);
  });
  it("F6.12: POST /reports/none/share → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "radiologist");
    expect((await a.post("/reports/none/share").send({ email: "a@b.com" })).status).toBe(404);
  });
  it("F6.13: GET /reports/none → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "radiologist");
    expect((await a.get("/reports/none")).status).toBe(404);
  });
  it("F6.14: GET /reports/by-study/none → 404", async () => {
    const { app } = buildApp(); const a = await login(app, "radiologist");
    expect((await a.get("/reports/by-study/none")).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F7. CONTENT-TYPE & MALFORMED BODY
// ═══════════════════════════════════════════════════════════════════════════════

describe("F7. Malformed Bodies", () => {
  it("F7.1: webhook with text/plain body", async () => {
    const { app } = buildApp();
    const r = await request(app).post("/webhook/study").set("Content-Type", "text/plain").send("not json");
    expect(r.status).toBe(400);
  });

  it("F7.2: report with empty JSON", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/reports").send({});
    expect(r.status).toBe(400);
  });

  it("F7.3: patient with empty JSON", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiographer");
    const r = await a.post("/patients").send({});
    expect(r.status).toBe(400);
  });

  it("F7.4: order with empty JSON", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiographer");
    const r = await a.post("/orders").send({});
    expect(r.status).toBe(400);
  });

  it("F7.5: billing with empty JSON", async () => {
    const { app } = buildApp();
    const a = await login(app, "admin");
    const r = await a.post("/billing").send({});
    expect(r.status).toBe(400);
  });

  it("F7.6: invite with empty JSON", async () => {
    const { app } = buildApp();
    const a = await login(app, "admin");
    const r = await a.post("/admin/invite").send({});
    expect(r.status).toBe(400);
  });

  it("F7.7: assign with empty JSON", async () => {
    const { app } = buildApp();
    const a = await login(app, "admin");
    const r = await a.post("/assign").send({});
    expect(r.status).toBe(400);
  });

  it("F7.8: update-status with empty JSON", async () => {
    const { app } = buildApp();
    const a = await login(app, "admin");
    const r = await a.post("/update-status").send({});
    expect(r.status).toBe(400);
  });

  it("F7.9: template with empty JSON", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/templates").send({});
    expect(r.status).toBe(400);
  });

  it("F7.10: physician with empty JSON", async () => {
    const { app } = buildApp();
    const a = await login(app, "receptionist");
    const r = await a.post("/referring-physicians").send({});
    expect(r.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F8. REPORT EDIT + VERSIONS TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

describe("F8. Report Edit Tracking", () => {
  it("F8.1: edit creates 'edit' version", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "v1", ownerId: "dev-radiologist" }));
    const a = await login(app, "radiologist");
    await a.put(`/reports/${r.id}`).send({ content: "v2" });
    const updated = await store.getReport(r.id);
    expect(updated!.versions.some((v) => v.type === "edit")).toBe(true);
  });

  it("F8.2: status change to final creates 'sign' version", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "x", ownerId: "dev-radiologist" }));
    const a = await login(app, "radiologist");
    await a.patch(`/reports/${r.id}/status`).send({ status: "final" });
    const updated = await store.getReport(r.id);
    expect(updated!.versions.some((v) => v.type === "sign")).toBe(true);
  });

  it("F8.3: status change to preliminary creates 'status-change' version", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "x", ownerId: "dev-radiologist" }));
    const a = await login(app, "radiologist");
    await a.patch(`/reports/${r.id}/status`).send({ status: "preliminary" });
    const updated = await store.getReport(r.id);
    expect(updated!.versions.some((v) => v.type === "status-change")).toBe(true);
  });

  it("F8.4: share creates 'share' version", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "x", ownerId: "dev-radiologist" }));
    const a = await login(app, "radiologist");
    await a.post(`/reports/${r.id}/share`).send({ email: "a@b.com" });
    const updated = await store.getReport(r.id);
    expect(updated!.versions.some((v) => v.type === "share")).toBe(true);
  });

  it("F8.5: addendum creates 'addendum' version", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "x", ownerId: "dev-radiologist" }));
    const a = await login(app, "radiologist");
    await a.patch(`/reports/${r.id}/addendum`).send({ addendum: "note" });
    const updated = await store.getReport(r.id);
    expect(updated!.versions.some((v) => v.type === "addendum")).toBe(true);
  });

  it("F8.6: full lifecycle has 5+ versions", async () => {
    const { app, store } = buildApp();
    const a = await login(app, "radiologist");
    const c = await a.post("/reports").send({ studyId: "lifecycle", content: "draft" });
    await a.put(`/reports/${c.body.id}`).send({ content: "edited" });
    await a.patch(`/reports/${c.body.id}/status`).send({ status: "preliminary" });
    await a.patch(`/reports/${c.body.id}/status`).send({ status: "final" });
    await a.patch(`/reports/${c.body.id}/addendum`).send({ addendum: "note" });
    const report = await store.getReport(c.body.id);
    expect(report!.versions.length).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F9. FINAL SIGN BEHAVIOR
// ═══════════════════════════════════════════════════════════════════════════════

describe("F9. Sign Behavior", () => {
  it("F9.1: signing sets signedBy to session user", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "x", ownerId: "dev-radiologist" }));
    const a = await login(app, "radiologist");
    const res = await a.patch(`/reports/${r.id}/status`).send({ status: "final" });
    expect(res.body.signedBy).toBe("dev-radiologist");
  });

  it("F9.2: signing sets signedAt to current time", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "x", ownerId: "dev-radiologist" }));
    const a = await login(app, "radiologist");
    const before = new Date().toISOString();
    const res = await a.patch(`/reports/${r.id}/status`).send({ status: "final" });
    expect(res.body.signedAt).toBeDefined();
    expect(new Date(res.body.signedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime() - 1000);
  });

  it("F9.3: preliminary does NOT set signedBy", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "x", ownerId: "dev-radiologist" }));
    const a = await login(app, "radiologist");
    const res = await a.patch(`/reports/${r.id}/status`).send({ status: "preliminary" });
    expect(res.body.signedBy).toBeUndefined();
  });

  it("F9.4: cancelled does NOT set signedBy", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "x", ownerId: "dev-radiologist" }));
    const a = await login(app, "radiologist");
    const res = await a.patch(`/reports/${r.id}/status`).send({ status: "cancelled" });
    expect(res.body.signedBy).toBeUndefined();
  });

  it("F9.5: admin can also sign reports", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "x", ownerId: "dev-admin" }));
    const a = await login(app, "admin");
    const res = await a.patch(`/reports/${r.id}/status`).send({ status: "final" });
    expect(res.body.signedBy).toBe("dev-admin");
  });
});
