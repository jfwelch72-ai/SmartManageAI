import { db } from "../db";
import { uploadIntents } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { logError } from "../utils/logger";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { ObjectPermission } from "../objectAcl";

/**
 * Verify the caller's organization (and optionally user) is allowed to attach
 * `storageKey` as a document/source reference. This protects against a Task
 * #492 cross-tenant abuse where Org A could submit a `storageKey` belonging to
 * Org B's private upload prefix.
 *
 * Acceptance is granted when EITHER:
 *   - An `upload_intents` row exists with a matching `objectKey` whose
 *     `organizationId` is the caller's org (and, when `userId` is supplied,
 *     `uploadedById` matches the caller). This covers freshly-uploaded
 *     objects that may not yet have ACL metadata loaded.
 *   - The underlying object's stored ACL policy resolves to the caller's org
 *     via `canAccessObjectEntity` (READ permission is sufficient — we just
 *     need to confirm tenancy of the existing object).
 *
 * Throws a 403 (or 404 for missing objects) on rejection.
 */
export async function assertStorageKeyBelongsToOrg(
  storageKey: string,
  orgId: string,
  userId?: string,
  userRole?: string,
): Promise<void> {
  if (!storageKey || typeof storageKey !== "string") {
    throw Object.assign(new Error("storageKey required"), { status: 400 });
  }

  // Fast path: match an upload intent created by this org for this objectKey.
  // upload_intents stores the raw bucket-prefixed key (e.g. /bucket/orgId/uploads/uuid),
  // but callers usually pass the normalized "/objects/<orgId>/uploads/<uuid>"
  // form returned by the confirm endpoint. We try both representations.
  try {
    const candidates: string[] = [storageKey];
    const objectStorageService = new ObjectStorageService();
    try {
      const normalized = objectStorageService.normalizeObjectEntityPath(storageKey);
      if (normalized && normalized !== storageKey) candidates.push(normalized);
    } catch {
      // normalization is best-effort here
    }
    // Also try the un-normalized form: /objects/<entity> -> <privateDir>/<entity>
    if (storageKey.startsWith("/objects/")) {
      try {
        const privateDir = objectStorageService.getPrivateObjectDir();
        const entity = storageKey.slice("/objects/".length);
        const trimmed = privateDir.endsWith("/") ? privateDir.slice(0, -1) : privateDir;
        candidates.push(`${trimmed}/${entity}`);
      } catch {
        // PRIVATE_OBJECT_DIR may be unset in some test envs; ignore
      }
    }

    const conditions = [eq(uploadIntents.organizationId, orgId)];
    if (userId) conditions.push(eq(uploadIntents.uploadedById, userId));
    const [intent] = await db
      .select({ id: uploadIntents.id })
      .from(uploadIntents)
      .where(and(...conditions, inArray(uploadIntents.objectKey, candidates)))
      .limit(1);
    if (intent) return;
  } catch (err) {
    // Surface the failure with context so an actual schema/query bug is
    // visible in logs rather than silently downgrading to the slower ACL
    // path. We still fall through to the ACL check (which is a stricter
    // tenancy gate) so a transient lookup error cannot grant access on its
    // own.
    logError("upload_intent ownership lookup failed; falling back to ACL check", {
      error: err instanceof Error ? err.message : String(err),
      orgId,
    });
  }

  // Slow path: verify against the object's stored ACL policy.
  try {
    const objectStorageService = new ObjectStorageService();
    const normalized = objectStorageService.normalizeObjectEntityPath(storageKey);
    const objectFile = await objectStorageService.getObjectEntityFile(normalized);
    const ok = await objectStorageService.canAccessObjectEntity({
      userId,
      userOrganizationId: orgId,
      objectFile,
      requestedPermission: ObjectPermission.READ,
      userRole,
    });
    if (!ok) {
      throw Object.assign(new Error("Forbidden: storageKey does not belong to your organization"), { status: 403 });
    }
  } catch (err: any) {
    if (err?.status) throw err;
    if (err instanceof ObjectNotFoundError) {
      throw Object.assign(new Error("storageKey does not reference a known object"), { status: 404 });
    }
    logError("Failed to validate storageKey ownership", { error: String(err) });
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
}
