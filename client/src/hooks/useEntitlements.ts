/**
 * Hook for accessing organization entitlements and feature gating
 */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { FeatureKey, PlanTier, AddOnKey } from "@shared/billing/plans";

interface AddonDetail {
  key: AddOnKey;
  name: string;
  description: string;
  price: number;
}

interface UsageData {
  quantity: number;
  periodStart: string | null;
  periodEnd: string | null;
}

interface PlanInfo {
  name: string;
  description: string;
  price: number;
}

export interface Entitlements {
  organizationId: string;
  organizationName: string;
  planTier: PlanTier;
  planInfo: PlanInfo;
  status: string;
  activeAddons: AddOnKey[];
  addonDetails: AddonDetail[];
  features: FeatureKey[];
  usage: {
    ai_vision_docs: UsageData;
  };
  isDevMode: boolean;
}

/**
 * Hook to fetch and cache organization entitlements
 */
export function useEntitlements() {
  const { user } = useAuth();
  const query = useQuery<Entitlements>({
    queryKey: ["/api/billing/entitlements"],
    staleTime: 60 * 1000, // 1 minute
    retry: 1,
    // Super Admin has no organizationId — endpoint returns 400 "Organization required"
    // for org-less sessions. Disable the query to avoid noisy error logs.
    enabled: !!user?.organizationId,
  });

  /**
   * Check if user has access to a specific feature
   */
  const can = (featureKey: FeatureKey): boolean => {
    if (!query.data) return false;
    return query.data.features.includes(featureKey);
  };

  /**
   * Check if an add-on is active
   */
  const hasAddon = (addonKey: AddOnKey): boolean => {
    if (!query.data) return false;
    return query.data.activeAddons.includes(addonKey);
  };

  /**
   * Get the current plan tier
   */
  const getPlanTier = (): PlanTier | null => {
    return query.data?.planTier || null;
  };

  /**
   * Check if currently in dev mode (manual billing)
   */
  const isDevMode = (): boolean => {
    return query.data?.isDevMode || false;
  };

  return {
    ...query,
    entitlements: query.data,
    can,
    hasAddon,
    getPlanTier,
    isDevMode,
  };
}

/**
 * Hook to fetch available plans and add-ons (public info)
 */
export function usePlans() {
  return useQuery<{
    plans: Array<{
      tier: PlanTier;
      name: string;
      description: string;
      price: number;
      features: FeatureKey[];
    }>;
    addons: Array<{
      key: AddOnKey;
      name: string;
      description: string;
      price: number;
      grantsFeature: FeatureKey;
    }>;
  }>({
    queryKey: ["/api/billing/plans"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
