import crypto from "crypto";
import { db } from "../db";
import { integrationApiKeys, integrationApiRequestLog, type IntegrationApiKey, PUBLIC_API_SCOPES, type PublicApiScope } from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";

const KEY_PREFIX = "ckp_";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export interface IssuedApiKey {
  id: string;
  name: string;
  scopes: string[];
  prefix: string;
  fullKey: string;
  createdAt: Date;
}

export async function issueApiKey(
  orgId: string,
  userId: string,
  name: string,
  scopes: string[],
  options: { rateLimitPerMinute?: number; expiresAt?: Date } = {},
): Promise<IssuedApiKey> {
  for (const scope of scopes) {
    if (!(PUBLIC_API_SCOPES as readonly string[]).includes(scope)) {
      throw new Error(`Unknown scope: ${scope}`);
    }
  }
  const secret = crypto.randomBytes(32).toString("base64url");
  const prefix = KEY_PREFIX + crypto.randomBytes(4).toString("hex");
  const fullKey = `${prefix}.${secret}`;
  const keyHash = hashKey(fullKey);

  const [row] = await db.insert(integrationApiKeys).values({
    organizationId: orgId,
    name,
    prefix,
    keyHash,
    scopes,
    rateLimitPerMinute: options.rateLimitPerMinute ?? 120,
    expiresAt: options.expiresAt ?? null,
    createdByUserId: userId,
  }).returning();

  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes as string[],
    prefix: row.prefix,
    fullKey,
    createdAt: row.createdAt,
  };
}

export async function listApiKeys(orgId: string) {
  const rows = await db.select().from(integrationApiKeys)
    .where(eq(integrationApiKeys.organizationId, orgId))
    .orderBy(desc(integrationApiKeys.createdAt));
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes as string[],
    rateLimitPerMinute: r.rateLimitPerMinute,
    isActive: r.isActive,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    createdAt: r.createdAt,
  }));
}

export async function revokeApiKey(orgId: string, id: string) {
  const [row] = await db.update(integrationApiKeys)
    .set({ isActive: false, revokedAt: new Date() })
    .where(and(eq(integrationApiKeys.id, id), eq(integrationApiKeys.organizationId, orgId)))
    .returning();
  return row || null;
}

export async function authenticateApiKey(rawKey: string): Promise<IntegrationApiKey | null> {
  if (!rawKey || !rawKey.includes(".")) return null;
  const [prefix] = rawKey.split(".");
  if (!prefix.startsWith(KEY_PREFIX)) return null;
  // Multiple rows may share a prefix (8 hex chars = 32 bits) at scale; iterate and
  // verify every active candidate via timing-safe full-hash comparison.
  const rows = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.prefix, prefix));
  const provided = Buffer.from(hashKey(rawKey), "hex");
  const now = new Date();
  for (const row of rows) {
    if (!row.isActive) continue;
    if (row.expiresAt && row.expiresAt < now) continue;
    const expected = Buffer.from(row.keyHash, "hex");
    if (expected.length !== provided.length) continue;
    if (!crypto.timingSafeEqual(expected, provided)) continue;
    db.update(integrationApiKeys).set({ lastUsedAt: now }).where(eq(integrationApiKeys.id, row.id)).catch(() => {});
    return row;
  }
  return null;
}

export function hasScope(key: IntegrationApiKey, required: PublicApiScope): boolean {
  const scopes = (key.scopes as string[]) || [];
  return scopes.includes(required);
}

export async function logApiRequest(params: {
  orgId: string;
  apiKeyId?: string | null;
  method: string;
  path: string;
  statusCode: number;
  durationMs?: number;
  scopeUsed?: string;
  errorMessage?: string;
  ip?: string;
}) {
  try {
    await db.insert(integrationApiRequestLog).values({
      organizationId: params.orgId,
      apiKeyId: params.apiKeyId || null,
      method: params.method,
      path: params.path,
      statusCode: params.statusCode,
      durationMs: params.durationMs,
      scopeUsed: params.scopeUsed,
      errorMessage: params.errorMessage,
      ip: params.ip,
    });
  } catch {
    // Don't break the request on log failure.
  }
}

export async function getRequestLog(orgId: string, limit = 200) {
  return db.select().from(integrationApiRequestLog)
    .where(eq(integrationApiRequestLog.organizationId, orgId))
    .orderBy(desc(integrationApiRequestLog.createdAt))
    .limit(limit);
}
