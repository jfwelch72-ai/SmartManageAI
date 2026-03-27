import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePageVisible } from "@/hooks/use-page-visible";
import type { Project, ScopeItem, ChangeOrder, CalendarEvent, Notification, TimeEntry, TMDailySheet, ProjectNote, Media, Bid, Estimate, ProcurementItem, PlanDocument, Receipt, TimeClockShift, Crew, CrewProjectAssignment, LeaveType, LeaveRequest } from "@shared/schema";

// Dashboard
interface DashboardStats {
  activeProjectsCount: number;
  pendingChangeOrdersCount: number;
  pendingTimeOffCount: number;
  activeDelaysCount: number;
  delaysNeedingAckCount: number;
  delaysNeedingChangeOrderCount: number;
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

// Leave Management
export interface LeaveBalance {
  leaveTypeId: string;
  leaveTypeName: string;
  annualAllowance: number;
  used: number;
  remaining: number;
}

export interface LeaveRequestWithDetails extends LeaveRequest {
  employeeFirstName: string | null;
  employeeLastName: string | null;
  leaveTypeName: string | null;
}

export function useLeaveTypes() {
  return useQuery<LeaveType[]>({
    queryKey: ["/api/leave/types"],
  });
}

export function useLeaveBalances(employeeId?: string) {
  const queryString = employeeId ? `?employeeId=${employeeId}` : "";
  return useQuery<LeaveBalance[]>({
    queryKey: ["/api/leave/balances", employeeId],
    queryFn: async () => {
      const response = await fetch(`/api/leave/balances${queryString}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch leave balances");
      return response.json();
    },
  });
}

export function useLeaveRequests(params?: { status?: string; scope?: string; employeeId?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.scope) searchParams.set("scope", params.scope);
  if (params?.employeeId) searchParams.set("employeeId", params.employeeId);
  const queryString = searchParams.toString();
  return useQuery<LeaveRequestWithDetails[]>({
    queryKey: ["/api/leave/requests", params],
    queryFn: async () => {
      const response = await fetch(`/api/leave/requests${queryString ? `?${queryString}` : ""}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch leave requests");
      return response.json();
    },
  });
}

export interface TeamLeaveEntry {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  leaveTypeName: string | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
}

export function useTeamLeaveCalendar() {
  return useQuery<TeamLeaveEntry[]>({
    queryKey: ["/api/leave/team-calendar"],
  });
}

export function useCreateLeaveRequest() {
  return useMutation({
    mutationFn: async (data: { leaveTypeId: string; startDate: string; endDate: string; reason?: string }) => {
      const response = await apiRequest("POST", "/api/leave/requests", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/balances"] });
    },
  });
}

export function useApproveLeaveRequest() {
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const response = await apiRequest("POST", `/api/leave/requests/${id}/approve`, { note });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/team-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

export function useDenyLeaveRequest() {
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const response = await apiRequest("POST", `/api/leave/requests/${id}/deny`, { note });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/team-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
    },
  });
}

export function useCancelLeaveRequest() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/leave/requests/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/team-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
    },
  });
}

export function useUpdateLeaveRequest() {
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; leaveTypeId?: string; startDate?: string; endDate?: string; reason?: string }) => {
      const response = await apiRequest("PATCH", `/api/leave/requests/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/balances"] });
    },
  });
}

export function useCreateLeaveType() {
  return useMutation({
    mutationFn: async (data: { name: string; annualAllowance: number; isActive?: boolean }) => {
      const response = await apiRequest("POST", "/api/leave/types", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave/types"] });
    },
  });
}

export function useUpdateLeaveType() {
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; annualAllowance?: number; isActive?: boolean }) => {
      const response = await apiRequest("PATCH", `/api/leave/types/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave/types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/balances"] });
    },
  });
}

export function useDeleteLeaveType() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/leave/types/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave/types"] });
    },
  });
}

