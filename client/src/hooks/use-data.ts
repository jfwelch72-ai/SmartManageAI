import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Project, ScopeItem, ChangeOrder, CalendarEvent, Notification, TimeEntry, TMDailySheet, ProjectNote, Media, Bid, Estimate, ProcurementItem, PlanDocument, Receipt, TimeClockShift, Crew, CrewProjectAssignment } from "@shared/schema";

// Dashboard
interface DashboardStats {
  activeProjectsCount: number;
  pendingChangeOrdersCount: number;
  pendingTimeOffCount: number;
}

export function useDashboardStats() {
  return useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });
}

// Project with enriched user names from API
export interface ProjectWithNames extends Project {
  estimator?: string;
  superintendent?: string;
}

// Projects
export function useProject(code: string) {
  return useQuery<Project>({
    queryKey: ["/api/projects", code],
    enabled: !!code,
  });
}

export function useProjects() {
  return useQuery<{ data: ProjectWithNames[]; pagination: { page: number; limit: number; totalCount: number; totalPages: number; } }, Error, ProjectWithNames[]>({
    queryKey: ["/api/projects"],
    select: (response) => response.data,
  });
}

// Scope Items
export function useScopeItems(code: string) {
  return useQuery<ScopeItem[]>({
    queryKey: ["/api/projects", code, "scope"],
    enabled: !!code,
  });
}

