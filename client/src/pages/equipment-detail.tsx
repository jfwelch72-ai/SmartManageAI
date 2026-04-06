import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  Send,
  Edit,
  Undo2,
  MapPin,
  DollarSign,
  CalendarClock,
  TrendingDown,
  Fuel,
} from "lucide-react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import type { Equipment } from "@shared/schema";
import {
  useEquipmentMutations,
  editEquipmentSchema,
  assignmentSchema,
  returnEquipmentSchema,
  repairSchema,
  hourLogSchema,
  rateProfileSchema,
  fuelLogSchema,
} from "@/hooks/useEquipmentMutations";
import type {
  EditEquipmentInput,
  AssignmentInput,
  ReturnEquipmentInput,
  RepairInput,
  HourLogInput,
  RateProfileInput,
  FuelLogInput,
} from "@/hooks/useEquipmentMutations";
import {
  OverviewTab,
  AssignmentsTab,
  RepairsTab,
  HoursTab,
  MaintenanceTab,
  RatesTab,
  DepreciationTab,
  FuelTab,
} from "@/components/equipment/EquipmentTabs";
import type {
  MaintenanceSchedule,
  MaintenanceHistory,
  RateProfile,
} from "@/components/equipment/EquipmentTabs";
import {
  EditEquipmentDialog,
  AssignEquipmentDialog,
  ReturnEquipmentDialog,
  RepairDialog,
  HourLogDialog,
  CompleteMaintenanceDialog,
  RateProfileDialog,
  FuelLogDialog,
} from "@/components/equipment/EquipmentDialogs";

const STATUS_OPTIONS = [
  {
    value: "AVAILABLE",
    label: "Available",
    color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  },
  {
    value: "ASSIGNED",
    label: "Assigned",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  },
  {
    value: "IN_REPAIR",
    label: "In Repair",
    color:
      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  },
  {
    value: "OUT_OF_SERVICE",
    label: "Out of Service",
    color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  },
  {
    value: "RETIRED",
    label: "Retired",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  },
];