// Messages
export function useUnreadMessageCount() {
  const isVisible = usePageVisible();
  return useQuery<{ unreadCount: number }>({
    queryKey: ["/api/messages/unread-count"],
    refetchInterval: isVisible ? 60000 : false,
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
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

export function useUpdateTimeEntry() {
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; date?: string; hoursRegular?: string; hoursOvertime?: string; costCode?: string; notes?: string; adminOverride?: boolean }) => {
      const response = await apiRequest("PATCH", `/api/time-entries/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
    },
  });
}

export function useDeleteTimeEntry() {
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/time-entries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
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

export function useDeleteProcurementItem() {
  return useMutation({
    mutationFn: async ({ id, projectCode }: { id: string; projectCode: string }) => {
      const response = await apiRequest("DELETE", `/api/procurement/${id}`);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectCode, "procurement"] });
    },
  });
}

// Procurement Module
export interface ProcurementPRItem {
  id: string;
  prId: string;
  description: string;
  category: string | null;
  quantity: string | null;
  unit: string | null;
  estimatedUnitCost: string | null;
  costCode: string | null;
}

export interface ProcurementPR {
  id: string;
  orgId: string;
  projectId: string;
  requestedById: string;
  prNumber: string;
  title: string;
  status: string;
  totalEstimatedCost: string | null;
  neededByDate: string | null;
  notes: string | null;
  rejectionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  items: ProcurementPRItem[];
  project: { name: string; code: string } | null;
  requestedBy: { firstName: string; lastName: string } | null;
}

export interface ProcurementPOItem {
  id: string;
  poId: string;
  prItemId: string | null;
  description: string;
  quantity: string | null;
  unit: string | null;
  unitCost: string | null;
  quantityReceived: string | number | null;
  costCode: string | null;
  expectedDeliveryDate: string | null;
}

export interface ProcurementPO {
  id: string;
  orgId: string;
  projectId: string;
  prId: string | null;
  vendorId: string | null;
  poNumber: string;
  status: string;
  totalCost: string | null;
  terms: string | null;
  deliveryAddress: string | null;
  neededByDate: string | null;
  notes: string | null;
  rejectionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  items: ProcurementPOItem[];
  project: { name: string; code: string } | null;
  vendor: { id: string; name: string } | null;
  receipts?: ProcurementPOReceipt[];
  invoices?: ProcurementPOInvoice[];
}

export interface ProcurementPOReceipt {
  id: string;
  status: string;
  receivedAt: string;
  deliveryNote: string | null;
  notes: string | null;
  receivedBy: { firstName: string | null; lastName: string | null } | null;
  items: { id: string; poItemId: string | null; quantityReceived: string; condition: string; notes: string | null; itemDescription?: string | null }[];
}

export interface ProcurementPOInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmount: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  notes: string | null;
  fileUrl: string | null;
  match: { matchStatus: string; poAmount?: string; invoiceAmount?: string; receivedQtyMatchPct?: string; resolvedAt?: string | null } | null;
  totalPaid: string;
  payments: InvoicePayment[];
}

export interface ProcurementInvoice {
  id: string;
  orgId: string;
  poId: string;
  vendorId: string | null;
  invoiceNumber: string;
  vendorInvoiceRef: string | null;
  invoiceDate: string | null;
  totalAmount: string | null;
  status: string;
  dueDate: string | null;
  notes: string | null;
  fileUrl: string | null;
  createdAt: string;
  updatedAt: string;
  po: { poNumber: string } | null;
  vendor: { id: string; name: string } | null;
  match: { id: string; matchStatus: string; poAmount: string; invoiceAmount: string; receivedQtyMatchPct: string; resolvedAt?: string | null } | null;
  totalPaid: string;
}

export interface InvoicePayment {
  id: string;
  orgId: string;
  invoiceId: string;
  amount: string;
  paymentDate: string;
  method: string | null;
  referenceNumber: string | null;
  notes: string | null;
  recordedById: string;
  recordedBy: { firstName: string; lastName: string } | null;
  createdAt: string;
}

export function usePurchaseRequests(filters?: { projectId?: string; status?: string; search?: string }) {
  const params = new URLSearchParams();
  if (filters?.projectId) params.set("projectId", filters.projectId);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.search) params.set("search", filters.search);
  const qs = params.toString();
  const url = `/api/procurement-module/requests${qs ? `?${qs}` : ""}`;
  return useQuery<ProcurementPR[]>({
    queryKey: ["/api/procurement-module/requests", filters?.projectId ?? "all", filters?.status ?? "all", filters?.search ?? ""],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch purchase requests");
      return res.json();
    },
  });
}

export function useCreatePurchaseRequest() {
  return useMutation({
    mutationFn: async (data: { projectId: string; title: string; neededByDate?: string | null; notes?: string | null; items?: { description: string; category?: string | null; quantity?: string | null; unit?: string | null; estimatedUnitCost?: string | null; costCode?: string | null }[] }) => {
      const response = await apiRequest("POST", "/api/procurement-module/requests", data);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/requests"] });
    },
  });
}

export function useUpdatePurchaseRequest() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ title: string; neededByDate: string | null; notes: string | null; items: { description: string; category?: string | null; quantity?: string | null; unit?: string | null; estimatedUnitCost?: string | null; costCode?: string | null }[] }> }) => {
      const response = await apiRequest("PATCH", `/api/procurement-module/requests/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/requests"] });
    },
  });
}

