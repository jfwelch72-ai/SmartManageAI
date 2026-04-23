// Task #1344: org-admin fan-out for Davis-Bacon wage decision problems.
//
// Two related concerns are handled here so the throttling/dedup logic lives
// in one module:
//
//   1. notifyOrgAdminsOfWageDecisionSyncFailure — called when a manual
//      `POST /api/payroll/wage-decisions/sync` request fails (and from the
//      fire-and-forget background sync path) so every org admin sees the
//      failure in-app and via email instead of relying on the connection
//      owner being awake / paying attention.
//
//   2. processMissingWageDecisionReminders — daily job that fans out a
//      reminder to org admins for any project whose wage decision has been
//      missing from the Davis-Bacon cache for more than 24h. Throttled to
//      no more than one reminder per project per calendar week using the
//      `notifications` table as the cadence store (no extra schema needed).

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  notifications,
  projects,
  users,
  integrationSyncState,
  type InsertNotification,
} from "@shared/schema";
import { insertNotification } from "./notificationService";
import { isWageDeterminationCached } from "../integrations/providers/dol_davis_bacon/sync";
import { logError, logInfo, logWarn } from "../utils/logger";

const ADMIN_ROLES = ["ADMIN"] as const;

const REMINDER_THROTTLE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
const MISSING_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getOrgAdminUserIds(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        inArray(users.role, ADMIN_ROLES as unknown as string[]),
        eq(users.isActive, true),
      ),
    );
  return rows.map((r) => r.id);
}

export interface NotifyAdminsOfFailureArgs {
  organizationId: string;
  decisionNumber: string;
  errorMessage: string;
  /** Optional: skip this user when fanning out (e.g. the connection owner
   * who already received a tailored notification via the existing path) so
   * they don't get a duplicate in-app + email. */
  excludeUserId?: string | null;
  source: "manual_sync" | "background_sync";
}

/**
 * Fan an in-app + email notification of a Davis-Bacon wage decision sync
 * failure out to every active org admin. Reuses the existing
 * `DAVIS_BACON_AUTO_SYNC_FAILED` notification type so the email template,
 * settings page section, and one-click mute link from Task #1361 all apply.
 */
