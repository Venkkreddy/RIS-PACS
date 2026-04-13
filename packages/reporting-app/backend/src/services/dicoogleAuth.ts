import axios from "axios";
import { env } from "../config/env";
import { logger } from "./logger";

let cachedToken: { token: string; ts: number } | null = null;
const TOKEN_TTL = 10 * 60 * 1000; // 10 minutes

async function loginToDicoogle(): Promise<string> {
  const baseUrl = env.DICOOGLE_BASE_URL;
  const username = env.DICOOGLE_USERNAME;
  const password = env.DICOOGLE_PASSWORD;

  // Attempt 1: form-urlencoded POST (Dicoogle 3.x default)
  try {
    const response = await axios.post(
      `${baseUrl}/login`,
      `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000,
      },
    );
    const data = response.data as { token?: string; user?: string };
    if (data.token) return data.token;
  } catch (err) {
    logger.warn({
      message: "Dicoogle form login failed, trying JSON login",
      error: err instanceof Error ? err.message : String(err),
      baseUrl,
    });
  }

  // Attempt 2: JSON POST (some Dicoogle builds accept JSON)
  try {
    const response = await axios.post(
      `${baseUrl}/login`,
      { username, password },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      },
    );
    const data = response.data as { token?: string };
    if (data.token) return data.token;
  } catch (err) {
    logger.warn({
      message: "Dicoogle JSON login also failed",
      error: err instanceof Error ? err.message : String(err),
      baseUrl,
    });
  }

  throw new Error(`All Dicoogle login methods failed for ${baseUrl}`);
}

export async function getDicoogleToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.ts < TOKEN_TTL) {
    return cachedToken.token;
  }
  const token = await loginToDicoogle();
  cachedToken = { token, ts: Date.now() };
  return token;
}

/** Invalidate cached token so next call re-authenticates. */
export function clearDicoogleTokenCache(): void {
  cachedToken = null;
}

export async function getDicoogleAuthHeaders(): Promise<Record<string, string>> {
  try {
    const token = await getDicoogleToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    // Fall back to HTTP Basic Auth so DIM queries still work
    const basic = Buffer.from(
      `${env.DICOOGLE_USERNAME}:${env.DICOOGLE_PASSWORD}`,
    ).toString("base64");
    return { Authorization: `Basic ${basic}` };
  }
}
