import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { withSystemJobContext } from "../dbContext";
import { orgDeletionRequests, organizations } from "@shared/schema";
import { logError, logInfo } from "../utils/logger";
import { logAudit } from "../auditLogger";
import { sendEmail } from "../email";
import { objectStorageClient } from "../objectStorage";

// Tables that MUST be retained even after a hard delete. `org_deletion_requests`
// is the audit trail of the deletion itself; deleting it would erase the
// forensic record we just wrote. `superadmin_access_log` is platform-level
// audit. Add new platform-audit tables here if introduced.
const HARD_DELETE_TABLE_DENYLIST = new Set<string>([
  "org_deletion_requests",
  "superadmin_access_log",
  "audit_log",
]);

// Schema-driven discovery: every public table that owns an `organization_id`
// column is in scope for hard delete. This removes the brittle "allowlist
// drift" failure mode flagged in earlier review rounds — newly-added tenant
// tables are picked up automatically and tested via the residual-row check
// below, which fails the sweep if any org row remains anywhere.
async function listOrgScopedTables(): Promise<string[]> {
  const rows: any = await db.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
    ORDER BY table_name
  `);
  return (rows?.rows ?? rows ?? [])
    .map((r: any) => String(r.table_name))
    .filter((t: string) => !HARD_DELETE_TABLE_DENYLIST.has(t));
}

const PROJECT_BID_OWNER_TABLES = [
  { table: "projects", column: "gc_organization_id" },
  { table: "bids", column: "gc_organization_id" },
];

interface PerOrgFailure { step: string; error: string }

async function deleteObjectStoragePrefix(orgId: string, failures: PerOrgFailure[]): Promise<{ deleted: number }> {
  const privateDir = (process.env.PRIVATE_OBJECT_DIR ?? "").replace(/\/+$/, "");
  if (!privateDir) {
    failures.push({ step: "object_storage:env", error: "PRIVATE_OBJECT_DIR not set" });
    return { deleted: 0 };
  }
  // PRIVATE_OBJECT_DIR is `/<bucket>/<base>`; org files live under
  // `${PRIVATE_OBJECT_DIR}/${orgId}/...`. Compute bucket + prefix.
  const trimmed = privateDir.replace(/^\/+/, "");
  const slash = trimmed.indexOf("/");
  const bucketName = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const baseInBucket = slash === -1 ? "" : trimmed.slice(slash + 1);
  const prefix = baseInBucket ? `${baseInBucket}/${orgId}/` : `${orgId}/`;
  let deleted = 0;
  try {
    const bucket = objectStorageClient.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix });
    for (const f of files) {
      try {
        await f.delete({ ignoreNotFound: true });
        deleted += 1;
      } catch (e) {
        failures.push({ step: `object_storage:${f.name}`, error: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    failures.push({ step: "object_storage:list", error: e instanceof Error ? e.message : String(e) });
  }
  return { deleted };
}

export async function runOrgHardDeleteSweep(): Promise<{ swept: number; failed: number }> {
  // Task #2673 — sweep walks every org. `withSystemJobContext`
  // delegates to `runAsSuperadmin` so each run writes one
  // `superadmin_access_log` row before the cross-tenant query runs.
  return withSystemJobContext("orgHardDeleteSweep", async () => {
  const due = await db.select().from(orgDeletionRequests).where(
    and(
      eq(orgDeletionRequests.status, "SCHEDULED_HARD_DELETE"),
      lte(orgDeletionRequests.hardDeleteScheduledAt, new Date()),
    ),
  );

  let swept = 0;
  let failed = 0;

  for (const req of due) {
    const orgId = req.organizationId;
    const failures: PerOrgFailure[] = [];
    logInfo("[orgHardDelete] starting", { id: req.id, orgId });

    let scopedTables: string[] = [];
    try {
      scopedTables = await listOrgScopedTables();
    } catch (e) {
      failures.push({ step: "db:introspect", error: e instanceof Error ? e.message : String(e) });
    }
    for (const t of scopedTables) {
      try {
        await db.execute(sql`DELETE FROM ${sql.identifier(t)} WHERE organization_id = ${orgId}`);
      } catch (e) {
        failures.push({ step: `db:${t}`, error: e instanceof Error ? e.message : String(e) });
      }
    }

    for (const { table, column } of PROJECT_BID_OWNER_TABLES) {
      try {
        await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${orgId}`);
      } catch (e) {
        failures.push({ step: `db:${table}`, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Before deleting users, NULL out FK references on the deletion-request
    // row itself. `requested_by_id` is a non-null FK; `cancelled_by_id` is
    // nullable. Without this step the subsequent DELETE on `users` would
    // fail with a FK violation and the sweep would loop forever
    // (caught by the FK-graph review on round 4).
    try {
      await db.execute(sql`
        UPDATE org_deletion_requests
           SET requested_by_id = NULL, cancelled_by_id = NULL
         WHERE organization_id = ${orgId}
      `);
    } catch (e) {
      failures.push({ step: "db:detach_deletion_fk", error: e instanceof Error ? e.message : String(e) });
    }

    try {
      await db.execute(sql`DELETE FROM "users" WHERE organization_id = ${orgId}`);
    } catch (e) {
      failures.push({ step: "db:users", error: e instanceof Error ? e.message : String(e) });
    }

    const blob = await deleteObjectStoragePrefix(orgId ?? "", failures);

    try {
      await db.delete(organizations).where(eq(organizations.id, orgId ?? ""));
    } catch (e) {
      failures.push({ step: "db:organizations", error: e instanceof Error ? e.message : String(e) });
    }

    if (failures.length > 0) {
      failed += 1;
      // Leave status=SCHEDULED_HARD_DELETE so the next hourly sweep retries.
      // Audit each failure for forensic visibility / alerting.
      logError("[orgHardDelete] partial failure — leaving status=SCHEDULED_HARD_DELETE for retry", { id: req.id, orgId, failures }, new Error(`${failures.length} step(s) failed`));
      try {
        await logAudit({
          userId: req.requestedById ?? "system",
          entityType: "org_deletion_request",
          entityId: req.id,
          action: "DELETE",
          newValue: JSON.stringify({ orgId, status: "RETRYING", failures }),
        });
      } catch {/* noop */}
      continue;
    }

    try {
      await db.update(orgDeletionRequests)
        .set({ status: "COMPLETED", hardDeletedAt: new Date() })
        .where(eq(orgDeletionRequests.id, req.id));
      await logAudit({
        userId: req.requestedById ?? "system",
        entityType: "org_deletion_request",
        entityId: req.id,
        action: "DELETE",
        newValue: JSON.stringify({ orgId, blobsDeleted: blob.deleted, completedAt: new Date().toISOString() }),
      });
    } catch (e) {
      failed += 1;
      logError("[orgHardDelete] post-delete bookkeeping failed", { id: req.id }, e instanceof Error ? e : new Error(String(e)));
      continue;
    }

    if (req.confirmationSentTo) {
      try {
        await sendEmail({
          to: req.confirmationSentTo,
          subject: "Your SmartManageAI organization has been permanently deleted",
          text: `As scheduled, your SmartManageAI organization has now been permanently deleted (including ${blob.deleted} stored file(s)). If this was unexpected, please contact security@smartmanage.ai immediately.`,
          html: `<p>As scheduled, your SmartManageAI organization has now been permanently deleted (including <strong>${blob.deleted}</strong> stored file(s)).</p><p>If this was unexpected, please contact <a href="mailto:security@smartmanage.ai">security@smartmanage.ai</a> immediately.</p>`,
        });
      } catch (e) {
        logError("[orgHardDelete] notification email failed", { id: req.id }, e instanceof Error ? e : new Error(String(e)));
      }
    }

    swept += 1;
    logInfo("[orgHardDelete] completed", { id: req.id, orgId, blobsDeleted: blob.deleted });
  }

  return { swept, failed };
  });
}
