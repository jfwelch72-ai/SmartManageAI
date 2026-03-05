import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { z } from "zod";
import type { Equipment } from "@shared/schema";

export const editEquipmentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
  status: z.string().min(1, "Status is required"),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.coerce.number().optional(),
  serialNumber: z.string().optional(),
  vinNumber: z.string().optional(),
  licensePlate: z.string().optional(),
  currentHours: z.string().optional(),
  purchasePrice: z.string().optional(),
  homeLocation: z.string().optional(),
  currentLocation: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

export const assignmentSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  expectedReturnDate: z.string().optional(),
  notes: z.string().optional(),
});

export const returnEquipmentSchema = z.object({
  returnCondition: z.string().optional(),
  endingHours: z.string().optional(),
  notes: z.string().optional(),
});

export const repairSchema = z.object({
  description: z.string().min(1, "Description is required"),
  problemDescription: z.string().min(1, "Problem description is required"),
  repairLocation: z.string().optional(),
  estimatedCost: z.string().optional(),
  estimatedCompletionDate: z.string().optional(),
});

export const hourLogSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  weekStartDate: z.string().min(1, "Week start date is required"),
  weekEndDate: z.string().min(1, "Week end date is required"),
  startingHours: z.string().min(1, "Starting hours is required"),
  endingHours: z.string().min(1, "Ending hours is required"),
  notes: z.string().optional(),
  fuelUsed: z.string().optional(),
});

export const rateProfileSchema = z.object({
  hourlyRate: z.string().min(1, "Hourly rate is required"),
  dailyRate: z.string().optional(),
  weeklyRate: z.string().optional(),
  monthlyRate: z.string().optional(),
  fuelCostPerHour: z.string().optional(),
  maintenanceCostPerHour: z.string().optional(),
  operatorCostPerHour: z.string().optional(),
  includesOperator: z.boolean().default(false),
  effectiveDate: z.string().min(1, "Effective date is required"),
  notes: z.string().optional(),
  isActive: z.boolean().default(true),
});

interface AIRecommendation {
  recommendedTasks: { task: string; priority: string; estimatedCost: number; estimatedHours: number }[];
  recommendedParts: { part: string; quantity: number; estimatedCost: number; supplier: string }[];
  preventativeSchedule: { interval: string; task: string; description: string }[];
  urgency: string;
  estimatedTotalCost: number;
  summary: string;
  warningsOrNotes: string[];
}

interface MaintenanceScheduleResponse {
  schedules: { id: string }[];
  manufacturerNotes?: string;
  totalAnnualMaintenanceCost?: number;
  criticalItems?: string[];
}

export type EditEquipmentInput = {
  name: string;
  type: string;
  status: string;
  make?: string;
  model?: string;
  year?: number;
  serialNumber?: string;
  vinNumber?: string;
  licensePlate?: string;
  currentHours?: string;
  purchasePrice?: string;
  homeLocation?: string;
  currentLocation?: string;
  description?: string;
  notes?: string;
};

export type AssignmentInput = {
  projectId: string;
  expectedReturnDate?: string;
  notes?: string;
};

export type ReturnEquipmentInput = {
  returnCondition?: string;
  endingHours?: string;
  notes?: string;
};

export type RepairInput = {
  description: string;
  problemDescription: string;
  repairLocation?: string;
  estimatedCost?: string;
  estimatedCompletionDate?: string;
};

export type HourLogInput = {
  projectId: string;
  weekStartDate: string;
  weekEndDate: string;
  startingHours: string;
  endingHours: string;
  notes?: string;
  fuelUsed?: string;
};

export type RateProfileInput = {
  hourlyRate: string;
  dailyRate?: string;
  weeklyRate?: string;
  monthlyRate?: string;
  fuelCostPerHour?: string;
  maintenanceCostPerHour?: string;
  operatorCostPerHour?: string;
  includesOperator: boolean;
  effectiveDate: string;
  notes?: string;
  isActive: boolean;
};