export function useSubmitPurchaseRequest() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/procurement-module/requests/${id}/submit`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/requests"] });
    },
  });
}

export function useApprovePurchaseRequest() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/procurement-module/requests/${id}/approve`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/requests"] });
    },
  });
}

export function useRejectPurchaseRequest() {
  return useMutation({
    mutationFn: async ({ id, rejectionNotes }: { id: string; rejectionNotes?: string }) => {
      const response = await apiRequest("POST", `/api/procurement-module/requests/${id}/reject`, { rejectionNotes });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/requests"] });
    },
  });
}

export function useConvertPRToPO() {
  return useMutation({
    mutationFn: async ({ id, vendorId }: { id: string; vendorId?: string }) => {
      const response = await apiRequest("POST", `/api/procurement-module/requests/${id}/convert-to-po`, { vendorId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
    },
  });
}

export function useDeletePurchaseRequest() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/procurement-module/requests/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/requests"] });
    },
  });
}

export function usePurchaseOrders(filters?: { projectId?: string; status?: string; search?: string }) {
  const params = new URLSearchParams();
  if (filters?.projectId) params.set("projectId", filters.projectId);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.search) params.set("search", filters.search);
  const qs = params.toString();
  const url = `/api/procurement-module/orders${qs ? `?${qs}` : ""}`;
  return useQuery<ProcurementPO[]>({
    queryKey: ["/api/procurement-module/orders", filters?.projectId ?? "all", filters?.status ?? "all", filters?.search ?? ""],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch purchase orders");
      return res.json();
    },
  });
}

export function usePurchaseOrderDetail(id: string | null) {
  return useQuery<ProcurementPO>({
    queryKey: ["/api/procurement-module/orders", id],
    enabled: !!id,
  });
}

export function useCreatePurchaseOrder() {
  return useMutation({
    mutationFn: async (data: { projectId: string; vendorId?: string | null; terms?: string | null; deliveryAddress?: string | null; neededByDate?: string | null; notes?: string | null; items?: { description: string; quantity?: string | null; unit?: string | null; unitCost?: string | null; costCode?: string | null; expectedDeliveryDate?: string | null }[] }) => {
      const response = await apiRequest("POST", "/api/procurement-module/orders", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/delivery-schedule"] });
    },
  });
}

export function useUpdatePurchaseOrder() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ vendorId: string | null; terms: string | null; deliveryAddress: string | null; neededByDate: string | null; notes: string | null; items: { description: string; quantity?: string | null; unit?: string | null; unitCost?: string | null; costCode?: string | null; expectedDeliveryDate?: string | null }[] }> }) => {
      const response = await apiRequest("PATCH", `/api/procurement-module/orders/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/delivery-schedule"] });
    },
  });
}

export function useSubmitPurchaseOrder() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/procurement-module/orders/${id}/submit`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
    },
  });
}

