import express from "express";
import session from "express-session";
import passport from "./auth/passport";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { securityMiddleware } from "./middleware/security";
import { apiGateway } from "./middleware/apiGateway";
import { hipaaPhiAccessLogger, hipaaRequireHttps } from "./middleware/hipaaMiddleware";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { aiRouter } from "./routes/ai";
import { healthRouter } from "./routes/health";
import { hipaaRouter } from "./routes/hipaa";
import { reportsRouter } from "./routes/reports";
import { templatesRouter } from "./routes/templates";
import { transcribeRouter } from "./routes/transcribe";
import { webhookRouter } from "./routes/webhook";
import { worklistRouter } from "./routes/worklist";
import { patientsRouter } from "./routes/patients";
import { ordersRouter } from "./routes/orders";
import { scansRouter } from "./routes/scans";
import { billingRouter } from "./routes/billing";
import { referringPhysiciansRouter } from "./routes/referringPhysicians";
import { dicomUploadRouter } from "./routes/dicomUpload";
import { dicomwebRouter } from "./routes/dicomweb";
import { dicomwebMultiTenantRouter } from "./routes/dicomwebMultiTenant";
import { permissionsRouter } from "./routes/permissions";
import { servicesRouter } from "./routes/services";
import { tenantAuthRouter } from "./routes/tenantAuth";
import { tenantAdminRouter } from "./routes/tenantAdminPlatform";
import { JwtService } from "./services/jwtService";
import { TenantScopedStore } from "./services/tenantScopedStore";
import { DicoogleService } from "./services/dicoogleService";
import { EmailService } from "./services/emailService";
import { HipaaAuditService } from "./services/hipaaAuditService";
import { PdfService } from "./services/pdfService";
import { ReportService } from "./services/reportService";
import { SpeechService } from "./services/speechService";
import { StorageService } from "./services/storageService";
import { StoreService } from "./services/store";
import { InMemoryStoreService } from "./services/inMemoryStore";
import { MonaiService } from "./services/monaiService";
import { ServiceRegistry } from "./services/serviceRegistry";
import { logger } from "./services/logger";

export function createApp(deps?: {
  store?: StoreService;
  storageService?: StorageService;
  speechService?: SpeechService;
  emailService?: EmailService;
  pdfService?: PdfService;
  dicoogleService?: DicoogleService;
  reportService?: ReportService;
  monaiService?: MonaiService;
  serviceRegistry?: ServiceRegistry;
}): { app: express.Express; store: StoreService | InMemoryStoreService } {
  const app = express();

  // Use Firebase Firestore as the primary data store.
  // Falls back to in-memory store only when USE_INMEMORY_STORE is explicitly set.
  let store: StoreService | InMemoryStoreService;
  if (deps?.store) {
    store = deps.store;
  } else if (process.env.USE_INMEMORY_STORE === "true") {
    logger.info({ message: "USE_INMEMORY_STORE=true — using in-memory store" });
    store = new InMemoryStoreService() as unknown as StoreService;
  } else {
    store = new StoreService();
  }
  const storageService = deps?.storageService ?? new StorageService();
  const serviceRegistry = deps?.serviceRegistry ?? new ServiceRegistry(store);
  const speechService = deps?.speechService ?? new SpeechService(storageService, serviceRegistry);
  const emailService = deps?.emailService ?? new EmailService();
  const pdfService = deps?.pdfService ?? new PdfService();
  const dicoogleService = deps?.dicoogleService ?? new DicoogleService();
  const reportService = deps?.reportService ?? new ReportService(store);
  const monaiService = deps?.monaiService ?? new MonaiService(serviceRegistry);
  const dicomRouter = dicomwebRouter();

  // ── Multi-tenant services (initialized early so gateway + routes can use them) ──
  let jwtService: JwtService | undefined;
  let tenantStore: TenantScopedStore | undefined;

  if (env.MULTI_TENANT_ENABLED) {
    jwtService = new JwtService();
    tenantStore = new TenantScopedStore();
    logger.info({ message: "Multi-tenant mode ENABLED — all routes will support tenant isolation" });
  }

  // ── HIPAA Compliance: audit service ──
  const hipaaAuditService = new HipaaAuditService();
  logger.info({ message: "HIPAA compliance layer initialized — audit logging, session timeout, PHI tracking active" });

  app.set("trust proxy", 1);

  // ── Health (mounted before security middleware so container probes always work) ──
  app.use("/health", healthRouter(dicoogleService));

  // ── HIPAA: enforce HTTPS in production (§164.312(e)(1)) ──
  app.use(hipaaRequireHttps());

  securityMiddleware.forEach((middleware) => app.use(middleware));
  app.use(requestLogger);

  // ── HIPAA: PHI access audit logging (§164.312(b)) ──
  app.use(hipaaPhiAccessLogger(hipaaAuditService));

  // ── API Gateway: security controller between frontend and all backend routes ──
  app.use(apiGateway(jwtService));

  const isProduction = env.NODE_ENV === "production";

  app.use(
    session({
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: isProduction ? "none" : "lax",
        secure: isProduction,
        maxAge: 15 * 60 * 1000,
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // ── Session-based auth routes ──
  app.use("/auth", authRouter(store, hipaaAuditService));

  // ── Core application routes (all go through gateway + session auth) ──
  app.use("/", adminRouter(store, emailService));
  app.use("/templates", templatesRouter(store));
  app.use("/reports", reportsRouter({ store, reportService, storageService, speechService, emailService, pdfService }));
  app.use("/ai", aiRouter(monaiService, store));
  app.use("/", worklistRouter(store, dicoogleService, tenantStore));
  app.use("/webhook", webhookRouter(reportService, dicoogleService, monaiService, store as StoreService));
  app.use("/transcribe", transcribeRouter(speechService));
  app.use("/patients", patientsRouter(store));
  app.use("/orders", ordersRouter(store));
  app.use("/scans", scansRouter(store));
  app.use("/billing", billingRouter(store));
  app.use("/referring-physicians", referringPhysiciansRouter(store));
  app.use("/dicom", dicomUploadRouter(store, serviceRegistry, storageService, tenantStore, monaiService));
  app.use("/dicomweb/weasis/:accessToken", dicomRouter);
  app.use("/dicomweb", dicomRouter);
  app.use("/dicom-web/weasis/:accessToken", dicomRouter);
  app.use("/dicom-web", dicomRouter);
  app.use("/wado/weasis/:accessToken", dicomRouter);
  app.use("/wado", dicomRouter);
  app.use("/permissions", permissionsRouter(store));
  app.use("/", servicesRouter(serviceRegistry, store));

  // ── HIPAA compliance routes (audit log, emergency access, compliance dashboard) ──
  app.use("/hipaa", hipaaRouter(hipaaAuditService));

  // ── Multi-tenant API routes (v1 namespace) ──
  if (env.MULTI_TENANT_ENABLED && jwtService && tenantStore) {
    app.use("/api/v1/auth", tenantAuthRouter(tenantStore, jwtService));
    app.use("/api/v1/platform", tenantAdminRouter(tenantStore, jwtService));
    app.use("/api/v1/dicomweb", dicomwebMultiTenantRouter(jwtService, tenantStore));
    app.use("/api/v1", tenantAdminRouter(tenantStore, jwtService));
  }

  app.use(errorHandler);

  return { app, store };
}
