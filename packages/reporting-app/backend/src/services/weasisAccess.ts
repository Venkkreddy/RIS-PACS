import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../config/env";

const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;

interface WeasisAccessPayload {
  studyUID: string;
  exp: number;
  tenantSlug?: string;
}

function signTokenPayload(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}

export function createWeasisAccessToken(
  studyUID: string,
  ttlMs = DEFAULT_TOKEN_TTL_MS,
  tenantSlug?: string,
): string {
  const payloadObj: WeasisAccessPayload = {
    studyUID,
    exp: Date.now() + ttlMs,
  };
  if (tenantSlug) payloadObj.tenantSlug = tenantSlug;

  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  return `${payload}.${signTokenPayload(payload)}`;
}

export interface WeasisTokenResult {
  valid: boolean;
  studyUID?: string;
  tenantSlug?: string;
}

/**
 * Verify a Weasis access token. If `studyUID` is provided, it must match the
 * token's studyUID. If omitted, the token is validated by signature and expiry
 * only and the embedded studyUID is returned so callers can scope access.
 */
export function verifyWeasisAccessToken(token: string, studyUID?: string | null): WeasisTokenResult {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return { valid: false };

  const expectedSignature = signTokenPayload(payload);
  const actualSignatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  if (actualSignatureBuffer.length !== expectedSignatureBuffer.length) return { valid: false };
  if (!timingSafeEqual(actualSignatureBuffer, expectedSignatureBuffer)) return { valid: false };

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<WeasisAccessPayload>;
    if (typeof decoded.exp !== "number" || decoded.exp <= Date.now()) {
      return { valid: false };
    }
    if (!decoded.studyUID) {
      return { valid: false };
    }
    if (studyUID && decoded.studyUID !== studyUID) {
      return { valid: false };
    }
    return { valid: true, studyUID: decoded.studyUID, tenantSlug: decoded.tenantSlug };
  } catch {
    return { valid: false };
  }
}
