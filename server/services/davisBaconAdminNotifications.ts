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
import { isWageDeterminationCached, type DavisBaconWageRate } from "../integrations/providers/dol_davis_bacon/sync";
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

// Task #1400 — diff cached vs freshly-imported wage determination rates.
//
// Two payloads are considered "different" when, for any classification:
//   - the classification appears only on one side (added or removed), or
//   - any of baseRate/fringeRate/totalRate differ by more than 0.005 (i.e.
//     a real cent-level change rather than float jitter).
//
// Returns null when the payloads are equivalent so the caller can skip
// the notification fan-out on no-op refreshes.
export interface WageRateDiffEntry {
  classification: string;
  kind: "added" | "removed" | "changed";
  oldBaseRate?: number;
  newBaseRate?: number;
  oldFringeRate?: number;
  newFringeRate?: number;
  oldTotalRate?: number;
  newTotalRate?: number;
}

export interface WageRateDiff {
  changes: WageRateDiffEntry[];
}

const RATE_EPSILON = 0.005;

function normalizeKey(s: string): string {
  return s.trim().toLowerCase();
}

export function diffWageRates(
  oldRates: DavisBaconWageRate[] | null | undefined,
  newRates: DavisBaconWageRate[] | null | undefined,
): WageRateDiff | null {
  const oldMap = new Map<string, DavisBaconWageRate>();
  for (const r of oldRates ?? []) oldMap.set(normalizeKey(r.classification), r);
  const newMap = new Map<string, DavisBaconWageRate>();
  for (const r of newRates ?? []) newMap.set(normalizeKey(r.classification), r);

  const changes: WageRateDiffEntry[] = [];
  for (const [key, n] of newMap) {
    const o = oldMap.get(key);
    if (!o) {
      changes.push({
        classification: n.classification,
        kind: "added",
        newBaseRate: n.baseRate,
        newFringeRate: n.fringeRate,
        newTotalRate: n.totalRate,
      });
      continue;
    }
    const baseDiff = Math.abs((o.baseRate ?? 0) - (n.baseRate ?? 0)) > RATE_EPSILON;
    const fringeDiff = Math.abs((o.fringeRate ?? 0) - (n.fringeRate ?? 0)) > RATE_EPSILON;
    const totalDiff = Math.abs((o.totalRate ?? 0) - (n.totalRate ?? 0)) > RATE_EPSILON;
    if (baseDiff || fringeDiff || totalDiff) {
      changes.push({
        classification: n.classification,
        kind: "changed",
        oldBaseRate: o.baseRate,
        newBaseRate: n.baseRate,
        oldFringeRate: o.fringeRate,
        newFringeRate: n.fringeRate,
        oldTotalRate: o.totalRate,
        newTotalRate: n.totalRate,
      });
    }
  }
  for (const [key, o] of oldMap) {
    if (newMap.has(key)) continue;
    changes.push({
      classification: o.classification,
      kind: "removed",
      oldBaseRate: o.baseRate,
      oldFringeRate: o.fringeRate,
      oldTotalRate: o.totalRate,
    });
  }

  if (changes.length === 0) return null;
  return { changes };
}

export interface NotifyRateChangeArgs {
  organizationId: string;
  decisionNumber: string;
  diff: WageRateDiff;
}

export interface NotifyRateChangeResult {
  affectedProjects: number;
  notificationsSent: number;
  recipientsNotified: number;
}

function fmtRate(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  return `$${n.toFixed(2)}`;
}

function summarizeDiff(diff: WageRateDiff, max = 5): string {
  const lines: string[] = [];
  for (const c of diff.changes.slice(0, max)) {
    if (c.kind === "added") {
      lines.push(`• Added: ${c.classification} (total ${fmtRate(c.newTotalRate)})`);
    } else if (c.kind === "removed") {
      lines.push(`• Removed: ${c.classification} (was total ${fmtRate(c.oldTotalRate)})`);
    } else {
      lines.push(
        `• ${c.classification}: base ${fmtRate(c.oldBaseRate)} → ${fmtRate(c.newBaseRate)}, ` +
          `fringe ${fmtRate(c.oldFringeRate)} → ${fmtRate(c.newFringeRate)}`,
      );
    }
  }
  if (diff.changes.length > max) {
    lines.push(`…and ${diff.changes.length - max} more classification(s).`);
  }
  return lines.join("\n");
}

/**
 * Task #1400 / #1407 — notify the audience for every project in
 * `organizationId` whose `wageDecision` matches `decisionNumber` that the
 * cached Davis-Bacon rates just changed.
 *
 * Recipients per project: every active org admin. Project managers are
 * intentionally NOT included here — Task #1487 split the PM audience out
 * to `notifyProjectManagersOnPersistedRateChanges` (the richer
 * per-project, payroll-tab-linked email of type
 * WAGE_DECISION_RATES_CHANGED_FOR_PM, written from
 * `persistRateChangeRecords`). The stale-refresh sweep used to call both
 * paths back-to-back, which delivered two emails per refresh to any PM
 * assigned to an affected project. This function now keeps the org-level
 * admin digest behaviour (unchanged from a recipient's perspective) while
 * leaving the per-project PM email to the dedicated path.
 *
 * Task #1407: a single user is notified at most once per sweep/decision,
 * even when they're the recipient for many affected projects. When the
 * user has only one affected project the notification is identical to the
 * pre-digest behaviour (same title, same message, same relatedEntityId).
 * When multiple projects roll up for the same user, those projects are
 * collapsed into one digest notification listing each affected project
 * alongside the shared rate diff summary.
 */
