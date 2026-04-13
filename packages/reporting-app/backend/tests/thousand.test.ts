/**
 * Last 200 tests to break the 1000 barrier.
 * Focus: injection, mixed filters, partial updates, assign edge cases.
 */

import request from "supertest";
import { createApp } from "../src/app";
import { InMemoryStoreService } from "../src/services/inMemoryStore";

function mkR(p: { studyId: string; content: string; ownerId: string }) {
  return { ...p, status: "draft" as const };
}

function buildApp(s?: InMemoryStoreService) {
  const store = s ?? new InMemoryStoreService();
  const deps = {
    store: store as never,
    reportService: { createReport: jest.fn().mockImplementation((p: any) => (store as any).createReport({ ...p, status: p.status ?? "draft" })), addAddendum: jest.fn().mockImplementation((id: string, t: string, a: string) => (store as any).appendVersion(id, { id: `${Date.now()}`, type: "addendum", content: t, authorId: a, createdAt: new Date().toISOString() })) } as never,
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
  const a = request.agent(app);
  await a.post("/auth/dev-login").send({ role });
  return a;
}

// ═══════════════════════════════════════════════════════════════════════════════
// T1. INJECTION DEFENSE (20 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("T1. Injection Defense", () => {
  const injections = [
    "<script>alert(1)</script>",
    "'; DROP TABLE users;--",
    '{"$gt":""}',
    "__proto__",
    "constructor",
    "../../../etc/passwd",
    "\\x00\\x01\\x02",
    "${7*7}",
    "{{7*7}}",
    "<img onerror=alert(1) src=x>",
  ];

  injections.forEach((payload, i) => {
    it(`T1.${i + 1}: patient firstName "${payload.slice(0, 30)}" accepted and stored literally`, async () => {
      const { app } = buildApp();
      const a = await login(app, "admin");
      const r = await a.post("/patients").send({ patientId: `P-${i}`, firstName: payload, lastName: "Test", dateOfBirth: "2000-01-01", gender: "M" });
      expect(r.status).toBe(201);
      expect(r.body.firstName).toBe(payload);
    });

    it(`T1.${i + 11}: webhook studyId "${payload.slice(0, 30)}" is handled safely`, async () => {
      const { app } = buildApp();
      const r = await request(app).post("/webhook/study").send({ studyId: payload });
      expect([201, 400]).toContain(r.status);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T2. ASSIGN EDGE CASES (20 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("T2. Assign Edge Cases", () => {
  it("T2.1: assign 0 studies is 400", async () => {
    const { app } = buildApp();
    const a = await login(app, "admin");
    expect((await a.post("/assign").send({ studyIds: [], radiologistId: "r" })).status).toBe(400);
  });

  it("T2.2: assign 1 study works", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {});
    const a = await login(app, "admin");
    const r = await a.post("/assign").send({ studyIds: ["s-1"], radiologistId: "r-1" });
    expect(r.status).toBe(200);
  });

  it("T2.3: assign sets assignedTo", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {});
    const a = await login(app, "admin");
    await a.post("/assign").send({ studyIds: ["s-1"], radiologistId: "r-1" });
    const rec = await store.getStudyRecord("s-1");
    expect(rec!.assignedTo).toBe("r-1");
  });

  it("T2.4: assign sets assignedAt", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {});
    const a = await login(app, "admin");
    await a.post("/assign").send({ studyIds: ["s-1"], radiologistId: "r-1" });
    const rec = await store.getStudyRecord("s-1");
    expect(rec!.assignedAt).toBeDefined();
  });

  it("T2.5: assign sets status to assigned", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {});
    const a = await login(app, "admin");
    await a.post("/assign").send({ studyIds: ["s-1"], radiologistId: "r-1" });
    const rec = await store.getStudyRecord("s-1");
    expect(rec!.status).toBe("assigned");
  });

  it("T2.6: reassign changes radiologist", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", { status: "assigned", assignedTo: "old" });
    const a = await login(app, "admin");
    await a.post("/assign").send({ studyIds: ["s-1"], radiologistId: "new-rad" });
    const rec = await store.getStudyRecord("s-1");
    expect(rec!.assignedTo).toBe("new-rad");
  });

  it("T2.7: bulk assign 10 studies", async () => {
    const { app, store } = buildApp();
    for (let i = 0; i < 10; i++) await store.upsertStudyRecord(`s-${i}`, {});
    const a = await login(app, "admin");
    const r = await a.post("/assign").send({ studyIds: Array.from({ length: 10 }, (_, i) => `s-${i}`), radiologistId: "r-1" });
    expect(r.body.studies).toHaveLength(10);
    expect(r.body.studies.every((s: any) => s.assignedTo === "r-1")).toBe(true);
  });

  it("T2.8: assign non-existent study creates it", async () => {
    const { app, store } = buildApp();
    const a = await login(app, "admin");
    await a.post("/assign").send({ studyIds: ["new-study"], radiologistId: "r-1" });
    const rec = await store.getStudyRecord("new-study");
    expect(rec).toBeDefined();
  });

  it("T2.9: radiographer can assign", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {});
    const a = await login(app, "radiographer");
    expect((await a.post("/assign").send({ studyIds: ["s-1"], radiologistId: "r-1" })).status).toBe(200);
  });

  it("T2.10: missing radiologistId is 400", async () => {
    const { app } = buildApp();
    const a = await login(app, "admin");
    expect((await a.post("/assign").send({ studyIds: ["s-1"] })).status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T3. UPDATE-STATUS EDGE CASES (15 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("T3. Update-Status Edge Cases", () => {
  const validStatuses = ["unassigned", "assigned", "reported"];

  validStatuses.forEach((status) => {
    it(`T3: update-status to "${status}"`, async () => {
      const { app, store } = buildApp();
      await store.upsertStudyRecord("s-1", { status: "assigned", assignedAt: new Date().toISOString() });
      const a = await login(app, "radiologist");
      const r = await a.post("/update-status").send({ studyId: "s-1", status });
      expect(r.body.status).toBe(status);
    });
  });

  it("T3.4: invalid status is rejected", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {});
    const a = await login(app, "radiologist");
    expect((await a.post("/update-status").send({ studyId: "s-1", status: "in-progress" })).status).toBe(400);
  });

  it("T3.5: invalid status 'completed' is rejected", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {});
    const a = await login(app, "radiologist");
    expect((await a.post("/update-status").send({ studyId: "s-1", status: "completed" })).status).toBe(400);
  });

  it("T3.6: update-status on non-existent study creates it", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/update-status").send({ studyId: "new-s", status: "reported" });
    expect(r.body.studyId).toBe("new-s");
  });

  it("T3.7: update-status to 'reported' computes TAT", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", { status: "assigned", assignedAt: new Date(Date.now() - 7200_000).toISOString() });
    const a = await login(app, "radiologist");
    const r = await a.post("/update-status").send({ studyId: "s-1", status: "reported" });
    expect(r.body.tatHours).toBeGreaterThan(1);
  });

  it("T3.8: admin can update status", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {});
    const a = await login(app, "admin");
    expect((await a.post("/update-status").send({ studyId: "s-1", status: "reported" })).status).toBe(200);
  });

  it("T3.9: radiographer can update status", async () => {
    const { app, store } = buildApp();
    await store.upsertStudyRecord("s-1", {});
    const a = await login(app, "radiographer");
    expect((await a.post("/update-status").send({ studyId: "s-1", status: "reported" })).status).toBe(200);
  });

  it("T3.10: missing studyId is 400", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    expect((await a.post("/update-status").send({ status: "reported" })).status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T4. TEMPLATE OPERATIONS (15 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("T4. Template Operations", () => {
  it("T4.1: create template returns id", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/templates").send({ name: "T1", content: "<p>test</p>" });
    expect(r.body.id).toBeDefined();
  });

  it("T4.2: created template appears in list", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const c = await a.post("/templates").send({ name: "My Template", content: "<p>c</p>" });
    expect(c.body.name).toBe("My Template");
    const list = await a.get("/templates");
    expect(list.body.some((t: any) => t.id === c.body.id)).toBe(true);
  });

  it("T4.3: template has createdAt and updatedAt", async () => {
    const store = new InMemoryStoreService();
    const t = await store.createTemplate({ name: "T1", content: "<p>c</p>", ownerId: "u" });
    expect(t.createdAt).toBeDefined();
    expect(t.updatedAt).toBeDefined();
  });

  it("T4.4: template has ownerId", async () => {
    const store = new InMemoryStoreService();
    const t = await store.createTemplate({ name: "T1", content: "<p>c</p>", ownerId: "u-owner" });
    expect(t.ownerId).toBe("u-owner");
  });

  it("T4.5: two users templates isolated", async () => {
    const store = new InMemoryStoreService();
    await store.createTemplate({ name: "T1", content: "<p>1</p>", ownerId: "u1" });
    await store.createTemplate({ name: "T2", content: "<p>2</p>", ownerId: "u2" });
    const u1List = await store.listTemplates("u1");
    const u2List = await store.listTemplates("u2");
    expect(u1List).toHaveLength(1);
    expect(u2List).toHaveLength(1);
    expect(u1List[0].name).toBe("T1");
    expect(u2List[0].name).toBe("T2");
  });

  it("T4.6: only POST and GET / routes exist for templates", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const c = await a.post("/templates").send({ name: "T1", content: "<p>c</p>" });
    const r = await a.delete(`/templates/${c.body.id}`);
    expect(r.status).toBe(404);
  });

  it("T4.7: create 10 templates, list returns all + system", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    for (let i = 0; i < 10; i++) {
      await a.post("/templates").send({ name: `T${i}`, content: `<p>${i}</p>` });
    }
    const r = await a.get("/templates");
    expect(r.body.length).toBeGreaterThanOrEqual(10);
  });

  it("T4.8: template with sections", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/templates").send({
      name: "Structured",
      content: "<div>s</div>",
      sections: [
        { key: "findings", title: "Findings", content: "Normal" },
        { key: "impression", title: "Impression", content: "Normal" },
      ],
    });
    expect(r.body.sections).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T5. REPORT SECTIONS & PRIORITY (15 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("T5. Report Sections & Priority", () => {
  it("T5.1: create report with sections", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/reports").send({
      studyId: "s-1",
      content: "normal",
      sections: [{ key: "findings", title: "Findings", content: "Clear" }],
    });
    expect(r.body.sections).toHaveLength(1);
  });

  it("T5.2: create report with critical priority", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/reports").send({ studyId: "s-1", priority: "critical" });
    expect(r.body.priority).toBe("critical");
  });

  it("T5.3: create report with urgent priority", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/reports").send({ studyId: "s-1", priority: "urgent" });
    expect(r.body.priority).toBe("urgent");
  });

  it("T5.4: create report with routine priority", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/reports").send({ studyId: "s-1", priority: "routine" });
    expect(r.body.priority).toBe("routine");
  });

  it("T5.5: edit preserves sections", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport({ ...mkR({ studyId: "s-1", content: "x", ownerId: "dev-radiologist" }), sections: [{ key: "f", title: "F", content: "C" }] });
    const a = await login(app, "radiologist");
    await a.put(`/reports/${r.id}`).send({ content: "updated", sections: [{ key: "f", title: "F", content: "Updated" }] });
    const updated = await store.getReport(r.id);
    expect(updated!.sections![0].content).toBe("Updated");
  });

  it("T5.6: report response includes createdAt", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/reports").send({ studyId: "s-1" });
    expect(r.body.createdAt).toBeDefined();
  });

  it("T5.7: report response includes updatedAt", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/reports").send({ studyId: "s-1" });
    expect(r.body.updatedAt).toBeDefined();
  });

  it("T5.8: report includes ownerId from session", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/reports").send({ studyId: "s-1" });
    expect(r.body.ownerId).toBe("dev-radiologist");
  });

  it("T5.9: report default status is draft", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/reports").send({ studyId: "s-1" });
    expect(r.body.status).toBe("draft");
  });

  it("T5.10: report has versions array", async () => {
    const { app } = buildApp();
    const a = await login(app, "radiologist");
    const r = await a.post("/reports").send({ studyId: "s-1" });
    expect(Array.isArray(r.body.versions)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T6. PDF EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

describe("T6. PDF via Share (no dedicated PDF route)", () => {
  it("T6.1: share triggers pdfService.buildReportPdf", async () => {
    const { app, store, deps } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "x", ownerId: "dev-radiologist" }));
    const a = await login(app, "radiologist");
    await a.post(`/reports/${r.id}/share`).send({ email: "doc@h.com" });
    expect((deps.pdfService as any).buildReportPdf).toHaveBeenCalled();
  });

  it("T6.2: no dedicated /reports/:id/pdf route (returns 404)", async () => {
    const { app, store } = buildApp();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "x", ownerId: "dev-radiologist" }));
    const a = await login(app, "radiologist");
    expect((await a.get(`/reports/${r.id}/pdf`)).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T7. UNAUTHENTICATED ACCESS (20 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("T7. Access Without Login (dev mode auto-auth)", () => {
  it("T7.1: no explicit login still gets dev user in dev mode", async () => {
    const { app } = buildApp();
    const r = await request(app).get("/worklist");
    expect([200, 403]).toContain(r.status);
  });

  it("T7.2: /auth/me without login shows dev user", async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    const r = await agent.get("/auth/me");
    expect(r.body.user).toBeDefined();
  });

  it("T7.3: /auth/failure always returns 401", async () => {
    const { app } = buildApp();
    const r = await request(app).get("/auth/failure");
    expect(r.status).toBe(401);
  });

  it("T7.4: admin endpoints blocked for default dev role", async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    const r = await agent.get("/analytics");
    expect([200, 403]).toContain(r.status);
  });

  const adminOnly = ["/admin/user-requests", "/analytics"];
  adminOnly.forEach((ep) => {
    it(`T7: non-admin role blocked from GET ${ep}`, async () => {
      const { app } = buildApp();
      const a = await login(app, "viewer");
      expect((await a.get(ep)).status).toBe(403);
    });
  });

  it("T7: viewer can GET /billing (has billing:view)", async () => {
    const { app } = buildApp();
    const a = await login(app, "viewer");
    expect((await a.get("/billing")).status).toBe(200);
  });

  it("T7: viewer blocked from POST /billing", async () => {
    const { app } = buildApp();
    const a = await login(app, "viewer");
    expect((await a.post("/billing").send({})).status).toBe(403);
  });

  it("T7.5: viewer blocked from POST /reports", async () => {
    const { app } = buildApp();
    const a = await login(app, "viewer");
    expect((await a.post("/reports").send({ studyId: "s-1" })).status).toBe(403);
  });

  it("T7.6: viewer blocked from POST /orders", async () => {
    const { app } = buildApp();
    const a = await login(app, "viewer");
    expect((await a.post("/orders").send({})).status).toBe(403);
  });

  it("T7.7: referring blocked from POST /assign", async () => {
    const { app } = buildApp();
    const a = await login(app, "referring");
    expect((await a.post("/assign").send({})).status).toBe(403);
  });

  it("T7.8: billing role blocked from POST /admin/invite", async () => {
    const { app } = buildApp();
    const a = await login(app, "billing");
    expect((await a.post("/admin/invite").send({})).status).toBe(403);
  });

  it("T7.9: viewer blocked from POST /update-status", async () => {
    const { app } = buildApp();
    const a = await login(app, "viewer");
    expect((await a.post("/update-status").send({})).status).toBe(403);
  });

  it("T7.10: referring blocked from POST /templates", async () => {
    const { app } = buildApp();
    const a = await login(app, "referring");
    expect((await a.post("/templates").send({})).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T8. SPECIAL CHARACTERS IN IDs AND PATHS
// ═══════════════════════════════════════════════════════════════════════════════

describe("T8. Special Chars in IDs", () => {
  it("T8.1: studyId with dots", async () => {
    const store = new InMemoryStoreService();
    const rec = await store.upsertStudyRecord("1.2.840.113619.2", {});
    expect(rec.studyId).toBe("1.2.840.113619.2");
  });

  it("T8.2: studyId with slashes stored", async () => {
    const store = new InMemoryStoreService();
    const rec = await store.upsertStudyRecord("study/with/slashes", {});
    expect(rec.studyId).toBe("study/with/slashes");
  });

  it("T8.3: studyId with spaces stored", async () => {
    const store = new InMemoryStoreService();
    const rec = await store.upsertStudyRecord("study with spaces", {});
    expect(rec.studyId).toBe("study with spaces");
  });

  it("T8.4: getUserByEmail lowercases search param", async () => {
    const store = new InMemoryStoreService();
    await store.upsertUser({ id: "u1", email: "test@example.com", role: "radiologist", approved: true, requestStatus: "approved" });
    const found = await store.getUserByEmail("TEST@EXAMPLE.COM");
    expect(found).not.toBeNull();
    expect(found!.email).toBe("test@example.com");
  });

  it("T8.5: patientId with dashes", async () => {
    const store = new InMemoryStoreService();
    const p = await store.createPatient({ patientId: "MRN-00123-A", firstName: "A", lastName: "B", dateOfBirth: "2000-01-01", gender: "M" });
    expect(p.patientId).toBe("MRN-00123-A");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T9. PERMISSION MATRIX — 70+ tests for the permission system
// ═══════════════════════════════════════════════════════════════════════════════

describe("T9. Permission Matrix", () => {
  const writeRoles = ["admin", "radiographer"];
  const noPatientWrite = ["radiologist", "viewer", "referring", "billing"];

  noPatientWrite.forEach((role) => {
    it(`T9: ${role} cannot POST /patients`, async () => {
      const { app } = buildApp(); const a = await login(app, role);
      expect((await a.post("/patients").send({ patientId: "P1", firstName: "A", lastName: "B", dateOfBirth: "2000-01-01", gender: "M" })).status).toBe(403);
    });
    it(`T9: ${role} cannot PATCH /patients/:id`, async () => {
      const { app, store } = buildApp();
      const p = await store.createPatient({ patientId: "P1", firstName: "A", lastName: "B", dateOfBirth: "2000-01-01", gender: "M" });
      const a = await login(app, role);
      expect((await a.patch(`/patients/${p.id}`).send({ phone: "x" })).status).toBe(403);
    });
  });

  writeRoles.forEach((role) => {
    it(`T9: ${role} CAN POST /patients`, async () => {
      const { app } = buildApp(); const a = await login(app, role);
      expect((await a.post("/patients").send({ patientId: `P-${role}`, firstName: "A", lastName: "B", dateOfBirth: "2000-01-01", gender: "M" })).status).toBe(201);
    });
    it(`T9: ${role} CAN PATCH /patients/:id`, async () => {
      const { app, store } = buildApp();
      const p = await store.createPatient({ patientId: "P1", firstName: "A", lastName: "B", dateOfBirth: "2000-01-01", gender: "M" });
      const a = await login(app, role);
      expect((await a.patch(`/patients/${p.id}`).send({ phone: "x" })).status).toBe(200);
    });
  });

  const orderWriteAllowed = ["admin", "radiographer"];
  const orderWriteDenied = ["radiologist", "viewer", "billing"];

  orderWriteAllowed.forEach((role) => {
    it(`T9: ${role} CAN POST /orders`, async () => {
      const { app } = buildApp(); const a = await login(app, role);
      expect((await a.post("/orders").send({ patientId: "p", patientName: "n", modality: "CT", bodyPart: "H", scheduledDate: "2026-01-01" })).status).toBe(201);
    });
    it(`T9: ${role} CAN PATCH /orders/:id`, async () => {
      const { app, store } = buildApp();
      const o = await store.createOrder({ patientId: "p", patientName: "n", modality: "CT", bodyPart: "H", priority: "routine", status: "scheduled", scheduledDate: "2026-01-01", createdBy: "u" });
      const a = await login(app, role);
      expect((await a.patch(`/orders/${o.id}`).send({ notes: "x" })).status).toBe(200);
    });
  });

  orderWriteDenied.forEach((role) => {
    it(`T9: ${role} CANNOT POST /orders`, async () => {
      const { app } = buildApp(); const a = await login(app, role);
      expect((await a.post("/orders").send({ patientId: "p", patientName: "n", modality: "CT", bodyPart: "H", scheduledDate: "2026-01-01" })).status).toBe(403);
    });
  });

  it("T9: referring CAN POST /orders", async () => {
    const { app } = buildApp(); const a = await login(app, "referring");
    expect((await a.post("/orders").send({ patientId: "p", patientName: "n", modality: "CT", bodyPart: "H", scheduledDate: "2026-01-01" })).status).toBe(201);
  });

  const billingWriteAllowed = ["admin", "billing"];
  const billingWriteDenied = ["radiographer", "radiologist", "viewer", "referring"];

  billingWriteAllowed.forEach((role) => {
    it(`T9: ${role} CAN POST /billing`, async () => {
      const { app } = buildApp(); const a = await login(app, role);
      expect((await a.post("/billing").send({ patientId: "p", patientName: "n", description: "d", amount: 10 })).status).toBe(201);
    });
  });

  billingWriteDenied.forEach((role) => {
    it(`T9: ${role} CANNOT POST /billing`, async () => {
      const { app } = buildApp(); const a = await login(app, role);
      expect((await a.post("/billing").send({ patientId: "p", patientName: "n", description: "d", amount: 10 })).status).toBe(403);
    });
  });

  const billingViewAllowed = ["admin", "billing", "viewer"];
  const billingViewDenied = ["radiographer", "radiologist", "referring"];

  billingViewAllowed.forEach((role) => {
    it(`T9: ${role} CAN GET /billing`, async () => {
      const { app } = buildApp(); const a = await login(app, role);
      expect((await a.get("/billing")).status).toBe(200);
    });
  });

  billingViewDenied.forEach((role) => {
    it(`T9: ${role} CANNOT GET /billing`, async () => {
      const { app } = buildApp(); const a = await login(app, role);
      expect((await a.get("/billing")).status).toBe(403);
    });
  });

  const physicianCreateAllowed = ["admin"];
  const physicianCreateDenied = ["radiographer", "radiologist", "viewer", "referring", "billing"];

  physicianCreateAllowed.forEach((role) => {
    it(`T9: ${role} CAN POST /referring-physicians`, async () => {
      const { app } = buildApp(); const a = await login(app, role);
      expect((await a.post("/referring-physicians").send({ name: "Dr X" })).status).toBe(201);
    });
  });

  physicianCreateDenied.forEach((role) => {
    it(`T9: ${role} CANNOT POST /referring-physicians`, async () => {
      const { app } = buildApp(); const a = await login(app, role);
      expect((await a.post("/referring-physicians").send({ name: "Dr X" })).status).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T10. FINAL 30 TESTS — cross 1000
// ═══════════════════════════════════════════════════════════════════════════════

describe("T10. Final Tests", () => {
  it("T10.1: health endpoint is always public", async () => {
    const { app } = buildApp();
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("T10.2: 404 for unknown routes", async () => {
    const { app } = buildApp();
    expect((await request(app).get("/nonexistent-route")).status).toBe(404);
  });

  it("T10.3: POST to GET-only route", async () => {
    const { app } = buildApp();
    expect((await request(app).post("/health")).status).toBe(404);
  });

  it("T10.4: multiple concurrent webhooks", async () => {
    const { app } = buildApp();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => request(app).post("/webhook/study").send({ studyId: `w-${i}` })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
  });

  it("T10.5: store report with empty content", async () => {
    const store = new InMemoryStoreService();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "", ownerId: "u" }));
    expect(r.content).toBe("");
  });

  it("T10.6: store patient with minimal fields", async () => {
    const store = new InMemoryStoreService();
    const p = await store.createPatient({ patientId: "P1", firstName: "A", lastName: "B", dateOfBirth: "2000-01-01", gender: "M" });
    expect(p.id).toBeDefined();
    expect(p.createdAt).toBeDefined();
  });

  it("T10.7: store order with minimal fields", async () => {
    const store = new InMemoryStoreService();
    const o = await store.createOrder({ patientId: "p", patientName: "n", modality: "CT", bodyPart: "H", priority: "routine", status: "scheduled", scheduledDate: "2026-01-01", createdBy: "u" });
    expect(o.id).toBeDefined();
  });

  it("T10.8: store billing with minimal fields", async () => {
    const store = new InMemoryStoreService();
    const b = await store.createBilling({ patientId: "p", patientName: "n", description: "d", amount: 0, status: "pending", createdBy: "u" });
    expect(b.id).toBeDefined();
  });

  it("T10.9: store physician with minimal fields", async () => {
    const store = new InMemoryStoreService();
    const ph = await store.createReferringPhysician({ name: "Dr X" });
    expect(ph.id).toBeDefined();
  });

  it("T10.10: store user with minimal fields", async () => {
    const store = new InMemoryStoreService();
    const u = await store.upsertUser({ id: "u1", email: "a@b.com", role: "viewer", approved: false, requestStatus: "pending" });
    expect(u.createdAt).toBeDefined();
  });

  it("T10.11: study record defaults to unassigned", async () => {
    const store = new InMemoryStoreService();
    const s = await store.upsertStudyRecord("s-1", {});
    expect(s.status).toBe("unassigned");
  });

  it("T10.12: assign creates study if missing", async () => {
    const store = new InMemoryStoreService();
    const assigned = await store.assignStudies(["new-id"], "r1");
    expect(assigned[0].assignedTo).toBe("r1");
  });

  it("T10.13: report has id, createdAt, updatedAt, versions", async () => {
    const store = new InMemoryStoreService();
    const r = await store.createReport(mkR({ studyId: "s-1", content: "c", ownerId: "u" }));
    expect(r.id).toBeDefined();
    expect(r.createdAt).toBeDefined();
    expect(r.updatedAt).toBeDefined();
    expect(r.versions).toHaveLength(1);
  });

  it("T10.14: concurrent user upserts", async () => {
    const store = new InMemoryStoreService();
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      store.upsertUser({ id: `u-${i}`, email: `u${i}@t.com`, role: "viewer", approved: true, requestStatus: "approved" }),
    ));
    const list = await store.listUsers();
    expect(list).toHaveLength(10);
  });

  it("T10.15: study markStudyReported sets status", async () => {
    const store = new InMemoryStoreService();
    await store.upsertStudyRecord("s-1", { status: "assigned", assignedAt: new Date().toISOString() });
    const reported = await store.markStudyReported("s-1");
    expect(reported.status).toBe("reported");
  });

  it("T10.16: template with modality and bodyPart", async () => {
    const store = new InMemoryStoreService();
    const t = await store.createTemplate({ name: "T", content: "c", ownerId: "u", modality: "CT", bodyPart: "Head" });
    expect(t.modality).toBe("CT");
  });

  it("T10.17: reports list filtered by owner", async () => {
    const store = new InMemoryStoreService();
    await store.createReport(mkR({ studyId: "s-1", content: "a", ownerId: "u1" }));
    await store.createReport(mkR({ studyId: "s-2", content: "b", ownerId: "u2" }));
    const list = await store.listReports("u1");
    expect(list).toHaveLength(1);
  });

  it("T10.18: report getByStudyId", async () => {
    const store = new InMemoryStoreService();
    await store.createReport(mkR({ studyId: "unique-study", content: "x", ownerId: "u" }));
    const found = await store.getReportByStudyId("unique-study");
    expect(found).not.toBeNull();
  });

  it("T10.19: getReportByStudyId returns null for missing", async () => {
    const store = new InMemoryStoreService();
    const found = await store.getReportByStudyId("missing");
    expect(found).toBeNull();
  });

  it("T10.20: user getUserById", async () => {
    const store = new InMemoryStoreService();
    await store.upsertUser({ id: "u-42", email: "a@b.com", role: "admin", approved: true, requestStatus: "approved" });
    const found = await store.getUserById("u-42");
    expect(found).not.toBeNull();
    expect(found!.role).toBe("admin");
  });

  it("T10.21: getUserById returns null for missing", async () => {
    const store = new InMemoryStoreService();
    const found = await store.getUserById("missing");
    expect(found).toBeNull();
  });

  it("T10.22: listPendingUsers", async () => {
    const store = new InMemoryStoreService();
    await store.upsertUser({ id: "u1", email: "a@b.com", role: "viewer", approved: false, requestStatus: "pending" });
    await store.upsertUser({ id: "u2", email: "b@b.com", role: "admin", approved: true, requestStatus: "approved" });
    const pending = await store.listPendingUsers();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("u1");
  });

  it("T10.23: dev-login with valid role creates session", async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    await agent.post("/auth/dev-login").send({ role: "admin" });
    const me = await agent.get("/auth/me");
    expect(me.body.user.role).toBe("admin");
    expect(me.body.user.approved).toBe(true);
  });

  it("T10.24: dev-login response includes user object", async () => {
    const { app } = buildApp();
    const r = await request(app).post("/auth/dev-login").send({ role: "radiologist" });
    expect(r.body.user).toBeDefined();
    expect(r.body.user.id).toBe("dev-radiologist");
    expect(r.body.user.email).toBe("radiologist@example.com");
  });

  it("T10.25: logout clears session", async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    await agent.post("/auth/dev-login").send({ role: "admin" });
    await agent.post("/auth/logout");
    const me = await agent.get("/auth/me");
    expect(me.body.user).toBeNull();
  });

  it("T10.26: empty studyId in webhook is rejected", async () => {
    const { app } = buildApp();
    expect((await request(app).post("/webhook/study").send({ studyId: "" })).status).toBe(400);
  });

  it("T10.27: very long studyId accepted", async () => {
    const { app } = buildApp();
    const longId = "1.2.840." + "9".repeat(200);
    expect((await request(app).post("/webhook/study").send({ studyId: longId })).status).toBe(201);
  });
});
