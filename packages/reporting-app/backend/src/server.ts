import { createApp } from "./app";
import { env } from "./config/env";
import { seedDevData } from "./config/seedDevData";
import { logger } from "./services/logger";

const { app, store } = createApp();

app.listen(env.PORT, () => {
  logger.info({ message: `Backend listening on port ${env.PORT}` });

  // Auto-seed sample data when using in-memory store (dev mode only)
  if (process.env.USE_INMEMORY_STORE === "true" && store && "upsertUser" in store) {
    seedDevData(store as Parameters<typeof seedDevData>[0]).catch((err) =>
      logger.error({ message: "Seed failed", error: String(err) }),
    );
  }
});