export async function notifyProjectManagersOfWageRateChange(
  args: NotifyRateChangeArgs,
): Promise<NotifyRateChangeResult> {
  const decision = args.decisionNumber.trim();
  if (!decision) {
    return { affectedProjects: 0, notificationsSent: 0, recipientsNotified: 0 };
  }

  const affected = await db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      projectManagerId: projects.projectManagerId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.gcOrganizationId, args.organizationId),
        sql`trim(${projects.wageDecision}) = ${decision}`,
      ),
    );

  if (affected.length === 0) {
    return { affectedProjects: 0, notificationsSent: 0, recipientsNotified: 0 };
  }

  const adminIds = await getOrgAdminUserIds(args.organizationId);
  const summary = summarizeDiff(args.diff);

  // Build userId → projects[] so a single user overseeing N affected
  // projects receives one digest instead of N near-identical alerts.
  type ProjectRef = { id: string; name: string; code: string };
  const byUser = new Map<string, ProjectRef[]>();
  for (const project of affected) {
    // Task #1487: PMs are notified via the dedicated per-project email
    // path (notifyProjectManagersOnPersistedRateChanges). Only fan the
    // org-level admin digest out from here so PMs assigned to an
    // affected project no longer receive two near-identical emails per
    // stale-refresh sweep.
    const recipients = new Set<string>(adminIds);
    if (recipients.size === 0) {
      logInfo("No recipients for wage rate change notification", {
        organizationId: args.organizationId,
        projectId: project.id,
        decisionNumber: decision,
      });
      continue;
    }
    const ref: ProjectRef = {
      id: project.id,
      name: project.name || "",
      code: project.code || "",
    };
    for (const userId of recipients) {
      const list = byUser.get(userId) ?? [];
      list.push(ref);
      byUser.set(userId, list);
    }
  }

  let notificationsSent = 0;
  let recipientsNotified = 0;

  const MAX_PROJECTS_LISTED = 10;

  for (const [userId, userProjects] of byUser) {
    let title: string;
    let message: string;
    let relatedEntityId: string | null;
    let relatedEntityType: string | null;

    if (userProjects.length === 1) {
      const project = userProjects[0];
      // Preserve the pre-digest single-project format byte-for-byte so
      // existing clients/tests continue to see the same payload.
      title = `Davis-Bacon rates changed for ${decision}`;
      message =
        `The latest auto-refresh of wage decision ${decision} returned ` +
        `different rates for ${args.diff.changes.length} classification(s) ` +
        `affecting project "${project.name || project.code}". Review certified ` +
        `payrolls and pay items before your next submission.\n\n${summary}`;
      relatedEntityId = project.id;
      relatedEntityType = "PROJECT";
    } else {
      title = `Davis-Bacon rates changed for ${decision} — ${userProjects.length} projects`;
      const listed = userProjects
        .slice(0, MAX_PROJECTS_LISTED)
        .map((p) => `• ${p.name || p.code}`)
        .join("\n");
      const overflow =
        userProjects.length > MAX_PROJECTS_LISTED
          ? `\n…and ${userProjects.length - MAX_PROJECTS_LISTED} more project(s).`
          : "";
      message =
        `The latest auto-refresh of wage decision ${decision} returned ` +
        `different rates for ${args.diff.changes.length} classification(s) ` +
        `affecting ${userProjects.length} of your projects. Review certified ` +
        `payrolls and pay items before your next submission.\n\n` +
        `Affected projects:\n${listed}${overflow}\n\n${summary}`;
      // Leave relatedEntityId null for digests so the email template falls
      // back to the payroll deep-link instead of pointing to one project.
      relatedEntityId = null;
      relatedEntityType = null;
    }

    try {
      await insertNotification({
        userId,
        organizationId: args.organizationId,
        type: "WAGE_DECISION_RATES_CHANGED",
        title,
        message,
        relatedEntityId,
        relatedEntityType,
      } as InsertNotification);
      notificationsSent += 1;
      recipientsNotified += 1;
    } catch (err) {
      logError(
        "Failed to deliver wage rate change notification",
        {
          organizationId: args.organizationId,
          userId,
          decisionNumber: decision,
          projectCount: userProjects.length,
        },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  if (notificationsSent > 0) {
    logInfo("Wage decision rate change fan-out complete", {
      organizationId: args.organizationId,
      decisionNumber: decision,
      affectedProjects: affected.length,
      notificationsSent,
      recipientsNotified,
      changedClassifications: args.diff.changes.length,
    });
  }

  return {
    affectedProjects: affected.length,
    notificationsSent,
    recipientsNotified,
  };
}

// Task #1449 — PM-targeted email triggered when persistRateChangeRecords
// writes new panel-flag records (Davis-Bacon stale-refresh produced a
// non-empty per-classification diff). Distinct from
// `notifyProjectManagersOfWageRateChange` (which is the wider
// admin + PM digest path on WAGE_DECISION_RATES_CHANGED) so PMs whose
// project references the decision get a per-project, classification-table
// nudge that deep-links to the project's payroll tab — closing the gap
// where the prevailing wage panel badge only fires once a PM happens to
// load that page.
//
// One notification per (PM, project) pair: the body lists every changed
// classification with old → new base/fringe/total numbers (the panel-flag
// rows always carry the full triple, including 0/null for added/removed
// classifications), and `relatedEntityId` is the project id so the email
// composer can deep-link to `/projects/<id>?tab=payroll`. Recipients are
// scoped to projects in `gcOrganizationId = organizationId`, so two
// projects in two different orgs that happen to use the same decision
// number stay isolated — only the PMs in the org we're persisting flags
// for get notified.
export interface NotifyPersistedRateChangesArgs {
  organizationId: string;
  decisionNumber: string;
  changes: ReadonlyArray<WageRateDiffEntry>;
}

export interface NotifyPersistedRateChangesResult {
  notificationsSent: number;
  recipientsNotified: number;
  affectedProjects: number;
}

function fmtRateOrDash(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function summarizePersistedChanges(
  changes: ReadonlyArray<WageRateDiffEntry>,
  max = 10,
): string {
  const lines: string[] = [];
  for (const c of changes.slice(0, max)) {
    const verb =
      c.kind === "added" ? "Added" : c.kind === "removed" ? "Removed" : "Updated";
    lines.push(
      `• ${verb} — ${c.classification}: ` +
        `base ${fmtRateOrDash(c.oldBaseRate)} → ${fmtRateOrDash(c.newBaseRate)}, ` +
        `fringe ${fmtRateOrDash(c.oldFringeRate)} → ${fmtRateOrDash(c.newFringeRate)}, ` +
        `total ${fmtRateOrDash(c.oldTotalRate)} → ${fmtRateOrDash(c.newTotalRate)}`,
    );
  }
  if (changes.length > max) {
    lines.push(`…and ${changes.length - max} more classification(s).`);
  }
  return lines.join("\n");
}

export async function notifyProjectManagersOnPersistedRateChanges(
  args: NotifyPersistedRateChangesArgs,
): Promise<NotifyPersistedRateChangesResult> {
  const decision = args.decisionNumber.trim();
  const empty: NotifyPersistedRateChangesResult = {
    notificationsSent: 0,
    recipientsNotified: 0,
    affectedProjects: 0,
  };
  if (!decision || args.changes.length === 0) return empty;

  // Scope to this org only — a different org may use the same decision
  // number but we must not leak across tenant boundaries (we're acting on
  // *this* org's panel-flag write).
  const affected = await db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      projectManagerId: projects.projectManagerId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.gcOrganizationId, args.organizationId),
        sql`trim(${projects.wageDecision}) = ${decision}`,
      ),
    );

  if (affected.length === 0) return empty;

  const summary = summarizePersistedChanges(args.changes);
  let notificationsSent = 0;
  const recipients = new Set<string>();

  for (const project of affected) {
    if (!project.projectManagerId) continue;
    recipients.add(project.projectManagerId);
    const projLabel = project.name || project.code || "your project";
    const title = `Davis-Bacon rates changed for ${decision}`;
    const message =
      `The latest Davis-Bacon refresh changed ${args.changes.length} ` +
      `classification rate(s) on wage decision ${decision} used by ` +
      `project "${projLabel}". Review the project's payroll tab and ` +
      `re-issue any in-flight certified payrolls before your next ` +
      `submission.\n\n${summary}`;
    try {
      await insertNotification({
        userId: project.projectManagerId,
        organizationId: args.organizationId,
        type: "WAGE_DECISION_RATES_CHANGED_FOR_PM",
        title,
        message,
        relatedEntityId: project.id,
        relatedEntityType: "PROJECT",
      } as InsertNotification);
      notificationsSent += 1;
    } catch (err) {
      logError(
        "Failed to deliver PM rate-change persistence notification",
        {
          organizationId: args.organizationId,
          decisionNumber: decision,
          projectId: project.id,
          userId: project.projectManagerId,
        },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  if (notificationsSent > 0) {
    logInfo("Davis-Bacon persisted rate-change PM fan-out", {
      organizationId: args.organizationId,
      decisionNumber: decision,
      affectedProjects: affected.length,
      notificationsSent,
      recipientsNotified: recipients.size,
      changedClassifications: args.changes.length,
    });
  }

  return {
    notificationsSent,
    recipientsNotified: recipients.size,
    affectedProjects: affected.length,
  };
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
