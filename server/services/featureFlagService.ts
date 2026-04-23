import { db } from "../db";
import { safeJsonParse } from "../responseHelper";
import { organizations, users, featureFlagPresetApplications, FEATURE_FLAG_KEYS, DISABLED_BY_DEFAULT_FLAGS, type FeatureFlagKey } from "@shared/schema";
import {
  getFeaturePresetForTrade,
  hasExplicitPresetForTrade,
  findClosestPreset,
  diffFlagsAgainstPreset,
} from "@shared/tradeFeaturePresets";
import { eq, or, isNull, sql, desc, notExists } from "drizzle-orm";
import {logInfo, logWarn } from "../utils/logger";

export type FeatureFlagsMap = Partial<Record<FeatureFlagKey, boolean>>;

const DEFAULT_FLAGS: FeatureFlagsMap = Object.fromEntries(
  FEATURE_FLAG_KEYS.map(key => [key, false])
) as FeatureFlagsMap;

export async function getFeatureFlags(orgId: string): Promise<FeatureFlagsMap> {
  const [org] = await db.select({ featureFlags: organizations.featureFlags })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org || !org.featureFlags) {
    return { ...DEFAULT_FLAGS };
  }

  try {
    const parsed = safeJsonParse(org.featureFlags, null) as FeatureFlagsMap;
    return { ...DEFAULT_FLAGS, ...parsed };
  } catch {
    logWarn("Non-critical operation failed");
    return { ...DEFAULT_FLAGS };
  }
}

export async function isFeatureEnabled(orgId: string, flag: FeatureFlagKey): Promise<boolean> {
  const flags = await getFeatureFlags(orgId);
  return flags[flag] === true;
}

