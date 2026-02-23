import { db } from "../db";
import { organizations, FEATURE_FLAG_KEYS, type FeatureFlagKey } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logInfo } from "../utils/logger";

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
    const parsed = JSON.parse(org.featureFlags) as FeatureFlagsMap;
    return { ...DEFAULT_FLAGS, ...parsed };
  } catch {
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
