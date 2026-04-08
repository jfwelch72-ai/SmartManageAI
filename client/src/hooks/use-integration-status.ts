import { useQuery } from "@tanstack/react-query";

export interface IntegrationStatus {
  livekit: boolean;
  twilio: boolean;
  openai: boolean;
  resend: boolean;
}

export function useIntegrationStatus() {
  const query = useQuery<IntegrationStatus>({
    queryKey: ["/api/integration-status"],
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    ...query,
    status: query.data ?? { livekit: false, twilio: false, openai: false, resend: false },
  };
}