export async function setFeatureFlag(orgId: string, flag: FeatureFlagKey, enabled: boolean): Promise<FeatureFlagsMap> {
  const currentFlags = await getFeatureFlags(orgId);
  currentFlags[flag] = enabled;

  await db.update(organizations)
    .set({ featureFlags: JSON.stringify(currentFlags), updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  logInfo(`Feature flag ${flag} set to ${enabled}`, { organizationId: orgId });
  return currentFlags;
}

export async function setAllFeatureFlags(orgId: string, flags: FeatureFlagsMap): Promise<FeatureFlagsMap> {
  const currentFlags = await getFeatureFlags(orgId);
  for (const [key, value] of Object.entries(flags)) {
    if (FEATURE_FLAG_KEYS.includes(key as FeatureFlagKey)) {
      currentFlags[key as FeatureFlagKey] = value;
    }
  }

  await db.update(organizations)
    .set({ featureFlags: JSON.stringify(currentFlags), updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  logInfo("Feature flags bulk updated", { organizationId: orgId });
  return currentFlags;
}

/**
 * Idempotent backfill: ensures every organization that has no feature flags
 * stored (NULL or empty string) gets the full flag set with most flags enabled.
 * Flags in DISABLED_BY_DEFAULT_FLAGS (e.g. BIM_VIEWER) remain off.
 * Safe to call on every dev server startup — only touches rows with missing data.
 */
export async function backfillMissingFeatureFlags(): Promise<void> {
  const disabledSet = new Set<string>(DISABLED_BY_DEFAULT_FLAGS);
  const allFlagsOn = JSON.stringify(
    Object.fromEntries(FEATURE_FLAG_KEYS.map(k => [k, !disabledSet.has(k)]))
  );

  const result = await db
    .update(organizations)
    .set({ featureFlags: allFlagsOn, updatedAt: new Date() })
    .where(
      or(
        isNull(organizations.featureFlags),
        sql`${organizations.featureFlags} = ''`
      )
    );

  const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  if (count > 0) {
    logInfo(`Feature flag backfill: enabled all flags for ${count} org(s) with missing data`);
  }
}

/**
 * Task #1185: backfill synthetic preset-application audit rows for organizations
 * onboarded before Task #1119 shipped the `feature_flag_preset_applications`
 * audit table. Their flags were set during AI onboarding via `applyTradePreset`
 * but no audit row exists, so the Feature Flags tab shows
 * "No trade preset has been applied to this organization yet." even though the
 * flags do reflect a preset.
 *
 * For each org that currently has zero audit rows, if its trade has an explicit
 * preset and its stored feature flags exactly match that preset, insert a
 * synthetic row attributed to "system" (appliedById=null) at the org's
 * createdAt timestamp. Idempotent: orgs that already have any audit row are
 * skipped, so this is safe to call on every startup.
 */
export async function backfillPresetApplications(): Promise<void> {
  const candidates = await db
    .select({
      id: organizations.id,
      tradeType: organizations.tradeType,
      featureFlags: organizations.featureFlags,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .where(
      notExists(
        db
          .select({ id: featureFlagPresetApplications.id })
          .from(featureFlagPresetApplications)
          .where(eq(featureFlagPresetApplications.organizationId, organizations.id)),
      ),
    );

  // Cap how far an org's stored flags may drift from a preset before we still
  // call the org "customized from" that preset. Beyond this, attribution
  // becomes unreliable (the org's flags no longer resemble the preset enough
  // to claim it as the origin), so we leave such orgs without a synthetic
  // audit row rather than print a misleading "Customized from X" line.
  const MAX_FUZZY_BACKFILL_DISTANCE = 6;

  let inserted = 0;
  let fuzzyInserted = 0;
  for (const org of candidates) {
    if (!org.featureFlags) continue;

    let parsed: FeatureFlagsMap | null;
    try {
      parsed = safeJsonParse(org.featureFlags, null) as FeatureFlagsMap | null;
    } catch {
      parsed = null;
    }
    if (!parsed) continue;

    // Step 1: prefer the org's own trade preset (if explicit) — that's the
    // preset they were originally onboarded with, even if a few flags drifted.
    // We still cap the allowable drift so heavily diverged orgs aren't
    // mislabeled "Customized from <their trade>".
    let recordedTradeType: string | null = null;
    let isFuzzy = false;
    if (org.tradeType && hasExplicitPresetForTrade(org.tradeType)) {
      const preset = getFeaturePresetForTrade(org.tradeType);
      let distance = 0;
      for (const key of FEATURE_FLAG_KEYS) {
        if ((parsed[key] ?? false) !== preset[key]) distance++;
      }
      if (distance === 0 || distance <= MAX_FUZZY_BACKFILL_DISTANCE) {
        recordedTradeType = org.tradeType;
        isFuzzy = distance > 0;
      }
    }

    // Step 2: org's trade has no explicit preset (or its preset drifted past
    // the threshold) — fall back to the closest preset across all trades so
    // they still get a sensible "Last applied" line. findClosestPreset always
    // returns one deterministic winner (preferring the org's own trade on
    // ties); we still gate the result on the distance threshold to avoid
    // weak/incorrect "customized from" attribution.
    if (!recordedTradeType) {
      const closest = findClosestPreset(parsed, org.tradeType ?? undefined);
      if (closest && closest.distance <= MAX_FUZZY_BACKFILL_DISTANCE) {
        recordedTradeType = closest.tradeType;
        isFuzzy = !closest.exact;
      }
    }
    if (!recordedTradeType) continue;

    try {
      await db.insert(featureFlagPresetApplications).values({
        organizationId: org.id,
        tradeType: recordedTradeType,
        appliedById: null,
        appliedAt: org.createdAt,
      });
      inserted++;
      if (isFuzzy) fuzzyInserted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(
        `[FeatureFlags] Backfill failed to insert preset application | organizationId=${org.id} tradeType=${recordedTradeType} error=${message}`,
      );
    }
  }

  if (inserted > 0) {
    logInfo(
      `[FeatureFlags] Preset application backfill: inserted ${inserted} synthetic audit row(s) for legacy orgs (${fuzzyInserted} customized from preset)`,
    );
  }
}

export async function applyTradePreset(
  orgId: string,
  tradeType: string,
  appliedByUserId?: string | null,
): Promise<FeatureFlagsMap> {
  const preset = getFeaturePresetForTrade(tradeType);
  const flagsJson = JSON.stringify(preset);

  await db.update(organizations)
    .set({ featureFlags: flagsJson, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  try {
    await db.insert(featureFlagPresetApplications).values({
      organizationId: orgId,
      tradeType,
      appliedById: appliedByUserId ?? null,
    });
  } catch (err) {
    // Audit insert failures must not fail the user-facing apply, but they do
    // need to be visible in logs so broken auditing is detectable. Surface
    // org/trade/user context and the error message.
    const message = err instanceof Error ? err.message : String(err);
    logWarn(
      `[FeatureFlags] Failed to record preset application audit row | organizationId=${orgId} tradeType=${tradeType} appliedByUserId=${appliedByUserId ?? "null"} error=${message}`,
    );
  }

  logInfo(`[FeatureFlags] Applied trade preset for "${tradeType}"`, { organizationId: orgId });
  return preset;
}

export interface PresetFlagDiffEntry {
  key: FeatureFlagKey;
  current: boolean;
  preset: boolean;
}

export interface LastPresetApplication {
  tradeType: string;
  appliedAt: Date;
  appliedBy: { id: string; firstName: string; lastName: string; email: string } | null;
  /**
   * True when the org's currently stored feature flags no longer exactly
   * match the preset that was last applied. UI surfaces this as
   * "Customized from <Preset>" rather than a flat "Last applied" line.
   */
  isCustomized: boolean;
  /**
   * Per-flag differences between the currently stored flags and the preset
   * recorded on the most recent audit row. Empty when isCustomized=false.
   */
  diff: PresetFlagDiffEntry[];
}

export async function getLastPresetApplication(orgId: string): Promise<LastPresetApplication | null> {
  const [row] = await db
    .select({
      tradeType: featureFlagPresetApplications.tradeType,
      appliedAt: featureFlagPresetApplications.appliedAt,
      appliedById: featureFlagPresetApplications.appliedById,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
      userId: users.id,
    })
    .from(featureFlagPresetApplications)
    .leftJoin(users, eq(users.id, featureFlagPresetApplications.appliedById))
    .where(eq(featureFlagPresetApplications.organizationId, orgId))
    .orderBy(desc(featureFlagPresetApplications.appliedAt))
    .limit(1);

  if (!row) return null;

  // Compare the org's currently stored flags to the recorded preset so the
  // Feature Flags tab can show "Customized from <Preset>" when the org
  // edited individual flags after the preset was applied.
  const currentFlags = await getFeatureFlags(orgId);
  const preset = getFeaturePresetForTrade(row.tradeType);
  const diff = diffFlagsAgainstPreset(currentFlags, preset);

  return {
    tradeType: row.tradeType,
    appliedAt: row.appliedAt,
    appliedBy: row.userId
      ? {
          id: row.userId,
          firstName: row.userFirstName ?? "",
          lastName: row.userLastName ?? "",
          email: row.userEmail ?? "",
        }
      : null,
    isCustomized: diff.length > 0,
    diff,
  };
}

export interface PresetApplicationHistoryItem {
  id: string;
  tradeType: string;
  appliedAt: Date;
  appliedBy: { id: string; firstName: string; lastName: string; email: string } | null;
}

export interface PresetApplicationHistoryPage {
  items: PresetApplicationHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listPresetApplications(
  orgId: string,
  page: number = 1,
  pageSize: number = 20,
): Promise<PresetApplicationHistoryPage> {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  const offset = (safePage - 1) * safePageSize;

  const rows = await db
    .select({
      id: featureFlagPresetApplications.id,
      tradeType: featureFlagPresetApplications.tradeType,
      appliedAt: featureFlagPresetApplications.appliedAt,
      appliedById: featureFlagPresetApplications.appliedById,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
      userId: users.id,
    })
    .from(featureFlagPresetApplications)
    .leftJoin(users, eq(users.id, featureFlagPresetApplications.appliedById))
    .where(eq(featureFlagPresetApplications.organizationId, orgId))
    .orderBy(desc(featureFlagPresetApplications.appliedAt))
    .limit(safePageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(featureFlagPresetApplications)
    .where(eq(featureFlagPresetApplications.organizationId, orgId));

  return {
    items: rows.map((row) => ({
      id: row.id,
      tradeType: row.tradeType,
      appliedAt: row.appliedAt,
      appliedBy: row.userId
        ? {
            id: row.userId,
            firstName: row.userFirstName ?? "",
            lastName: row.userLastName ?? "",
            email: row.userEmail ?? "",
          }
        : null,
    })),
    total: Number(count) || 0,
    page: safePage,
    pageSize: safePageSize,
  };
}
