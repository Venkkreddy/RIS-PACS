import { InMemoryStoreService } from "../src/services/inMemoryStore";

let store: InMemoryStoreService;

beforeEach(() => {
  store = new InMemoryStoreService();
});

// ── Templates ────────────────────────────────────────────────────────────────
describe("Templates", () => {
  const payload = { name: "CT Head", content: "<p>Findings…</p>", ownerId: "user-1" };

  it("creates a template with generated id and timestamps", async () => {
    const t = await store.createTemplate(payload);

    expect(t.id).toBeDefined();
    expect(t.name).toBe("CT Head");
    expect(t.ownerId).toBe("user-1");
    expect(t.createdAt).toBeDefined();
    expect(t.updatedAt).toBeDefined();
  });

  it("lists templates filtered by ownerId", async () => {
    await store.createTemplate(payload);
    await store.createTemplate({ ...payload, ownerId: "user-2" });

    const list = await store.listTemplates("user-1");
    expect(list).toHaveLength(1);
    expect(list[0].ownerId).toBe("user-1");
  });

  it("returns empty array when no templates match", async () => {
    const list = await store.listTemplates("nonexistent");
    expect(list).toEqual([]);
  });
});

// ── Reports ──────────────────────────────────────────────────────────────────
describe("Reports", () => {
  const payload = { studyId: "study-1", content: "Normal chest X-ray", ownerId: "user-1", status: "draft" as const };

  it("creates a report with initial audit version", async () => {
    const r = await store.createReport(payload);

    expect(r.id).toBeDefined();
    expect(r.studyId).toBe("study-1");
    expect(r.versions).toHaveLength(1);
    expect(r.versions[0].type).toBe("initial");
    expect(r.attachments).toEqual([]);
  });

  it("lists reports filtered by ownerId", async () => {
    await store.createReport(payload);
    await store.createReport({ ...payload, ownerId: "user-2" });

    const list = await store.listReports("user-1");
    expect(list).toHaveLength(1);
  });

  it("gets a report by id", async () => {
    const created = await store.createReport(payload);
    const found = await store.getReport(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it("returns null for unknown report id", async () => {
    const found = await store.getReport("nonexistent");
    expect(found).toBeNull();
  });

  it("gets a report by studyId", async () => {
    await store.createReport(payload);
    const found = await store.getReportByStudyId("study-1");
    expect(found).not.toBeNull();
    expect(found!.studyId).toBe("study-1");
  });

  it("appends a version and updates content", async () => {
    const r = await store.createReport(payload);
    const version = { id: "v2", type: "addendum" as const, content: "Addendum", authorId: "user-1", createdAt: new Date().toISOString() };

    const updated = await store.appendVersion(r.id, version, "Updated content");

    expect(updated.versions).toHaveLength(2);
    expect(updated.content).toBe("Updated content");
  });

  it("throws when appending version to missing report", async () => {
    const version = { id: "v1", type: "addendum" as const, content: "X", authorId: "u", createdAt: "" };
    await expect(store.appendVersion("bad-id", version)).rejects.toThrow("Report not found");
  });

  it("adds an attachment with audit trail", async () => {
    const r = await store.createReport(payload);
    const updated = await store.addAttachment(r.id, "https://storage.example.com/img.png", "user-1");

    expect(updated.attachments).toContain("https://storage.example.com/img.png");
    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[1].type).toBe("attachment");
  });

  it("throws when adding attachment to missing report", async () => {
    await expect(store.addAttachment("bad", "url", "u")).rejects.toThrow("Report not found");
  });

});

// ── Studies (worklist) ───────────────────────────────────────────────────────
describe("Studies", () => {
  it("upserts a new study record", async () => {
    const s = await store.upsertStudyRecord("s-1", { patientName: "John Doe", studyDate: "2026-01-15" });

    expect(s.studyId).toBe("s-1");
    expect(s.status).toBe("unassigned");
    expect(s.patientName).toBe("John Doe");
  });

  it("merges patch into existing study record", async () => {
    await store.upsertStudyRecord("s-1", { patientName: "John" });
    const updated = await store.upsertStudyRecord("s-1", { location: "Room A" });

    expect(updated.patientName).toBe("John");
    expect(updated.location).toBe("Room A");
  });

  it("gets a study by id", async () => {
    await store.upsertStudyRecord("s-1", {});
    const found = await store.getStudyRecord("s-1");
    expect(found).not.toBeNull();
  });

  it("returns null for unknown study", async () => {
    const found = await store.getStudyRecord("missing");
    expect(found).toBeNull();
  });

  it("lists studies with status filter", async () => {
    await store.upsertStudyRecord("s-1", { status: "assigned" });
    await store.upsertStudyRecord("s-2", { status: "unassigned" });

    const list = await store.listStudyRecords({ status: "assigned" });
    expect(list).toHaveLength(1);
    expect(list[0].studyId).toBe("s-1");
  });

  it("lists studies with assignedTo filter", async () => {
    await store.upsertStudyRecord("s-1", { assignedTo: "rad-1" });
    await store.upsertStudyRecord("s-2", { assignedTo: "rad-2" });

    const list = await store.listStudyRecords({ assignedTo: "rad-1" });
    expect(list).toHaveLength(1);
  });

  it("lists studies with name search", async () => {
    await store.upsertStudyRecord("s-1", { patientName: "Alice Smith" });
    await store.upsertStudyRecord("s-2", { patientName: "Bob Jones" });

    const list = await store.listStudyRecords({ name: "alice" });
    expect(list).toHaveLength(1);
  });

  it("lists studies with date filter", async () => {
    await store.upsertStudyRecord("s-1", { studyDate: "2026-03-15T10:00:00Z" });
    await store.upsertStudyRecord("s-2", { studyDate: "2026-03-16T10:00:00Z" });

    const list = await store.listStudyRecords({ date: "2026-03-15" });
    expect(list).toHaveLength(1);
  });

  it("lists studies with location filter", async () => {
    await store.upsertStudyRecord("s-1", { location: "Main Campus" });
    await store.upsertStudyRecord("s-2", { location: "Downtown" });

    const list = await store.listStudyRecords({ location: "main" });
    expect(list).toHaveLength(1);
  });

  it("assigns studies to a radiologist", async () => {
    await store.upsertStudyRecord("s-1", {});
    await store.upsertStudyRecord("s-2", {});

    const assigned = await store.assignStudies(["s-1", "s-2"], "rad-1");

    expect(assigned).toHaveLength(2);
    expect(assigned[0].status).toBe("assigned");
    expect(assigned[0].assignedTo).toBe("rad-1");
    expect(assigned[0].assignedAt).toBeDefined();
  });

  it("marks a study as reported with TAT calculation", async () => {
    await store.upsertStudyRecord("s-1", { status: "assigned", assignedAt: new Date(Date.now() - 3600_000).toISOString() });

    const reported = await store.markStudyReported("s-1");

    expect(reported.status).toBe("reported");
    expect(reported.reportedAt).toBeDefined();
    expect(reported.tatHours).toBeGreaterThanOrEqual(0.9);
  });

  it("marks a non-existing study as reported", async () => {
    const reported = await store.markStudyReported("new-study");
    expect(reported.status).toBe("reported");
    expect(reported.tatHours).toBe(0);
  });
});

// ── Users ────────────────────────────────────────────────────────────────────
describe("Users", () => {
  const baseUser = { id: "u-1", email: "doc@example.com", role: "radiologist" as const, approved: false, requestStatus: "pending" as const, displayName: "Dr. Smith" };

  it("upserts a new user", async () => {
    const u = await store.upsertUser(baseUser);

    expect(u.id).toBe("u-1");
    expect(u.email).toBe("doc@example.com");
    expect(u.createdAt).toBeDefined();
  });

  it("preserves createdAt on re-upsert", async () => {
    const first = await store.upsertUser(baseUser);
    const second = await store.upsertUser({ ...baseUser, displayName: "Dr. Jane Smith" });

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.displayName).toBe("Dr. Jane Smith");
  });

  it("lists all users", async () => {
    await store.upsertUser(baseUser);
    await store.upsertUser({ ...baseUser, id: "u-2", email: "tech@example.com", role: "radiographer" });

    const list = await store.listUsers();
    expect(list).toHaveLength(2);
  });

  it("gets user by id", async () => {
    await store.upsertUser(baseUser);
    const found = await store.getUserById("u-1");
    expect(found).not.toBeNull();
  });

  it("returns null for unknown user id", async () => {
    const found = await store.getUserById("missing");
    expect(found).toBeNull();
  });

  it("gets user by email (case-insensitive)", async () => {
    await store.upsertUser(baseUser);
    const found = await store.getUserByEmail("DOC@EXAMPLE.COM");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("u-1");
  });

  it("updates user role and marks approved", async () => {
    await store.upsertUser(baseUser);
    const updated = await store.updateUserRole("u-1", "admin", "Admin User");

    expect(updated.role).toBe("admin");
    expect(updated.approved).toBe(true);
    expect(updated.requestStatus).toBe("approved");
    expect(updated.displayName).toBe("Admin User");
  });

  it("throws when updating role on nonexistent user", async () => {
    await expect(store.updateUserRole("bad", "admin")).rejects.toThrow("User not found");
  });

  it("lists pending users only", async () => {
    await store.upsertUser(baseUser);
    await store.upsertUser({ ...baseUser, id: "u-2", email: "approved@example.com", requestStatus: "approved" });

    const pending = await store.listPendingUsers();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("u-1");
  });

  it("approves a user", async () => {
    await store.upsertUser(baseUser);
    const updated = await store.updateUserApproval("u-1", "approved", "radiologist");

    expect(updated.approved).toBe(true);
    expect(updated.requestStatus).toBe("approved");
  });

  it("rejects a user", async () => {
    await store.upsertUser(baseUser);
    const updated = await store.updateUserApproval("u-1", "rejected");

    expect(updated.approved).toBe(false);
    expect(updated.requestStatus).toBe("rejected");
  });

  it("throws when approving nonexistent user", async () => {
    await expect(store.updateUserApproval("bad", "approved")).rejects.toThrow("User not found");
  });
});

// ── Invites ──────────────────────────────────────────────────────────────────
describe("Invites", () => {
  it("creates an invite with generated id and timestamp", async () => {
    const invite = await store.createInvite({ email: "new@example.com", role: "radiographer", token: "tok-123", invitedBy: "admin-1" });

    expect(invite.id).toBeDefined();
    expect(invite.email).toBe("new@example.com");
    expect(invite.token).toBe("tok-123");
    expect(invite.createdAt).toBeDefined();
  });
});

// ── Patients ─────────────────────────────────────────────────────────────────
describe("Patients", () => {
  const payload = { patientId: "MRN-001", firstName: "Jane", lastName: "Doe", dateOfBirth: "1990-05-10", gender: "F" as const };

  it("creates a patient with generated id", async () => {
    const p = await store.createPatient(payload);

    expect(p.id).toBeDefined();
    expect(p.firstName).toBe("Jane");
    expect(p.patientId).toBe("MRN-001");
  });

  it("gets a patient by id", async () => {
    const created = await store.createPatient(payload);
    const found = await store.getPatient(created.id);
    expect(found).not.toBeNull();
    expect(found!.firstName).toBe("Jane");
  });

  it("returns null for unknown patient", async () => {
    const found = await store.getPatient("missing");
    expect(found).toBeNull();
  });

  it("updates patient fields", async () => {
    const created = await store.createPatient(payload);
    const updated = await store.updatePatient(created.id, { phone: "555-1234" });

    expect(updated.phone).toBe("555-1234");
    expect(updated.firstName).toBe("Jane");
    expect(updated.updatedAt).toBeDefined();
  });

  it("throws when updating nonexistent patient", async () => {
    await expect(store.updatePatient("bad", { phone: "555" })).rejects.toThrow("Patient not found");
  });

  it("lists patients sorted by updatedAt descending", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const _first = await store.createPatient(payload);

    jest.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const _second = await store.createPatient({ ...payload, patientId: "MRN-002", firstName: "Bob" });

    jest.useRealTimers();

    const list = await store.listPatients();
    expect(list).toHaveLength(2);
    // Most recently created (later updatedAt) should be first
    expect(list[0].firstName).toBe("Bob");
  });

  it("searches patients by name or patientId", async () => {
    await store.createPatient(payload);
    await store.createPatient({ ...payload, patientId: "MRN-002", firstName: "Alice", lastName: "Wonder" });

    const byFirst = await store.listPatients("alice");
    expect(byFirst).toHaveLength(1);

    const byLast = await store.listPatients("doe");
    expect(byLast).toHaveLength(1);

    const byMrn = await store.listPatients("MRN-001");
    expect(byMrn).toHaveLength(1);
  });
});

