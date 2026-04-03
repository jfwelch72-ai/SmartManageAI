import { useQuery } from "@tanstack/react-query";
import type { FeatureFlagKey } from "@shared/schema";

interface FeatureFlagsResponse {
  flags: Partial<Record<FeatureFlagKey, boolean>>;
  keys: readonly FeatureFlagKey[];
}

export function useFeatureFlags() {
  const { data, isLoading } = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    flags: data?.flags ?? {},
    isLoading,
    isEnabled: (key: FeatureFlagKey) => data?.flags?.[key] === true,
  };
}
