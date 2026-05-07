import { db } from "../db";
import { eq } from "drizzle-orm";
import { organizations, DEFAULT_ORG_STORAGE_QUOTA_BYTES, MIN_ORG_STORAGE_QUOTA_BYTES, MAX_ORG_STORAGE_QUOTA_BYTES, ORG_STORAGE_QUOTA_WARNING_THRESHOLD } from "@shared/schema";
import { ObjectStorageService, objectStorageClient } from "../objectStorage";
import { logError } from "./logger";
import {
  recordStorageSnapshot,
  checkQuota as checkBillingQuota,
  reportMeteredOverage,
} from "../services/billing/usageMetering";

/**
 * Task #1955 — per-organization object-storage quota helpers.
 *
 * The website builder image library (`POST /api/website/upload-image`) and
 * the social-media post media uploader (`POST /api/social/upload-media`,
 * `POST /api/social/posts/generate-image`) both write into the shared
 * `gallery/<orgId>/` prefix on Replit Object Storage. The original 3 GB
 * hard cap that lived inside those routes was removed earlier so users
 * weren't blocked, but with effectively-unlimited per-file caps an org
 * could now upload tens or hundreds of GB without any guardrail.
 *
 * This module centralises the quota policy:
 *   - `getOrgStorageQuotaBytes` reads the per-org override with a fallback
 *     to the package-wide 100 GB default.
 *   - `getOrgStorageUsageBytes` sums every object under the org's gallery
 *     prefix (the same scope we list in the Media Library so the number
 *     matches what users see).
 *   - `assertWithinStorageQuota` is the single enforcement gate the
 *     upload routes call before persisting bytes; it throws a
 *     `StorageQuotaExceededError` carrying the exact numbers we surface
 *     in the 413 response so the UI can show "X of Y GB used".
 */

const objectStorage = new ObjectStorageService();

export interface OrgStorageUsage {
  usageBytes: number;
  quotaBytes: number;
  remainingBytes: number;
  percentUsed: number;
}

export class StorageQuotaExceededError extends Error {
  readonly code = "STORAGE_QUOTA_EXCEEDED" as const;
  readonly httpStatus = 413 as const;
  readonly currentUsageBytes: number;
  readonly quotaBytes: number;
  readonly attemptedBytes: number;

  constructor(args: { currentUsageBytes: number; quotaBytes: number; attemptedBytes: number }) {
    super(
      `Organization storage quota exceeded (used ${args.currentUsageBytes} bytes + attempted ${args.attemptedBytes} bytes > quota ${args.quotaBytes} bytes)`,
    );
    this.name = "StorageQuotaExceededError";
    this.currentUsageBytes = args.currentUsageBytes;
    this.quotaBytes = args.quotaBytes;
    this.attemptedBytes = args.attemptedBytes;
  }
}

export function clampStorageQuotaBytes(input: number): number {
  if (!Number.isFinite(input)) return DEFAULT_ORG_STORAGE_QUOTA_BYTES;
  const rounded = Math.floor(input);
  if (rounded < MIN_ORG_STORAGE_QUOTA_BYTES) return MIN_ORG_STORAGE_QUOTA_BYTES;
  if (rounded > MAX_ORG_STORAGE_QUOTA_BYTES) return MAX_ORG_STORAGE_QUOTA_BYTES;
  return rounded;
}

export async function getOrgStorageQuotaBytes(orgId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ quota: organizations.storageQuotaBytes })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!row || row.quota == null) return DEFAULT_ORG_STORAGE_QUOTA_BYTES;
    const value = typeof row.quota === "string" ? Number(row.quota) : row.quota;
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_ORG_STORAGE_QUOTA_BYTES;
    return value;
  } catch (err) {
    // Don't fail the upload if the lookup itself blows up — fall back to
    // the package default so the gate still catches obviously-runaway
    // tenants. The error is logged so platform-ops can investigate.
    logError(
      "[storage-quota] Failed to read per-org quota; falling back to default",
      { orgId },
      err instanceof Error ? err : new Error(String(err)),
    );
    return DEFAULT_ORG_STORAGE_QUOTA_BYTES;
  }
}