export function useEquipmentMutations(equipment: Equipment | undefined) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [aiRecommendations, setAiRecommendations] = useState<AIRecommendation | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);

  const updateEquipment = useMutation({
    mutationFn: async (data: EditEquipmentInput) => {
      return apiRequest("PATCH", `/api/equipment/${equipment?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Equipment updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update equipment", variant: "destructive" });
    },
  });

  const assignEquipment = useMutation({
    mutationFn: async (data: AssignmentInput) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/assign`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Equipment assigned successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to assign equipment", variant: "destructive" });
    },
  });

  const returnEquipment = useMutation({
    mutationFn: async (data: ReturnEquipmentInput) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/return`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Equipment returned successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to return equipment", variant: "destructive" });
    },
  });

  const createRepair = useMutation({
    mutationFn: async (data: RepairInput) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/repairs`, data);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Repair request submitted" });
      setAiRecommendations(null);
      try {
        await apiRequest("POST", "/api/equipment/notify-maintenance", {
          equipmentId: equipment?.id,
          message: `New repair request for ${equipment?.name} (${equipment?.equipmentCode})`,
          type: "REPAIR",
        });
      } catch (e) {
        console.error("Failed to send notification:", e);
      }
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create repair", variant: "destructive" });
    },
  });

  const submitHourLog = useMutation({
    mutationFn: async (data: HourLogInput) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/hour-logs`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Hour log submitted" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to submit hour log", variant: "destructive" });
    },
  });

  const updateRepairStatus = useMutation({
    mutationFn: async ({ repairId, status }: { repairId: string; status: string }) => {
      return apiRequest("PATCH", `/api/equipment/repairs/${repairId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Repair status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update repair status", variant: "destructive" });
    },
  });

  const generateSchedule = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/equipment/${equipment?.id}/generate-maintenance-schedule`, {});
      return res.json();
    },
    onSuccess: (data: MaintenanceScheduleResponse) => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipment?.id, "maintenance-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: `Generated ${data.schedules.length} maintenance schedule items` });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to generate maintenance schedule", variant: "destructive" });
    },
  });

  const completeMaintenance = useMutation({
    mutationFn: async ({ scheduleId, data }: { scheduleId: string; data: { notes?: string; laborCost?: string; partsCost?: string; performedByVendor?: string } }) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/maintenance-schedules/${scheduleId}/complete`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipment?.id, "maintenance-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipment?.id, "maintenance-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Maintenance marked as completed" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to complete maintenance", variant: "destructive" });
    },
  });

  const createRateMutation = useMutation({
    mutationFn: async (data: RateProfileInput) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/rate-profiles`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipment?.id, "rate-profiles"] });
      toast({ title: "Success", description: "Rate profile created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create rate profile", variant: "destructive" });
    },
  });

  const updateRateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: RateProfileInput }) => {
      return apiRequest("PATCH", `/api/equipment/${equipment?.id}/rate-profiles/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipment?.id, "rate-profiles"] });
      toast({ title: "Success", description: "Rate profile updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update rate profile", variant: "destructive" });
    },
  });

  const activateRateMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/rate-profiles/${id}/activate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipment?.id, "rate-profiles"] });
      toast({ title: "Success", description: "Rate profile activated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to activate rate profile", variant: "destructive" });
    },
  });

  const fetchAIRecommendations = async (problemDescription: string) => {
    if (!equipment?.id) return;
    setLoadingAI(true);
    try {
      const response = await fetch(`/api/equipment/${equipment.id}/ai-recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ problemDescription }),
      });
      if (!response.ok) throw new Error("Failed to get AI recommendations");
      const data = await response.json();
      setAiRecommendations(data);
    } catch (error) {
      toast({ title: "AI Error", description: "Failed to fetch AI recommendations", variant: "destructive" });
    } finally {
      setLoadingAI(false);
    }
  };

  return {
    updateEquipment,
    assignEquipment,
    returnEquipment,
    createRepair,
    submitHourLog,
    updateRepairStatus,
    generateSchedule,
    completeMaintenance,
    createRateMutation,
    updateRateMutation,
    activateRateMutation,
    fetchAIRecommendations,
    aiRecommendations,
    setAiRecommendations,
    loadingAI,
  };
}

export type { AIRecommendation };
