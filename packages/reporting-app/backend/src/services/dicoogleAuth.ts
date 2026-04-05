import axios from "axios";
import { env } from "../config/env";

let cachedToken: { token: string; ts: number } | null = null;
const TOKEN_TTL = 10 * 60 * 1000; // 10 minutes

async function loginToDicoogle(): Promise<string> {
  const response = await axios.post(
    `${env.DICOOGLE_BASE_URL}/login`,
    `username=${encodeURIComponent(env.DICOOGLE_USERNAME)}&password=${encodeURIComponent(env.DICOOGLE_PASSWORD)}`,
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
    },
  );
  const data = response.data as { token: string };
  return data.token;
}

export async function getDicoogleToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.ts < TOKEN_TTL) {
    return cachedToken.token;
  }
  const token = await loginToDicoogle();
  cachedToken = { token, ts: Date.now() };
  return token;
}

export async function getDicoogleAuthHeaders(): Promise<Record<string, string>> {
  const token = await getDicoogleToken();
  return { Authorization: `Bearer ${token}` };
}
