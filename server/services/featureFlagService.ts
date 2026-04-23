import { db } from "../db";
import { safeJsonParse } from "../responseHelper";
import { organizations, users, featureFlagPresetApplications, FEATURE_FLAG_KEYS, DISABLED_BY_DEFAULT_FLAGS, type FeatureFlagKey } from "@shared/schema";
import { getFeaturePresetForTrade } from "@shared/tradeFeaturePresets";
import { eq, or, isNull, sql, desc } from "drizzle-orm";
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

export interface LastPresetApplication {
  tradeType: string;
  appliedAt: Date;
  appliedBy: { id: string; firstName: string; lastName: string; email: string } | null;
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