// ── Referring Physicians ─────────────────────────────────────────────────────
describe("Referring Physicians", () => {
  const payload = { name: "Dr. House", specialty: "Diagnostics", phone: "555-0000", email: "house@hospital.com", hospital: "Princeton-Plainsboro" };

  it("creates a referring physician", async () => {
    const p = await store.createReferringPhysician(payload);

    expect(p.id).toBeDefined();
    expect(p.name).toBe("Dr. House");
    expect(p.hospital).toBe("Princeton-Plainsboro");
  });

  it("gets a physician by id", async () => {
    const created = await store.createReferringPhysician(payload);
    const found = await store.getReferringPhysician(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Dr. House");
  });

  it("returns null for unknown physician", async () => {
    const found = await store.getReferringPhysician("missing");
    expect(found).toBeNull();
  });

  it("updates physician fields", async () => {
    const created = await store.createReferringPhysician(payload);
    const updated = await store.updateReferringPhysician(created.id, { specialty: "Nephrology" });

    expect(updated.specialty).toBe("Nephrology");
    expect(updated.name).toBe("Dr. House");
  });

  it("throws when updating nonexistent physician", async () => {
    await expect(store.updateReferringPhysician("bad", { specialty: "X" })).rejects.toThrow("Referring physician not found");
  });

  it("lists physicians sorted alphabetically", async () => {
    await store.createReferringPhysician(payload);
    await store.createReferringPhysician({ ...payload, name: "Dr. Adams" });

    const list = await store.listReferringPhysicians();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("Dr. Adams");
  });

  it("searches physicians by name or hospital", async () => {
    await store.createReferringPhysician(payload);
    await store.createReferringPhysician({ ...payload, name: "Dr. Wilson", hospital: "City General" });

    const byName = await store.listReferringPhysicians("wilson");
    expect(byName).toHaveLength(1);

    const byHospital = await store.listReferringPhysicians("princeton");
    expect(byHospital).toHaveLength(1);
  });
});

// ── Orders ───────────────────────────────────────────────────────────────────
describe("Orders", () => {
  const payload = {
    patientId: "p-1",
    patientName: "Jane Doe",
    modality: "CT" as const,
    bodyPart: "Head",
    priority: "routine" as const,
    status: "scheduled" as const,
    scheduledDate: "2026-03-15T09:00:00Z",
    createdBy: "user-1",
  };

  it("creates an order with generated id", async () => {
    const o = await store.createOrder(payload);

    expect(o.id).toBeDefined();
    expect(o.patientName).toBe("Jane Doe");
    expect(o.modality).toBe("CT");
  });

  it("gets an order by id", async () => {
    const created = await store.createOrder(payload);
    const found = await store.getOrder(created.id);
    expect(found).not.toBeNull();
    expect(found!.bodyPart).toBe("Head");
  });

  it("returns null for unknown order", async () => {
    const found = await store.getOrder("missing");
    expect(found).toBeNull();
  });

  it("updates order fields", async () => {
    const created = await store.createOrder(payload);
    const updated = await store.updateOrder(created.id, { status: "in-progress" });

    expect(updated.status).toBe("in-progress");
    expect(updated.patientName).toBe("Jane Doe");
  });

  it("throws when updating nonexistent order", async () => {
    await expect(store.updateOrder("bad", { status: "completed" })).rejects.toThrow("Order not found");
  });

  it("lists orders filtered by status", async () => {
    await store.createOrder(payload);
    await store.createOrder({ ...payload, status: "completed", scheduledDate: "2026-03-14T09:00:00Z" });

    const list = await store.listOrders({ status: "scheduled" });
    expect(list).toHaveLength(1);
  });

  it("lists orders filtered by patientId", async () => {
    await store.createOrder(payload);
    await store.createOrder({ ...payload, patientId: "p-2", patientName: "Bob", scheduledDate: "2026-03-14T09:00:00Z" });

    const list = await store.listOrders({ patientId: "p-1" });
    expect(list).toHaveLength(1);
  });

  it("lists orders filtered by date", async () => {
    await store.createOrder(payload);
    await store.createOrder({ ...payload, scheduledDate: "2026-03-16T09:00:00Z" });

    const list = await store.listOrders({ date: "2026-03-15" });
    expect(list).toHaveLength(1);
  });

  it("searches orders by name, bodyPart, or modality", async () => {
    await store.createOrder(payload);
    await store.createOrder({ ...payload, modality: "MR", bodyPart: "Spine", patientName: "Bob Smith", scheduledDate: "2026-03-14T09:00:00Z" });

    const byName = await store.listOrders({ search: "jane" });
    expect(byName).toHaveLength(1);

    const byBody = await store.listOrders({ search: "spine" });
    expect(byBody).toHaveLength(1);

    const byModality = await store.listOrders({ search: "MR" });
    expect(byModality).toHaveLength(1);
  });

  it("returns orders sorted by scheduledDate descending", async () => {
    await store.createOrder(payload); // 2026-03-15
    await store.createOrder({ ...payload, scheduledDate: "2026-03-20T09:00:00Z" });

    const list = await store.listOrders();
    expect(list[0].scheduledDate).toBe("2026-03-20T09:00:00Z");
  });
});

// ── Billing ──────────────────────────────────────────────────────────────────
describe("Billing", () => {
  const payload = {
    patientId: "p-1",
    patientName: "Jane Doe",
    description: "CT Head scan",
    modality: "CT" as const,
    bodyPart: "Head",
    amount: 250,
    status: "pending" as const,
    createdBy: "user-1",
  };

  it("creates a billing record with generated id", async () => {
    const b = await store.createBilling(payload);

    expect(b.id).toBeDefined();
    expect(b.amount).toBe(250);
    expect(b.status).toBe("pending");
  });

  it("gets a billing record by id", async () => {
    const created = await store.createBilling(payload);
    const found = await store.getBilling(created.id);
    expect(found).not.toBeNull();
    expect(found!.description).toBe("CT Head scan");
  });

  it("returns null for unknown billing id", async () => {
    const found = await store.getBilling("missing");
    expect(found).toBeNull();
  });

  it("updates billing fields", async () => {
    const created = await store.createBilling(payload);
    const updated = await store.updateBilling(created.id, { status: "invoiced", invoiceNumber: "INV-001" });

    expect(updated.status).toBe("invoiced");
    expect(updated.invoiceNumber).toBe("INV-001");
  });

  it("throws when updating nonexistent billing record", async () => {
    await expect(store.updateBilling("bad", { status: "paid" })).rejects.toThrow("Billing record not found");
  });

  it("lists billing filtered by status", async () => {
    await store.createBilling(payload);
    await store.createBilling({ ...payload, status: "paid" });

    const list = await store.listBilling({ status: "pending" });
    expect(list).toHaveLength(1);
  });

  it("lists billing filtered by patientId", async () => {
    await store.createBilling(payload);
    await store.createBilling({ ...payload, patientId: "p-2", patientName: "Bob" });

    const list = await store.listBilling({ patientId: "p-1" });
    expect(list).toHaveLength(1);
  });

  it("searches billing by patientName or invoiceNumber", async () => {
    await store.createBilling({ ...payload, invoiceNumber: "INV-100" });
    await store.createBilling({ ...payload, patientName: "Bob Smith", invoiceNumber: "INV-200" });

    const byName = await store.listBilling({ search: "jane" });
    expect(byName).toHaveLength(1);

    const byInvoice = await store.listBilling({ search: "INV-200" });
    expect(byInvoice).toHaveLength(1);
  });

  it("returns billing sorted by createdAt descending", async () => {
    const first = await store.createBilling(payload);
    const second = await store.createBilling({ ...payload, description: "MR Spine" });

    // Force distinct createdAt to guarantee sort order
    await store.updateBilling(first.id, { createdAt: "2026-01-01T00:00:00Z" } as any);
    await store.updateBilling(second.id, { createdAt: "2026-01-02T00:00:00Z" } as any);

    const list = await store.listBilling();
    expect(list[0].id).toBe(second.id);
  });
});
