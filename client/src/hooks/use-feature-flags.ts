import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { FeatureFlagKey } from "@shared/schema";

interface FeatureFlagsResponse {
  flags: Partial<Record<FeatureFlagKey, boolean>>;
  keys: readonly FeatureFlagKey[];
}

export function useFeatureFlags() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    staleTime: 5 * 60 * 1000,
    retry: 1,
    // Super Admin has no organizationId — endpoint returns 400 "Organization required"
    // for org-less sessions. Disable the query to avoid noisy error logs.
    enabled: !!user?.organizationId,
  });

  return {
    flags: data?.flags ?? {},
    isLoading,
    isEnabled: (key: FeatureFlagKey) => data?.flags?.[key] === true,
  };
}
