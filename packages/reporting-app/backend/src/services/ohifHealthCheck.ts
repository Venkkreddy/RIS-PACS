import axios from "axios";
import { env } from "../config/env";
import { logger } from "./logger";

const CACHE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 2_000;

let cachedAvailable: boolean | null = null;
let lastCheckAt = 0;

function candidateProbeUrls(): string[] {
  return Array.from(new Set([env.OHIF_BASE_URL, env.OHIF_PUBLIC_BASE_URL].filter(Boolean)));
}

async function probe(): Promise<{ available: boolean; attemptedUrls: string[] }> {
  const attemptedUrls = candidateProbeUrls();
  for (const url of attemptedUrls) {
    try {
      await axios.get(url, { timeout: PROBE_TIMEOUT_MS, validateStatus: () => true });
      return { available: true, attemptedUrls };
    } catch {
      // try next candidate
    }
  }
  return { available: false, attemptedUrls };
}

export async function isOhifAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cachedAvailable !== null && now - lastCheckAt < CACHE_TTL_MS) {
    return cachedAvailable;
  }

  const { available, attemptedUrls } = await probe();
  cachedAvailable = available;
  lastCheckAt = now;

  if (!available) {
    logger.debug({
      message: `OHIF viewer not reachable at any configured URL — viewer links suppressed`,
      attemptedUrls,
    });
  }

  return available;
}

export function resetOhifCache(): void {
  cachedAvailable = null;
  lastCheckAt = 0;
}