export function useUpdateScopeItem() {
  return useMutation({
    mutationFn: async ({ id, data, projectCode }: { id: string; data: Partial<ScopeItem>; projectCode: string }) => {
      const response = await apiRequest("PATCH", `/api/scope-items/${id}`, data);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "scope"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

// Change Orders
export function useChangeOrders(code: string) {
  return useQuery<ChangeOrder[]>({
    queryKey: ["/api/projects", code, "change-orders"],
    enabled: !!code,
  });
}

export function useCreateChangeOrder() {
  return useMutation({
    mutationFn: async (data: Partial<ChangeOrder> & { projectCode: string }) => {
      const { projectCode, ...changeOrderData } = data;
      const response = await apiRequest("POST", "/api/change-orders", changeOrderData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "change-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

export function useApproveChangeOrder() {
  return useMutation({
    mutationFn: async ({ id, projectCode }: { id: string; projectCode: string }) => {
      const response = await apiRequest("POST", `/api/change-orders/${id}/approve`);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "change-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

export function useRejectChangeOrder() {
  return useMutation({
    mutationFn: async ({ id, reason, projectCode }: { id: string; reason: string; projectCode: string }) => {
      const response = await apiRequest("POST", `/api/change-orders/${id}/reject`, { rejectionReason: reason });
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "change-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

export function useRequestApprovalChangeOrder() {
  return useMutation({
    mutationFn: async ({ id, projectCode }: { id: string; projectCode: string }) => {
      const response = await apiRequest("POST", `/api/change-orders/${id}/request-approval`);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "change-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

export function useSubmitChangeOrder() {
  return useMutation({
    mutationFn: async ({ id, projectCode }: { id: string; projectCode: string }) => {
      const response = await apiRequest("POST", `/api/change-orders/${id}/submit`);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "change-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

export function useReturnToDraftChangeOrder() {
  return useMutation({
    mutationFn: async ({ id, reason, projectCode }: { id: string; reason?: string; projectCode: string }) => {
      const response = await apiRequest("POST", `/api/change-orders/${id}/return-to-draft`, { reason });
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "change-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

// Calendar Events
export function useCalendarEvents() {
  return useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar/events"],
  });
}

export function useCreateCalendarEvent() {
  return useMutation({
    mutationFn: async (data: Partial<CalendarEvent>) => {
      const response = await apiRequest("POST", "/api/calendar/events", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
    },
  });
}

export function useApproveTimeOff() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/calendar/events/${id}/approve`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

// Notifications
export function useNotifications() {
  return useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });
}

export function useUnreadNotificationCount() {
  return useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
  });
}

export function useMarkNotificationRead() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("PATCH", `/api/notifications/${id}/read`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  return useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/notifications/read-all");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });
}

// Time Entries
export function useTimeEntries() {
  return useQuery<{ data: TimeEntry[]; pagination: any }>({
    queryKey: ["/api/time-entries"],
  });
}

export function useProjectTimeEntries(code: string) {
  return useQuery<TimeEntry[]>({
    queryKey: ["/api/projects", code, "time-entries"],
    enabled: !!code,
  });
}

export function useCreateTimeEntry() {
  return useMutation({
    mutationFn: async (data: Partial<TimeEntry> & { projectCode?: string }) => {
      const { projectCode, ...entryData } = data;
      const response = await apiRequest("POST", "/api/time-entries", entryData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      if (variables.projectCode) {
        queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "time-entries"] });
      }
    },
  });
}

export function useApproveTimeEntry() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/time-entries/${id}/approve`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

// T&M Daily Sheets
export function useProjectTMSheets(code: string) {
  return useQuery<TMDailySheet[]>({
    queryKey: ["/api/projects", code, "tm-sheets"],
    enabled: !!code,
  });
}

export function useCreateTMSheet() {
  return useMutation({
    mutationFn: async (data: Partial<TMDailySheet> & { projectCode: string; projectId: string }) => {
      const { projectCode, ...sheetData } = data;
      const response = await apiRequest("POST", "/api/tm-sheets", sheetData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "tm-sheets"] });
    },
  });
}

// Project Notes
export function useProjectNotes(code: string) {
  return useQuery<ProjectNote[]>({
    queryKey: ["/api/projects", code, "notes"],
    enabled: !!code,
  });
}

export function useCreateProjectNote() {
  return useMutation({
    mutationFn: async (data: Partial<ProjectNote> & { projectCode: string }) => {
      const { projectCode, ...noteData } = data;
      const response = await apiRequest("POST", `/api/projects/${projectCode}/notes`, noteData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "notes"] });
    },
  });
}

// Media
export function useProjectMedia(code: string) {
  return useQuery<Media[]>({
    queryKey: ["/api/projects", code, "media"],
    enabled: !!code,
  });
}

export function useCreateMedia() {
  return useMutation({
    mutationFn: async (data: Partial<Media> & { projectCode: string }) => {
      const { projectCode, ...mediaData } = data;
      const response = await apiRequest("POST", `/api/projects/${projectCode}/media`, mediaData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "media"] });
    },
  });
}

export function useDeleteMedia() {
  return useMutation({
    mutationFn: async ({ id, projectCode }: { id: string; projectCode: string }) => {
      const response = await apiRequest("DELETE", `/api/media/${id}`);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "media"] });
    },
  });
}

// Estimates
export function useProjectEstimates(code: string) {
  return useQuery<Estimate[]>({
    queryKey: ["/api/projects", code, "estimates"],
    enabled: !!code,
  });
}

export function useCreateEstimate() {
  return useMutation({
    mutationFn: async (data: Partial<Estimate> & { projectCode: string; projectId: string }) => {
      const { projectCode, ...estimateData } = data;
      const response = await apiRequest("POST", "/api/estimates", estimateData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "estimates"] });
    },
  });
}

// Procurement
export function useProjectProcurement(code: string) {
  return useQuery<ProcurementItem[]>({
    queryKey: ["/api/projects", code, "procurement"],
    enabled: !!code,
  });
}

export function useCreateProcurementItem() {
  return useMutation({
    mutationFn: async (data: Partial<ProcurementItem> & { projectCode: string; projectId: string }) => {
      const { projectCode, ...itemData } = data;
      const response = await apiRequest("POST", "/api/procurement", itemData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "procurement"] });
    },
  });
}

export function useUpdateProcurementItem() {
  return useMutation({
    mutationFn: async ({ id, data, projectCode }: { id: string; data: Partial<ProcurementItem>; projectCode: string }) => {
      const response = await apiRequest("PATCH", `/api/procurement/${id}`, data);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "procurement"] });
    },
  });
}

// Documents
export function useProjectDocuments(code: string) {
  return useQuery<PlanDocument[]>({
    queryKey: ["/api/projects", code, "documents"],
    enabled: !!code,
  });
}

export function useCreateDocument() {
  return useMutation({
    mutationFn: async (data: Partial<PlanDocument> & { projectCode: string; projectId: string }) => {
      const { projectCode, ...docData } = data;
      const response = await apiRequest("POST", "/api/documents", docData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "documents"] });
    },
  });
}

// Receipts
export function useProjectReceipts(code: string) {
  return useQuery<Receipt[]>({
    queryKey: ["/api/projects", code, "receipts"],
    enabled: !!code,
  });
}

export function useCreateReceipt() {
  return useMutation({
    mutationFn: async (data: Partial<Receipt> & { projectCode: string; projectId: string }) => {
      const { projectCode, ...receiptData } = data;
      const response = await apiRequest("POST", "/api/receipts", receiptData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "receipts"] });
    },
  });
}

// Subcontractor Payments
export interface SubcontractorPayment {
  id: string;
  contractId: string;
  paymentNumber: number;
  amount: string;
  retentionHeld: string | null;
  paymentDate: string | null;
  description: string | null;
  invoiceNumber: string | null;
  status: string;
  approvedById: string | null;
  approvedAt: string | null;
  paidById: string | null;
  paidAt: string | null;
  createdAt: string;
}

export function useContractPayments(contractId: string) {
  return useQuery<SubcontractorPayment[]>({
    queryKey: ["/api/subcontractor-contracts", contractId, "payments"],
    enabled: !!contractId,
  });
}

export function useCreateSubcontractorPayment() {
  return useMutation({
    mutationFn: async (data: { 
      contractId: string; 
      projectCode: string;
      amount: string; 
      description?: string;
      invoiceNumber?: string;
      paymentDate?: string;
    }) => {
      const { contractId, projectCode, ...paymentData } = data;
      const response = await apiRequest("POST", `/api/subcontractor-contracts/${contractId}/payments`, paymentData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-contracts", variables.contractId, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-payables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "financials"] });
    },
  });
}

// Bids
export function useBids() {
  return useQuery<Bid[]>({
    queryKey: ["/api/bids"],
  });
}

export function useBid(code: string) {
  return useQuery<Bid>({
    queryKey: ["/api/bids", code],
    enabled: !!code,
  });
}

export function useCreateBid() {
  return useMutation({
    mutationFn: async (data: Partial<Bid>) => {
      const response = await apiRequest("POST", "/api/bids", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
    },
  });
}

export function useUpdateBid() {
  return useMutation({
    mutationFn: async ({ code, data }: { code: string; data: Partial<Bid> }) => {
      const response = await apiRequest("PATCH", `/api/bids/${code}`, data);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bids", variables.code] });
    },
  });
}

export function useDeleteBid() {
  return useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("DELETE", `/api/bids/${code}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
    },
  });
}

export function useConvertBidToProject() {
  return useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", `/api/bids/${code}/convert`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });
}

// Projects mutations
export function useCreateProject() {
  return useMutation({
    mutationFn: async (data: Partial<Project>) => {
      const response = await apiRequest("POST", "/api/projects", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });
}

export function useUpdateProject() {
  return useMutation({
    mutationFn: async ({ code, data }: { code: string; data: Partial<Project> }) => {
      const response = await apiRequest("PATCH", `/api/projects/${code}`, data);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.code] });
    },
  });
}

// Scope Items mutations  
export function useCreateScopeItem() {
  return useMutation({
    mutationFn: async (data: Partial<ScopeItem> & { projectCode: string }) => {
      const { projectCode, ...scopeData } = data;
      const response = await apiRequest("POST", `/api/projects/${projectCode}/scope`, scopeData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "scope"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

export function useDeleteScopeItem() {
  return useMutation({
    mutationFn: async ({ id, projectCode }: { id: string; projectCode: string }) => {
      const response = await apiRequest("DELETE", `/api/scope-items/${id}`);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "scope"] });
    },
  });
}

// Time Clock
interface ClockInData {
  projectId: string;
  latitude?: number;
  longitude?: number;
}

interface ClockOutData {
  latitude?: number;
  longitude?: number;
}

export function useCurrentShift() {
  return useQuery<{ shift: TimeClockShift | null; project?: Project | null }>({
    queryKey: ["/api/time-clock/my-current-shift"],
    refetchInterval: 30000, // Refetch every 30 seconds to keep shift status fresh
  });
}

export function useClockIn() {
  return useMutation({
    mutationFn: async (data: ClockInData) => {
      const response = await apiRequest("POST", "/api/time-clock/clock-in", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/my-current-shift"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/my-shifts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/active-shifts"] });
    },
  });
}

export function useClockOut() {
  return useMutation({
    mutationFn: async (data: ClockOutData) => {
      const response = await apiRequest("POST", "/api/time-clock/clock-out", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/my-current-shift"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/my-shifts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/active-shifts"] });
    },
  });
}

export function useMyShifts() {
  return useQuery<TimeClockShift[]>({
    queryKey: ["/api/time-clock/my-shifts"],
  });
}

export function useActiveShifts() {
  return useQuery<TimeClockShift[]>({
    queryKey: ["/api/time-clock/active-shifts"],
    refetchInterval: 15000, // Refresh every 15 seconds for live monitoring
  });
}

export function usePendingShiftApprovals() {
  return useQuery<TimeClockShift[]>({
    queryKey: ["/api/time-clock/pending-approvals"],
  });
}

export function useApproveShift() {
  return useMutation({
    mutationFn: async ({ shiftId, createTimeEntry }: { shiftId: string; createTimeEntry?: boolean }) => {
      const response = await apiRequest("POST", `/api/time-clock/shifts/${shiftId}/approve`, { createTimeEntry });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/my-shifts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
    },
  });
}

export function useRejectShift() {
  return useMutation({
    mutationFn: async ({ shiftId, reason }: { shiftId: string; reason: string }) => {
      const response = await apiRequest("POST", `/api/time-clock/shifts/${shiftId}/reject`, { reason });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/my-shifts"] });
    },
  });
}

export function useAdjustShift() {
  return useMutation({
    mutationFn: async ({ 
      shiftId, 
      clockIn, 
      clockOut, 
      reason 
    }: { 
      shiftId: string; 
      clockIn?: string; 
      clockOut?: string; 
      reason: string;
    }) => {
      const response = await apiRequest("POST", `/api/time-clock/shifts/${shiftId}/adjust`, {
        clockIn,
        clockOut,
        reason,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/my-shifts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/active-shifts"] });
    },
  });
}

// Project Labor Rates
export interface ProjectLaborRate {
  id: string;
  projectId: string;
  defaultRegularRate: string;
  defaultOvertimeRate: string;
  burdenMultiplier: string;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectEmployeeRate {
  id: string;
  projectId: string;
  userId: string;
  regularRate: string;
  overtimeRate: string;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  };
}

export function useProjectLaborRates(code: string) {
  return useQuery<ProjectLaborRate | null>({
    queryKey: ["/api/projects", code, "labor-rates"],
    enabled: !!code,
  });
}

export function useUpdateProjectLaborRates() {
  return useMutation({
    mutationFn: async ({ projectCode, data }: { projectCode: string; data: { defaultRegularRate: string | number; defaultOvertimeRate: string | number; burdenMultiplier: string | number; notes?: string; } }) => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/labor-rates`, data);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "labor-rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "financials"] });
    },
  });
}

export function useProjectEmployeeRates(code: string) {
  return useQuery<ProjectEmployeeRate[]>({
    queryKey: ["/api/projects", code, "employee-rates"],
    enabled: !!code,
  });
}

export function useUpdateProjectEmployeeRate() {
  return useMutation({
    mutationFn: async ({ projectCode, data }: { projectCode: string; data: { userId: string; regularRate: string | number; overtimeRate: string | number; notes?: string; } }) => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/employee-rates`, data);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "employee-rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "financials"] });
    },
  });
}

export function useDeleteProjectEmployeeRate() {
  return useMutation({
    mutationFn: async ({ projectCode, rateId }: { projectCode: string; rateId: string; }) => {
      const response = await apiRequest("DELETE", `/api/projects/${projectCode}/employee-rates/${rateId}`);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "employee-rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "financials"] });
    },
  });
}
