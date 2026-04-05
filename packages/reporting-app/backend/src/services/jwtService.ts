import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env";
import { getFirestore } from "./firebaseAdmin";

export interface TenantTokenPayload extends JwtPayload {
  sub: string;       // user ID
  tid: string;       // tenant ID
  email: string;
  role: string;
  tslug: string;     // tenant slug (for display/routing)
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export class JwtService {
  private readonly secret: string;
  private readonly issuer = "tdai-platform";

  constructor() {
    this.secret = env.JWT_SECRET;
    if (this.secret.length < 32) {
      throw new Error("JWT_SECRET must be at least 32 characters for HS256");
    }
  }

  private get db() {
    return getFirestore();
  }

  generateTokenPair(payload: {
    userId: string;
    tenantId: string;
    email: string;
    role: string;
    tenantSlug: string;
  }): TokenPair {
    const tokenPayload: Omit<TenantTokenPayload, "iat" | "exp" | "iss"> = {
      sub: payload.userId,
      tid: payload.tenantId,
      email: payload.email,
      role: payload.role,
      tslug: payload.tenantSlug,
    };

    const signOpts: SignOptions = { issuer: this.issuer, algorithm: "HS256" };

    const accessToken = jwt.sign(tokenPayload, this.secret, {
      ...signOpts,
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });

    const refreshToken = jwt.sign(
      { sub: payload.userId, tid: payload.tenantId, type: "refresh" },
      this.secret,
      { ...signOpts, expiresIn: REFRESH_TOKEN_EXPIRY },
    );

    return { accessToken, refreshToken, expiresIn: 900 };
  }

  verifyAccessToken(token: string): TenantTokenPayload {
    const decoded = jwt.verify(token, this.secret, {
      issuer: this.issuer,
      algorithms: ["HS256"],
    }) as TenantTokenPayload;

    if (!decoded.sub || !decoded.tid) {
      throw new Error("Invalid token payload: missing sub or tid");
    }

    return decoded;
  }

  verifyRefreshToken(token: string): { sub: string; tid: string } {
    const decoded = jwt.verify(token, this.secret, {
      issuer: this.issuer,
      algorithms: ["HS256"],
    }) as JwtPayload & { type?: string; tid?: string };

    if (decoded.type !== "refresh" || !decoded.sub || !decoded.tid) {
      throw new Error("Invalid refresh token");
    }

    return { sub: decoded.sub, tid: decoded.tid };
  }

  async storeRefreshToken(tenantId: string, userId: string, token: string): Promise<void> {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS).toISOString();

    await this.db.collection("refresh_tokens").doc(hash).set({
      tenant_id: tenantId,
      user_id: userId,
      token_hash: hash,
      revoked: false,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });
  }

  async validateRefreshToken(tenantId: string, userId: string, token: string): Promise<boolean> {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const doc = await this.db.collection("refresh_tokens").doc(hash).get();

    if (!doc.exists) return false;
    const data = doc.data()!;
    return (
      data.tenant_id === tenantId &&
      data.user_id === userId &&
      data.revoked === false &&
      new Date(data.expires_at) > new Date()
    );
  }

  async revokeRefreshToken(tenantId: string, token: string): Promise<void> {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const doc = await this.db.collection("refresh_tokens").doc(hash).get();

    if (doc.exists && doc.data()?.tenant_id === tenantId) {
      await doc.ref.update({ revoked: true });
    }
  }

  async revokeAllUserTokens(tenantId: string, userId: string): Promise<void> {
    const snapshot = await this.db
      .collection("refresh_tokens")
      .where("tenant_id", "==", tenantId)
      .where("user_id", "==", userId)
      .where("revoked", "==", false)
      .get();

    const batch = this.db.batch();
    snapshot.docs.forEach((doc) => batch.update(doc.ref, { revoked: true }));
    await batch.commit();
  }

  async cleanupExpiredTokens(): Promise<void> {
    const now = new Date().toISOString();
    const expiredSnapshot = await this.db
      .collection("refresh_tokens")
      .where("expires_at", "<", now)
      .get();

    const revokedSnapshot = await this.db
      .collection("refresh_tokens")
      .where("revoked", "==", true)
      .get();

    const batch = this.db.batch();
    expiredSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    revokedSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}