export function useApprovePurchaseOrder() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/procurement-module/orders/${id}/approve`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
    },
  });
}

export function useRejectPurchaseOrder() {
  return useMutation({
    mutationFn: async ({ id, rejectionNotes }: { id: string; rejectionNotes?: string }) => {
      const response = await apiRequest("POST", `/api/procurement-module/orders/${id}/reject`, { rejectionNotes });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
    },
  });
}

export function useSendPurchaseOrder() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/procurement-module/orders/${id}/send`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
    },
  });
}

export function useDeletePurchaseOrder() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/procurement-module/orders/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
    },
  });
}

export function useBulkApprovePurchaseOrders() {
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const response = await apiRequest("POST", "/api/procurement-module/orders/bulk-approve", { ids });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/delivery-schedule"] });
    },
  });
}

export interface ProcurementSummary {
  totalPOs: number;
  totalValue: string;
  committedCost: string;
  pendingApproval: number;
  totalCommitted: string;
  totalInvoiced: string;
  totalPaid: string;
}

export function useProcurementSummary(projectId?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  const qs = params.toString();
  const url = `/api/procurement-module/summary${qs ? `?${qs}` : ""}`;
  return useQuery<ProcurementSummary>({
    queryKey: ["/api/procurement-module/summary", projectId ?? "all"],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch procurement summary");
      return res.json();
    },
  });
}

export interface DeliveryScheduleItem {
  itemId: string;
  description: string;
  quantity: string | null;
  unit: string | null;
  unitCost: string | null;
  quantityReceived: string | null;
  expectedDeliveryDate: string;
  poId: string;
  poNumber: string;
  poStatus: string;
  projectId: string;
  projectName: string | null;
  projectCode: string | null;
  vendorName: string | null;
  vendorId: string | null;
}

export function useDeliverySchedule(filters?: { projectId?: string; from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (filters?.projectId) params.set("projectId", filters.projectId);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  const qs = params.toString();
  const url = `/api/procurement-module/delivery-schedule${qs ? `?${qs}` : ""}`;
  return useQuery<DeliveryScheduleItem[]>({
    queryKey: ["/api/procurement-module/delivery-schedule", filters?.projectId ?? "all", filters?.from ?? "", filters?.to ?? ""],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch delivery schedule");
      return res.json();
    },
  });
}

export interface ProcurementReceiptItem {
  id: string;
  receiptId: string;
  poItemId: string | null;
  quantityReceived: string;
  condition: string;
  notes: string | null;
  itemDescription: string | null;
}

export interface ProcurementReceipt {
  id: string;
  poId: string;
  receivedById: string;
  receivedAt: string;
  status: string;
  deliveryNote: string | null;
  notes: string | null;
  poNumber: string | null;
  receivedBy: { firstName: string; lastName: string } | null;
  vendor: { id: string; name: string } | null;
  project: { name: string; code: string | null } | null;
  items: ProcurementReceiptItem[];
}

export function useProcurementReceipts(filters?: { projectId?: string; status?: string; search?: string } | string) {
  const params = typeof filters === "string" ? { projectId: filters } : filters;
  const qp = new URLSearchParams();
  if (params?.projectId) qp.set("projectId", params.projectId);
  if (params?.status) qp.set("status", params.status);
  if (params?.search) qp.set("search", params.search);
  const qs = qp.toString();
  const url = qs ? `/api/procurement-module/receipts?${qs}` : "/api/procurement-module/receipts";
  return useQuery<ProcurementReceipt[]>({
    queryKey: ["/api/procurement-module/receipts", params?.projectId ?? "all", params?.status ?? "all", params?.search ?? ""],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch receipts");
      return res.json();
    },
  });
}

