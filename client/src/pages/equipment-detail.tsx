import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  ArrowLeft, Truck, Wrench, Clock, MapPin, Calendar, DollarSign, 
  Settings2, AlertTriangle, CheckCircle, Edit, History, FileText,
  Plus, Send, Loader2, Sparkles, Package, ClipboardList, Undo2,
  CalendarClock, RefreshCw, Check, AlertCircle
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, startOfWeek, endOfWeek } from "date-fns";
import type { Equipment } from "@shared/schema";

const STATUS_OPTIONS = [
  { value: "AVAILABLE", label: "Available", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  { value: "ASSIGNED", label: "Assigned", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  { value: "IN_REPAIR", label: "In Repair", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  { value: "OUT_OF_SERVICE", label: "Out of Service", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  { value: "RETIRED", label: "Retired", color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200" },
];

const EQUIPMENT_TYPES = [
  { value: "HEAVY_EQUIPMENT", label: "Heavy Equipment" },
  { value: "POWER_TOOL", label: "Power Tool" },
  { value: "HAND_TOOL", label: "Hand Tool" },
  { value: "VEHICLE", label: "Vehicle" },
  { value: "TRAILER", label: "Trailer" },
  { value: "CONCRETE", label: "Concrete" },
  { value: "COMPACTION", label: "Compaction" },
  { value: "SURVEYING", label: "Surveying" },
  { value: "SAFETY", label: "Safety" },
  { value: "OTHER", label: "Other" },
];

const REPAIR_STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

const editEquipmentSchema = z.object({
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

const assignmentSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  expectedReturnDate: z.string().optional(),
  notes: z.string().optional(),
});

const returnEquipmentSchema = z.object({
  returnCondition: z.string().optional(),
  endingHours: z.string().optional(),
  notes: z.string().optional(),
});

const repairSchema = z.object({
  description: z.string().min(1, "Description is required"),
  problemDescription: z.string().min(1, "Problem description is required"),
  repairLocation: z.string().optional(),
  estimatedCost: z.string().optional(),
  estimatedCompletionDate: z.string().optional(),
});

const hourLogSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  weekStartDate: z.string().min(1, "Week start date is required"),
  weekEndDate: z.string().min(1, "Week end date is required"),
  startingHours: z.string().min(1, "Starting hours is required"),
  endingHours: z.string().min(1, "Ending hours is required"),
  notes: z.string().optional(),
  fuelUsed: z.string().optional(),
});

type EditEquipmentInput = z.infer<typeof editEquipmentSchema>;
type AssignmentInput = z.infer<typeof assignmentSchema>;
type ReturnEquipmentInput = z.infer<typeof returnEquipmentSchema>;
type RepairInput = z.infer<typeof repairSchema>;
type HourLogInput = z.infer<typeof hourLogSchema>;

interface AIRecommendation {
  recommendedTasks: { task: string; priority: string; estimatedCost: number; estimatedHours: number }[];
  recommendedParts: { part: string; quantity: number; estimatedCost: number; supplier: string }[];
  preventativeSchedule: { interval: string; task: string; description: string }[];
  urgency: string;
  estimatedTotalCost: number;
  summary: string;
  warningsOrNotes: string[];
}

interface MaintenanceSchedule {
  id: string;
  equipmentId: string;
  maintenanceType: string;
  name: string;
  description: string | null;
  intervalHours: number | null;
  intervalDays: number | null;
  lastPerformedAt: string | null;
  lastPerformedHours: string | null;
  nextDueAt: string | null;
  nextDueHours: string | null;
  alertDaysBefore: number;
  alertHoursBefore: number;
  isActive: boolean;
  priority?: string;
  estimatedDuration?: string;
  estimatedCost?: number;
  requiredParts?: string[];
  notes?: string;
}

interface MaintenanceScheduleResponse {
  schedules: MaintenanceSchedule[];
  manufacturerNotes?: string;
  totalAnnualMaintenanceCost?: number;
  criticalItems?: string[];
}

interface MaintenanceHistory {
  id: string;
  maintenanceType: string;
  description: string;
  performedAt: string;
  hoursAtMaintenance: string | null;
  performedByVendor: string | null;
  laborCost: string | null;
  partsCost: string | null;
  totalCost: string | null;
  notes: string | null;
  performedByName: string;
}

interface RateProfile {
  id: string;
  equipmentId: string;
  hourlyRate: string;
  dailyRate: string | null;
  weeklyRate: string | null;
  monthlyRate: string | null;
  fuelCostPerHour: string | null;
  maintenanceCostPerHour: string | null;
  operatorCostPerHour: string | null;
  includesOperator: boolean;
  effectiveDate: string;
  expirationDate: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  createdByName?: string;
}

const rateProfileSchema = z.object({
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

type RateProfileInput = z.infer<typeof rateProfileSchema>;

export default function EquipmentDetailPage() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { code } = useParams<{ code: string }>();
  
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [showRepairDialog, setShowRepairDialog] = useState(false);
  const [showHourLogDialog, setShowHourLogDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [aiRecommendations, setAiRecommendations] = useState<AIRecommendation | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [showCompleteMaintenanceDialog, setShowCompleteMaintenanceDialog] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<MaintenanceSchedule | null>(null);
  const [showRateDialog, setShowRateDialog] = useState(false);
  const [editingRate, setEditingRate] = useState<RateProfile | null>(null);
  
  const { data: equipment, isLoading, error } = useQuery<Equipment>({
    queryKey: ["/api/equipment", code],
    queryFn: async () => {
      const response = await fetch(`/api/equipment/${code}`, {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 404) throw new Error("Equipment not found");
        throw new Error("Failed to fetch equipment");
      }
      return response.json();
    },
    enabled: !!code,
  });
  
  const { data: assignments = [] } = useQuery<any[]>({
    queryKey: ["/api/equipment", equipment?.id, "assignments"],
    queryFn: async () => {
      const response = await fetch(`/api/equipment/${equipment?.id}/assignments`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch assignments");
      return response.json();
    },
    enabled: !!equipment?.id,
  });
  
  const { data: repairs = [] } = useQuery<any[]>({
    queryKey: ["/api/equipment", equipment?.id, "repairs"],
    queryFn: async () => {
      const response = await fetch(`/api/equipment/${equipment?.id}/repairs`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch repairs");
      return response.json();
    },
    enabled: !!equipment?.id,
  });
  
  const { data: hourLogs = [] } = useQuery<any[]>({
    queryKey: ["/api/equipment", equipment?.id, "hour-logs"],
    queryFn: async () => {
      const response = await fetch(`/api/equipment/${equipment?.id}/hour-logs`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch hour logs");
      return response.json();
    },
    enabled: !!equipment?.id,
  });

  const { data: availableProjects = [] } = useQuery<any[]>({
    queryKey: ["/api/equipment/available-projects"],
    queryFn: async () => {
      const response = await fetch("/api/equipment/available-projects", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const { data: maintenanceSchedules = [] } = useQuery<MaintenanceSchedule[]>({
    queryKey: ["/api/equipment", equipment?.id, "maintenance-schedules"],
    queryFn: async ({ queryKey }) => {
      const [, equipmentId] = queryKey as [string, string | undefined, string];
      if (!equipmentId) return [];
      const response = await fetch(`/api/equipment/${equipmentId}/maintenance-schedules`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch maintenance schedules");
      return response.json();
    },
    enabled: !!equipment?.id,
  });

  const { data: maintenanceHistory = [] } = useQuery<MaintenanceHistory[]>({
    queryKey: ["/api/equipment", equipment?.id, "maintenance-history"],
    queryFn: async ({ queryKey }) => {
      const [, equipmentId] = queryKey as [string, string | undefined, string];
      if (!equipmentId) return [];
      const response = await fetch(`/api/equipment/${equipmentId}/maintenance-history`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch maintenance history");
      return response.json();
    },
    enabled: !!equipment?.id,
  });

  const { data: rateProfiles = [], isLoading: isLoadingRates } = useQuery<RateProfile[]>({
    queryKey: ["/api/equipment", equipment?.id, "rate-profiles"],
    queryFn: async () => {
      if (!equipment?.id) return [];
      const response = await fetch(`/api/equipment/${equipment.id}/rate-profiles`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch rate profiles");
      return response.json();
    },
    enabled: !!equipment?.id,
  });
  
  const form = useForm<EditEquipmentInput>({
    resolver: zodResolver(editEquipmentSchema),
    defaultValues: {
      name: "",
      type: "",
      status: "",
      make: "",
      model: "",
      year: undefined,
      serialNumber: "",
      vinNumber: "",
      licensePlate: "",
      currentHours: "0",
      purchasePrice: "",
      homeLocation: "",
      currentLocation: "",
      description: "",
      notes: "",
    },
  });

  const assignmentForm = useForm<AssignmentInput>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: {
      projectId: "",
      expectedReturnDate: "",
      notes: "",
    },
  });

  const returnForm = useForm<ReturnEquipmentInput>({
    resolver: zodResolver(returnEquipmentSchema),
    defaultValues: {
      returnCondition: "",
      endingHours: equipment?.currentHours || "",
      notes: "",
    },
  });

  const repairForm = useForm<RepairInput>({
    resolver: zodResolver(repairSchema),
    defaultValues: {
      description: "",
      problemDescription: "",
      repairLocation: "",
      estimatedCost: "",
      estimatedCompletionDate: "",
    },
  });

  const hourLogForm = useForm<HourLogInput>({
    resolver: zodResolver(hourLogSchema),
    defaultValues: {
      projectId: "",
      weekStartDate: format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"),
      weekEndDate: format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"),
      startingHours: equipment?.currentHours || "0",
      endingHours: "",
      notes: "",
      fuelUsed: "",
    },
  });

  const rateForm = useForm<RateProfileInput>({
    resolver: zodResolver(rateProfileSchema),
    defaultValues: {
      hourlyRate: "",
      dailyRate: "",
      weeklyRate: "",
      monthlyRate: "",
      fuelCostPerHour: "",
      maintenanceCostPerHour: "",
      operatorCostPerHour: "",
      includesOperator: false,
      effectiveDate: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      isActive: true,
    },
  });
  
  const updateEquipment = useMutation({
    mutationFn: async (data: EditEquipmentInput) => {
      return apiRequest("PATCH", `/api/equipment/${equipment?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Equipment updated successfully" });
      setShowEditDialog(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update equipment",
        variant: "destructive" 
      });
    },
  });

  const assignEquipment = useMutation({
    mutationFn: async (data: AssignmentInput) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/assign`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Equipment assigned successfully" });
      setShowAssignDialog(false);
      assignmentForm.reset();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to assign equipment",
        variant: "destructive" 
      });
    },
  });

  const returnEquipment = useMutation({
    mutationFn: async (data: ReturnEquipmentInput) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/return`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Equipment returned successfully" });
      setShowReturnDialog(false);
      returnForm.reset();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to return equipment",
        variant: "destructive" 
      });
    },
  });

  const createRepair = useMutation({
    mutationFn: async (data: RepairInput) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/repairs`, data);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Repair request submitted" });
      setShowRepairDialog(false);
      repairForm.reset();
      setAiRecommendations(null);
      
      // Notify maintenance managers
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
      toast({ 
        title: "Error", 
        description: error.message || "Failed to create repair",
        variant: "destructive" 
      });
    },
  });

  const submitHourLog = useMutation({
    mutationFn: async (data: HourLogInput) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/hour-logs`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Hour log submitted" });
      setShowHourLogDialog(false);
      hourLogForm.reset();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to submit hour log",
        variant: "destructive" 
      });
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
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update repair status",
        variant: "destructive" 
      });
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
      toast({
        title: "Success",
        description: `Generated ${data.schedules.length} maintenance schedule items`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate maintenance schedule",
        variant: "destructive",
      });
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
      toast({
        title: "Success",
        description: "Maintenance marked as completed",
      });
      setShowCompleteMaintenanceDialog(false);
      setSelectedSchedule(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to complete maintenance",
        variant: "destructive",
      });
    },
  });

  const createRateMutation = useMutation({
    mutationFn: async (data: RateProfileInput) => {
      return apiRequest("POST", `/api/equipment/${equipment?.id}/rate-profiles`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipment?.id, "rate-profiles"] });
      toast({ title: "Success", description: "Rate profile created successfully" });
      setShowRateDialog(false);
      rateForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create rate profile",
        variant: "destructive",
      });
    },
  });

  const updateRateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: RateProfileInput }) => {
      return apiRequest("PATCH", `/api/equipment/${equipment?.id}/rate-profiles/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipment?.id, "rate-profiles"] });
      toast({ title: "Success", description: "Rate profile updated successfully" });
      setShowRateDialog(false);
      setEditingRate(null);
      rateForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update rate profile",
        variant: "destructive",
      });
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
      toast({
        title: "Error",
        description: error.message || "Failed to activate rate profile",
        variant: "destructive",
      });
    },
  });

  const fetchAIRecommendations = async () => {
    if (!equipment?.id) return;
    setLoadingAI(true);
    try {
      const response = await fetch(`/api/equipment/${equipment.id}/ai-recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ problemDescription: repairForm.getValues("problemDescription") }),
      });
      if (!response.ok) throw new Error("Failed to get AI recommendations");
      const data = await response.json();
      setAiRecommendations(data);
    } catch (error) {
      toast({
        title: "AI Error",
        description: "Failed to fetch AI recommendations",
        variant: "destructive",
      });
    } finally {
      setLoadingAI(false);
    }
  };
  
  const handleEdit = () => {
    if (equipment) {
      form.reset({
        name: equipment.name || "",
        type: equipment.type || "",
        status: equipment.status || "",
        make: equipment.make || "",
        model: equipment.model || "",
        year: equipment.year || undefined,
        serialNumber: equipment.serialNumber || "",
        vinNumber: equipment.vinNumber || "",
        licensePlate: equipment.licensePlate || "",
        currentHours: equipment.currentHours || "0",
        purchasePrice: equipment.purchasePrice || "",
        homeLocation: equipment.homeLocation || "",
        currentLocation: equipment.currentLocation || "",
        description: equipment.description || "",
        notes: equipment.notes || "",
      });
      setShowEditDialog(true);
    }
  };

  const handleOpenAssign = () => {
    assignmentForm.reset({
      projectId: "",
      expectedReturnDate: "",
      notes: "",
    });
    setShowAssignDialog(true);
  };

  const handleOpenReturn = () => {
    returnForm.reset({
      returnCondition: "",
      endingHours: equipment?.currentHours || "",
      notes: "",
    });
    setShowReturnDialog(true);
  };

  const handleOpenRepair = () => {
    repairForm.reset({
      description: "",
      problemDescription: "",
      repairLocation: "",
      estimatedCost: "",
      estimatedCompletionDate: "",
    });
    setAiRecommendations(null);
    setShowRepairDialog(true);
  };

  const handleOpenHourLog = () => {
    hourLogForm.reset({
      projectId: activeAssignment?.projectId || "",
      weekStartDate: format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"),
      weekEndDate: format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"),
      startingHours: equipment?.currentHours || "0",
      endingHours: "",
      notes: "",
      fuelUsed: "",
    });
    setShowHourLogDialog(true);
  };

  const handleCompleteMaintenance = (schedule: MaintenanceSchedule) => {
    setSelectedSchedule(schedule);
    setShowCompleteMaintenanceDialog(true);
  };

  const handleGenerateSchedule = () => {
    if (!equipment?.id) return;
    generateSchedule.mutate();
  };

  const submitCompleteMaintenance = (formData: { notes?: string; laborCost?: string; partsCost?: string; performedByVendor?: string }) => {
    if (!equipment?.id || !selectedSchedule?.id) return;
    completeMaintenance.mutate({ scheduleId: selectedSchedule.id, data: formData });
  };

  const handleEditRate = (profile: RateProfile) => {
    setEditingRate(profile);
    rateForm.reset({
      hourlyRate: profile.hourlyRate || "",
      dailyRate: profile.dailyRate || "",
      weeklyRate: profile.weeklyRate || "",
      monthlyRate: profile.monthlyRate || "",
      fuelCostPerHour: profile.fuelCostPerHour || "",
      maintenanceCostPerHour: profile.maintenanceCostPerHour || "",
      operatorCostPerHour: profile.operatorCostPerHour || "",
      includesOperator: profile.includesOperator || false,
      effectiveDate: profile.effectiveDate ? format(new Date(profile.effectiveDate), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
      notes: profile.notes || "",
      isActive: profile.isActive,
    });
    setShowRateDialog(true);
  };

  const handleRateSubmit = (data: RateProfileInput) => {
    // Convert string values to numbers and empty strings to null for backend
    const payload = {
      hourlyRate: data.hourlyRate ? data.hourlyRate : null,
      dailyRate: data.dailyRate || null,
      weeklyRate: data.weeklyRate || null,
      monthlyRate: data.monthlyRate || null,
      fuelCostPerHour: data.fuelCostPerHour || null,
      maintenanceCostPerHour: data.maintenanceCostPerHour || null,
      operatorCostPerHour: data.operatorCostPerHour || null,
      includesOperator: data.includesOperator,
      effectiveDate: data.effectiveDate,
      notes: data.notes || null,
      isActive: data.isActive,
    };
    
    if (editingRate) {
      updateRateMutation.mutate({ id: editingRate.id, data: payload as RateProfileInput });
    } else {
      createRateMutation.mutate(payload as RateProfileInput);
    }
  };

  const handleCloseRateDialog = () => {
    setShowRateDialog(false);
    setEditingRate(null);
    rateForm.reset();
  };

  const getMaintenanceStatus = (schedule: MaintenanceSchedule): { status: string; color: string; icon: any } => {
    const now = new Date();
    const currentHours = parseFloat(equipment?.currentHours || "0");
    
    // Check hour-based due
    if (schedule.nextDueHours) {
      const dueHours = parseFloat(schedule.nextDueHours);
      const hoursRemaining = dueHours - currentHours;
      
      if (hoursRemaining <= 0) {
        return { status: "Overdue", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: AlertCircle };
      }
      if (hoursRemaining <= (schedule.alertHoursBefore || 25)) {
        return { status: "Due Soon", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", icon: AlertTriangle };
      }
    }
    
    // Check date-based due
    if (schedule.nextDueAt) {
      const dueDate = new Date(schedule.nextDueAt);
      const daysRemaining = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysRemaining <= 0) {
        return { status: "Overdue", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: AlertCircle };
      }
      if (daysRemaining <= (schedule.alertDaysBefore || 7)) {
        return { status: "Due Soon", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", icon: AlertTriangle };
      }
    }
    
    return { status: "On Schedule", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: CheckCircle };
  };
  
  const handleSubmit = (data: EditEquipmentInput) => {
    updateEquipment.mutate(data);
  };
  
  const getStatusBadge = (status: string) => {
    const statusOption = STATUS_OPTIONS.find(s => s.value === status);
    return statusOption ? statusOption.color : "bg-gray-100 text-gray-800";
  };
  
  const getStatusLabel = (status: string) => {
    const statusOption = STATUS_OPTIONS.find(s => s.value === status);
    return statusOption ? statusOption.label : status;
  };
  
  const getTypeLabel = (type: string) => {
    const typeOption = EQUIPMENT_TYPES.find(t => t.value === type);
    return typeOption ? typeOption.label : type;
  };

  const activeAssignment = assignments.find((a: any) => a.isActive);
  const canEdit = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPERINTENDENT" || user?.role === "MAINTENANCE_MANAGER";
  const isAssigned = equipment?.status === "ASSIGNED" && activeAssignment;
  
  if (!user) return null;
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-7xl px-6 py-8">
          <div className="text-center text-muted-foreground">Loading equipment...</div>
        </main>
      </div>
    );
  }
  
  if (error || !equipment) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-7xl px-6 py-8">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-destructive">Equipment Not Found</h2>
            <p className="text-muted-foreground mt-2">The equipment you're looking for doesn't exist.</p>
            <Button asChild className="mt-4">
              <Link href="/equipment">Back to Equipment</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/equipment">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold truncate" data-testid="text-equipment-name">{equipment.name}</h1>
              <Badge className={getStatusBadge(equipment.status)}>
                {getStatusLabel(equipment.status)}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              {equipment.equipmentCode} 
              {equipment.make && equipment.model && ` \u2022 ${equipment.make} ${equipment.model}`}
              {equipment.year && ` (${equipment.year})`}
            </p>
          </div>
          {canEdit && (
            <div className="flex gap-2 flex-wrap">
              {equipment.status === "AVAILABLE" && (
                <Button onClick={handleOpenAssign} data-testid="button-assign">
                  <Send className="h-4 w-4 mr-2" />
                  Assign to Project
                </Button>
              )}
              {isAssigned && (
                <Button variant="outline" onClick={handleOpenReturn} data-testid="button-return">
                  <Undo2 className="h-4 w-4 mr-2" />
                  Return
                </Button>
              )}
              <Button variant="outline" onClick={handleEdit} data-testid="button-edit">
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </div>
          )}
        </div>

        {activeAssignment && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <MapPin className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Currently assigned to</p>
                  <Link href={`/projects/${activeAssignment.projectCode}`} className="font-medium text-primary hover:underline">
                    {activeAssignment.projectName}
                  </Link>
                </div>
                {activeAssignment.expectedReturnDate && (
                  <div className="ml-auto text-right">
                    <p className="text-sm text-muted-foreground">Expected return</p>
                    <p className="font-medium">{format(new Date(activeAssignment.expectedReturnDate), "MMM d, yyyy")}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="assignments" data-testid="tab-assignments">Assignments</TabsTrigger>
            <TabsTrigger value="repairs" data-testid="tab-repairs">Repairs</TabsTrigger>
            <TabsTrigger value="hours" data-testid="tab-hours">Hour Logs</TabsTrigger>
            <TabsTrigger value="maintenance" data-testid="tab-maintenance">
              <CalendarClock className="h-4 w-4 mr-1" />
              Preventative Maintenance
            </TabsTrigger>
            <TabsTrigger value="rates" data-testid="tab-rates">
              <DollarSign className="h-4 w-4 mr-1" />
              Rates
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Equipment Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Type</p>
                      <p className="font-medium">{getTypeLabel(equipment.type)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Current Hours</p>
                      <p className="font-medium flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {equipment.currentHours || "0"} hrs
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Make</p>
                      <p className="font-medium">{equipment.make || "-"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Model</p>
                      <p className="font-medium">{equipment.model || "-"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Year</p>
                      <p className="font-medium">{equipment.year || "-"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Serial Number</p>
                      <p className="font-medium">{equipment.serialNumber || "-"}</p>
                    </div>
                    {equipment.vinNumber && (
                      <div>
                        <p className="text-sm text-muted-foreground">VIN</p>
                        <p className="font-medium">{equipment.vinNumber}</p>
                      </div>
                    )}
                    {equipment.licensePlate && (
                      <div>
                        <p className="text-sm text-muted-foreground">License Plate</p>
                        <p className="font-medium">{equipment.licensePlate}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Location & Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Home Location</p>
                      <p className="font-medium flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {equipment.homeLocation || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Current Location</p>
                      <p className="font-medium flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {equipment.currentLocation || equipment.homeLocation || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Purchase Price</p>
                      <p className="font-medium flex items-center gap-1">
                        <DollarSign className="h-4 w-4" />
                        {equipment.purchasePrice ? `$${parseFloat(equipment.purchasePrice).toLocaleString()}` : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Last Maintenance</p>
                      <p className="font-medium flex items-center gap-1">
                        <Wrench className="h-4 w-4" />
                        {equipment.lastMaintenanceDate 
                          ? format(new Date(equipment.lastMaintenanceDate), "MMM d, yyyy")
                          : "-"
                        }
                      </p>
                    </div>
                  </div>
                  
                  {equipment.description && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Description</p>
                      <p className="text-sm">{equipment.description}</p>
                    </div>
                  )}
                  
                  {equipment.notes && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Notes</p>
                      <p className="text-sm">{equipment.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          
          <TabsContent value="assignments">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">Assignment History</CardTitle>
                  <CardDescription>Track where this equipment has been assigned</CardDescription>
                </div>
                {canEdit && equipment.status === "AVAILABLE" && (
                  <Button onClick={handleOpenAssign} size="sm" data-testid="button-new-assignment">
                    <Plus className="h-4 w-4 mr-2" />
                    Assign
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {assignments.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No assignment history</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Assigned</TableHead>
                        <TableHead>Returned</TableHead>
                        <TableHead>Hours Used</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignments.map((assignment: any) => (
                        <TableRow key={assignment.id}>
                          <TableCell>
                            <Link href={`/projects/${assignment.projectCode}`} className="text-primary hover:underline">
                              {assignment.projectName}
                            </Link>
                          </TableCell>
                          <TableCell>{format(new Date(assignment.assignedAt), "MMM d, yyyy")}</TableCell>
                          <TableCell>
                            {assignment.returnedAt 
                              ? format(new Date(assignment.returnedAt), "MMM d, yyyy")
                              : "-"
                            }
                          </TableCell>
                          <TableCell>
                            {assignment.hoursAtReturn && assignment.hoursAtAssignment
                              ? `${(parseFloat(assignment.hoursAtReturn) - parseFloat(assignment.hoursAtAssignment)).toFixed(1)} hrs`
                              : "-"
                            }
                          </TableCell>
                          <TableCell>
                            <Badge variant={assignment.isActive ? "default" : "secondary"}>
                              {assignment.isActive ? "Active" : "Returned"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="repairs">
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">Repair History</CardTitle>
                    <CardDescription>Track repairs and maintenance issues</CardDescription>
                  </div>
                  {canEdit && (
                    <Button onClick={handleOpenRepair} size="sm" data-testid="button-new-repair">
                      <Plus className="h-4 w-4 mr-2" />
                      Report Issue
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {repairs.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No repair history</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Repair #</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Reported</TableHead>
                          <TableHead>Cost</TableHead>
                          <TableHead>Status</TableHead>
                          {canEdit && <TableHead>Actions</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {repairs.map((repair: any) => (
                          <TableRow key={repair.id}>
                            <TableCell className="font-mono">{repair.repairNumber}</TableCell>
                            <TableCell>{repair.description}</TableCell>
                            <TableCell>{format(new Date(repair.problemReportedAt), "MMM d, yyyy")}</TableCell>
                            <TableCell>
                              {repair.actualCost 
                                ? `$${parseFloat(repair.actualCost).toLocaleString()}`
                                : repair.estimatedCost
                                  ? `~$${parseFloat(repair.estimatedCost).toLocaleString()}`
                                  : "-"
                              }
                            </TableCell>
                            <TableCell>
                              <Badge variant={
                                repair.status === "COMPLETED" ? "default" :
                                repair.status === "IN_PROGRESS" ? "secondary" : "outline"
                              }>
                                {repair.status}
                              </Badge>
                            </TableCell>
                            {canEdit && (
                              <TableCell>
                                <Select
                                  value={repair.status}
                                  onValueChange={(value) => updateRepairStatus.mutate({ repairId: repair.id, status: value })}
                                >
                                  <SelectTrigger className="w-32">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {REPAIR_STATUS_OPTIONS.map(opt => (
                                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          
          <TabsContent value="hours">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">Hour Logs</CardTitle>
                  <CardDescription>Weekly equipment usage tracking</CardDescription>
                </div>
                {canEdit && (
                  <Button onClick={handleOpenHourLog} size="sm" data-testid="button-new-hour-log">
                    <Plus className="h-4 w-4 mr-2" />
                    Log Hours
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {hourLogs.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No hour logs recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Week</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Starting Hours</TableHead>
                        <TableHead>Ending Hours</TableHead>
                        <TableHead>Hours Used</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hourLogs.map((log: any) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            {format(new Date(log.weekStartDate), "MMM d")} - {format(new Date(log.weekEndDate), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell>
                            <Link href={`/projects/${log.projectCode}`} className="text-primary hover:underline">
                              {log.projectName}
                            </Link>
                          </TableCell>
                          <TableCell>{log.startingHours}</TableCell>
                          <TableCell>{log.endingHours}</TableCell>
                          <TableCell className="font-medium">{log.hoursUsed} hrs</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="maintenance">
            <div className="space-y-6">
              {/* Schedule Generation Card */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <CalendarClock className="h-5 w-5" />
                      Preventative Maintenance Schedule
                    </CardTitle>
                    <CardDescription>
                      AI-generated maintenance schedule based on {equipment.make && equipment.model 
                        ? `${equipment.make} ${equipment.model} manufacturer recommendations` 
                        : `${getTypeLabel(equipment.type)} best practices`}
                    </CardDescription>
                  </div>
                  {canEdit && (
                    <Button 
                      onClick={handleGenerateSchedule} 
                      disabled={generateSchedule.isPending}
                      size="sm"
                      data-testid="button-generate-schedule"
                    >
                      {generateSchedule.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 mr-2" />
                          {maintenanceSchedules.length > 0 ? "Regenerate Schedule" : "Generate Schedule"}
                        </>
                      )}
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {maintenanceSchedules.length === 0 ? (
                    <div className="text-center py-12">
                      <CalendarClock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium mb-2">No Maintenance Schedule</h3>
                      <p className="text-muted-foreground mb-4">
                        Generate an AI-powered maintenance schedule based on this equipment's make, model, and current hours.
                      </p>
                      {canEdit && (
                        <Button onClick={handleGenerateSchedule} disabled={generateSchedule.isPending} data-testid="button-generate-schedule-empty">
                          {generateSchedule.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Generating Schedule...
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4 mr-2" />
                              Generate Maintenance Schedule
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {maintenanceSchedules.map((schedule) => {
                        const statusInfo = getMaintenanceStatus(schedule);
                        const StatusIcon = statusInfo.icon;
                        return (
                          <Card key={schedule.id} className="border">
                            <CardContent className="p-4">
                              <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="flex-1 min-w-0 space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="font-semibold">{schedule.name}</h4>
                                    <Badge className={statusInfo.color}>
                                      <StatusIcon className="h-3 w-3 mr-1" />
                                      {statusInfo.status}
                                    </Badge>
                                    <Badge variant="outline">{schedule.maintenanceType}</Badge>
                                  </div>
                                  
                                  {schedule.description && (
                                    <p className="text-sm text-muted-foreground">{schedule.description}</p>
                                  )}
                                  
                                  <div className="flex flex-wrap gap-4 text-sm">
                                    {schedule.intervalHours && (
                                      <div className="flex items-center gap-1 text-muted-foreground">
                                        <Clock className="h-4 w-4" />
                                        Every {schedule.intervalHours} hours
                                      </div>
                                    )}
                                    {schedule.intervalDays && (
                                      <div className="flex items-center gap-1 text-muted-foreground">
                                        <Calendar className="h-4 w-4" />
                                        Every {schedule.intervalDays} days
                                      </div>
                                    )}
                                    {schedule.nextDueHours && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-muted-foreground">Next due at:</span>
                                        <span className="font-medium">{parseFloat(schedule.nextDueHours).toLocaleString()} hrs</span>
                                        <span className="text-muted-foreground">
                                          ({(parseFloat(schedule.nextDueHours) - parseFloat(equipment.currentHours || "0")).toFixed(0)} hrs remaining)
                                        </span>
                                      </div>
                                    )}
                                    {schedule.nextDueAt && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-muted-foreground">Next due:</span>
                                        <span className="font-medium">{format(new Date(schedule.nextDueAt), "MMM d, yyyy")}</span>
                                      </div>
                                    )}
                                  </div>
                                  
                                  {schedule.lastPerformedAt && (
                                    <div className="text-xs text-muted-foreground">
                                      Last performed: {format(new Date(schedule.lastPerformedAt), "MMM d, yyyy")}
                                      {schedule.lastPerformedHours && ` at ${parseFloat(schedule.lastPerformedHours).toLocaleString()} hrs`}
                                    </div>
                                  )}
                                </div>
                                
                                {canEdit && (
                                  <Button 
                                    size="sm" 
                                    onClick={() => handleCompleteMaintenance(schedule)}
                                    data-testid={`button-complete-maintenance-${schedule.id}`}
                                  >
                                    <Check className="h-4 w-4 mr-1" />
                                    Mark Complete
                                  </Button>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Maintenance History Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <History className="h-5 w-5" />
                    Maintenance History
                  </CardTitle>
                  <CardDescription>Record of completed maintenance tasks</CardDescription>
                </CardHeader>
                <CardContent>
                  {maintenanceHistory.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No maintenance history recorded</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Performed</TableHead>
                          <TableHead>Hours</TableHead>
                          <TableHead>Cost</TableHead>
                          <TableHead>Performed By</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {maintenanceHistory.map((record) => (
                          <TableRow key={record.id}>
                            <TableCell>
                              <Badge variant="outline">{record.maintenanceType}</Badge>
                            </TableCell>
                            <TableCell className="max-w-xs truncate">{record.description}</TableCell>
                            <TableCell>{format(new Date(record.performedAt), "MMM d, yyyy")}</TableCell>
                            <TableCell>
                              {record.hoursAtMaintenance 
                                ? `${parseFloat(record.hoursAtMaintenance).toLocaleString()} hrs`
                                : "-"
                              }
                            </TableCell>
                            <TableCell>
                              {record.totalCost 
                                ? `$${parseFloat(record.totalCost).toLocaleString()}`
                                : "-"
                              }
                            </TableCell>
                            <TableCell>{record.performedByVendor || record.performedByName}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Rates Tab Content */}
          <TabsContent value="rates">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">Internal Rate Profiles</CardTitle>
                  <CardDescription>
                    Configure hourly, daily, and weekly rates for estimating and project costing
                  </CardDescription>
                </div>
                {canEdit && (
                  <Button 
                    onClick={() => setShowRateDialog(true)} 
                    data-testid="button-add-rate"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Rate Profile
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {isLoadingRates ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">Loading rate profiles...</span>
                  </div>
                ) : rateProfiles.length === 0 ? (
                  <div className="text-center py-8">
                    <DollarSign className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">No rate profiles configured</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Add rate profiles to track equipment costs for bids and projects
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Hourly Rate</TableHead>
                        <TableHead>Daily Rate</TableHead>
                        <TableHead>Weekly Rate</TableHead>
                        <TableHead>Fuel/hr</TableHead>
                        <TableHead>Effective Date</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rateProfiles.map((profile) => (
                        <TableRow key={profile.id} data-testid={`row-rate-${profile.id}`}>
                          <TableCell>
                            <Badge variant={profile.isActive ? "default" : "secondary"}>
                              {profile.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">
                            ${parseFloat(profile.hourlyRate || "0").toLocaleString()}/hr
                          </TableCell>
                          <TableCell>
                            {profile.dailyRate 
                              ? `$${parseFloat(profile.dailyRate).toLocaleString()}/day`
                              : "-"
                            }
                          </TableCell>
                          <TableCell>
                            {profile.weeklyRate 
                              ? `$${parseFloat(profile.weeklyRate).toLocaleString()}/wk`
                              : "-"
                            }
                          </TableCell>
                          <TableCell>
                            {profile.fuelCostPerHour 
                              ? `$${parseFloat(profile.fuelCostPerHour).toLocaleString()}`
                              : "-"
                            }
                          </TableCell>
                          <TableCell>
                            {format(new Date(profile.effectiveDate), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell>
                            {canEdit && (
                              <div className="flex gap-2">
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => handleEditRate(profile)}
                                  data-testid={`button-edit-rate-${profile.id}`}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                {!profile.isActive && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => activateRateMutation.mutate(profile.id)}
                                    disabled={activateRateMutation.isPending}
                                    data-testid={`button-activate-rate-${profile.id}`}
                                  >
                                    <Check className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      
      {/* Edit Equipment Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Equipment</DialogTitle>
            <DialogDescription>
              Update the equipment details.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EQUIPMENT_TYPES.map(option => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {STATUS_OPTIONS.map(option => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="currentHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Hours</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="make"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Make</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Year</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="serialNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Serial Number</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="homeLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Home Location</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="currentLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Location</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowEditDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateEquipment.isPending} data-testid="button-save">
                  {updateEquipment.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Assign Equipment Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Equipment to Project</DialogTitle>
            <DialogDescription>
              Select a project to assign this equipment to.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...assignmentForm}>
            <form onSubmit={assignmentForm.handleSubmit((data) => assignEquipment.mutate(data))} className="space-y-4">
              <FormField
                control={assignmentForm.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-project">
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableProjects.map((project: any) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.code} - {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={assignmentForm.control}
                name="expectedReturnDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expected Return Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-return-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={assignmentForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Any special notes..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAssignDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={assignEquipment.isPending} data-testid="button-confirm-assign">
                  {assignEquipment.isPending ? "Assigning..." : "Assign Equipment"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Return Equipment Dialog */}
      <Dialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Return Equipment</DialogTitle>
            <DialogDescription>
              Mark this equipment as returned from {activeAssignment?.projectName}.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...returnForm}>
            <form onSubmit={returnForm.handleSubmit((data) => returnEquipment.mutate(data))} className="space-y-4">
              <FormField
                control={returnForm.control}
                name="endingHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ending Hours</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" {...field} data-testid="input-ending-hours" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={returnForm.control}
                name="returnCondition"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Return Condition</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select condition" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="GOOD">Good</SelectItem>
                        <SelectItem value="FAIR">Fair</SelectItem>
                        <SelectItem value="NEEDS_REPAIR">Needs Repair</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={returnForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Any issues or observations..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowReturnDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={returnEquipment.isPending} data-testid="button-confirm-return">
                  {returnEquipment.isPending ? "Processing..." : "Return Equipment"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Report Repair Dialog with AI Recommendations */}
      <Dialog open={showRepairDialog} onOpenChange={setShowRepairDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Report Equipment Issue</DialogTitle>
            <DialogDescription>
              Describe the problem and get AI-powered repair recommendations.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Form {...repairForm}>
                <form onSubmit={repairForm.handleSubmit((data) => createRepair.mutate(data))} className="space-y-4">
                  <FormField
                    control={repairForm.control}
                    name="problemDescription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Problem Description *</FormLabel>
                        <FormControl>
                          <Textarea 
                            {...field} 
                            placeholder="Describe the issue in detail..."
                            className="min-h-[100px]"
                            data-testid="input-problem-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={fetchAIRecommendations}
                    disabled={loadingAI || !repairForm.getValues("problemDescription")}
                    className="w-full"
                    data-testid="button-get-ai"
                  >
                    {loadingAI ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Get AI Recommendations
                      </>
                    )}
                  </Button>
                  
                  <FormField
                    control={repairForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Repair Title *</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Brief title for this repair" data-testid="input-repair-title" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={repairForm.control}
                    name="repairLocation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Repair Location</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Where will repairs be done?" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={repairForm.control}
                      name="estimatedCost"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Estimated Cost</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" {...field} placeholder="$0.00" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={repairForm.control}
                      name="estimatedCompletionDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Expected Completion</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setShowRepairDialog(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createRepair.isPending} data-testid="button-submit-repair">
                      {createRepair.isPending ? "Submitting..." : "Submit Repair Request"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </div>
            
            <div className="space-y-4">
              {aiRecommendations ? (
                <>
                  <Card className="border-primary/50">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <CardTitle className="text-sm">AI Analysis</CardTitle>
                        <Badge variant={
                          aiRecommendations.urgency === "CRITICAL" ? "destructive" :
                          aiRecommendations.urgency === "HIGH" ? "default" : "secondary"
                        }>
                          {aiRecommendations.urgency} Priority
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="text-sm">
                      <p>{aiRecommendations.summary}</p>
                      {aiRecommendations.estimatedTotalCost > 0 && (
                        <p className="mt-2 font-medium">
                          Estimated Total Cost: ${aiRecommendations.estimatedTotalCost.toLocaleString()}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                  
                  {aiRecommendations.recommendedTasks.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <ClipboardList className="h-4 w-4" />
                          Recommended Tasks
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="text-sm space-y-2">
                          {aiRecommendations.recommendedTasks.map((task, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <Badge variant="outline" className="text-xs shrink-0">{task.priority}</Badge>
                              <span>{task.task}</span>
                              {task.estimatedCost > 0 && (
                                <span className="text-muted-foreground ml-auto">${task.estimatedCost}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                  
                  {aiRecommendations.recommendedParts.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          Recommended Parts
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="text-sm space-y-2">
                          {aiRecommendations.recommendedParts.map((part, i) => (
                            <li key={i} className="flex items-center justify-between gap-2">
                              <span>{part.part} (x{part.quantity})</span>
                              <span className="text-muted-foreground">${part.estimatedCost}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                  
                  {aiRecommendations.preventativeSchedule.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          Preventative Maintenance Schedule
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="text-sm space-y-2">
                          {aiRecommendations.preventativeSchedule.map((item, i) => (
                            <li key={i} className="border-l-2 border-muted pl-3">
                              <div className="font-medium">{item.task}</div>
                              <div className="text-xs text-muted-foreground">Every {item.interval}</div>
                              <div className="text-xs">{item.description}</div>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                  
                  {aiRecommendations.warningsOrNotes.length > 0 && (
                    <Card className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-900/20">
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                          <ul className="text-sm space-y-1">
                            {aiRecommendations.warningsOrNotes.map((note, i) => (
                              <li key={i}>{note}</li>
                            ))}
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-8">
                  <Sparkles className="h-12 w-12 mb-4 opacity-20" />
                  <p className="text-sm">Describe the problem and click "Get AI Recommendations" for intelligent repair suggestions, parts lists, and maintenance schedules.</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Hour Log Dialog */}
      <Dialog open={showHourLogDialog} onOpenChange={setShowHourLogDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log Equipment Hours</DialogTitle>
            <DialogDescription>
              Record weekly equipment usage.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...hourLogForm}>
            <form onSubmit={hourLogForm.handleSubmit((data) => submitHourLog.mutate(data))} className="space-y-4">
              <FormField
                control={hourLogForm.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-hour-log-project">
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableProjects.map((project: any) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.code} - {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={hourLogForm.control}
                  name="weekStartDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Week Start *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-week-start" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={hourLogForm.control}
                  name="weekEndDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Week End *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-week-end" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={hourLogForm.control}
                  name="startingHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Starting Hours *</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.1" {...field} data-testid="input-starting-hours" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={hourLogForm.control}
                  name="endingHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ending Hours *</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.1" {...field} data-testid="input-log-ending-hours" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <FormField
                control={hourLogForm.control}
                name="fuelUsed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fuel Used (gallons)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" {...field} placeholder="Optional" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={hourLogForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Any notes about usage this week..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowHourLogDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitHourLog.isPending} data-testid="button-submit-hours">
                  {submitHourLog.isPending ? "Submitting..." : "Submit Hour Log"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Complete Maintenance Dialog */}
      <Dialog open={showCompleteMaintenanceDialog} onOpenChange={(open) => {
        setShowCompleteMaintenanceDialog(open);
        if (!open) setSelectedSchedule(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Complete Maintenance</DialogTitle>
            <DialogDescription>
              {selectedSchedule && (
                <>Record completion of: <strong>{selectedSchedule.name}</strong></>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <CompleteMaintenanceForm 
            onSubmit={submitCompleteMaintenance}
            onCancel={() => {
              setShowCompleteMaintenanceDialog(false);
              setSelectedSchedule(null);
            }}
            isPending={completeMaintenance.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Rate Profile Dialog */}
      <Dialog open={showRateDialog} onOpenChange={handleCloseRateDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRate ? "Edit Rate Profile" : "Add Rate Profile"}
            </DialogTitle>
            <DialogDescription>
              Configure internal hourly, daily, and weekly rates for this equipment
            </DialogDescription>
          </DialogHeader>
          
          <Form {...rateForm}>
            <form onSubmit={rateForm.handleSubmit(handleRateSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={rateForm.control}
                  name="hourlyRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hourly Rate *</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.01" 
                          placeholder="$0.00/hr" 
                          {...field}
                          data-testid="input-hourly-rate"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={rateForm.control}
                  name="dailyRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Daily Rate</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.01" 
                          placeholder="$0.00/day" 
                          {...field}
                          data-testid="input-daily-rate"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={rateForm.control}
                  name="weeklyRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weekly Rate</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.01" 
                          placeholder="$0.00/wk" 
                          {...field}
                          data-testid="input-weekly-rate"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={rateForm.control}
                  name="monthlyRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monthly Rate</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.01" 
                          placeholder="$0.00/mo" 
                          {...field}
                          data-testid="input-monthly-rate"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-3">Operating Costs</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={rateForm.control}
                    name="fuelCostPerHour"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fuel Cost/hr</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            step="0.01" 
                            placeholder="$0.00" 
                            {...field}
                            data-testid="input-fuel-cost"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={rateForm.control}
                    name="maintenanceCostPerHour"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Maintenance Cost/hr</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            step="0.01" 
                            placeholder="$0.00" 
                            {...field}
                            data-testid="input-maintenance-cost"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={rateForm.control}
                    name="operatorCostPerHour"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Operator Cost/hr</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            step="0.01" 
                            placeholder="$0.00" 
                            {...field}
                            data-testid="input-operator-cost"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={rateForm.control}
                    name="includesOperator"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 pt-6">
                        <FormControl>
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={field.onChange}
                            className="h-4 w-4 rounded border-gray-300"
                            data-testid="checkbox-includes-operator"
                          />
                        </FormControl>
                        <FormLabel className="!mt-0">Rate Includes Operator</FormLabel>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
              
              <div className="border-t pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={rateForm.control}
                    name="effectiveDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Effective Date *</FormLabel>
                        <FormControl>
                          <Input 
                            type="date" 
                            {...field}
                            data-testid="input-effective-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={rateForm.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 pt-6">
                        <FormControl>
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={field.onChange}
                            className="h-4 w-4 rounded border-gray-300"
                            data-testid="checkbox-is-active"
                          />
                        </FormControl>
                        <FormLabel className="!mt-0">Active</FormLabel>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
              
              <FormField
                control={rateForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Any notes about this rate profile..." 
                        {...field}
                        data-testid="input-rate-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseRateDialog}>
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createRateMutation.isPending || updateRateMutation.isPending}
                  data-testid="button-save-rate"
                >
                  {(createRateMutation.isPending || updateRateMutation.isPending) 
                    ? "Saving..." 
                    : editingRate ? "Update Rate" : "Add Rate"
                  }
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CompleteMaintenanceForm({ 
  onSubmit, 
  onCancel,
  isPending
}: { 
  onSubmit: (data: { notes?: string; laborCost?: string; partsCost?: string; performedByVendor?: string }) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [formData, setFormData] = useState({
    notes: "",
    laborCost: "",
    partsCost: "",
    performedByVendor: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Labor Cost</label>
          <Input 
            type="number" 
            step="0.01" 
            placeholder="$0.00"
            value={formData.laborCost}
            onChange={(e) => setFormData({ ...formData, laborCost: e.target.value })}
            data-testid="input-labor-cost"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Parts Cost</label>
          <Input 
            type="number" 
            step="0.01" 
            placeholder="$0.00"
            value={formData.partsCost}
            onChange={(e) => setFormData({ ...formData, partsCost: e.target.value })}
            data-testid="input-parts-cost"
          />
        </div>
      </div>
      
      <div className="space-y-2">
        <label className="text-sm font-medium">Performed By (External Vendor)</label>
        <Input 
          placeholder="Leave blank if performed in-house"
          value={formData.performedByVendor}
          onChange={(e) => setFormData({ ...formData, performedByVendor: e.target.value })}
          data-testid="input-vendor"
        />
      </div>
      
      <div className="space-y-2">
        <label className="text-sm font-medium">Notes</label>
        <Textarea 
          placeholder="Any notes about this maintenance..."
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          data-testid="input-maintenance-notes"
        />
      </div>
      
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-complete">
          Cancel
        </Button>
        <Button type="submit" disabled={isPending} data-testid="button-confirm-complete">
          {isPending ? "Completing..." : "Complete Maintenance"}
        </Button>
      </DialogFooter>
    </form>
  );
}
