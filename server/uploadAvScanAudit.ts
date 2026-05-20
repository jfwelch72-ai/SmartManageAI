// prompt-injection-guard: no LLM calls in this file; AV-scan audit helper only
import { logError } from "./utils/logger";
import { logAudit } from "./auditLogger";
import { getCorrelationId } from "./middleware/correlationId";
import { ObjectStorageService } from "./objectStorage";
import type { AuthRequest } from "./auth";

/**
 * Record every upload AV-scan outcome in the audit_log and, when the verdict
 * is "blocked", physically quarantine the offending object by deleting it from
 * GCS.
 *
 * Both the single-shot (`/api/objects/confirm`), multipart
 * (`/api/objects/multipart/:uploadId/complete`), and support-attachment upload
 * paths funnel through this helper so we get a tamper-evident trail of:
 *   - who triggered the scan and from which org,
 *   - which object was scanned (path + content-type + size),
 *   - which scanner was active and what verdict it returned,
 *   - the request correlation id (`x-request-id`) so the audit row can be
 *     cross-referenced with structured logs / Sentry.
 *
 * For "blocked" verdicts the GCS object is deleted **before** the audit row is
 * written. This ensures that a transient DB error in `logAudit` cannot leave an
 * infected blob reachable in storage — the quarantine is always attempted
 * first. Delete failures are logged and swallowed (best-effort quarantine) so
 * that the audit write still proceeds.
 *
 * @param args.entityId  - The opaque ID stored as `entityId` in the audit_log
 *   row (typically an upload-intent ID or a file UUID).
 * @param args.route     - A short label identifying the upload entry point
 *   (e.g. "confirm", "multipart_complete", "support_attachment").
 */
export async function recordUploadScanAudit(args: {
  userId: string;
  entityId: string;
  objectKey: string;
  contentType: string | null;
  sizeBytes: number | null;
  organizationId: string | null;
  scanResult: { status: "clean" | "blocked" | "skipped"; reason?: string; scannerId?: string };
  route: string;
  req: AuthRequest;
}): Promise<void> {
  const { userId, entityId, objectKey, contentType, sizeBytes, organizationId, scanResult, route, req } = args;
  const correlationId = getCorrelationId() ?? null;

  if (scanResult.status === "blocked") {
    try {
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.deleteObjectByKey(objectKey);
    } catch (err) {
      logError(
        "[upload-av] Failed to quarantine (delete) infected object",
        { objectKey, entityId, correlationId },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  const action = scanResult.status === "blocked" ? "REJECT" : "APPROVE";
  const payload = {
    op: "upload_av_scan",
    route,
    status: scanResult.status,
    reason: scanResult.reason ?? null,
    scannerId: scanResult.scannerId ?? null,
    objectKey,
    contentType,
    sizeBytes,
    organizationId,
    correlationId,
  };

  await logAudit(
    {
      userId,
      entityType: "upload_av_scan",
      entityId,
      action,
      oldValue: null,
      newValue: JSON.stringify(payload),
    },
    req,
  );
}