export async function getOrgStorageUsageBytes(orgId: string): Promise<number> {
  const publicPaths = objectStorage.getPublicObjectSearchPaths();
  if (publicPaths.length === 0) return 0;

  const basePath = publicPaths[0];
  const prefix = `gallery/${orgId}/`;
  const pathParts = basePath.split("/").filter((p) => p.length > 0);
  const bucketName = pathParts[0];
  const bucketPrefix = pathParts.length > 1 ? pathParts.slice(1).join("/") + "/" + prefix : prefix;

  const bucket = objectStorageClient.bucket(bucketName);
  const [files] = await bucket.getFiles({ prefix: bucketPrefix });

  let total = 0;
  for (const f of files) {
    // The list response carries metadata.size for each object so we don't
    // need to fan out N additional getMetadata() requests.
    const sz = (f.metadata as { size?: string | number } | undefined)?.size;
    if (sz != null) {
      const n = typeof sz === "string" ? parseInt(sz, 10) : sz;
      if (Number.isFinite(n)) total += n;
    }
  }
  return total;
}

export async function getOrgStorageUsage(orgId: string): Promise<OrgStorageUsage> {
  const [usageBytes, quotaBytes] = await Promise.all([
    getOrgStorageUsageBytes(orgId),
    getOrgStorageQuotaBytes(orgId),
  ]);
  const remainingBytes = Math.max(0, quotaBytes - usageBytes);
  const percentUsed = quotaBytes > 0 ? Math.min(1, usageBytes / quotaBytes) : 0;
  return { usageBytes, quotaBytes, remainingBytes, percentUsed };
}

export async function assertWithinStorageQuota(
  orgId: string,
  attemptedBytes: number,
): Promise<OrgStorageUsage> {
  const usage = await getOrgStorageUsage(orgId);
  if (attemptedBytes < 0) attemptedBytes = 0;
  if (usage.usageBytes + attemptedBytes > usage.quotaBytes) {
    throw new StorageQuotaExceededError({
      currentUsageBytes: usage.usageBytes,
      quotaBytes: usage.quotaBytes,
      attemptedBytes,
    });
  }
  // Task #2482 — plan-tier storage quota decision. Run synchronously
  // BEFORE persisting bytes so we can hard-block the upload when the
  // org is over its plan storage limit AND no metered Stripe price
  // is configured. checkQuota returns allowed=true when the org is
  // under plan, or over plan but billed via Stripe metered storage —
  // in either case the upload proceeds and we emit the overage units
  // (when applicable). allowed=false means block.
  const projected = usage.usageBytes + attemptedBytes;
  let check;
  try {
    check = await checkBillingQuota(orgId, "storage_bytes", attemptedBytes);
  } catch (err) {
    // Don't block uploads on a billing-DB outage; we already passed
    // the per-org hard cap. Log and proceed.
    logError(
      "[storage-quota] Plan-tier quota check failed (proceeding on hard cap only)",
      { orgId },
      err instanceof Error ? err : new Error(String(err)),
    );
    return usage;
  }
  if (!check.allowed) {
    throw new StorageQuotaExceededError({
      currentUsageBytes: usage.usageBytes,
      quotaBytes: check.limit,
      attemptedBytes,
    });
  }
  // Snapshot + Stripe overage emission can run async — they don't
  // gate the upload, only update the dashboard and push billing units.
  void (async () => {
    try {
      await recordStorageSnapshot(orgId, projected);
      if (check.billedToStripe && check.overage > 0) {
        await reportMeteredOverage(orgId, "storage_bytes", Math.min(attemptedBytes, check.overage));
      }
    } catch (err) {
      logError(
        "[storage-quota] Failed to record/bill storage usage (non-blocking)",
        { orgId, projected },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  })();
  return usage;
}

export function setOrgStorageQuota(orgId: string, quotaBytes: number): Promise<void> {
  const clamped = clampStorageQuotaBytes(quotaBytes);
  return db
    .update(organizations)
    .set({ storageQuotaBytes: clamped, updatedAt: new Date() })
    .where(eq(organizations.id, orgId))
    .then(() => undefined);
}

export function isStorageQuotaExceededError(err: unknown): err is StorageQuotaExceededError {
  return err instanceof StorageQuotaExceededError;
}

export function storageQuotaWarningThreshold(): number {
  return ORG_STORAGE_QUOTA_WARNING_THRESHOLD;
}

// Re-exported for routes that want to surface the same defaults to the UI
// without re-importing the schema module.
export { DEFAULT_ORG_STORAGE_QUOTA_BYTES, MIN_ORG_STORAGE_QUOTA_BYTES, MAX_ORG_STORAGE_QUOTA_BYTES };
