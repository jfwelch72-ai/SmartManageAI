import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorIngestRuns,
  organizations,
} from "@shared/schema";
import { isFeatureEnabled } from "../featureFlagService";
import { logError, logInfo, logWarn } from "../../utils/logger";
import { runIngestion } from "./ingestion";

export interface ScheduledIngestionSummary {
  orgsConsidered: number;
  orgsTriggered: number;
  orgsSkippedRecent: number;
  orgsSkippedInFlight: number;
  orgsSkippedNotEnabled: number;
  orgsSucceeded: number;
  orgsFailed: number;
  durationMs: number;
}

const DEFAULT_MIN_HOURS_BETWEEN_RUNS = 20;
const DEFAULT_IN_FLIGHT_GRACE_HOURS = 6;

function envHours(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export async function processAiEstimatorScheduledIngestion(opts: { now?: Date } = {}): Promise<ScheduledIngestionSummary> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const minHoursBetween = envHours(
    "AI_ESTIMATOR_INGEST_MIN_HOURS_BETWEEN_RUNS",
    DEFAULT_MIN_HOURS_BETWEEN_RUNS,
  );
  const inFlightGraceHours = envHours(
    "AI_ESTIMATOR_INGEST_INFLIGHT_GRACE_HOURS",
    DEFAULT_IN_FLIGHT_GRACE_HOURS,
  );

  const summary: ScheduledIngestionSummary = {
    orgsConsidered: 0,
    orgsTriggered: 0,
    orgsSkippedRecent: 0,
    orgsSkippedInFlight: 0,
    orgsSkippedNotEnabled: 0,
    orgsSucceeded: 0,
    orgsFailed: 0,
    durationMs: 0,
  };

  // Active orgs only — soft-deactivated tenants shouldn't keep churning
  // through ingestion while their data is frozen.
  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.isActive, true));

  const recentCutoff = new Date(now.getTime() - minHoursBetween * 60 * 60 * 1000);
  const inFlightCutoff = new Date(now.getTime() - inFlightGraceHours * 60 * 60 * 1000);

  for (const org of orgs) {
    summary.orgsConsidered++;
    try {
      const enabled = await isFeatureEnabled(org.id, "AI_ESTIMATOR");
      if (!enabled) {
        summary.orgsSkippedNotEnabled++;
        continue;
      }

      // Skip if a successful run started inside the cooldown window — keeps
      // the cadence at "at most once per day per org" even if the cron is
      // run manually or fires twice for any reason.
      const [recent] = await db
        .select({ id: aiEstimatorIngestRuns.id })
        .from(aiEstimatorIngestRuns)
        .where(and(
          eq(aiEstimatorIngestRuns.organizationId, org.id),
          eq(aiEstimatorIngestRuns.status, "SUCCEEDED"),
          sql`${aiEstimatorIngestRuns.startedAt} >= ${recentCutoff}`,
        ))
        .limit(1);
      if (recent) {
        summary.orgsSkippedRecent++;
        continue;
      }

      // Skip if a previous run is still RUNNING within the grace window
      // (anything older than the grace window is treated as a stuck row
      // and we let the new run start; the runner will overwrite the row's
      // companion entry by inserting a new one).
      const [inFlight] = await db
        .select({ id: aiEstimatorIngestRuns.id })
        .from(aiEstimatorIngestRuns)
        .where(and(
          eq(aiEstimatorIngestRuns.organizationId, org.id),
          eq(aiEstimatorIngestRuns.status, "RUNNING"),
          sql`${aiEstimatorIngestRuns.startedAt} >= ${inFlightCutoff}`,
        ))
        .limit(1);
      if (inFlight) {
        logWarn("AI Estimator scheduled ingestion: previous run still in flight", { orgId: org.id });
        summary.orgsSkippedInFlight++;
        continue;
      }

      summary.orgsTriggered++;
      const run = await runIngestion(org.id, null, "SCHEDULED");
      if (run.status === "SUCCEEDED") {
        summary.orgsSucceeded++;
      } else {
        summary.orgsFailed++;
      }
    } catch (err) {
      // `runIngestion` already records failures into `ai_estimator_ingest_runs`,
      // but a hard exception here (e.g. before the row was inserted) still
      // needs to be visible in the runner logs and the per-tick metrics.
      summary.orgsFailed++;
      logError("AI Estimator scheduled ingestion org iteration failed", {
        orgId: org.id,
        error: String(err),
      });
    }
  }

  summary.durationMs = Date.now() - startedAt;
  if (summary.orgsTriggered > 0 || summary.orgsFailed > 0) {
    logInfo("AI Estimator scheduled ingestion tick", { ...summary });
  }
  return summary;
}
