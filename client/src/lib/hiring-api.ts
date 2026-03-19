import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type {
  HiringJob,
  HiringCandidate,
  HiringCandidateNote,
  HiringActivityLog,
  HiringIntegration,
  HiringSyncLog,
  HiringJobTemplate,
  HiringDashboardStats,
} from "@/types/hiring";

// ============================================================
// Jobs
// ============================================================

export function useHiringJobs() {
  return useQuery<HiringJob[]>({ queryKey: ["/api/hiring/jobs"] });
}

export function useHiringJob(id: string | undefined) {
  return useQuery<HiringJob>({
    queryKey: ["/api/hiring/jobs", id],
    enabled: !!id,
  });
}

export function useJobTemplates() {
  return useQuery<HiringJobTemplate[]>({ queryKey: ["/api/hiring/jobs/templates"] });
}

export function useCreateJob() {
  return useMutation({
    mutationFn: async (data: Partial<HiringJob>) => {
      const res = await apiRequest("POST", "/api/hiring/jobs", data);
      return res.json() as Promise<HiringJob>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs"] });
    },
  });
}

export function useUpdateJob(id: string) {
  return useMutation({
    mutationFn: async (data: Partial<HiringJob>) => {
      const res = await apiRequest("PATCH", `/api/hiring/jobs/${id}`, data);
      return res.json() as Promise<HiringJob>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs"] });
    },
  });
}

export function usePublishJob() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/hiring/jobs/${id}/publish`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs"] });
    },
  });
}

export function useArchiveJob() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/hiring/jobs/${id}/archive`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs"] });
    },
  });
}

// ============================================================
// Candidates
// ============================================================

export function useHiringCandidates(params?: {
  jobId?: string;
  stage?: string;
  source?: string;
  search?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.jobId) searchParams.set("jobId", params.jobId);
  if (params?.stage) searchParams.set("stage", params.stage);
  if (params?.source) searchParams.set("source", params.source);
  if (params?.search) searchParams.set("search", params.search);
  const qs = searchParams.toString();
  const url = qs ? `/api/hiring/candidates?${qs}` : "/api/hiring/candidates";

  return useQuery<HiringCandidate[]>({
    queryKey: ["/api/hiring/candidates", params ?? {}],
    queryFn: () => fetch(url, { credentials: "include" }).then((r) => r.json()),
  });
}

export function useHiringCandidate(id: string | undefined) {
  return useQuery<HiringCandidate>({
    queryKey: ["/api/hiring/candidates", id],
    enabled: !!id,
  });
}

export function useCandidateNotes(candidateId: string | undefined) {
  return useQuery<HiringCandidateNote[]>({
    queryKey: ["/api/hiring/candidates", candidateId, "notes"],
    enabled: !!candidateId,
  });
}

export function useCandidateActivity(candidateId: string | undefined) {
  return useQuery<HiringActivityLog[]>({
    queryKey: ["/api/hiring/candidates", candidateId, "activity"],
    enabled: !!candidateId,
  });
}

export function useUpdateCandidateStage(candidateId: string) {
  return useMutation({
    mutationFn: async (stage: string) => {
      const res = await apiRequest("PUT", `/api/hiring/candidates/${candidateId}/stage`, { stage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/candidates", candidateId] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/candidates"] });
    },
  });
}

export function useAddCandidateNote(candidateId: string) {
  return useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest("POST", `/api/hiring/candidates/${candidateId}/notes`, { body });
      return res.json() as Promise<HiringCandidateNote>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/candidates", candidateId, "notes"] });
    },
  });
}

// ============================================================
// Dashboard & Activity
// ============================================================

export function useHiringDashboardStats() {
  return useQuery<HiringDashboardStats>({ queryKey: ["/api/hiring/analytics/dashboard"] });
}

export function useHiringActivity() {
  return useQuery<HiringActivityLog[]>({ queryKey: ["/api/hiring/activity"] });
}

// ============================================================
// Integrations & Sync Logs
// ============================================================

export function useHiringIntegrations() {
  return useQuery<HiringIntegration[]>({ queryKey: ["/api/hiring/integrations"] });
}

export function useHiringSyncLogs() {
  return useQuery<HiringSyncLog[]>({ queryKey: ["/api/hiring/sync-logs"] });
}

export function useConnectIntegration() {
  return useMutation({
    mutationFn: async (data: { providerName: string; credentials: Record<string, string> }) => {
      const res = await apiRequest("POST", "/api/hiring/integrations", data);
      return res.json() as Promise<HiringIntegration>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/integrations"] });
    },
  });
}

export function useDisconnectIntegration() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/hiring/integrations/${id}`, undefined);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/integrations"] });
    },
  });
}

export function useTestIntegration() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/hiring/integrations/${id}/test`, {});
      return res.json() as Promise<{ success: boolean; message: string }>;
    },
  });
}

export function useSyncIntegration() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/hiring/integrations/${id}/sync`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/sync-logs"] });
    },
  });
}

// ============================================================
// Interviews
// ============================================================

export function useHiringInterviews(candidateId?: string) {
  const qs = candidateId ? `?candidateId=${candidateId}` : "";
  return useQuery({
    queryKey: ["/api/hiring/interviews", candidateId ?? "all"],
    queryFn: () => fetch(`/api/hiring/interviews${qs}`, { credentials: "include" }).then((r) => r.json()),
  });
}

export function useScheduleInterview() {
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/hiring/interviews", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/interviews"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/analytics/dashboard"] });
    },
  });
}

export function useUpdateInterview(id: string) {
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/hiring/interviews/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/interviews"] });
    },
  });
}

// ============================================================
// Hiring Tasks
// ============================================================

export function useHiringTasks(candidateId?: string) {
  const qs = candidateId ? `?candidateId=${candidateId}` : "";
  return useQuery({
    queryKey: ["/api/hiring/tasks", candidateId ?? "all"],
    queryFn: () => fetch(`/api/hiring/tasks${qs}`, { credentials: "include" }).then((r) => r.json()),
  });
}

export function useCreateHiringTask() {
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/hiring/tasks", data);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/tasks"] });
      if (variables.candidateId) {
        queryClient.invalidateQueries({ queryKey: ["/api/hiring/tasks", variables.candidateId as string] });
      }
    },
  });
}

export function useUpdateHiringTask(id: string) {
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/hiring/tasks/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/tasks"] });
    },
  });
}

// ============================================================
// AI Scoring
// ============================================================

export function useAiScoreCandidate(candidateId: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/hiring/candidates/${candidateId}/ai-score`, {});
      return res.json() as Promise<{
        score: number;
        recommendation: string;
        strengths: string[];
        concerns: string[];
        candidate: unknown;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/candidates", candidateId] });
    },
  });
}