export async function notifyOrgAdminsOfWageDecisionSyncFailure(
  args: NotifyAdminsOfFailureArgs,
): Promise<{ recipients: number }> {
  const adminIds = await getOrgAdminUserIds(args.organizationId);
  const targets = adminIds.filter(
    (id) => !args.excludeUserId || id !== args.excludeUserId,
  );
  if (targets.length === 0) {
    logInfo("No active org admins to notify of Davis-Bacon sync failure", {
      organizationId: args.organizationId,
      decisionNumber: args.decisionNumber,
      source: args.source,
    });
    return { recipients: 0 };
  }

  const trimmed = args.errorMessage.slice(0, 300);
  const sourceLabel =
    args.source === "manual_sync" ? "Manual sync attempt" : "Automatic background sync";

  for (const userId of targets) {
    try {
      await insertNotification({
        userId,
        organizationId: args.organizationId,
        type: "DAVIS_BACON_AUTO_SYNC_FAILED",
        title: "Davis-Bacon wage decision sync failed",
        message:
          `${sourceLabel} failed for wage decision ${args.decisionNumber}: ` +
          `${trimmed}. Open the Integrations page to retry or update credentials.`,
        relatedEntityId: null,
        relatedEntityType: "INTEGRATION_CONNECTION",
      } as InsertNotification);
    } catch (err) {
      logError(
        "Failed to deliver Davis-Bacon admin failure notification",
        {
          organizationId: args.organizationId,
          decisionNumber: args.decisionNumber,
          userId,
        },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
  return { recipients: targets.length };
}

export interface MissingReminderRunResult {
  candidateProjects: number;
  remindersSent: number;
  recipientsNotified: number;
  throttledProjects: number;
}

/**
 * Daily reminder sweep. Picks up every project whose `wageDecision` is set
 * but not present in the Davis-Bacon cache, and whose
 * `projects.createdAt` (a stable lower bound on when the decision could
 * have been imported) is older than 24h. For each such project, fans a
 * `WAGE_DECISION_MISSING_REMINDER` notification out to every active org
 * admin — provided no reminder for the same project has already gone out
 * within the last 7 days.
 */
export async function processMissingWageDecisionReminders(
  now: Date = new Date(),
): Promise<MissingReminderRunResult> {
  const cutoff = new Date(now.getTime() - MISSING_THRESHOLD_MS);

  // Same candidate set as `GET /api/payroll/missing-wage-decisions`:
  // every project with a wage decision set and a GC org assigned. We
  // then filter to those whose missing-state has been unresolved for
  // more than 24h.
  //
  // "First noticed missing at" is computed via a LEFT JOIN to
  // integration_sync_state on `wage_determination:<decisionNumber>` —
  // when the project's wage decision has been queued for sync (the
  // common path, written by queueWageDecisionSync from
  // projectCrudRoutes/laborRateRoutes), we use the sync_state row's
  // created_at so changing the wage decision resets the 24h clock.
  // When no sync_state row exists yet (e.g. the org has no Davis-Bacon
  // connection, or the queue never ran), we fall back to
  // `projects.updatedAt` — the most recent moment the wage decision
  // *could* have been set/changed — so projects shown by the missing
  // endpoint still get reminders even when the queue never wrote a
  // sync_state row.
  //
  // Projects link to an organization via `gcOrganizationId` (the GC org
  // the project belongs to) — this is the canonical org filter used
  // across the rest of the codebase (overheadRoutes, takeoffSheetRoutes,
  // profitabilityAlertRoutes, etc.). Projects with no GC org are skipped
  // because there's no admin audience to notify.
  const candidates = await db
    .select({
      id: projects.id,
      name: projects.name,
      organizationId: projects.gcOrganizationId,
      wageDecision: projects.wageDecision,
      firstMissingAt: sql<Date>`COALESCE(${integrationSyncState.createdAt}, ${projects.updatedAt})`,
    })
    .from(projects)
    .leftJoin(
      integrationSyncState,
      and(
        eq(integrationSyncState.organizationId, projects.gcOrganizationId),
        sql`${integrationSyncState.entityType} = 'wage_determination:' || trim(${projects.wageDecision})`,
      ),
    )
    .where(
      sql`${projects.wageDecision} IS NOT NULL
          AND length(trim(${projects.wageDecision})) > 0
          AND ${projects.gcOrganizationId} IS NOT NULL
          AND COALESCE(${integrationSyncState.createdAt}, ${projects.updatedAt}) < ${cutoff}`,
    );

  if (candidates.length === 0) {
    return {
      candidateProjects: 0,
      remindersSent: 0,
      recipientsNotified: 0,
      throttledProjects: 0,
    };
  }

  // Dedupe cache lookups per (org, decision) — many projects in an org
  // typically share a small number of distinct wage decisions.
  type Key = string;
  const cacheKey = (orgId: string, decision: string): Key => `${orgId}::${decision}`;
  const cacheStatus = new Map<Key, boolean>();
  await Promise.all(
    Array.from(
      new Set(
        candidates.map((p) =>
          cacheKey(p.organizationId, (p.wageDecision || "").trim()),
        ),
      ),
    ).map(async (key) => {
      const [orgId, decision] = key.split("::");
      try {
        cacheStatus.set(key, await isWageDeterminationCached(orgId, decision));
      } catch (err) {
        // On lookup error, assume cached so we don't blast spurious reminders.
        logWarn("Davis-Bacon cache check failed in reminder sweep", {
          orgId,
          decision,
          error: String(err),
        });
        cacheStatus.set(key, true);
      }
    }),
  );

  // Group missing projects by org so admin lookup happens once per org.
  const missingByOrg = new Map<
    string,
    Array<{ id: string; name: string; wageDecision: string }>
  >();
  for (const p of candidates) {
    const decision = (p.wageDecision || "").trim();
    if (!decision) continue;
    const cached = cacheStatus.get(cacheKey(p.organizationId, decision));
    if (cached !== false) continue;
    const list = missingByOrg.get(p.organizationId) ?? [];
    list.push({ id: p.id, name: p.name || "", wageDecision: decision });
    missingByOrg.set(p.organizationId, list);
  }

  const throttleCutoff = new Date(now.getTime() - REMINDER_THROTTLE_MS);
  let candidateProjects = 0;
  let remindersSent = 0;
  let recipientsNotified = 0;
  let throttledProjects = 0;

  for (const [orgId, items] of missingByOrg) {
    candidateProjects += items.length;
    const adminIds = await getOrgAdminUserIds(orgId);
    if (adminIds.length === 0) {
      logInfo("Skipping wage decision reminders — org has no active admins", {
        organizationId: orgId,
        projectCount: items.length,
      });
      continue;
    }

    for (const item of items) {
      // Throttle: skip if any reminder for this project went out within
      // the last 7 days. Single query against the indexed createdAt column.
      const [recent] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.type, "WAGE_DECISION_MISSING_REMINDER"),
            eq(notifications.relatedEntityId, item.id),
            sql`${notifications.createdAt} > ${throttleCutoff}`,
          ),
        )
        .limit(1);
      if (recent) {
        throttledProjects += 1;
        continue;
      }

      const title = "Wage decision still missing — certified payroll at risk";
      const message =
        `Davis-Bacon wage decision ${item.wageDecision} for project ` +
        `"${item.name}" has been missing for more than 24 hours. Run the ` +
        `Davis-Bacon import from the Integrations page, or open Payroll to ` +
        `retry the sync before your next certified payroll deadline.`;

      let delivered = 0;
      for (const userId of adminIds) {
        try {
          await insertNotification({
            userId,
            organizationId: orgId,
            type: "WAGE_DECISION_MISSING_REMINDER",
            title,
            message,
            relatedEntityId: item.id,
            relatedEntityType: "PROJECT",
          } as InsertNotification);
          delivered += 1;
        } catch (err) {
          logError(
            "Failed to deliver wage decision missing reminder",
            {
              organizationId: orgId,
              projectId: item.id,
              userId,
            },
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }
      if (delivered > 0) {
        remindersSent += 1;
        recipientsNotified += delivered;
      }
    }
  }

  if (remindersSent > 0) {
    logInfo("Wage decision missing reminder sweep", {
      candidateProjects,
      remindersSent,
      recipientsNotified,
      throttledProjects,
    });
  }

  return { candidateProjects, remindersSent, recipientsNotified, throttledProjects };
}

// Test-only helper for predictable cleanup in unit tests.
export async function __getMostRecentReminderForTest(projectId: string) {
  const [row] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "WAGE_DECISION_MISSING_REMINDER"),
        eq(notifications.relatedEntityId, projectId),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(1);
  return row;
}