export function useCreatePOReceipt() {
  return useMutation({
    mutationFn: async ({ poId, data }: { poId: string; data: { deliveryNote?: string | null; notes?: string | null; items: { poItemId: string; quantityReceived: string; condition?: string; notes?: string | null }[] } }) => {
      const response = await apiRequest("POST", `/api/procurement-module/orders/${poId}/receipts`, data);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders", variables.poId] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/receipts"] });
    },
  });
}

export const useCreateReceipt = useCreatePOReceipt;

export function useVendorInvoices(filters?: { projectId?: string; status?: string; search?: string }) {
  const params = new URLSearchParams();
  if (filters?.projectId) params.set("projectId", filters.projectId);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.search) params.set("search", filters.search);
  const qs = params.toString();
  const url = `/api/procurement-module/invoices${qs ? `?${qs}` : ""}`;
  return useQuery<ProcurementInvoice[]>({
    queryKey: ["/api/procurement-module/invoices", filters?.projectId ?? "all", filters?.status ?? "all", filters?.search ?? ""],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
  });
}

export function useCreateVendorInvoice() {
  return useMutation({
    mutationFn: async (data: { poId: string; invoiceNumber: string; invoiceDate: string; totalAmount: string; vendorId?: string | null; dueDate?: string | null; notes?: string | null; fileUrl?: string | null; items?: { poItemId: string; description: string; quantity: string; unitCost: string; amount: string }[] }) => {
      const response = await apiRequest("POST", "/api/procurement-module/invoices", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
    },
  });
}

export function useUpdateVendorInvoice() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ invoiceNumber: string; invoiceDate: string; totalAmount: string; dueDate: string | null; notes: string | null; fileUrl: string | null }> }) => {
      const response = await apiRequest("PATCH", `/api/procurement-module/invoices/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/invoices"] });
    },
  });
}

export function useInvoiceMatch(invoiceId: string | null) {
  return useQuery<{ matchStatus: string; amountMatchPct: string; receivedQtyMatchPct: string; invoiceAmount: string; poAmount: string; notes: string | null } | null>({
    queryKey: ["/api/procurement-module/invoices", invoiceId, "match"],
    enabled: !!invoiceId,
  });
}

export function useCreateInvoiceMatch() {
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const response = await apiRequest("POST", `/api/procurement-module/invoices/${invoiceId}/match`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
    },
  });
}

export function useResolveMatchDiscrepancy() {
  return useMutation({
    mutationFn: async ({ invoiceId, notes }: { invoiceId: string; notes: string }) => {
      const response = await apiRequest("POST", `/api/procurement-module/invoices/${invoiceId}/match/resolve`, { notes });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/orders"] });
    },
  });
}

export function useInvoicePayments(invoiceId: string | null) {
  return useQuery<InvoicePayment[]>({
    queryKey: ["/api/procurement-module/invoices", invoiceId, "payments"],
    queryFn: async () => {
      const res = await fetch(`/api/procurement-module/invoices/${invoiceId}/payments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch payments");
      return res.json();
    },
    enabled: !!invoiceId,
  });
}

