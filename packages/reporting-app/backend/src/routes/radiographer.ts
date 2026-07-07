import { Router } from "express";
import { z } from "zod";
import * as net from "net";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { StoreService } from "../services/store";

function testTcpConnection(ipAddress: string, port: number, timeoutMs = 2000): Promise<{ connected: boolean; message: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ connected: true, message: `Successfully connected to ${ipAddress}:${port}` });
      }
    });

    socket.on("timeout", () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ connected: false, message: `Connection to ${ipAddress}:${port} timed out` });
      }
    });

    socket.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ connected: false, message: `Failed to connect: ${err.message}` });
      }
    });

    socket.connect(port, ipAddress);
  });
}

const printerSchema = z.object({
  printerName: z.string().optional(),
  aeTitle: z.string().optional(),
  ipAddress: z.string().optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  filmSize: z.string().optional(),
  magnification: z.string().optional(),
});

const pacsSchema = z.object({
  aeTitle: z.string().optional(),
  ipAddress: z.string().optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
});

const scpSchema = z.object({
  aeTitle: z.string().optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  compression: z.string().optional(),
});

const settingsSchema = z.object({
  printer: printerSchema.default({}),
  pacs: pacsSchema.default({}),
  scpReceiver: scpSchema.default({}),
});

type RadiographerSettings = z.infer<typeof settingsSchema>;

let settings: RadiographerSettings = {
  printer: {
    printerName: "Film Printer",
    aeTitle: "TDAI_PRINT",
    ipAddress: "127.0.0.1",
    port: 104,
    filmSize: "14x17",
    magnification: "Replicate",
  },
  pacs: {
    aeTitle: "ORTHANC",
    ipAddress: "127.0.0.1",
    port: 4242,
  },
  scpReceiver: {
    aeTitle: "TDAI_SCP",
    port: 11112,
    compression: "None",
  },
};

export function radiographerRouter(store: StoreService): Router {
  const router = Router();

  router.get(
    "/settings",
    ensureAuthenticated,
    ensurePermission(store, "worklist:view"),
    asyncHandler(async (_req, res) => {
      res.json(settings);
    }),
  );

  router.put(
    "/settings",
    ensureAuthenticated,
    ensurePermission(store, "worklist:update_status"),
    asyncHandler(async (req, res) => {
      settings = settingsSchema.parse(req.body);
      res.json(settings);
    }),
  );

  router.post(
    "/settings/:target/test",
    ensureAuthenticated,
    ensurePermission(store, "worklist:view"),
    asyncHandler(async (req, res) => {
      const target = z.enum(["printer", "pacs", "scpReceiver"]).parse(req.params.target);
      const config = settings[target];
      const port = config.port;
      const ipAddress = "ipAddress" in config ? config.ipAddress : "127.0.0.1";

      if (!port) {
        res.json({
          target,
          connected: false,
          message: "Port is not configured",
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      const result = await testTcpConnection(ipAddress || "127.0.0.1", port);
      res.json({
        target,
        connected: result.connected,
        message: result.message,
        checkedAt: new Date().toISOString(),
      });
    }),
  );

  return router;
}
