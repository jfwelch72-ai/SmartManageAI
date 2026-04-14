import { useQuery } from "@tanstack/react-query";

export interface IntegrationStatus {
  livekit: boolean;
  twilio: boolean;
  openai: boolean;
  resend: boolean;
  social_facebook: boolean;
  social_linkedin: boolean;
  social_twitter: boolean;
  social_tiktok: boolean;
  social_youtube: boolean;
  social_pinterest: boolean;
}

const DEFAULT_STATUS: IntegrationStatus = {
  livekit: false,
  twilio: false,
  openai: false,
  resend: false,
  social_facebook: false,
  social_linkedin: false,
  social_twitter: false,
  social_tiktok: false,
  social_youtube: false,
  social_pinterest: false,
};

export function useIntegrationStatus() {
  const query = useQuery<IntegrationStatus>({
    queryKey: ["/api/integration-status"],
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    ...query,
    status: query.data ?? DEFAULT_STATUS,
  };
}

export function hasAnySocialIntegration(status: IntegrationStatus): boolean {
  return (
    status.social_facebook ||
    status.social_linkedin ||
    status.social_twitter ||
    status.social_tiktok ||
    status.social_youtube ||
    status.social_pinterest
  );
}
