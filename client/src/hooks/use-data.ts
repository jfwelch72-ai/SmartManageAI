import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Project, ScopeItem, ChangeOrder, CalendarEvent, Notification } from "@shared/schema";

// Projects
export function useProject(code: string) {
  return useQuery({
    queryKey: ["/api/projects", code],
    enabled: !!code,
  });
}

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ["/api/projects"],
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
    mutationFn: async ({ id, data }: { id: string; data: Partial<ScopeItem> }) => {
      return apiRequest(`/api/scope-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
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
    mutationFn: async (data: Partial<ChangeOrder>) => {
      return apiRequest("/api/change-orders", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });
}

export function useApproveChangeOrder() {
  return useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/change-orders/${id}/approve`, { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

export function useRejectChangeOrder() {
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      return apiRequest(`/api/change-orders/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ rejectionReason: reason }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
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
      return apiRequest("/api/calendar/events", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
    },
  });
}

export function useApproveTimeOff() {
  return useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/calendar/events/${id}/approve`, { method: "POST" });
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
      return apiRequest(`/api/notifications/${id}/read`, { method: "PATCH" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  return useMutation({
    mutationFn: async () => {
      return apiRequest("/api/notifications/read-all", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });
}