export default function EquipmentDetailPage() {
  const { user } = useAuth();
  const { code } = useParams<{ code: string }>();

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [showRepairDialog, setShowRepairDialog] = useState(false);
  const [showHourLogDialog, setShowHourLogDialog] = useState(false);
  const [showCompleteMaintenanceDialog, setShowCompleteMaintenanceDialog] =
    useState(false);
  const [showRateDialog, setShowRateDialog] = useState(false);
  const [showFuelLogDialog, setShowFuelLogDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedSchedule, setSelectedSchedule] =
    useState<MaintenanceSchedule | null>(null);
  const [editingRate, setEditingRate] = useState<RateProfile | null>(null);

  const {
    data: equipment,
    isLoading,
    error,
  } = useQuery<Equipment>({
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
      const response = await fetch(
        `/api/equipment/${equipment?.id}/assignments`,
        { credentials: "include" },
      );
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
      const response = await fetch(
        `/api/equipment/${equipment?.id}/hour-logs`,
        { credentials: "include" },
      );
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
      const response = await fetch(
        `/api/equipment/${equipmentId}/maintenance-schedules`,
        { credentials: "include" },
      );
      if (!response.ok)
        throw new Error("Failed to fetch maintenance schedules");
      return response.json();
    },
    enabled: !!equipment?.id,
  });

  const { data: maintenanceHistory = [] } = useQuery<MaintenanceHistory[]>({
    queryKey: ["/api/equipment", equipment?.id, "maintenance-history"],
    queryFn: async ({ queryKey }) => {
      const [, equipmentId] = queryKey as [string, string | undefined, string];
      if (!equipmentId) return [];
      const response = await fetch(
        `/api/equipment/${equipmentId}/maintenance-history`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to fetch maintenance history");
      return response.json();
    },
    enabled: !!equipment?.id,
  });

  const { data: rateProfiles = [], isLoading: isLoadingRates } = useQuery<
    RateProfile[]
  >({
    queryKey: ["/api/equipment", equipment?.id, "rate-profiles"],
    queryFn: async () => {
      if (!equipment?.id) return [];
      const response = await fetch(
        `/api/equipment/${equipment.id}/rate-profiles`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to fetch rate profiles");
      return response.json();
    },
    enabled: !!equipment?.id,
  });

  const mutations = useEquipmentMutations(equipment);

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
    defaultValues: { projectId: "", expectedReturnDate: "", notes: "" },
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
      weekStartDate: format(
        startOfWeek(new Date(), { weekStartsOn: 1 }),
        "yyyy-MM-dd",
      ),
      weekEndDate: format(
        endOfWeek(new Date(), { weekStartsOn: 1 }),
        "yyyy-MM-dd",
      ),
      startingHours: equipment?.currentHours || "0",
      endingHours: "",
      notes: "",
      fuelUsed: "",
    },
  });

  const fuelLogForm = useForm<FuelLogInput>({
    resolver: zodResolver(fuelLogSchema),
    defaultValues: {
      date: format(new Date(), "yyyy-MM-dd"),
      gallons: "",
      pricePerGallon: "",
      fuelType: "DIESEL",
      meterReading: "",
      projectId: "",
      notes: "",
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

  const activeAssignment = assignments.find((a: any) => a.isActive);
  const canEdit =
    user?.role === "ADMIN" ||
    user?.role === "MANAGER" ||
    user?.role === "SUPERINTENDENT" ||
    user?.role === "FIELD_WORKER";
  const isAssigned = equipment?.status === "ASSIGNED" && activeAssignment;

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
        depreciationMethod: equipment.depreciationMethod || "",
        usefulLifeYears: equipment.usefulLifeYears || undefined,
        salvageValue: equipment.salvageValue || "",
        inServiceDate: equipment.inServiceDate || "",
      });
      setShowEditDialog(true);
    }
  };

  const handleOpenAssign = () => {
    assignmentForm.reset({ projectId: "", expectedReturnDate: "", notes: "" });
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
    mutations.setAiRecommendations(null);
    setShowRepairDialog(true);
  };

  const handleOpenHourLog = () => {
    hourLogForm.reset({
      projectId: activeAssignment?.projectId || "",
      weekStartDate: format(
        startOfWeek(new Date(), { weekStartsOn: 1 }),
        "yyyy-MM-dd",
      ),
      weekEndDate: format(
        endOfWeek(new Date(), { weekStartsOn: 1 }),
        "yyyy-MM-dd",
      ),
      startingHours: equipment?.currentHours || "0",
      endingHours: "",
      notes: "",
      fuelUsed: "",
    });
    setShowHourLogDialog(true);
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
      effectiveDate: profile.effectiveDate
        ? format(new Date(profile.effectiveDate), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd"),
      notes: profile.notes || "",
      isActive: profile.isActive,
    });
    setShowRateDialog(true);
  };

  const handleRateSubmit = (data: RateProfileInput) => {
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
      mutations.updateRateMutation.mutate({
        id: editingRate.id,
        data: payload as RateProfileInput,
      });
    } else {
      mutations.createRateMutation.mutate(payload as RateProfileInput);
    }
  };

  const handleCloseRateDialog = () => {
    setShowRateDialog(false);
    setEditingRate(null);
    rateForm.reset();
  };

  const getStatusBadge = (status: string) => {
    const statusOption = STATUS_OPTIONS.find((s) => s.value === status);
    return statusOption ? statusOption.color : "bg-gray-100 text-gray-800";
  };

  const getStatusLabel = (status: string) => {
    const statusOption = STATUS_OPTIONS.find((s) => s.value === status);
    return statusOption ? statusOption.label : status;
  };

  if (!user) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-7xl px-6 py-8">
          <div className="text-center text-muted-foreground">
            Loading equipment...
          </div>
        </main>
      </div>
    );
  }

  if (error || !equipment) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-7xl px-6 py-8">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-destructive">
              Equipment Not Found
            </h2>
            <p className="text-muted-foreground mt-2">
              The equipment you're looking for doesn't exist.
            </p>
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
      <main className="mx-auto max-w-full px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/equipment">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1
                className="text-2xl font-bold truncate"
                data-testid="text-equipment-name"
              >
                {equipment.name}
              </h1>
              <Badge className={getStatusBadge(equipment.status)}>
                {getStatusLabel(equipment.status)}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              {equipment.equipmentCode}
              {equipment.make &&
                equipment.model &&
                ` \u2022 ${equipment.make} ${equipment.model}`}
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
                <Button
                  variant="outline"
                  onClick={handleOpenReturn}
                  data-testid="button-return"
                >
                  <Undo2 className="h-4 w-4 mr-2" />
                  Return
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleEdit}
                data-testid="button-edit"
              >
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
                  <p className="text-sm text-muted-foreground">
                    Currently assigned to
                  </p>
                  <Link
                    href={`/projects/${activeAssignment.projectCode}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {activeAssignment.projectName}
                  </Link>
                </div>
                {activeAssignment.expectedReturnDate && (
                  <div className="ml-auto text-right">
                    <p className="text-sm text-muted-foreground">
                      Expected return
                    </p>
                    <p className="font-medium">
                      {format(
                        new Date(activeAssignment.expectedReturnDate),
                        "MMM d, yyyy",
                      )}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview" data-testid="tab-overview">
              Overview
            </TabsTrigger>
            <TabsTrigger value="assignments" data-testid="tab-assignments">
              Assignments
            </TabsTrigger>
            <TabsTrigger value="repairs" data-testid="tab-repairs">
              Repairs
            </TabsTrigger>
            <TabsTrigger value="hours" data-testid="tab-hours">
              Hour Logs
            </TabsTrigger>
            <TabsTrigger value="maintenance" data-testid="tab-maintenance">
              <CalendarClock className="h-4 w-4 mr-1" />
              Preventative Maintenance
            </TabsTrigger>
            <TabsTrigger value="depreciation" data-testid="tab-depreciation">
              <TrendingDown className="h-4 w-4 mr-1" />
              Depreciation
            </TabsTrigger>
            <TabsTrigger value="fuel" data-testid="tab-fuel">
              <Fuel className="h-4 w-4 mr-1" />
              Fuel
            </TabsTrigger>
            <TabsTrigger value="rates" data-testid="tab-rates">
              <DollarSign className="h-4 w-4 mr-1" />
              Rates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <OverviewTab equipment={equipment} />
          </TabsContent>

          <TabsContent value="assignments">
            <AssignmentsTab
              assignments={assignments}
              canEdit={canEdit}
              equipmentStatus={equipment.status}
              onOpenAssign={handleOpenAssign}
            />
          </TabsContent>

          <TabsContent value="repairs">
            <RepairsTab
              repairs={repairs}
              canEdit={canEdit}
              onOpenRepair={handleOpenRepair}
              onUpdateRepairStatus={(repairId, status) =>
                mutations.updateRepairStatus.mutate({ repairId, status })
              }
            />
          </TabsContent>

          <TabsContent value="hours">
            <HoursTab
              hourLogs={hourLogs}
              canEdit={canEdit}
              onOpenHourLog={handleOpenHourLog}
            />
          </TabsContent>

          <TabsContent value="maintenance">
            <MaintenanceTab
              equipment={equipment}
              maintenanceSchedules={maintenanceSchedules}
              maintenanceHistory={maintenanceHistory}
              canEdit={canEdit}
              isGenerating={mutations.generateSchedule.isPending}
              onGenerateSchedule={() => mutations.generateSchedule.mutate()}
              onCompleteMaintenance={(schedule) => {
                setSelectedSchedule(schedule);
                setShowCompleteMaintenanceDialog(true);
              }}
            />
          </TabsContent>

          <TabsContent value="depreciation">
            <DepreciationTab equipment={equipment} />
          </TabsContent>

          <TabsContent value="fuel">
            <FuelTab
              equipment={equipment}
              canEdit={canEdit}
              onOpenFuelLog={() => setShowFuelLogDialog(true)}
            />
          </TabsContent>

          <TabsContent value="rates">
            <RatesTab
              rateProfiles={rateProfiles}
              isLoadingRates={isLoadingRates}
              canEdit={canEdit}
              onAddRate={() => setShowRateDialog(true)}
              onEditRate={handleEditRate}
              onActivateRate={(id) => mutations.activateRateMutation.mutate(id)}
              isActivating={mutations.activateRateMutation.isPending}
            />
          </TabsContent>
        </Tabs>
      </main>

      <EditEquipmentDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        form={form}
        onSubmit={(data) => {
          mutations.updateEquipment.mutate(data, {
            onSuccess: () => setShowEditDialog(false),
          });
        }}
        isPending={mutations.updateEquipment.isPending}
      />

      <AssignEquipmentDialog
        open={showAssignDialog}
        onOpenChange={setShowAssignDialog}
        form={assignmentForm}
        availableProjects={availableProjects}
        onSubmit={(data) => {
          mutations.assignEquipment.mutate(data, {
            onSuccess: () => {
              setShowAssignDialog(false);
              assignmentForm.reset();
            },
          });
        }}
        isPending={mutations.assignEquipment.isPending}
      />

      <ReturnEquipmentDialog
        open={showReturnDialog}
        onOpenChange={setShowReturnDialog}
        form={returnForm}
        activeAssignment={activeAssignment}
        onSubmit={(data) => {
          mutations.returnEquipment.mutate(data, {
            onSuccess: () => {
              setShowReturnDialog(false);
              returnForm.reset();
            },
          });
        }}
        isPending={mutations.returnEquipment.isPending}
      />

      <RepairDialog
        open={showRepairDialog}
        onOpenChange={setShowRepairDialog}
        form={repairForm}
        onSubmit={(data) => {
          mutations.createRepair.mutate(data, {
            onSuccess: () => {
              setShowRepairDialog(false);
              repairForm.reset();
            },
          });
        }}
        isPending={mutations.createRepair.isPending}
        aiRecommendations={mutations.aiRecommendations}
        loadingAI={mutations.loadingAI}
        onFetchAI={() =>
          mutations.fetchAIRecommendations(
            repairForm.getValues("problemDescription"),
          )
        }
      />

      <HourLogDialog
        open={showHourLogDialog}
        onOpenChange={setShowHourLogDialog}
        form={hourLogForm}
        availableProjects={availableProjects}
        onSubmit={(data) => {
          mutations.submitHourLog.mutate(data, {
            onSuccess: () => {
              setShowHourLogDialog(false);
              hourLogForm.reset();
            },
          });
        }}
        isPending={mutations.submitHourLog.isPending}
      />

      <CompleteMaintenanceDialog
        open={showCompleteMaintenanceDialog}
        onOpenChange={(open) => {
          setShowCompleteMaintenanceDialog(open);
          if (!open) setSelectedSchedule(null);
        }}
        selectedSchedule={selectedSchedule}
        onSubmit={(formData) => {
          if (!equipment?.id || !selectedSchedule?.id) return;
          mutations.completeMaintenance.mutate(
            { scheduleId: selectedSchedule.id, data: formData },
            {
              onSuccess: () => {
                setShowCompleteMaintenanceDialog(false);
                setSelectedSchedule(null);
              },
            },
          );
        }}
        isPending={mutations.completeMaintenance.isPending}
      />

      <RateProfileDialog
        open={showRateDialog}
        onOpenChange={handleCloseRateDialog}
        form={rateForm}
        editingRate={editingRate}
        onSubmit={handleRateSubmit}
        isPending={
          mutations.createRateMutation.isPending ||
          mutations.updateRateMutation.isPending
        }
      />

      <FuelLogDialog
        open={showFuelLogDialog}
        onOpenChange={setShowFuelLogDialog}
        form={fuelLogForm}
        availableProjects={availableProjects}
        onSubmit={(data) => {
          mutations.submitFuelLog.mutate(data, {
            onSuccess: () => {
              setShowFuelLogDialog(false);
              fuelLogForm.reset({
                date: format(new Date(), "yyyy-MM-dd"),
                gallons: "",
                pricePerGallon: "",
                fuelType: "DIESEL",
                meterReading: "",
                projectId: "",
                notes: "",
              });
            },
          });
        }}
        isPending={mutations.submitFuelLog.isPending}
      />
    </div>
  );
}