export function useCreateInvoicePayment() {
  return useMutation({
    mutationFn: async ({ invoiceId, data }: { invoiceId: string; data: { amount: string; paymentDate: string; method?: string | null; referenceNumber?: string | null; notes?: string | null } }) => {
      const response = await apiRequest("POST", `/api/procurement-module/invoices/${invoiceId}/payments`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/invoices"] });
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

export function useCreateProjectReceipt() {
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
    refetchInterval: 30000, // Poll every 30 seconds for realtime updates
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    staleTime: 10000, // Consider data stale after 10 seconds
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
    onSuccess: (_data, code) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bids", code] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });
}

export interface ConvertBidData {
  code: string;
  superintendentId?: string;
  projectManagerId?: string;
  overheadPercent?: number;
  profitPercent?: number;
  startStatus?: "ACTIVE" | "PLANNING";
}

export function useConvertBidToProject() {
  return useMutation({
    mutationFn: async (data: ConvertBidData) => {
      const { code, superintendentId, projectManagerId, overheadPercent, profitPercent, startStatus } = data;
      const response = await apiRequest("POST", `/api/bids/${code}/convert`, {
        superintendentId,
        projectManagerId,
        overheadPercent,
        profitPercent,
        startStatus,
      });
      return response.json();
    },
    onSuccess: () => {
      // Invalidate bids cache so awarded status shows immediately
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
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

export function useDeleteProject() {
  return useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("DELETE", `/api/projects/${code}`);
      return response.json();
    },
    onSuccess: (_data, code) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", code] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/shifts"] });
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

export function useMyShifts(params?: { startDate?: string; endDate?: string; pageSize?: number }) {
  const queryParams = new URLSearchParams();
  if (params?.startDate) queryParams.set("startDate", params.startDate);
  if (params?.endDate) queryParams.set("endDate", params.endDate);
  if (params?.pageSize) queryParams.set("pageSize", String(params.pageSize));
  const qs = queryParams.toString();
  const url = `/api/time-clock/my-shifts${qs ? `?${qs}` : ""}`;
  return useQuery<TimeClockShift[]>({
    queryKey: [url],
  });
}

export function useOvertimeApprovers() {
  return useQuery<any[]>({
    queryKey: ["/api/overtime-requests/approvers"],
  });
}

export function useOvertimeRequestsByShifts(shiftIds: string[]) {
  return useQuery<any[]>({
    queryKey: ["/api/overtime-requests/by-shifts", shiftIds],
    queryFn: async () => {
      if (shiftIds.length === 0) return [];
      const response = await apiRequest("POST", "/api/overtime-requests/by-shifts", { shiftIds });
      return response.json();
    },
    enabled: shiftIds.length > 0,
  });
}

export function useCreateOvertimeRequest() {
  return useMutation({
    mutationFn: async (data: { shiftId: string; requestedHours: string; superintendentId: string; notes?: string }) => {
      const response = await apiRequest("POST", "/api/overtime-requests", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-requests/by-shifts"] });
    },
  });
}

export function usePendingOvertimeRequests() {
  return useQuery<any[]>({
    queryKey: ["/api/overtime-requests/pending"],
  });
}

export function useApproveOvertimeRequest() {
  return useMutation({
    mutationFn: async ({ id, approvedHours }: { id: string; approvedHours?: string }) => {
      const response = await apiRequest("POST", `/api/overtime-requests/${id}/approve`, { approvedHours });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-requests/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-requests/by-shifts"] });
    },
  });
}

export function useRejectOvertimeRequest() {
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const response = await apiRequest("POST", `/api/overtime-requests/${id}/reject`, { reason });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-requests/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-requests/by-shifts"] });
    },
  });
}

export function useActiveShifts() {
  return useQuery<TimeClockShift[]>({
    queryKey: ["/api/time-clock/active-shifts"],
    refetchInterval: 30000,
  });
}

export function usePendingShiftApprovals() {
  return useQuery<TimeClockShift[]>({
    queryKey: ["/api/time-clock/pending-approvals"],
    refetchInterval: 30000,
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

// Time Entry Approvals (for PM-reviewed time)
export interface PendingTimeEntry {
  id: string;
  userId: string;
  projectId: string;
  date: string;
  hoursRegular: string | null;
  hoursOvertime: string | null;
  notes: string | null;
  approvalStatus: string;
  userName: string;
  userEmail: string | null;
  userRole: string | null;
  projectName: string | null;
  projectCode: string | null;
}

export function usePendingTimeEntryApprovals() {
  return useQuery<PendingTimeEntry[]>({
    queryKey: ["/api/time-entries/pending-approvals"],
    refetchInterval: 30000,
  });
}

export function useRejectTimeEntry() {
  return useMutation({
    mutationFn: async ({ entryId, reason }: { entryId: string; reason: string }) => {
      const response = await apiRequest("POST", `/api/time-entries/${entryId}/reject`, { reason });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
    },
  });
}

export function useBulkApproveTimeEntries() {
  return useMutation({
    mutationFn: async (entryIds: string[]) => {
      const response = await apiRequest("PATCH", "/api/time-entries/batch-approve", { entryIds });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
    },
  });
}

// Payroll Notifications
export interface PayrollNotification {
  id: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  projectId: string | null;
  approvingManagerId: string;
  officeManagerId: string | null;
  status: string;
  totalShiftsApproved: number;
  totalTimeEntriesApproved: number;
  totalHours: string | null;
  processedAt: Date | null;
  processedById: string | null;
  createdAt: Date;
  managerName: string;
  projectName: string | null;
  projectCode: string | null;
}

export function usePayrollNotifications() {
  return useQuery<PayrollNotification[]>({
    queryKey: ["/api/payroll-notifications"],
  });
}

export function useCreatePayrollNotification() {
  return useMutation({
    mutationFn: async (data: {
      periodStart: string;
      periodEnd: string;
      projectId?: string | null;
      totalShiftsApproved?: number;
      totalTimeEntriesApproved?: number;
      totalHours?: string | null;
    }) => {
      const response = await apiRequest("POST", "/api/payroll-notifications", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-notifications"] });
    },
  });
}

export function useProcessPayrollNotification() {
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await apiRequest("PATCH", `/api/payroll-notifications/${notificationId}/process`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-notifications"] });
    },
  });
}

// Time Clock Approval Summary
export interface ApprovalSummary {
  period: { start: string; end: string };
  shifts: { pending: number; approved: number; rejected: number; totalHours: number };
  entries: { pending: number; approved: number; rejected: number; totalHours: number };
  totals: { pendingItems: number; approvedItems: number; rejectedItems: number; totalHours: number };
}

export function useApprovalSummary(startDate: string, endDate: string, projectId?: string) {
  const searchParams = new URLSearchParams({ startDate, endDate });
  if (projectId) searchParams.append("projectId", projectId);
  
  return useQuery<ApprovalSummary>({
    queryKey: ["/api/time-clock/approval-summary", startDate, endDate, projectId],
    enabled: !!startDate && !!endDate,
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

// T&M Tickets - matches database schema
export interface TMTicket {
  id: string;
  projectId: string;
  ticketNumber: string;
  workDate: string;
  scopeDescription: string;
  notes: string | null;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  totalLaborHours: string;
  totalLaborCost: string;
  totalEquipmentCost: string;
  totalMaterialCost: string;
  grandTotal: string;
  rejectionReason: string | null;
  clientSignoffName: string | null;
  clientSignoffSignature: string | null;
  clientSignoffAt: string | null;
  signedDocumentUrl: string | null;
  costCode: string | null;
  billingStatus: string;
  location: string | null;
  createdById: string;
  createdByName: string | null;
  approvedById: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  submittedAt: string | null;
  laborEntries?: TMTicketLaborEntry[];
  equipmentEntries?: TMTicketEquipmentEntry[];
  materialEntries?: TMTicketMaterialEntry[];
}

export interface TMTicketLaborEntry {
  id: string;
  ticketId: string;
  employeeName: string;
  position: string;
  crewMemberCount: number;
  hoursWorked: string;
  totalHours: string;
  hourlyRate: string | null;
  totalCost: string | null;
}

export interface TMTicketEquipmentEntry {
  id: string;
  ticketId: string;
  equipmentType: string;
  quantity: number;
  hoursUsed: string;
  hourlyRate: string | null;
  totalCost: string | null;
}

export interface TMTicketMaterialEntry {
  id: string;
  ticketId: string;
  materialDescription: string;
  quantity: string;
  unit: string | null;
  unitCost: string | null;
  totalCost: string | null;
}

export function useTMTickets(projectId: string) {
  return useQuery<TMTicket[]>({
    queryKey: ["/api/projects", projectId, "tm-tickets"],
    enabled: !!projectId,
  });
}

export function useTMTicket(ticketId: string) {
  return useQuery<TMTicket>({
    queryKey: ["/api/tm-tickets", ticketId],
    enabled: !!ticketId,
  });
}

export function useCreateTMTicket() {
  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      workDate: string;
      description: string;
      location?: string;
      costCode?: string;
      workTypeId?: string;
      workTypeCode?: string;
      workTypeName?: string;
      categoryName?: string;
      scopeModifierIds?: string;
      scopeModifierNames?: string;
      canonicalName?: string;
      scopeUnit?: string;
      scopeQuantity?: string;
      laborEntries?: Array<{
        employeeName: string;
        position?: string;
        crewName?: string;
        regularHours: string;
        overtimeHours?: string;
        rate: string;
        overtimeRate?: string;
      }>;
      equipmentEntries?: Array<{
        equipmentType: string;
        description?: string;
        quantity: string;
        hours: string;
        rate: string;
      }>;
      materialEntries?: Array<{
        description: string;
        quantity: string;
        unit?: string;
        unitCost: string;
      }>;
    }) => {
      const { projectId, ...ticketData } = data;
      const response = await apiRequest("POST", `/api/projects/${projectId}/tm-tickets`, ticketData);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectId, "tm-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });
}

export function useUpdateTMTicket() {
  return useMutation({
    mutationFn: async ({ ticketId, projectId, data }: {
      ticketId: string;
      projectId: string;
      data: {
        workDate?: string;
        description?: string;
        location?: string;
        laborEntries?: Array<{
          id?: string;
          employeeName: string;
          position?: string;
          crewName?: string;
          regularHours: string;
          overtimeHours?: string;
          rate: string;
          overtimeRate?: string;
        }>;
        equipmentEntries?: Array<{
          id?: string;
          equipmentType: string;
          description?: string;
          quantity: string;
          hours: string;
          rate: string;
        }>;
        materialEntries?: Array<{
          id?: string;
          description: string;
          quantity: string;
          unit?: string;
          unitCost: string;
        }>;
      };
    }) => {
      const response = await apiRequest("PATCH", `/api/tm-tickets/${ticketId}`, data);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-tickets", variables.ticketId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectId, "tm-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });
}

export function useSubmitTMTicket() {
  return useMutation({
    mutationFn: async ({ ticketId, projectId }: { ticketId: string; projectId: string; }) => {
      const response = await apiRequest("POST", `/api/tm-tickets/${ticketId}/submit`);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-tickets", variables.ticketId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectId, "tm-tickets"] });
    },
  });
}

export function useApproveTMTicket() {
  return useMutation({
    mutationFn: async ({ ticketId, projectId }: { ticketId: string; projectId: string; }) => {
      const response = await apiRequest("POST", `/api/tm-tickets/${ticketId}/approve`);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-tickets", variables.ticketId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectId, "tm-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });
}

export function useRejectTMTicket() {
  return useMutation({
    mutationFn: async ({ ticketId, projectId, reason }: { ticketId: string; projectId: string; reason: string; }) => {
      const response = await apiRequest("POST", `/api/tm-tickets/${ticketId}/reject`, { reason });
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-tickets", variables.ticketId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectId, "tm-tickets"] });
    },
  });
}

export function useDeleteTMTicket() {
  return useMutation({
    mutationFn: async ({ ticketId, projectId }: { ticketId: string; projectId: string; }) => {
      const response = await apiRequest("DELETE", `/api/tm-tickets/${ticketId}`);
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectId, "tm-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });
}

// Trade Features
export interface TradeFeature {
  id: string;
  tradeType: string;
  featureKey: string;
  featureName: string;
  description: string | null;
  navSection: string | null;
  navIcon: string | null;
  navPath: string | null;
  dashboardWidget: string | null;
  sortOrder: number;
  isEnabled: boolean;
  createdAt: string; // ISO string from server
}

export interface TradeFeatureResponse {
  features: TradeFeature[];
  tradeType: string | null;
}

export function useTradeFeatures() {
  return useQuery<TradeFeatureResponse>({
    queryKey: ["/api/trade-features"],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
}
