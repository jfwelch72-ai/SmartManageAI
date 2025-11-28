import { useState, useMemo, useEffect } from "react";
import AppHeader from "@/components/AppHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import StatusBadge from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FileUploadZone from "@/components/FileUploadZone";
import ScopeOfWorkTable from "@/components/ScopeOfWorkTable";
import ScopeProgressTracker from "@/components/ScopeProgressTracker";
import DailyNoteFeed from "@/components/DailyNoteFeed";
import MediaGallery from "@/components/MediaGallery";
import { ObjectUploader } from "@/components/ObjectUploader";
import TakeoffWorkspace from "@/components/TakeoffWorkspace";
import ProjectLaborHours from "@/components/ProjectLaborHours";
import ProjectEstimate from "@/components/ProjectEstimate";
import JobInformationForm from "@/components/JobInformationForm";
import TMTicketsSection from "@/components/TMTicketsSection";
import DelaysSection from "@/components/DelaysSection";
import { Building2, MapPin, User, Phone, Mail, Calendar, Plus, CheckCircle, XCircle, Clock, Upload, DollarSign, Edit, AlertTriangle, Download, Eye, FileText, Trash2, ChevronDown, ChevronRight, Package, Users, Ruler, CalendarCheck, StickyNote, Paperclip, ExternalLink, Truck, Wrench, Send, Undo2, Settings2, Link2, CloudRain } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { FeaturePermissions, hasManagementAccess } from "@/lib/rbac";
import { useProject, useScopeItems, useChangeOrders, useApproveChangeOrder, useRejectChangeOrder, useRequestApprovalChangeOrder, useSubmitChangeOrder, useReturnToDraftChangeOrder, useCreateChangeOrder, useProjectNotes, useProjectMedia, useProjectEstimates, useProjectProcurement, useProjectDocuments, useProjectTimeEntries, useProjectTMSheets, useProjectReceipts, useCreateProcurementItem, useCreateSubcontractorPayment, useProjectLaborRates, useProjectEmployeeRates, useUpdateProjectLaborRates, useUpdateProjectEmployeeRate, useDeleteProjectEmployeeRate } from "@/hooks/use-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ChangeOrder, ScopeItem, DailyScopeProgress } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChangeOrderFiles } from "@/components/ChangeOrderFiles";
import { ChangeOrderDialog } from "@/components/ChangeOrderDialog";
import StandardizedScopeSelector, { type ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import { Link } from "wouter";

interface ProjectEquipmentTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

const PLAN_STATUS_COLORS: Record<string, string> = {
  PLANNED: "secondary",
  ASSIGNED: "default",
  RENTAL_BOOKED: "default",
  RENTAL_ACTIVE: "default",
  COMPLETED: "secondary",
  CANCELLED: "outline",
};

function ProjectEquipmentTab({ projectId, projectCode, userRole }: ProjectEquipmentTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddPlanDialog, setShowAddPlanDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedPlanForAssignment, setSelectedPlanForAssignment] = useState<any>(null);
  const [showRentalBookingDialog, setShowRentalBookingDialog] = useState(false);
  const [showRentalTrackingDialog, setShowRentalTrackingDialog] = useState(false);
  const [selectedPlanForRental, setSelectedPlanForRental] = useState<any>(null);
  
  const { data: assignedEquipment = [], isLoading: loadingAssigned } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "equipment"],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/equipment`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch equipment");
      return response.json();
    },
    enabled: !!projectId,
  });

  const { data: equipmentPlans = [], isLoading: loadingPlans } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "equipment-plans"],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/equipment-plans`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch equipment plans");
      return response.json();
    },
    enabled: !!projectId,
  });

  const canManageEquipment = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT" || userRole === "MAINTENANCE_MANAGER";
  const canManagePlans = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT" || userRole === "ESTIMATOR";

  const returnEquipment = useMutation({
    mutationFn: async (equipmentId: string) => {
      return apiRequest("POST", `/api/equipment/${equipmentId}/return`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Success", description: "Equipment returned" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to return equipment",
        variant: "destructive" 
      });
    },
  });

  const updatePlanStatus = useMutation({
    mutationFn: async ({ planId, status }: { planId: string; status: string }) => {
      return apiRequest("PATCH", `/api/projects/${projectId}/equipment-plans/${planId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      toast({ title: "Success", description: "Equipment plan updated" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update plan",
        variant: "destructive" 
      });
    },
  });

  const deletePlan = useMutation({
    mutationFn: async (planId: string) => {
      return apiRequest("DELETE", `/api/projects/${projectId}/equipment-plans/${planId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      toast({ title: "Success", description: "Equipment plan removed" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to remove plan",
        variant: "destructive" 
      });
    },
  });

  const isLoading = loadingAssigned || loadingPlans;

  const totalPlannedCost = equipmentPlans.reduce((sum: number, plan: any) => sum + Number(plan.plannedCost || 0), 0);
  const ownedPlans = equipmentPlans.filter((p: any) => p.source === "OWNED");
  const rentalPlans = equipmentPlans.filter((p: any) => p.source === "RENTAL");

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading equipment...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Ruler className="h-5 w-5" />
              Equipment Plan
            </CardTitle>
            <CardDescription>
              Planned equipment for this project (from bid or manually added)
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {totalPlannedCost > 0 && (
              <Badge variant="secondary" className="text-base">
                Total: ${totalPlannedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Badge>
            )}
            {canManagePlans && (
              <Button size="sm" onClick={() => setShowAddPlanDialog(true)} data-testid="button-add-equipment-plan">
                <Plus className="h-4 w-4 mr-1" />
                Add Equipment
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {equipmentPlans.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Ruler className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>No equipment planned for this project</p>
              {canManagePlans && (
                <p className="text-sm mt-2">
                  Equipment plans are carried over when converting a bid to a project
                </p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Planned Days</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Planned Cost</TableHead>
                  <TableHead>Status</TableHead>
                  {canManagePlans && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipmentPlans.map((plan: any) => (
                  <TableRow key={plan.id}>
                    <TableCell className="font-medium">{plan.equipmentName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{plan.equipmentType}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={plan.source === "OWNED" ? "default" : "secondary"}>
                        {plan.source}
                      </Badge>
                    </TableCell>
                    <TableCell>{plan.plannedDays || plan.plannedHours ? `${plan.plannedDays || "-"} days / ${plan.plannedHours || "-"} hrs` : "-"}</TableCell>
                    <TableCell>
                      {plan.dailyRate ? `$${Number(plan.dailyRate).toFixed(2)}/day` : plan.hourlyRate ? `$${Number(plan.hourlyRate).toFixed(2)}/hr` : "-"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {plan.plannedCost ? `$${Number(plan.plannedCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={plan.status}
                        onValueChange={(value) => updatePlanStatus.mutate({ planId: plan.id, status: value })}
                        disabled={!canManagePlans || updatePlanStatus.isPending}
                      >
                        <SelectTrigger className="w-32" data-testid={`select-plan-status-${plan.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PLANNED">Planned</SelectItem>
                          <SelectItem value="ASSIGNED">Assigned</SelectItem>
                          <SelectItem value="RENTAL_BOOKED">Rental Booked</SelectItem>
                          <SelectItem value="RENTAL_ACTIVE">Rental Active</SelectItem>
                          <SelectItem value="COMPLETED">Completed</SelectItem>
                          <SelectItem value="CANCELLED">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {canManagePlans && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {plan.source === "OWNED" && plan.status === "PLANNED" && !plan.equipmentId && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedPlanForAssignment(plan);
                                setShowAssignDialog(true);
                              }}
                              data-testid={`button-assign-plan-${plan.id}`}
                            >
                              <Link2 className="h-4 w-4 mr-1" />
                              Assign
                            </Button>
                          )}
                          {plan.source === "RENTAL" && plan.status === "PLANNED" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedPlanForRental(plan);
                                setShowRentalBookingDialog(true);
                              }}
                              data-testid={`button-book-rental-${plan.id}`}
                            >
                              <ExternalLink className="h-4 w-4 mr-1" />
                              Book
                            </Button>
                          )}
                          {plan.source === "RENTAL" && (plan.status === "RENTAL_BOOKED" || plan.status === "RENTAL_ACTIVE") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedPlanForRental(plan);
                                setShowRentalTrackingDialog(true);
                              }}
                              data-testid={`button-track-rental-${plan.id}`}
                            >
                              <Edit className="h-4 w-4 mr-1" />
                              Track
                            </Button>
                          )}
                          {plan.equipmentId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                              data-testid={`button-view-equipment-${plan.id}`}
                            >
                              <Link href={`/equipment/${plan.equipmentCode || plan.equipmentId}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`button-delete-plan-${plan.id}`}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Equipment Plan?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Remove "{plan.equipmentName}" from the equipment plan. This cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deletePlan.mutate(plan.id)}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {equipmentPlans.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
              <div className="p-3 rounded-md bg-muted/50">
                <div className="text-muted-foreground">Owned Equipment</div>
                <div className="text-lg font-semibold">{ownedPlans.length} items</div>
                <div className="text-muted-foreground">
                  ${ownedPlans.reduce((sum: number, p: any) => sum + Number(p.plannedCost || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-3 rounded-md bg-muted/50">
                <div className="text-muted-foreground">Rental Equipment</div>
                <div className="text-lg font-semibold">{rentalPlans.length} items</div>
                <div className="text-muted-foreground">
                  ${rentalPlans.reduce((sum: number, p: any) => sum + Number(p.plannedCost || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-3 rounded-md bg-muted/50">
                <div className="text-muted-foreground">Total Planned Cost</div>
                <div className="text-lg font-semibold">
                  ${totalPlannedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Assigned Equipment
            </CardTitle>
            <CardDescription>
              Equipment currently assigned to this project
            </CardDescription>
          </div>
          {canManageEquipment && (
            <Button asChild size="sm" data-testid="button-manage-equipment">
              <Link href="/equipment">
                <Settings2 className="h-4 w-4 mr-2" />
                Manage Equipment
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {assignedEquipment.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Truck className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>No equipment currently assigned to this project</p>
              {canManageEquipment && (
                <p className="text-sm mt-2">
                  <Link href="/equipment" className="text-primary hover:underline">
                    Go to Equipment
                  </Link> to assign equipment to this project
                </p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Make/Model</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Expected Return</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageEquipment && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignedEquipment.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link href={`/equipment/${item.equipmentCode}`} className="text-primary hover:underline font-medium">
                        {item.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{item.equipmentCode}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.type}</Badge>
                    </TableCell>
                    <TableCell>
                      {item.make && item.model 
                        ? `${item.make} ${item.model}` 
                        : item.make || item.model || "-"
                      }
                      {item.year && <span className="text-muted-foreground ml-1">({item.year})</span>}
                    </TableCell>
                    <TableCell>
                      {item.assignedAt 
                        ? format(new Date(item.assignedAt), "MMM d, yyyy")
                        : "-"
                      }
                    </TableCell>
                    <TableCell>
                      {item.expectedReturnDate
                        ? format(new Date(item.expectedReturnDate), "MMM d, yyyy")
                        : "-"
                      }
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === "ASSIGNED" ? "default" : "secondary"}>
                        {item.status}
                      </Badge>
                    </TableCell>
                    {canManageEquipment && (
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => returnEquipment.mutate(item.id)}
                            disabled={returnEquipment.isPending}
                            data-testid={`button-return-${item.equipmentCode}`}
                          >
                            <Undo2 className="h-4 w-4 mr-1" />
                            Return
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddEquipmentPlanDialog
        open={showAddPlanDialog}
        onOpenChange={setShowAddPlanDialog}
        projectId={projectId}
      />

      <AssignEquipmentDialog
        open={showAssignDialog}
        onOpenChange={(open) => {
          setShowAssignDialog(open);
          if (!open) setSelectedPlanForAssignment(null);
        }}
        projectId={projectId}
        plan={selectedPlanForAssignment}
      />

      <RentalBookingDialog
        open={showRentalBookingDialog}
        onOpenChange={(open) => {
          setShowRentalBookingDialog(open);
          if (!open) setSelectedPlanForRental(null);
        }}
        projectId={projectId}
        plan={selectedPlanForRental}
      />

      <RentalTrackingDialog
        open={showRentalTrackingDialog}
        onOpenChange={(open) => {
          setShowRentalTrackingDialog(open);
          if (!open) setSelectedPlanForRental(null);
        }}
        projectId={projectId}
        plan={selectedPlanForRental}
      />
    </div>
  );
}

interface AddEquipmentPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

function AddEquipmentPlanDialog({ open, onOpenChange, projectId }: AddEquipmentPlanDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<"OWNED" | "RENTAL">("OWNED");
  const [equipmentName, setEquipmentName] = useState("");
  const [equipmentType, setEquipmentType] = useState("");
  const [plannedDays, setPlannedDays] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [notes, setNotes] = useState("");

  const createPlan = useMutation({
    mutationFn: async () => {
      const days = plannedDays ? Number(plannedDays) : null;
      const rate = dailyRate ? Number(dailyRate) : null;
      const cost = days && rate ? days * rate : null;
      
      return apiRequest("POST", `/api/projects/${projectId}/equipment-plans`, {
        source,
        equipmentName,
        equipmentType,
        plannedDays: days,
        dailyRate: rate,
        plannedCost: cost,
        notes: notes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      toast({ title: "Success", description: "Equipment added to plan" });
      onOpenChange(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to add equipment",
        variant: "destructive" 
      });
    },
  });

  const resetForm = () => {
    setSource("OWNED");
    setEquipmentName("");
    setEquipmentType("");
    setPlannedDays("");
    setDailyRate("");
    setNotes("");
  };

  const calculatedCost = plannedDays && dailyRate ? Number(plannedDays) * Number(dailyRate) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Equipment to Plan</DialogTitle>
          <DialogDescription>Add planned equipment for this project</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Button
              type="button"
              variant={source === "OWNED" ? "default" : "outline"}
              onClick={() => setSource("OWNED")}
              data-testid="button-source-owned"
            >
              <Truck className="h-4 w-4 mr-2" />
              Owned
            </Button>
            <Button
              type="button"
              variant={source === "RENTAL" ? "default" : "outline"}
              onClick={() => setSource("RENTAL")}
              data-testid="button-source-rental"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Rental
            </Button>
          </div>

          <div>
            <Label>Equipment Name</Label>
            <Input
              value={equipmentName}
              onChange={(e) => setEquipmentName(e.target.value)}
              placeholder="e.g., CAT 320 Excavator"
              data-testid="input-plan-equipment-name"
            />
          </div>

          <div>
            <Label>Equipment Type</Label>
            <Select value={equipmentType} onValueChange={setEquipmentType}>
              <SelectTrigger data-testid="select-plan-equipment-type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Heavy Equipment">Heavy Equipment</SelectItem>
                <SelectItem value="Vehicles">Vehicles</SelectItem>
                <SelectItem value="Power Tools">Power Tools</SelectItem>
                <SelectItem value="Hand Tools">Hand Tools</SelectItem>
                <SelectItem value="Trailers">Trailers</SelectItem>
                <SelectItem value="Concrete Equipment">Concrete Equipment</SelectItem>
                <SelectItem value="Excavation Equipment">Excavation Equipment</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Planned Days</Label>
              <Input
                type="number"
                value={plannedDays}
                onChange={(e) => setPlannedDays(e.target.value)}
                placeholder="0"
                data-testid="input-plan-days"
              />
            </div>
            <div>
              <Label>Daily Rate ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={dailyRate}
                onChange={(e) => setDailyRate(e.target.value)}
                placeholder="0.00"
                data-testid="input-plan-daily-rate"
              />
            </div>
          </div>

          {calculatedCost > 0 && (
            <div className="p-3 rounded-md bg-muted text-center">
              <div className="text-sm text-muted-foreground">Estimated Cost</div>
              <div className="text-lg font-bold">
                ${calculatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          )}

          <div>
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              data-testid="input-plan-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => createPlan.mutate()}
            disabled={!equipmentName || !equipmentType || createPlan.isPending}
            data-testid="button-submit-plan"
          >
            {createPlan.isPending ? "Adding..." : "Add to Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AssignEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  plan: any;
}

function AssignEquipmentDialog({ open, onOpenChange, projectId, plan }: AssignEquipmentDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");
  const [expectedDays, setExpectedDays] = useState("");

  const { data: availableEquipment = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/equipment", "available", plan?.equipmentType],
    queryFn: async () => {
      const response = await fetch(`/api/equipment?status=AVAILABLE&type=${encodeURIComponent(plan?.equipmentType || "")}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch available equipment");
      const data = await response.json();
      return data.data || data;
    },
    enabled: open && !!plan,
  });

  const assignEquipment = useMutation({
    mutationFn: async () => {
      const today = new Date();
      const endDate = expectedDays ? new Date(today.getTime() + Number(expectedDays) * 24 * 60 * 60 * 1000) : null;
      
      await apiRequest("POST", `/api/equipment/${selectedEquipmentId}/assign`, {
        projectId: projectId,
        expectedReturnDate: endDate?.toISOString().split('T')[0] || null,
      });
      
      try {
        await apiRequest("PATCH", `/api/projects/${projectId}/equipment-plans/${plan.id}`, {
          equipmentId: selectedEquipmentId,
          status: "ASSIGNED",
          actualStartDate: today.toISOString(),
          actualDays: expectedDays ? Number(expectedDays) : null,
        });
      } catch (planError) {
        console.error("Failed to update plan after equipment assignment:", planError);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment", "available"] });
      toast({ title: "Success", description: "Equipment assigned to project" });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to assign equipment",
        variant: "destructive" 
      });
    },
  });

  const resetForm = () => {
    setSelectedEquipmentId("");
    setExpectedDays("");
  };

  useEffect(() => {
    if (open && plan) {
      setExpectedDays(plan.plannedDays ? String(plan.plannedDays) : "");
      setSelectedEquipmentId("");
    } else if (!open) {
      resetForm();
    }
  }, [open, plan]);

  if (!plan) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Equipment to Plan</DialogTitle>
          <DialogDescription>
            Select equipment from your fleet to fulfill: {plan.equipmentName}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-md bg-muted/50 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Plan:</span>{" "}
                <span className="font-medium">{plan.equipmentName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Type:</span>{" "}
                <span className="font-medium">{plan.equipmentType}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Planned Days:</span>{" "}
                <span className="font-medium">{plan.plannedDays || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Planned Cost:</span>{" "}
                <span className="font-medium">
                  {plan.plannedCost ? `$${Number(plan.plannedCost).toFixed(2)}` : "-"}
                </span>
              </div>
            </div>
          </div>

          <div>
            <Label>Select Equipment from Fleet</Label>
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-2">Loading available equipment...</div>
            ) : availableEquipment.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2">
                No available equipment of type "{plan.equipmentType}" found in your fleet.
              </div>
            ) : (
              <Select value={selectedEquipmentId} onValueChange={setSelectedEquipmentId}>
                <SelectTrigger data-testid="select-equipment-assign">
                  <SelectValue placeholder="Select equipment" />
                </SelectTrigger>
                <SelectContent>
                  {availableEquipment.map((eq: any) => (
                    <SelectItem key={eq.id} value={eq.id}>
                      {eq.name} - {eq.make} {eq.model} ({eq.equipmentCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label>Expected Duration (Days)</Label>
            <Input
              type="number"
              value={expectedDays}
              onChange={(e) => setExpectedDays(e.target.value)}
              placeholder={plan.plannedDays ? String(plan.plannedDays) : "0"}
              data-testid="input-expected-days"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used to calculate expected return date
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => assignEquipment.mutate()}
            disabled={!selectedEquipmentId || assignEquipment.isPending}
            data-testid="button-confirm-assign"
          >
            {assignEquipment.isPending ? "Assigning..." : "Assign Equipment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RentalBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  plan: any;
}

function RentalBookingDialog({ open, onOpenChange, projectId, plan }: RentalBookingDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: rentalVendors = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/rental-vendors"],
    queryFn: async () => {
      const response = await fetch("/api/rental-vendors", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch vendors");
      return response.json();
    },
    enabled: open,
  });

  const bookRental = useMutation({
    mutationFn: async () => {
      const days = startDate && endDate 
        ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
        : null;
      const rate = dailyRate ? Number(dailyRate) : (plan.dailyRate ? Number(plan.dailyRate) : null);
      const cost = days && rate ? days * rate : null;
      
      return apiRequest("PATCH", `/api/projects/${projectId}/equipment-plans/${plan.id}`, {
        status: "RENTAL_BOOKED",
        rentalVendorId: selectedVendorId || null,
        rentalConfirmationNumber: confirmationNumber || null,
        actualStartDate: startDate || null,
        actualEndDate: endDate || null,
        actualDays: days,
        dailyRate: rate,
        actualCost: cost,
        notes: notes || plan.notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      toast({ title: "Success", description: "Rental booked successfully" });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to book rental",
        variant: "destructive" 
      });
    },
  });

  const resetForm = () => {
    setSelectedVendorId("");
    setConfirmationNumber("");
    setStartDate("");
    setEndDate("");
    setDailyRate("");
    setNotes("");
  };

  useEffect(() => {
    if (open && plan) {
      setSelectedVendorId(plan.rentalVendorId || "");
      setConfirmationNumber(plan.rentalConfirmationNumber || "");
      setStartDate(plan.plannedStartDate ? format(new Date(plan.plannedStartDate), "yyyy-MM-dd") : "");
      setEndDate(plan.plannedEndDate ? format(new Date(plan.plannedEndDate), "yyyy-MM-dd") : "");
      setDailyRate(plan.dailyRate ? String(plan.dailyRate) : "");
      setNotes(plan.notes || "");
    } else if (!open) {
      resetForm();
    }
  }, [open, plan]);

  if (!plan) return null;

  const calculatedDays = startDate && endDate 
    ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 0;
  const rate = dailyRate ? Number(dailyRate) : (plan.dailyRate ? Number(plan.dailyRate) : 0);
  const calculatedCost = calculatedDays * rate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Book Rental</DialogTitle>
          <DialogDescription>
            Book rental equipment: {plan.equipmentName}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-md bg-muted/50 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Equipment:</span>{" "}
                <span className="font-medium">{plan.equipmentName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Type:</span>{" "}
                <span className="font-medium">{plan.equipmentType}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Planned Days:</span>{" "}
                <span className="font-medium">{plan.plannedDays || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Planned Cost:</span>{" "}
                <span className="font-medium">
                  {plan.plannedCost ? `$${Number(plan.plannedCost).toFixed(2)}` : "-"}
                </span>
              </div>
            </div>
          </div>

          <div>
            <Label>Rental Vendor</Label>
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-2">Loading vendors...</div>
            ) : (
              <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
                <SelectTrigger data-testid="select-rental-vendor">
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {rentalVendors.map((vendor: any) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label>Confirmation Number (Optional)</Label>
            <Input
              value={confirmationNumber}
              onChange={(e) => setConfirmationNumber(e.target.value)}
              placeholder="e.g., RNT-12345"
              data-testid="input-confirmation-number"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-rental-start-date"
              />
            </div>
            <div>
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-rental-end-date"
              />
            </div>
          </div>

          <div>
            <Label>Daily Rate ($)</Label>
            <Input
              type="number"
              step="0.01"
              value={dailyRate}
              onChange={(e) => setDailyRate(e.target.value)}
              placeholder={plan.dailyRate ? String(plan.dailyRate) : "0.00"}
              data-testid="input-rental-daily-rate"
            />
          </div>

          {calculatedCost > 0 && (
            <div className="p-3 rounded-md bg-muted text-center">
              <div className="text-sm text-muted-foreground">{calculatedDays} days x ${rate.toFixed(2)}/day</div>
              <div className="text-lg font-bold">
                Total: ${calculatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          )}

          <div>
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              data-testid="input-rental-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => bookRental.mutate()}
            disabled={bookRental.isPending}
            data-testid="button-confirm-booking"
          >
            {bookRental.isPending ? "Booking..." : "Book Rental"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RentalTrackingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  plan: any;
}

function RentalTrackingDialog({ open, onOpenChange, projectId, plan }: RentalTrackingDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("RENTAL_ACTIVE");
  const [actualDays, setActualDays] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [notes, setNotes] = useState("");

  const updateRental = useMutation({
    mutationFn: async () => {
      const updateData: Record<string, any> = {
        status,
        notes: notes || plan.notes,
      };
      
      if (actualDays) updateData.actualDays = Number(actualDays);
      if (actualCost) updateData.actualCost = Number(actualCost);
      
      if (status === "COMPLETED") {
        updateData.actualEndDate = new Date().toISOString();
      }
      
      return apiRequest("PATCH", `/api/projects/${projectId}/equipment-plans/${plan.id}`, updateData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "equipment-plans"] });
      toast({ title: "Success", description: "Rental updated successfully" });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update rental",
        variant: "destructive" 
      });
    },
  });

  useEffect(() => {
    if (open && plan) {
      setStatus(plan.status);
      setActualDays(plan.actualDays ? String(plan.actualDays) : "");
      setActualCost(plan.actualCost ? String(plan.actualCost) : "");
      setNotes(plan.notes || "");
    }
  }, [open, plan]);

  if (!plan) return null;

  const costVariance = plan.plannedCost && actualCost 
    ? Number(actualCost) - Number(plan.plannedCost) 
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Track Rental</DialogTitle>
          <DialogDescription>
            Update rental status and track costs: {plan.equipmentName}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-md bg-muted/50 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Equipment:</span>{" "}
                <span className="font-medium">{plan.equipmentName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Vendor:</span>{" "}
                <span className="font-medium">{plan.vendorName || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Planned Cost:</span>{" "}
                <span className="font-medium">
                  {plan.plannedCost ? `$${Number(plan.plannedCost).toFixed(2)}` : "-"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Confirmation:</span>{" "}
                <span className="font-medium">{plan.rentalConfirmationNumber || "-"}</span>
              </div>
            </div>
          </div>

          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-rental-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RENTAL_BOOKED">Booked</SelectItem>
                <SelectItem value="RENTAL_ACTIVE">Active</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Actual Days</Label>
              <Input
                type="number"
                value={actualDays}
                onChange={(e) => setActualDays(e.target.value)}
                placeholder={plan.plannedDays ? String(plan.plannedDays) : "0"}
                data-testid="input-actual-days"
              />
            </div>
            <div>
              <Label>Actual Cost ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
                placeholder={plan.plannedCost ? String(plan.plannedCost) : "0.00"}
                data-testid="input-actual-cost"
              />
            </div>
          </div>

          {costVariance !== null && (
            <div className={`p-3 rounded-md text-center ${costVariance > 0 ? 'bg-destructive/10' : 'bg-green-500/10'}`}>
              <div className="text-sm text-muted-foreground">Cost Variance</div>
              <div className={`text-lg font-bold ${costVariance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                {costVariance > 0 ? '+' : ''}{costVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-sm ml-1">
                  ({((costVariance / Number(plan.plannedCost)) * 100).toFixed(1)}%)
                </span>
              </div>
            </div>
          )}

          <div>
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              data-testid="input-tracking-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => updateRental.mutate()}
            disabled={updateRental.isPending}
            data-testid="button-update-rental"
          >
            {updateRental.isPending ? "Updating..." : "Update Rental"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ChangeOrdersTabProps {
  changeOrders: ChangeOrder[];
  projectCode: string;
  projectId: string;
  isLoading: boolean;
  userRole: string;
}

function ChangeOrdersTab({ changeOrders, projectCode, projectId, isLoading, userRole }: ChangeOrdersTabProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedChangeOrder, setSelectedChangeOrder] = useState<ChangeOrder | null>(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [changeOrderNumber, setChangeOrderNumber] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  // Standardized scope of work selection (matches estimating sheets)
  const [scopeSelection, setScopeSelection] = useState<ScopeSelectionData | null>(null);
  const [scopeQuantity, setScopeQuantity] = useState("");
  const { toast } = useToast();

  const createMutation = useCreateChangeOrder();
  const requestApprovalMutation = useRequestApprovalChangeOrder();
  const approveMutation = useApproveChangeOrder();
  const rejectMutation = useRejectChangeOrder();
  const submitMutation = useSubmitChangeOrder();
  const returnToDraftMutation = useReturnToDraftChangeOrder();

  const handleCreate = async () => {
    if (!changeOrderNumber || !description || !amount) {
      toast({ title: "Error", description: "All fields are required", variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync({
        projectId,
        projectCode,
        changeOrderNumber,
        description,
        amount,
        // Standardized scope data for production rate tracking
        workTypeId: scopeSelection?.workTypeId || undefined,
        workTypeCode: scopeSelection?.workTypeCode || undefined,
        workTypeName: scopeSelection?.workTypeName || undefined,
        categoryName: scopeSelection?.categoryName || undefined,
        // Stringify arrays for API (schema expects JSON strings) - always send "[]" when empty
        scopeModifierIds: scopeSelection ? JSON.stringify(scopeSelection.modifierIds || []) : undefined,
        scopeModifierNames: scopeSelection ? JSON.stringify(scopeSelection.modifierNames || []) : undefined,
        canonicalName: scopeSelection?.canonicalName || undefined,
        scopeUnit: scopeSelection?.unit || undefined,
        scopeQuantity: scopeQuantity || undefined,
      });
      toast({ title: "Success", description: "Change order created" });
      setShowCreateDialog(false);
      setChangeOrderNumber("");
      setDescription("");
      setAmount("");
      setScopeSelection(null);
      setScopeQuantity("");
    } catch (error) {
      toast({ title: "Error", description: "Failed to create change order", variant: "destructive" });
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await approveMutation.mutateAsync({ id, projectCode });
      toast({ title: "Success", description: "Change order approved" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt("Rejection reason:");
    if (!reason) return;

    try {
      await rejectMutation.mutateAsync({ id, reason, projectCode });
      toast({ title: "Success", description: "Change order rejected" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to reject", variant: "destructive" });
    }
  };

  const handleSubmit = async (id: string) => {
    try {
      await submitMutation.mutateAsync({ id, projectCode });
      toast({ title: "Success", description: "Change order submitted to client" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to submit", variant: "destructive" });
    }
  };

  const handleReturnToDraft = async (id: string) => {
    const reason = prompt("Reason for returning to draft (optional):");
    
    try {
      await returnToDraftMutation.mutateAsync({ id, reason: reason || undefined, projectCode });
      toast({ title: "Success", description: "Change order returned to draft" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to return to draft", variant: "destructive" });
    }
  };

  const handleRequestApproval = async (id: string) => {
    try {
      await requestApprovalMutation.mutateAsync({ id, projectCode });
      toast({ title: "Success", description: "Change order sent for approval" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to request approval", variant: "destructive" });
    }
  };

  const canManage = ["ADMIN", "MANAGER"].includes(userRole);

  return (
    <TabsContent value="change-orders">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Change Orders</CardTitle>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-new-change-order">
                <Plus className="w-4 h-4 mr-2" />
                New Change Order
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-create-change-order">
              <DialogHeader>
                <DialogTitle>Create Change Order</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="co-number">Change Order Number</Label>
                    <Input
                      id="co-number"
                      value={changeOrderNumber}
                      onChange={(e) => setChangeOrderNumber(e.target.value)}
                      placeholder="CO-001"
                      data-testid="input-change-order-number"
                    />
                  </div>
                  <div>
                    <Label htmlFor="co-amount">Amount ($)</Label>
                    <Input
                      id="co-amount"
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="2500.00"
                      data-testid="input-change-order-amount"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Enter positive for additions or negative for deductions
                    </p>
                  </div>
                </div>

                {/* Standardized Scope of Work - matches estimating sheets for production rate tracking */}
                <Card className="p-4 bg-muted/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Ruler className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm font-medium">Scope of Work (for Production Rate Tracking)</Label>
                  </div>
                  <StandardizedScopeSelector
                    value={scopeSelection || undefined}
                    onChange={setScopeSelection}
                    showDimensionInputs={false}
                  />
                  {scopeSelection && (
                    <div className="mt-3 grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="co-scope-quantity">Quantity</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="co-scope-quantity"
                            type="number"
                            step="0.01"
                            value={scopeQuantity}
                            onChange={(e) => setScopeQuantity(e.target.value)}
                            placeholder="0"
                            data-testid="input-co-scope-quantity"
                          />
                          <span className="text-sm text-muted-foreground whitespace-nowrap">{scopeSelection.unit}</span>
                        </div>
                      </div>
                      <div className="flex items-end">
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium">Selected:</span> {scopeSelection.canonicalName}
                        </div>
                      </div>
                    </div>
                  )}
                  {!scopeSelection && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Select a work type to enable production rate tracking for this change order.
                    </p>
                  )}
                </Card>

                <div>
                  <Label htmlFor="co-description">Description</Label>
                  <Textarea
                    id="co-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the change..."
                    data-testid="input-change-order-description"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  data-testid="button-submit-change-order"
                >
                  {createMutation.isPending ? "Creating..." : "Create Change Order"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading change orders...</div>
          ) : changeOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No change orders yet</div>
          ) : (
            <div className="space-y-3">
              {changeOrders.map((co) => (
                <Card key={co.id} data-testid={`change-order-${co.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="font-mono">{co.changeOrderNumber}</Badge>
                          <Badge
                            variant={
                              co.status === "APPROVED" ? "default" :
                              co.status === "REJECTED" ? "destructive" :
                              co.status === "SUBMITTED" ? "secondary" :
                              "outline"
                            }
                          >
                            {co.status?.replace("_", " ")}
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedChangeOrder(co);
                              setShowViewDialog(true);
                            }}
                            data-testid={`button-view-change-order-${co.id}`}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View Details
                          </Button>
                        </div>
                        <p className="font-medium mb-1">{co.description}</p>
                        <p className="text-sm text-muted-foreground">
                          Created {format(new Date(co.createdAt), "MMM d, yyyy")}
                        </p>
                        {co.rejectionReason && (
                          <p className="text-sm text-destructive mt-2">
                            Rejected: {co.rejectionReason}
                          </p>
                        )}
                        
                        {/* File Attachments Section */}
                        <ChangeOrderFiles changeOrderId={co.id} />
                      </div>
                      <div className="text-right">
                        {hasManagementAccess(userRole) && (
                          <>
                            <p className={`text-xl font-bold font-mono ${parseFloat(co.amount) < 0 ? 'text-destructive' : 'text-primary'}`}>
                              {parseFloat(co.amount) >= 0 ? '+' : ''}${parseFloat(co.amount).toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {parseFloat(co.amount) >= 0 ? 'Addition' : 'Deduction'}
                            </p>
                          </>
                        )}
                        {canManage && co.status === "DRAFT" && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleSubmit(co.id)}
                              disabled={submitMutation.isPending}
                              data-testid={`button-submit-${co.id}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Submit to Client
                            </Button>
                          </div>
                        )}
                        {canManage && co.status === "SUBMITTED" && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleApprove(co.id)}
                              disabled={approveMutation.isPending}
                              data-testid={`button-approve-${co.id}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReject(co.id)}
                              disabled={rejectMutation.isPending}
                              data-testid={`button-reject-${co.id}`}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Change Order View/Edit Dialog */}
      <ChangeOrderDialog
        changeOrder={selectedChangeOrder}
        open={showViewDialog}
        onOpenChange={(open) => {
          setShowViewDialog(open);
          if (!open) setSelectedChangeOrder(null);
        }}
        projectCode={projectCode}
        userRole={userRole}
      />
    </TabsContent>
  );
}

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");
  const [, params] = useRoute("/projects/:code");
  const { user, logout } = useAuth();
  const { toast } = useToast();
  
  // Check if coming from CFO dashboard
  const searchParams = new URLSearchParams(window.location.search);
  const fromCFO = searchParams.get('from') === 'cfo';
  const backPath = fromCFO ? '/cfo' : '/projects';
  const backLabel = fromCFO ? 'Back to CFO' : 'Back to Projects';
  
  const projectCode = params?.code || "";
  const { data: project, isLoading: projectLoading } = useProject(projectCode);
  const { data: scopeItems = [], isLoading: scopeLoading } = useScopeItems(projectCode);
  const { data: changeOrders = [], isLoading: changeOrdersLoading } = useChangeOrders(projectCode);
  const { data: projectNotes = [], isLoading: notesLoading } = useProjectNotes(projectCode);
  const { data: mediaItems = [], isLoading: mediaLoading } = useProjectMedia(projectCode);
  const { data: estimates = [], isLoading: estimatesLoading } = useProjectEstimates(projectCode);
  const { data: procurementItems = [], isLoading: procurementLoading } = useProjectProcurement(projectCode);
  const { data: documents = [], isLoading: documentsLoading } = useProjectDocuments(projectCode);
  const { data: timeEntries = [], isLoading: timeEntriesLoading} = useProjectTimeEntries(projectCode);
  const { data: tmSheets = [], isLoading: tmSheetsLoading } = useProjectTMSheets(projectCode);
  const { data: receipts = [], isLoading: receiptsLoading } = useProjectReceipts(projectCode);

  // Project financials query (for detailed profit tracking)
  interface ProjectFinancials {
    budget: number;
    originalContract: number;
    adjustedContract: number;
    contractAdditions: number;
    approvedChangeOrdersTotal: number;
    approvedChangeOrdersCount: number;
    tmCharges: {
      labor: number;
      equipment: number;
      materials: number;
      total: number;
      sheetsCount: number;
    };
    projectedProfit: number;
    actualProfit: number;
    actualCosts: {
      labor: number;
      laborHours: number;
      laborBaseCost?: number;
      materials: number;
      subcontractors: number;
      otherExpenses: number;
      total: number;
    };
    laborRates?: {
      configured: boolean;
      defaultRegularRate: number | null;
      defaultOvertimeRate: number | null;
      burdenMultiplier: number;
      employeeOverrideCount: number;
    };
    profitVariance: number;
    profitVariancePercent: number;
  }
  
  const { data: financials, isLoading: financialsLoading } = useQuery<ProjectFinancials>({
    queryKey: ["/api/projects", projectCode, "financials"],
    enabled: !!projectCode && FeaturePermissions.VIEW_PROJECT_FINANCIALS(user?.role),
  });

  // Project labor rates hooks
  const { data: laborRatesConfig, isLoading: laborRatesLoading } = useProjectLaborRates(projectCode);
  const { data: employeeRates = [], isLoading: employeeRatesLoading } = useProjectEmployeeRates(projectCode);
  const updateLaborRatesMutation = useUpdateProjectLaborRates();
  const updateEmployeeRateMutation = useUpdateProjectEmployeeRate();
  const deleteEmployeeRateMutation = useDeleteProjectEmployeeRate();

  // Subcontractor contracts query
  const { data: subcontractors = [], isLoading: subcontractorsLoading } = useQuery<Array<{
    id: string;
    contractNumber: string;
    scopeOfWork: string;
    contractAmount: string;
    startDate: string | null;
    completionDate: string | null;
    status: string;
    paymentTerms: string | null;
    retentionPercent: string | null;
    notes: string | null;
    createdAt: string;
    subcontractor: {
      id: string;
      companyName: string;
      contactName: string | null;
      email: string | null;
      phone: string | null;
    } | null;
  }>>({
    queryKey: ["/api/projects", projectCode, "subcontractors"],
    enabled: !!projectCode,
  });

  // Query all users for daily notes filter
  const { data: allUsers = [] } = useQuery<Array<{
    id: string;
    firstName: string;
    lastName: string;
  }>>({
    queryKey: ["/api/users"],
  });

  // Subcontractor payables query (for payment tracking on this project)
  const { data: allPayables = [] } = useQuery<Array<{
    paymentId: string;
    amount: string;
    status: string;
    remainingBalance: string;
    contract: {
      id: string;
      contractAmount: string;
    };
    project: {
      code: string;
    };
  }>>({
    queryKey: ["/api/subcontractor-payables"],
    enabled: !!projectCode,
  });

  // Filter payables for this project and aggregate by contract
  const payablesByContract = useMemo(() => {
    const filtered = allPayables.filter(p => p.project && p.project.code === projectCode);
    const grouped = new Map<string, { totalPaid: number; remainingBalance: number }>();
    
    filtered.forEach(payable => {
      const contractId = payable.contract.id;
      if (!grouped.has(contractId)) {
        grouped.set(contractId, { totalPaid: 0, remainingBalance: parseFloat(payable.remainingBalance) });
      }
      const current = grouped.get(contractId)!;
      if (payable.status === 'PAID') {
        current.totalPaid += parseFloat(payable.amount);
      }
    });
    
    return grouped;
  }, [allPayables, projectCode]);

  // Pending quotes query (quotes transferred from bid but not yet selected for contracts/procurement)
  interface PendingSubQuote {
    id: string;
    subcontractorName: string;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    scopeOfWork: string;
    quoteAmount: string;
    leadTime: string | null;
    estimatedCompletionTime: string | null;
    notes: string | null;
    fileUrl: string | null;
    fileName: string | null;
    createdAt: string;
  }
  
  interface PendingMatQuote {
    id: string;
    materialName: string;
    description: string;
    specs: string | null;
    cost: string;
    leadTime: string | null;
    supplierName: string | null;
    supplierContact: string | null;
    fileUrl: string | null;
    fileName: string | null;
    createdAt: string;
  }
  
  const { data: pendingQuotes, isLoading: pendingQuotesLoading } = useQuery<{
    subcontractorQuotes: PendingSubQuote[];
    materialQuotes: PendingMatQuote[];
  }>({
    queryKey: ["/api/projects", projectCode, "pending-quotes"],
    enabled: !!projectCode,
  });

  // Data quality score query
  const { data: dataQuality, isLoading: dataQualityLoading } = useQuery<{
    overall_score: number;
    has_scope: boolean;
    has_estimates: boolean;
    has_budget: boolean;
    has_timeline: boolean;
    has_daily_updates: boolean;
    has_cost_tracking: boolean;
    has_media: boolean;
    has_documentation: boolean;
    has_change_orders_managed: boolean;
    has_billing_setup: boolean;
  }>({
    queryKey: ["/api/projects", projectCode, "data-quality"],
    enabled: !!projectCode,
  });

  // Media upload state
  const [showMediaDialog, setShowMediaDialog] = useState(false);
  const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [mediaCaption, setMediaCaption] = useState("");
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  // Documents upload state
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentType, setDocumentType] = useState<"PLANS" | "SPECS" | "TAKEOFF" | "OTHER">("OTHER");
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);

  // Receipts upload state
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptVendor, setReceiptVendor] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptCategory, setReceiptCategory] = useState("");
  const [receiptDate, setReceiptDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  // Budget edit state (admin only)
  const [showBudgetEditDialog, setShowBudgetEditDialog] = useState(false);
  const [editBudget, setEditBudget] = useState("");
  const [editContractAmount, setEditContractAmount] = useState("");
  const [editTexturaDrawDate, setEditTexturaDrawDate] = useState("");
  const [editDrawDayOfMonth, setEditDrawDayOfMonth] = useState<number | "">("");
  const [plansSubTab, setPlansSubTab] = useState<"takeoff" | "documents">("documents");

  // Procurement item state
  const [showProcurementDialog, setShowProcurementDialog] = useState(false);
  const [procurementDescription, setProcurementDescription] = useState("");
  const [procurementVendor, setProcurementVendor] = useState("");
  const [procurementQuantity, setProcurementQuantity] = useState("");
  const [procurementUnit, setProcurementUnit] = useState("");
  const [procurementUnitCost, setProcurementUnitCost] = useState("");
  const [procurementStatus, setProcurementStatus] = useState<"PLANNED" | "ORDERED" | "DELIVERED">("PLANNED");
  const [procurementPoNumber, setProcurementPoNumber] = useState("");

  // Subcontractor payment state
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDescription, setPaymentDescription] = useState("");
  const [paymentInvoiceNumber, setPaymentInvoiceNumber] = useState("");
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));

  // Labor rates state
  const [showLaborRatesDialog, setShowLaborRatesDialog] = useState(false);
  const [laborRegularRate, setLaborRegularRate] = useState("");
  const [laborOvertimeRate, setLaborOvertimeRate] = useState("");
  const [laborBurdenMultiplier, setLaborBurdenMultiplier] = useState("");
  const [laborRatesNotes, setLaborRatesNotes] = useState("");
  const [showEmployeeRateDialog, setShowEmployeeRateDialog] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [employeeRegularRate, setEmployeeRegularRate] = useState("");
  const [employeeOvertimeRate, setEmployeeOvertimeRate] = useState("");
  const [employeeRateNotes, setEmployeeRateNotes] = useState("");

  // Quote detail dialog state
  const [showQuoteDetailDialog, setShowQuoteDetailDialog] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<{
    type: "subcontractor" | "material";
    data: any;
  } | null>(null);

  // Mutations
  const createProcurementMutation = useCreateProcurementItem();
  const createPaymentMutation = useCreateSubcontractorPayment();

  // Select pending quote mutations
  const selectSubQuoteMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      return await apiRequest("POST", `/api/projects/${projectCode}/pending-quotes/subcontractor/${quoteId}/select`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "pending-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "subcontractors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "financials"] });
      toast({ title: "Success", description: "Subcontractor contract created from quote" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to select quote", variant: "destructive" });
    },
  });

  const selectMatQuoteMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      return await apiRequest("POST", `/api/projects/${projectCode}/pending-quotes/material/${quoteId}/select`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "pending-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "procurement"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "financials"] });
      toast({ title: "Success", description: "Procurement item created from quote" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to select quote", variant: "destructive" });
    },
  });

  // Handlers for procurement
  const handleCreateProcurement = async () => {
    if (!procurementDescription) {
      toast({ title: "Error", description: "Description is required", variant: "destructive" });
      return;
    }
    if (!project) return;

    try {
      await createProcurementMutation.mutateAsync({
        projectId: project.id,
        projectCode,
        description: procurementDescription,
        vendor: procurementVendor || undefined,
        quantity: procurementQuantity || undefined,
        unit: procurementUnit || undefined,
        unitCost: procurementUnitCost || undefined,
        status: procurementStatus,
        poNumber: procurementPoNumber || undefined,
      });
      toast({ title: "Success", description: "Procurement item created" });
      setShowProcurementDialog(false);
      setProcurementDescription("");
      setProcurementVendor("");
      setProcurementQuantity("");
      setProcurementUnit("");
      setProcurementUnitCost("");
      setProcurementStatus("PLANNED");
      setProcurementPoNumber("");
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "financials"] });
    } catch (error) {
      toast({ title: "Error", description: "Failed to create procurement item", variant: "destructive" });
    }
  };

  // Handlers for subcontractor payments
  const handleCreatePayment = async () => {
    if (!selectedContractId || !paymentAmount) {
      toast({ title: "Error", description: "Amount is required", variant: "destructive" });
      return;
    }

    try {
      await createPaymentMutation.mutateAsync({
        contractId: selectedContractId,
        projectCode,
        amount: paymentAmount,
        description: paymentDescription || undefined,
        invoiceNumber: paymentInvoiceNumber || undefined,
        paymentDate: paymentDate ? new Date(paymentDate).toISOString() : undefined,
      });
      toast({ title: "Success", description: "Payment recorded" });
      setShowPaymentDialog(false);
      setSelectedContractId(null);
      setPaymentAmount("");
      setPaymentDescription("");
      setPaymentInvoiceNumber("");
      setPaymentDate(format(new Date(), "yyyy-MM-dd"));
    } catch (error) {
      toast({ title: "Error", description: "Failed to record payment", variant: "destructive" });
    }
  };

  // Handlers for labor rates
  const handleOpenLaborRatesDialog = () => {
    if (laborRatesConfig) {
      setLaborRegularRate(laborRatesConfig.defaultRegularRate);
      setLaborOvertimeRate(laborRatesConfig.defaultOvertimeRate);
      setLaborBurdenMultiplier(laborRatesConfig.burdenMultiplier);
      setLaborRatesNotes(laborRatesConfig.notes || "");
    } else {
      setLaborRegularRate("50");
      setLaborOvertimeRate("75");
      setLaborBurdenMultiplier("1.0");
      setLaborRatesNotes("");
    }
    setShowLaborRatesDialog(true);
  };

  const handleSaveLaborRates = async () => {
    if (!laborRegularRate || !laborOvertimeRate || !laborBurdenMultiplier) {
      toast({ title: "Error", description: "All rate fields are required", variant: "destructive" });
      return;
    }

    try {
      await updateLaborRatesMutation.mutateAsync({
        projectCode,
        data: {
          defaultRegularRate: laborRegularRate,
          defaultOvertimeRate: laborOvertimeRate,
          burdenMultiplier: laborBurdenMultiplier,
          notes: laborRatesNotes || undefined,
        },
      });
      toast({ title: "Success", description: "Labor rates saved" });
      setShowLaborRatesDialog(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to save labor rates", variant: "destructive" });
    }
  };

  const handleSaveEmployeeRate = async () => {
    if (!selectedEmployeeId || !employeeRegularRate || !employeeOvertimeRate) {
      toast({ title: "Error", description: "Employee and rates are required", variant: "destructive" });
      return;
    }

    try {
      await updateEmployeeRateMutation.mutateAsync({
        projectCode,
        data: {
          userId: selectedEmployeeId,
          regularRate: employeeRegularRate,
          overtimeRate: employeeOvertimeRate,
          notes: employeeRateNotes || undefined,
        },
      });
      toast({ title: "Success", description: "Employee rate saved" });
      setShowEmployeeRateDialog(false);
      setSelectedEmployeeId("");
      setEmployeeRegularRate("");
      setEmployeeOvertimeRate("");
      setEmployeeRateNotes("");
    } catch (error) {
      toast({ title: "Error", description: "Failed to save employee rate", variant: "destructive" });
    }
  };

  const handleDeleteEmployeeRate = async (rateId: string) => {
    try {
      await deleteEmployeeRateMutation.mutateAsync({ projectCode, rateId });
      toast({ title: "Success", description: "Employee rate removed" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to remove employee rate", variant: "destructive" });
    }
  };

  // Upload handlers
  const handleMediaUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingMedia(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", `/api/projects/${projectCode}/media`, {
        type: mediaType,
        caption: mediaCaption,
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "media"] });
      toast({ title: "Success", description: "Media uploaded successfully" });
      setShowMediaDialog(false);
      setMediaCaption("");
      setMediaType("IMAGE");
    } catch (error) {
      toast({ title: "Error", description: "Failed to save media", variant: "destructive" });
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleDocumentUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingDocument(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", "/api/documents", {
        projectId: project?.id,
        title: documentTitle,
        type: documentType,
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "documents"] });
      toast({ title: "Success", description: "Document uploaded successfully" });
      setShowDocumentDialog(false);
      setDocumentTitle("");
      setDocumentType("OTHER");
    } catch (error) {
      toast({ title: "Error", description: "Failed to save document", variant: "destructive" });
    } finally {
      setIsUploadingDocument(false);
    }
  };

  const handleBudgetUpdate = async () => {
    if (!editBudget || !editContractAmount) {
      toast({ title: "Error", description: "Budget and contract amount are required", variant: "destructive" });
      return;
    }

    try {
      const payload: any = {
        budget: editBudget,
        contractAmount: editContractAmount,
      };
      
      if (editTexturaDrawDate) {
        payload.texturaDrawDate = editTexturaDrawDate;
      }

      if (editDrawDayOfMonth !== "") {
        payload.drawDayOfMonth = editDrawDayOfMonth;
      }

      await apiRequest("PATCH", `/api/projects/${projectCode}/financials`, payload);
      
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode] });
      toast({ title: "Success", description: "Financial data updated" });
      setShowBudgetEditDialog(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to update financial data", variant: "destructive" });
    }
  };

  const handleReceiptUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingReceipt(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", "/api/receipts", {
        projectId: project?.id,
        vendor: receiptVendor,
        amount: receiptAmount,
        category: receiptCategory,
        date: new Date(receiptDate).toISOString(),
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "receipts"] });
      toast({ title: "Success", description: "Receipt uploaded successfully" });
      setShowReceiptDialog(false);
      setReceiptVendor("");
      setReceiptAmount("");
      setReceiptCategory("");
      setReceiptDate(format(new Date(), "yyyy-MM-dd"));
    } catch (error) {
      toast({ title: "Error", description: "Failed to save receipt", variant: "destructive" });
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  const getUploadParameters = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return {
        method: "PUT" as const,
        url: data.uploadURL,
      };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

  if (projectLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={user?.firstName || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">Loading project...</div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={user?.firstName || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="flex flex-col items-center justify-center h-96">
          <p className="text-muted-foreground mb-4">Project not found</p>
          <Button onClick={() => setLocation(backPath)} data-testid="button-back-to-projects">
            {backLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={user?.firstName || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Button variant="ghost" onClick={() => setLocation(backPath)} data-testid="button-back">
              ← {backLabel}
            </Button>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="font-mono">
                  {project.code}
                </Badge>
                <StatusBadge status={project.status} type="project" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
            </div>
          </div>
        </div>

        {FeaturePermissions.VIEW_PROJECT_BUDGET(user?.role) && (!project.budget || Number(project.budget) === 0) && (!project.contractAmount || Number(project.contractAmount) === 0) && (
          <Alert variant="destructive" className="mb-6" data-testid="alert-missing-budget">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Missing Financial Data</AlertTitle>
            <AlertDescription>
              This project is missing budget and contract information. Please update the financial data to enable accurate profitability tracking and AI analysis.
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="scope" data-testid="tab-scope">Scope & Progress</TabsTrigger>
            <TabsTrigger value="change-orders" data-testid="tab-change-orders">
              Change Orders
              {changeOrders.filter(co => co.status === "SUBMITTED").length > 0 && (
                <Badge className="ml-2" variant="secondary">
                  {changeOrders.filter(co => co.status === "SUBMITTED").length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="delays" data-testid="tab-delays">
              <CloudRain className="h-4 w-4 mr-1" />
              Delays
            </TabsTrigger>
            <TabsTrigger value="daily-notes" data-testid="tab-daily-notes">Daily Notes</TabsTrigger>
            <TabsTrigger value="media" data-testid="tab-media">Photos & Videos</TabsTrigger>
            {FeaturePermissions.VIEW_ESTIMATES_TAB(user?.role) && (
              <TabsTrigger value="estimate" data-testid="tab-estimate">Estimate</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_PROCUREMENT_TAB(user?.role) && (
              <TabsTrigger value="procurement" data-testid="tab-procurement">Procurement</TabsTrigger>
            )}
            <TabsTrigger value="plans" data-testid="tab-plans">Plans & Takeoff</TabsTrigger>
            {FeaturePermissions.VIEW_TIME_ENTRIES_TAB(user?.role) && (
              <TabsTrigger value="time" data-testid="tab-time">Time & T&M</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_TIME_ENTRIES_TAB(user?.role) && (
              <TabsTrigger value="labor-hours" data-testid="tab-labor-hours">Labor Hours</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_RECEIPTS_TAB(user?.role) && (
              <TabsTrigger value="receipts" data-testid="tab-receipts">Receipts</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_SUBCONTRACTORS_TAB(user?.role) && (
              <TabsTrigger value="subcontractors" data-testid="tab-subcontractors">Subcontractors</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_PROJECT_BUDGET(user?.role) && (
              <TabsTrigger value="labor-rates" data-testid="tab-labor-rates">Labor Rates</TabsTrigger>
            )}
            <TabsTrigger value="job-info" data-testid="tab-job-info">Job Info</TabsTrigger>
            {FeaturePermissions.VIEW_EQUIPMENT(user?.role) && (
              <TabsTrigger value="equipment" data-testid="tab-equipment">
                <Truck className="h-4 w-4 mr-1" />
                Equipment
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Project Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Client</p>
                      <p className="text-sm text-muted-foreground">{project.clientName || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <User className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Contact</p>
                      <p className="text-sm text-muted-foreground">{project.clientContactName || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Email</p>
                      <p className="text-sm text-muted-foreground">{project.clientContactEmail || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Phone</p>
                      <p className="text-sm text-muted-foreground">{project.clientContactPhone || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Location</p>
                      <p className="text-sm text-muted-foreground">
                        {[project.locationAddress, project.city, project.state].filter(Boolean).join(", ") || "N/A"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Project Team & Timeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-1">Start Date</p>
                    <p className="text-sm text-muted-foreground">
                      {project.startDate ? format(new Date(project.startDate), "MMM d, yyyy") : "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-1">Target End Date</p>
                    <p className="text-sm text-muted-foreground">
                      {project.endDate ? format(new Date(project.endDate), "MMM d, yyyy") : "Not set"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Financial Information - Hidden from hourly employees */}
            {FeaturePermissions.VIEW_PROJECT_FINANCIALS(user?.role) && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <CardTitle>Financial Information</CardTitle>
                  {(user?.role === "ADMIN" || user?.role === "OFFICE_MANAGER") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditBudget(project.budget || "0");
                        setEditContractAmount(project.contractAmount || "0");
                        setEditTexturaDrawDate(project.texturaDrawDate || "");
                        setEditDrawDayOfMonth(project.drawDayOfMonth || "");
                        setShowBudgetEditDialog(true);
                      }}
                      data-testid="button-edit-financials"
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Edit
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {financialsLoading ? (
                    <div className="text-center py-4 text-muted-foreground">Loading financial data...</div>
                  ) : financials ? (
                    <div className="space-y-6">
                      {/* Primary Financial Metrics */}
                      <div className="grid grid-cols-2 gap-4">
                        {/* Budget - Cost to do the job */}
                        <div className="p-4 rounded-lg border bg-card">
                          <div className="flex items-center gap-2 mb-2">
                            <DollarSign className="w-4 h-4 text-muted-foreground" />
                            <p className="text-sm font-medium text-muted-foreground">Budget</p>
                          </div>
                          <p className="text-2xl font-bold font-mono" data-testid="text-budget">
                            ${financials.budget.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">Direct cost to complete the work</p>
                        </div>
                        
                        {/* Contract Amount - What client pays */}
                        <div className="p-4 rounded-lg border bg-card">
                          <div className="flex items-center gap-2 mb-2">
                            <DollarSign className="w-4 h-4 text-muted-foreground" />
                            <p className="text-sm font-medium text-muted-foreground">Contract Amount</p>
                          </div>
                          <p className="text-2xl font-bold font-mono" data-testid="text-contract-amount">
                            ${financials.originalContract.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">Budget + overhead + profit</p>
                        </div>
                      </div>

                      {/* COs & T&M + Adjusted Contract Row */}
                      <div className="grid grid-cols-2 gap-4">
                        {/* Change Orders & T&M Total */}
                        <div className="p-4 rounded-lg border bg-amber-50 dark:bg-amber-950/30">
                          <div className="flex items-center gap-2 mb-2">
                            <DollarSign className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">COs & T&M</p>
                          </div>
                          <p className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400" data-testid="text-contract-additions">
                            {(financials.contractAdditions || 0) >= 0 ? '+' : ''}${(financials.contractAdditions || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                            <div className="flex justify-between">
                              <span>Change Orders ({financials.approvedChangeOrdersCount}):</span>
                              <span className="font-mono">${financials.approvedChangeOrdersTotal.toLocaleString()}</span>
                            </div>
                            {financials.tmTickets?.approvedTotal > 0 && (
                              <div className="flex justify-between">
                                <span>T&M Tickets ({financials.tmTickets?.approved || 0}):</span>
                                <span className="font-mono">${(financials.tmTickets?.approvedTotal || 0).toLocaleString()}</span>
                              </div>
                            )}
                            {financials.tmTickets?.pending > 0 && (
                              <div className="flex justify-between text-amber-600">
                                <span>Pending T&M ({financials.tmTickets?.pending}):</span>
                                <span className="font-mono">${(financials.tmTickets?.pendingTotal || 0).toLocaleString()}</span>
                              </div>
                            )}
                            {financials.tmCharges?.total > 0 && (
                              <div className="flex justify-between">
                                <span>Legacy T&M ({financials.tmCharges?.sheetsCount || 0}):</span>
                                <span className="font-mono">${(financials.tmCharges?.total || 0).toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Adjusted Contract */}
                        <div className="p-4 rounded-lg border bg-primary/5">
                          <div className="flex items-center gap-2 mb-2">
                            <DollarSign className="w-4 h-4 text-primary" />
                            <p className="text-sm font-medium text-primary">Adjusted Contract</p>
                          </div>
                          <p className="text-2xl font-bold font-mono text-primary" data-testid="text-adjusted-contract-amount">
                            ${financials.adjustedContract.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Original contract + COs + T&M
                          </p>
                        </div>
                      </div>

                      {/* Profit Section */}
                      <div className="grid grid-cols-2 gap-4">
                        {/* Projected Profit */}
                        <div className="p-4 rounded-lg border bg-green-50 dark:bg-green-950/30">
                          <div className="flex items-center gap-2 mb-2">
                            <DollarSign className="w-4 h-4 text-green-600 dark:text-green-400" />
                            <p className="text-sm font-medium text-green-600 dark:text-green-400">Projected Profit</p>
                          </div>
                          <p className="text-2xl font-bold font-mono text-green-600 dark:text-green-400" data-testid="text-projected-profit">
                            ${financials.projectedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">Expected profit (contract - budget)</p>
                        </div>
                        
                        {/* Actual Profit */}
                        <div className={`p-4 rounded-lg border ${financials.actualProfit >= 0 ? 'bg-green-50 dark:bg-green-950/30' : 'bg-red-50 dark:bg-red-950/30'}`}>
                          <div className="flex items-center gap-2 mb-2">
                            <DollarSign className={`w-4 h-4 ${financials.actualProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} />
                            <p className={`text-sm font-medium ${financials.actualProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>Actual Profit</p>
                          </div>
                          <p className={`text-2xl font-bold font-mono ${financials.actualProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} data-testid="text-actual-profit">
                            ${financials.actualProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">Real-time (adjusted contract - actual costs)</p>
                        </div>
                      </div>

                      {/* Actual Costs Breakdown */}
                      <div className="p-4 rounded-lg border bg-muted/30">
                        <p className="text-sm font-medium mb-3">Actual Costs Incurred</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <p className="text-muted-foreground">Labor</p>
                            <p className="font-mono font-medium">${financials.actualCosts.labor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            <p className="text-xs text-muted-foreground">{financials.actualCosts.laborHours.toFixed(1)} hrs</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Materials</p>
                            <p className="font-mono font-medium">${financials.actualCosts.materials.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Subcontractors</p>
                            <p className="font-mono font-medium">${financials.actualCosts.subcontractors.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Other Expenses</p>
                            <p className="font-mono font-medium">${financials.actualCosts.otherExpenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t flex justify-between items-center">
                          <p className="font-medium">Total Actual Costs</p>
                          <p className="font-mono font-bold text-lg">${financials.actualCosts.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                      </div>

                      {/* Profit Variance */}
                      {financials.profitVariance !== 0 && (
                        <div className={`p-3 rounded-lg ${financials.profitVariance >= 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'}`}>
                          <p className="text-sm font-medium">
                            Profit Variance: {financials.profitVariance >= 0 ? '+' : ''}${financials.profitVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
                            ({financials.profitVariancePercent >= 0 ? '+' : ''}{financials.profitVariancePercent.toFixed(1)}%)
                          </p>
                          <p className="text-xs mt-1">
                            {financials.profitVariance >= 0 
                              ? "Currently tracking above projected profit" 
                              : "Currently tracking below projected profit"
                            }
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Fallback to basic display if financials API fails */
                    <div className="space-y-4">
                      <div className="flex items-start gap-3">
                        <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Project Budget</p>
                          <p className="text-2xl font-bold font-mono">
                            ${parseFloat(project.budget || "0").toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Contract Amount</p>
                          <p className="text-2xl font-bold font-mono">
                            ${parseFloat(project.contractAmount || "0").toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{project.description || "No description provided"}</p>
              </CardContent>
            </Card>

            {/* Data Quality Score Card */}
            <Card data-testid="card-data-quality">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-4">
                <span>Data Quality Score</span>
                {dataQuality && (
                  <Badge 
                    className={
                      dataQuality.overall_score >= 80 
                        ? "bg-green-500 hover:bg-green-600" 
                        : dataQuality.overall_score >= 60 
                        ? "bg-yellow-500 hover:bg-yellow-600" 
                        : "bg-red-500 hover:bg-red-600"
                    }
                    data-testid="badge-overall-score"
                  >
                    {dataQuality.overall_score}/100
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Track data completeness to improve AI insights and project management
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dataQualityLoading ? (
                <div className="text-center py-4 text-muted-foreground">Loading data quality score...</div>
              ) : !dataQuality ? (
                <div className="text-center py-4 text-muted-foreground">Unable to load data quality score</div>
              ) : (
                <div className="space-y-3">
                  {/* Progress bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Overall Quality</span>
                      <span className="font-medium">{dataQuality.overall_score}%</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          dataQuality.overall_score >= 80
                            ? "bg-green-500"
                            : dataQuality.overall_score >= 60
                            ? "bg-yellow-500"
                            : "bg-red-500"
                        }`}
                        style={{ width: `${dataQuality.overall_score}%` }}
                      />
                    </div>
                  </div>

                  {/* Quality dimensions */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      {dataQuality.has_scope ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Scope
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Scope
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_estimates ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Estimates
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Estimates
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_budget ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Budget
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Budget
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_timeline ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Timeline
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Timeline
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_daily_updates ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Daily Updates
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Daily Updates
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_cost_tracking ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Cost Tracking
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Cost Tracking
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_media ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Media
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Media
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_documentation ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Documentation
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Documentation
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_change_orders_managed ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Change Orders
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Change Orders
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_billing_setup ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Billing Setup
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Billing Setup
                        </Badge>
                      )}
                    </div>
                  </div>

                  {dataQuality.overall_score < 80 && (
                    <div className="mt-4 p-3 bg-muted rounded-md">
                      <p className="text-sm font-medium mb-1">Improve Data Quality</p>
                      <p className="text-xs text-muted-foreground">
                        Complete missing sections to enhance AI insights and project tracking accuracy.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
            </Card>

            {/* Change Orders Summary */}
            <Card data-testid="card-change-orders-summary">
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Change Orders</CardTitle>
                  <CardDescription>Track status and value of project change orders</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveTab("change-orders")}
                  data-testid="button-view-all-change-orders"
                >
                  View All
                </Button>
              </CardHeader>
              <CardContent>
                {changeOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No change orders yet</p>
                ) : (
                  <div className="space-y-3">
                    {changeOrders.slice(0, 5).map((co) => (
                      <div 
                        key={co.id} 
                        className="flex items-center justify-between gap-4 p-3 rounded-md border hover-elevate active-elevate-2 cursor-pointer"
                        onClick={() => setActiveTab("change-orders")}
                        data-testid={`change-order-summary-${co.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="font-mono text-xs">
                              {co.changeOrderNumber}
                            </Badge>
                            <Badge
                              variant={
                                co.status === "APPROVED" ? "default" :
                                co.status === "REJECTED" ? "destructive" :
                                co.status === "PENDING_APPROVAL" ? "destructive" :
                                co.status === "SUBMITTED" ? "secondary" :
                                "outline"
                              }
                              className="text-xs"
                            >
                              {co.status?.replace("_", " ")}
                            </Badge>
                          </div>
                          <p className="text-sm font-medium truncate">{co.description}</p>
                          <p className="text-xs text-muted-foreground">
                            Created {format(new Date(co.createdAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        {hasManagementAccess(user?.role) && (
                          <div className="text-right">
                            <p className="text-lg font-bold font-mono">
                              ${parseFloat(co.amount).toLocaleString()}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                    {changeOrders.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center pt-2">
                        + {changeOrders.length - 5} more change order{changeOrders.length - 5 !== 1 ? 's' : ''}
                      </p>
                    )}
                    {hasManagementAccess(user?.role) && (
                      <div className="pt-3 border-t mt-3 grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Total Value</p>
                          <p className="text-xl font-bold font-mono">
                            ${changeOrders.reduce((sum, co) => sum + parseFloat(co.amount), 0).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Approved Value</p>
                          <p className="text-xl font-bold font-mono text-green-600">
                            ${changeOrders
                              .filter(co => co.status === "APPROVED")
                              .reduce((sum, co) => sum + parseFloat(co.amount), 0)
                              .toLocaleString()}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scope">
            <Card>
              <CardHeader>
                <CardTitle>Scope of Work & Progress Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <ScopeProgressTracker scopeItems={scopeItems} isLoading={scopeLoading} projectCode={projectCode} />
              </CardContent>
            </Card>
          </TabsContent>

          <ChangeOrdersTab 
            changeOrders={changeOrders}
            projectCode={projectCode}
            projectId={project.id}
            isLoading={changeOrdersLoading}
            userRole={user?.role || ""}
          />

          <TabsContent value="delays">
            <DelaysSection 
              projectId={project.id}
              projectCode={projectCode}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="daily-notes">
            <DailyNoteFeed projectId={project.id} availableUsers={allUsers} />
          </TabsContent>

          <TabsContent value="media">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Photos & Videos</CardTitle>
                <Dialog open={showMediaDialog} onOpenChange={setShowMediaDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-upload-media">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Media
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-upload-media">
                    <DialogHeader>
                      <DialogTitle>Upload Media</DialogTitle>
                      <DialogDescription>
                        Fill in the details below and then select a file to upload.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="media-type">Type</Label>
                        <Select
                          value={mediaType}
                          onValueChange={(value: "IMAGE" | "VIDEO") => setMediaType(value)}
                        >
                          <SelectTrigger id="media-type" data-testid="select-media-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="IMAGE">Image</SelectItem>
                            <SelectItem value="VIDEO">Video</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="media-caption">Caption (Optional)</Label>
                        <Input
                          id="media-caption"
                          value={mediaCaption}
                          onChange={(e) => setMediaCaption(e.target.value)}
                          placeholder="Enter a caption..."
                          data-testid="input-media-caption"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowMediaDialog(false);
                          setMediaCaption("");
                          setMediaType("IMAGE");
                        }}
                        data-testid="button-cancel-media"
                      >
                        Cancel
                      </Button>
                      <ObjectUploader
                        maxNumberOfFiles={1}
                        maxFileSize={104857600}
                        allowedFileTypes={mediaType === "IMAGE" ? ["image/*"] : ["video/*"]}
                        onGetUploadParameters={getUploadParameters}
                        onComplete={(result) => {
                          setIsUploadingMedia(true);
                          handleMediaUploadComplete(result);
                        }}
                        buttonVariant="default"
                        testId="button-select-media-file"
                      >
                        {isUploadingMedia ? "Uploading..." : "Select File"}
                      </ObjectUploader>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {mediaLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading media...</div>
                ) : mediaItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No media uploaded yet</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {mediaItems.map((item) => (
                      <Card key={item.id} data-testid={`media-${item.id}`}>
                        <CardContent className="p-4">
                          <Badge variant="outline" className="mb-2">{item.type}</Badge>
                          <p className="text-sm font-medium mb-1">{item.caption || "Untitled"}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(item.uploadedAt), "MMM d, yyyy")}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="estimate">
            <ProjectEstimate />
          </TabsContent>

          <TabsContent value="procurement">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Procurement Items</CardTitle>
                <Dialog open={showProcurementDialog} onOpenChange={setShowProcurementDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-new-procurement">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Item
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-create-procurement">
                    <DialogHeader>
                      <DialogTitle>Add Procurement Item</DialogTitle>
                      <DialogDescription>
                        Enter material or equipment details. Costs entered here flow to the project financials.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                      <div>
                        <Label htmlFor="procurement-description">Description *</Label>
                        <Input
                          id="procurement-description"
                          value={procurementDescription}
                          onChange={(e) => setProcurementDescription(e.target.value)}
                          placeholder="Material or equipment description..."
                          data-testid="input-procurement-description"
                        />
                      </div>
                      <div>
                        <Label htmlFor="procurement-vendor">Vendor/Supplier</Label>
                        <Input
                          id="procurement-vendor"
                          value={procurementVendor}
                          onChange={(e) => setProcurementVendor(e.target.value)}
                          placeholder="Vendor name..."
                          data-testid="input-procurement-vendor"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="procurement-quantity">Quantity</Label>
                          <Input
                            id="procurement-quantity"
                            type="number"
                            step="0.01"
                            value={procurementQuantity}
                            onChange={(e) => setProcurementQuantity(e.target.value)}
                            placeholder="0"
                            data-testid="input-procurement-quantity"
                          />
                        </div>
                        <div>
                          <Label htmlFor="procurement-unit">Unit</Label>
                          <Input
                            id="procurement-unit"
                            value={procurementUnit}
                            onChange={(e) => setProcurementUnit(e.target.value)}
                            placeholder="ea, lf, sf, cy..."
                            data-testid="input-procurement-unit"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="procurement-unit-cost">Unit Cost ($)</Label>
                        <Input
                          id="procurement-unit-cost"
                          type="number"
                          step="0.01"
                          value={procurementUnitCost}
                          onChange={(e) => setProcurementUnitCost(e.target.value)}
                          placeholder="0.00"
                          data-testid="input-procurement-unit-cost"
                        />
                        {procurementQuantity && procurementUnitCost && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Total: ${(parseFloat(procurementQuantity) * parseFloat(procurementUnitCost)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="procurement-status">Status</Label>
                        <Select
                          value={procurementStatus}
                          onValueChange={(value: "PLANNED" | "ORDERED" | "DELIVERED") => setProcurementStatus(value)}
                        >
                          <SelectTrigger id="procurement-status" data-testid="select-procurement-status">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PLANNED">Planned</SelectItem>
                            <SelectItem value="ORDERED">Ordered</SelectItem>
                            <SelectItem value="DELIVERED">Delivered</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="procurement-po">PO Number (Optional)</Label>
                        <Input
                          id="procurement-po"
                          value={procurementPoNumber}
                          onChange={(e) => setProcurementPoNumber(e.target.value)}
                          placeholder="PO-001..."
                          data-testid="input-procurement-po"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowProcurementDialog(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={handleCreateProcurement}
                        disabled={createProcurementMutation.isPending}
                        data-testid="button-submit-procurement"
                      >
                        {createProcurementMutation.isPending ? "Adding..." : "Add Item"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {procurementLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading procurement...</div>
                ) : procurementItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No procurement items yet</div>
                ) : (
                  <div className="space-y-3">
                    {procurementItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`procurement-${item.id}`}>
                        <div className="flex-1">
                          <p className="font-medium mb-1">{item.description}</p>
                          <p className="text-sm text-muted-foreground">{item.vendor || "No vendor"}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-mono text-sm">
                              {item.quantity} {item.unit}
                            </p>
                            {item.unitCost && item.quantity && (
                              <p className="text-xs text-muted-foreground">
                                ${(parseFloat(item.quantity) * parseFloat(item.unitCost)).toLocaleString()} total
                              </p>
                            )}
                          </div>
                          <Badge
                            variant={
                              item.status === "DELIVERED" ? "default" :
                              item.status === "ORDERED" ? "secondary" :
                              "outline"
                            }
                          >
                            {item.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plans" className="space-y-0">
            <div className="border-b mb-4">
              <div className="flex gap-2">
                <Button
                  variant={plansSubTab === "documents" ? "default" : "ghost"}
                  onClick={() => setPlansSubTab("documents")}
                  data-testid="tab-documents"
                  className="rounded-b-none"
                >
                  Documents
                </Button>
                <Button
                  variant={plansSubTab === "takeoff" ? "default" : "ghost"}
                  onClick={() => setPlansSubTab("takeoff")}
                  data-testid="tab-takeoff-workspace"
                  className="rounded-b-none"
                >
                  Takeoff Workspace
                </Button>
              </div>
            </div>
            
            {plansSubTab === "documents" && (
              <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-4">
                    <CardTitle>Documents</CardTitle>
                    <Dialog open={showDocumentDialog} onOpenChange={setShowDocumentDialog}>
                      <DialogTrigger asChild>
                        <Button size="sm" data-testid="button-upload-document">
                          <Upload className="w-4 h-4 mr-2" />
                          Upload Document
                        </Button>
                      </DialogTrigger>
                      <DialogContent data-testid="dialog-upload-document">
                        <DialogHeader>
                          <DialogTitle>Upload Document</DialogTitle>
                          <DialogDescription>
                            Fill in the details below and then select a file to upload.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="document-title">Title</Label>
                            <Input
                              id="document-title"
                              value={documentTitle}
                              onChange={(e) => setDocumentTitle(e.target.value)}
                              placeholder="Enter document title..."
                              data-testid="input-document-title"
                            />
                          </div>
                          <div>
                            <Label htmlFor="document-type">Type</Label>
                            <Select
                              value={documentType}
                              onValueChange={(value: "PLANS" | "SPECS" | "TAKEOFF" | "OTHER") => setDocumentType(value)}
                            >
                              <SelectTrigger id="document-type" data-testid="select-document-type">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="PLANS">Plans</SelectItem>
                                <SelectItem value="SPECS">Specifications</SelectItem>
                                <SelectItem value="TAKEOFF">Takeoff</SelectItem>
                                <SelectItem value="OTHER">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowDocumentDialog(false);
                              setDocumentTitle("");
                              setDocumentType("OTHER");
                            }}
                            data-testid="button-cancel-document"
                          >
                            Cancel
                          </Button>
                          <ObjectUploader
                            maxNumberOfFiles={1}
                            maxFileSize={104857600}
                            onGetUploadParameters={getUploadParameters}
                            onComplete={(result) => {
                              setIsUploadingDocument(true);
                              handleDocumentUploadComplete(result);
                            }}
                            buttonVariant="default"
                            testId="button-select-document-file"
                          >
                            {isUploadingDocument ? "Uploading..." : "Select File"}
                          </ObjectUploader>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  <CardContent>
                    {documentsLoading ? (
                      <div className="text-center py-8 text-muted-foreground">Loading documents...</div>
                    ) : documents.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">No documents uploaded yet</div>
                    ) : (
                      <div className="space-y-2">
                        {documents.map(doc => (
                          <div key={doc.id} className="flex items-center justify-between p-3 border rounded-md hover-elevate gap-4" data-testid={`document-${doc.id}`}>
                            <div className="flex-1">
                              <p className="font-medium text-sm">{doc.title || doc.fileName}</p>
                              <p className="text-xs text-muted-foreground">
                                Uploaded {format(new Date(doc.uploadedAt), "MMM d, yyyy")}
                              </p>
                            </div>
                            <Badge variant="outline">{doc.type}</Badge>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.open(doc.fileUrl, '_blank')}
                                data-testid={`button-view-document-${doc.id}`}
                              >
                                <Eye className="w-4 h-4 mr-1" />
                                View
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const link = document.createElement('a');
                                  link.href = doc.fileUrl;
                                  link.download = doc.fileName;
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                }}
                                data-testid={`button-download-document-${doc.id}`}
                              >
                                <Download className="w-4 h-4 mr-1" />
                                Download
                              </Button>
                              {doc.mimeType === 'application/pdf' && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={async () => {
                                    try {
                                      await apiRequest("POST", `/api/projects/${project!.id}/takeoff/import-plan`, { documentId: doc.id });
                                      toast({ title: "Success", description: "Plan imported to takeoff workspace" });
                                      await queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.id, "takeoff", "sheets"] });
                                      await queryClient.refetchQueries({ queryKey: ["/api/projects", project!.id, "takeoff", "sheets"] });
                                    } catch (error: any) {
                                      const errorMessage = error?.message || error?.error || "Failed to import plan";
                                      toast({ title: "Error", description: errorMessage, variant: "destructive" });
                                    }
                                  }}
                                  data-testid={`button-import-takeoff-${doc.id}`}
                                >
                                  <FileText className="w-4 h-4 mr-1" />
                                  Import to Takeoff
                                </Button>
                              )}
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    data-testid={`button-delete-document-${doc.id}`}
                                  >
                                    <Trash2 className="w-4 h-4 mr-1" />
                                    Delete
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent data-testid={`dialog-delete-confirm-${doc.id}`}>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Document</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete "{doc.title || doc.fileName}"? This action cannot be undone and will also remove any takeoff sheets associated with this document.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel data-testid={`button-cancel-delete-${doc.id}`}>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={async () => {
                                        try {
                                          await apiRequest("DELETE", `/api/documents/${doc.id}`);
                                          toast({ title: "Success", description: "Document deleted successfully" });
                                          await queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.code, "documents"] });
                                          await queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.id, "takeoff", "sheets"] });
                                        } catch (error: any) {
                                          const errorMessage = error?.message || error?.error || "Failed to delete document";
                                          toast({ title: "Error", description: errorMessage, variant: "destructive" });
                                        }
                                      }}
                                      data-testid={`button-confirm-delete-${doc.id}`}
                                      className="bg-destructive hover:bg-destructive/90"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
            )}
            
            {plansSubTab === "takeoff" && project && (
              <div className="h-[calc(100vh-200px)]">
                <TakeoffWorkspace projectId={project.id} projectCode={project.code} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="time">
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <CardTitle>Time & Material Tracking</CardTitle>
                </CardHeader>
                <CardContent>
                  {project && user && (
                    <TMTicketsSection
                      projectId={project.id}
                      projectCode={project.code}
                      userRole={user.role}
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Time Entries</CardTitle>
                </CardHeader>
                <CardContent>
                  {timeEntriesLoading ? (
                    <div className="text-center py-4 text-muted-foreground">Loading time entries...</div>
                  ) : timeEntries.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">No time entries yet</div>
                  ) : (
                    <div className="space-y-2">
                      {timeEntries.map((entry) => {
                        const totalHours = parseFloat(entry.hoursRegular) + parseFloat(entry.hoursOvertime || "0");
                        return (
                          <div key={entry.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`time-entry-${entry.id}`}>
                            <div>
                              <p className="text-sm font-medium">{format(new Date(entry.date), "MMM d, yyyy")}</p>
                              {entry.notes && (
                                <p className="text-xs text-muted-foreground">{entry.notes}</p>
                              )}
                              {entry.costCode && (
                                <p className="text-xs text-muted-foreground">Cost Code: {entry.costCode}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="font-mono text-sm">{totalHours} hours</p>
                              <Badge variant={entry.approvedAt ? "default" : "secondary"}>
                                {entry.approvedAt ? "Approved" : "Pending"}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>T&M Daily Sheets (Legacy)</CardTitle>
                </CardHeader>
                <CardContent>
                  {tmSheetsLoading ? (
                    <div className="text-center py-4 text-muted-foreground">Loading T&M sheets...</div>
                  ) : tmSheets.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">No T&M sheets yet</div>
                  ) : (
                    <div className="space-y-2">
                      {tmSheets.map((sheet) => (
                        <div key={sheet.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`tm-sheet-${sheet.id}`}>
                          <div>
                            <p className="text-sm font-medium">{format(new Date(sheet.date), "MMM d, yyyy")}</p>
                            <p className="text-xs text-muted-foreground">TFR Rep: {sheet.tfrRepName}</p>
                            {sheet.clientRepName && (
                              <p className="text-xs text-muted-foreground">Client Rep: {sheet.clientRepName}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="labor-hours">
            {project && <ProjectLaborHours projectId={project.id} projectCode={project.code} />}
          </TabsContent>

          <TabsContent value="receipts">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Receipts</CardTitle>
                <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-upload-receipt">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Receipt
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-upload-receipt">
                    <DialogHeader>
                      <DialogTitle>Upload Receipt</DialogTitle>
                      <DialogDescription>
                        Fill in the details below and then select a file to upload.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="receipt-vendor">Vendor</Label>
                        <Input
                          id="receipt-vendor"
                          value={receiptVendor}
                          onChange={(e) => setReceiptVendor(e.target.value)}
                          placeholder="Enter vendor name..."
                          data-testid="input-receipt-vendor"
                        />
                      </div>
                      <div>
                        <Label htmlFor="receipt-amount">Amount ($)</Label>
                        <Input
                          id="receipt-amount"
                          type="number"
                          step="0.01"
                          value={receiptAmount}
                          onChange={(e) => setReceiptAmount(e.target.value)}
                          placeholder="0.00"
                          data-testid="input-receipt-amount"
                        />
                      </div>
                      <div>
                        <Label htmlFor="receipt-category">Category</Label>
                        <Input
                          id="receipt-category"
                          value={receiptCategory}
                          onChange={(e) => setReceiptCategory(e.target.value)}
                          placeholder="Enter category..."
                          data-testid="input-receipt-category"
                        />
                      </div>
                      <div>
                        <Label htmlFor="receipt-date">Date</Label>
                        <Input
                          id="receipt-date"
                          type="date"
                          value={receiptDate}
                          onChange={(e) => setReceiptDate(e.target.value)}
                          data-testid="input-receipt-date"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowReceiptDialog(false);
                          setReceiptVendor("");
                          setReceiptAmount("");
                          setReceiptCategory("");
                          setReceiptDate(format(new Date(), "yyyy-MM-dd"));
                        }}
                        data-testid="button-cancel-receipt"
                      >
                        Cancel
                      </Button>
                      <ObjectUploader
                        maxNumberOfFiles={1}
                        maxFileSize={104857600}
                        allowedFileTypes={["image/*", "application/pdf"]}
                        onGetUploadParameters={getUploadParameters}
                        onComplete={(result) => {
                          setIsUploadingReceipt(true);
                          handleReceiptUploadComplete(result);
                        }}
                        buttonVariant="default"
                        testId="button-select-receipt-file"
                      >
                        {isUploadingReceipt ? "Uploading..." : "Select File"}
                      </ObjectUploader>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {receiptsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading receipts...</div>
                ) : receipts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No receipts uploaded yet</div>
                ) : (
                  <div className="space-y-3">
                    {receipts.map((receipt) => (
                      <div key={receipt.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`receipt-${receipt.id}`}>
                        <div className="flex-1">
                          <p className="font-medium mb-1">{receipt.vendor || "Unknown vendor"}</p>
                          <p className="text-sm text-muted-foreground">{receipt.category}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(receipt.date), "MMM d, yyyy")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold font-mono">
                            ${parseFloat(receipt.amount).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subcontractors">
            <Card>
              <CardHeader>
                <CardTitle>Subcontractors & Contracts</CardTitle>
              </CardHeader>
              <CardContent>
                {subcontractorsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading subcontractors...</div>
                ) : subcontractors.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No subcontractor contracts yet</div>
                ) : (
                  <div className="space-y-4">
                    {subcontractors.map((contract) => (
                      <Card key={contract.id} data-testid={`subcontractor-${contract.id}`}>
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <CardTitle className="text-base">
                                  {contract.subcontractor?.companyName || "Unknown Subcontractor"}
                                </CardTitle>
                                <Badge variant={
                                  contract.status === "ACTIVE" ? "default" :
                                  contract.status === "COMPLETED" ? "outline" :
                                  "secondary"
                                }>
                                  {contract.status}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mb-1">
                                Contract #{contract.contractNumber}
                              </p>
                              {contract.subcontractor?.contactName && (
                                <p className="text-xs text-muted-foreground">
                                  Contact: {contract.subcontractor.contactName}
                                  {contract.subcontractor.phone && ` • ${contract.subcontractor.phone}`}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-xl font-bold font-mono">
                                ${parseFloat(contract.contractAmount).toLocaleString()}
                              </p>
                              {contract.retentionPercent && (
                                <p className="text-xs text-muted-foreground">
                                  {contract.retentionPercent}% retention
                                </p>
                              )}
                              {payablesByContract.has(contract.id) && (
                                <div className="mt-2 text-sm">
                                  <p className="text-green-600 dark:text-green-500">
                                    Paid: ${payablesByContract.get(contract.id)!.totalPaid.toLocaleString()}
                                  </p>
                                  <p className={`${payablesByContract.get(contract.id)!.remainingBalance > 0 ? 'text-yellow-600 dark:text-yellow-500' : 'text-muted-foreground'}`}>
                                    Balance: ${payablesByContract.get(contract.id)!.remainingBalance.toLocaleString()}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div>
                            <p className="text-sm font-medium mb-1">Scope of Work</p>
                            <p className="text-sm text-muted-foreground">{contract.scopeOfWork}</p>
                          </div>
                          
                          {(contract.startDate || contract.completionDate) && (
                            <div className="flex items-center gap-4 text-sm">
                              {contract.startDate && (
                                <div>
                                  <span className="text-muted-foreground">Start: </span>
                                  <span className="font-medium">
                                    {format(new Date(contract.startDate), "MMM d, yyyy")}
                                  </span>
                                </div>
                              )}
                              {contract.completionDate && (
                                <div>
                                  <span className="text-muted-foreground">Completion: </span>
                                  <span className="font-medium">
                                    {format(new Date(contract.completionDate), "MMM d, yyyy")}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {contract.paymentTerms && (
                            <div>
                              <p className="text-sm font-medium mb-1">Payment Terms</p>
                              <p className="text-sm text-muted-foreground">{contract.paymentTerms}</p>
                            </div>
                          )}

                          {contract.notes && (
                            <div>
                              <p className="text-sm font-medium mb-1">Notes</p>
                              <p className="text-sm text-muted-foreground">{contract.notes}</p>
                            </div>
                          )}
                          
                          <div className="pt-2 border-t">
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedContractId(contract.id);
                                setShowPaymentDialog(true);
                              }}
                              data-testid={`button-record-payment-${contract.id}`}
                            >
                              <DollarSign className="w-4 h-4 mr-2" />
                              Record Payment
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pending Quotes Section - shows quotes transferred from bid but not yet selected */}
            {pendingQuotes && (pendingQuotes.subcontractorQuotes.length > 0 || pendingQuotes.materialQuotes.length > 0) && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-muted-foreground" />
                    Pending Quotes from Bid
                  </CardTitle>
                  <CardDescription>
                    These quotes were collected during the bid phase. Select the ones you want to convert into contracts or procurement items.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Pending Subcontractor Quotes */}
                  {pendingQuotes.subcontractorQuotes.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-muted-foreground">Subcontractor Quotes</h4>
                      {pendingQuotes.subcontractorQuotes.map((quote) => (
                        <Card 
                          key={quote.id} 
                          className="border-dashed hover-elevate cursor-pointer" 
                          data-testid={`pending-sub-quote-${quote.id}`}
                          onClick={() => {
                            setSelectedQuote({ type: "subcontractor", data: quote });
                            setShowQuoteDetailDialog(true);
                          }}
                        >
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-4 flex-wrap">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium">{quote.subcontractorName}</span>
                                  <Badge variant="secondary">Pending</Badge>
                                  {quote.fileUrl && (
                                    <Badge variant="outline" className="text-xs">
                                      <FileText className="w-3 h-3 mr-1" />
                                      Has Attachment
                                    </Badge>
                                  )}
                                </div>
                                {quote.contactName && (
                                  <p className="text-xs text-muted-foreground">
                                    Contact: {quote.contactName}
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold font-mono">
                                  ${parseFloat(quote.quoteAmount).toLocaleString()}
                                </p>
                                {quote.leadTime && (
                                  <p className="text-xs text-muted-foreground">
                                    Lead: {quote.leadTime}
                                  </p>
                                )}
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            <div>
                              <p className="text-sm font-medium mb-1">Scope of Work</p>
                              <p className="text-sm text-muted-foreground line-clamp-2">{quote.scopeOfWork}</p>
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t">
                              <p className="text-xs text-muted-foreground">
                                Click to view details • Added: {format(new Date(quote.createdAt), "MMM d, yyyy")}
                              </p>
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectSubQuoteMutation.mutate(quote.id);
                                }}
                                disabled={selectSubQuoteMutation.isPending}
                                data-testid={`button-select-sub-quote-${quote.id}`}
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                {selectSubQuoteMutation.isPending ? "Creating..." : "Select & Create Contract"}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  {/* Pending Material Quotes */}
                  {pendingQuotes.materialQuotes.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-muted-foreground">Material Quotes</h4>
                      {pendingQuotes.materialQuotes.map((quote) => (
                        <Card 
                          key={quote.id} 
                          className="border-dashed hover-elevate cursor-pointer" 
                          data-testid={`pending-mat-quote-${quote.id}`}
                          onClick={() => {
                            setSelectedQuote({ type: "material", data: quote });
                            setShowQuoteDetailDialog(true);
                          }}
                        >
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-4 flex-wrap">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium">{quote.materialName}</span>
                                  <Badge variant="secondary">Pending</Badge>
                                  {quote.fileUrl && (
                                    <Badge variant="outline" className="text-xs">
                                      <FileText className="w-3 h-3 mr-1" />
                                      Has Attachment
                                    </Badge>
                                  )}
                                </div>
                                {quote.supplierName && (
                                  <p className="text-xs text-muted-foreground">
                                    Supplier: {quote.supplierName}
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold font-mono">
                                  ${parseFloat(quote.cost).toLocaleString()}
                                </p>
                                {quote.leadTime && (
                                  <p className="text-xs text-muted-foreground">
                                    Lead: {quote.leadTime}
                                  </p>
                                )}
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            <div>
                              <p className="text-sm font-medium mb-1">Description</p>
                              <p className="text-sm text-muted-foreground line-clamp-2">{quote.description}</p>
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t">
                              <p className="text-xs text-muted-foreground">
                                Click to view details • Added: {format(new Date(quote.createdAt), "MMM d, yyyy")}
                              </p>
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectMatQuoteMutation.mutate(quote.id);
                                }}
                                disabled={selectMatQuoteMutation.isPending}
                                data-testid={`button-select-mat-quote-${quote.id}`}
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                {selectMatQuoteMutation.isPending ? "Creating..." : "Select & Create Procurement"}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Quote Detail Dialog */}
            <Dialog open={showQuoteDetailDialog} onOpenChange={(open) => {
              setShowQuoteDetailDialog(open);
              if (!open) setSelectedQuote(null);
            }}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-quote-detail">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {selectedQuote?.type === "subcontractor" ? (
                      <>
                        <Users className="w-5 h-5" />
                        Subcontractor Quote Details
                      </>
                    ) : (
                      <>
                        <Package className="w-5 h-5" />
                        Material Quote Details
                      </>
                    )}
                  </DialogTitle>
                  <DialogDescription>
                    Review the full details of this quote before selecting it.
                  </DialogDescription>
                </DialogHeader>

                {selectedQuote && (
                  <div className="space-y-6">
                    {/* Header with name and amount */}
                    <div className="flex items-start justify-between gap-4 p-4 bg-muted rounded-lg">
                      <div>
                        <h3 className="text-lg font-semibold">
                          {selectedQuote.type === "subcontractor" 
                            ? selectedQuote.data.subcontractorName 
                            : selectedQuote.data.materialName}
                        </h3>
                        <Badge variant="secondary" className="mt-1">Pending Selection</Badge>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold font-mono text-primary">
                          ${parseFloat(selectedQuote.type === "subcontractor" 
                            ? selectedQuote.data.quoteAmount 
                            : selectedQuote.data.cost).toLocaleString()}
                        </p>
                        {selectedQuote.data.leadTime && (
                          <p className="text-sm text-muted-foreground mt-1">
                            <Clock className="w-3 h-3 inline mr-1" />
                            Lead Time: {selectedQuote.data.leadTime}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Contact Information for Subcontractor */}
                    {selectedQuote.type === "subcontractor" && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <User className="w-4 h-4" />
                          Contact Information
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 border rounded-lg">
                          <div>
                            <p className="text-xs text-muted-foreground">Name</p>
                            <p className="text-sm font-medium">{selectedQuote.data.contactName || "Not provided"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Phone</p>
                            <p className="text-sm font-medium">{selectedQuote.data.contactPhone || "Not provided"}</p>
                          </div>
                          <div className="md:col-span-2">
                            <p className="text-xs text-muted-foreground">Email</p>
                            <p className="text-sm font-medium">{selectedQuote.data.contactEmail || "Not provided"}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Supplier Information for Material */}
                    {selectedQuote.type === "material" && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <Building2 className="w-4 h-4" />
                          Supplier Information
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 border rounded-lg">
                          <div>
                            <p className="text-xs text-muted-foreground">Supplier Name</p>
                            <p className="text-sm font-medium">{selectedQuote.data.supplierName || "Not provided"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Contact</p>
                            <p className="text-sm font-medium">{selectedQuote.data.supplierContact || "Not provided"}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Scope/Description */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        {selectedQuote.type === "subcontractor" ? "Scope of Work" : "Description"}
                      </h4>
                      <div className="p-3 border rounded-lg bg-card">
                        <p className="text-sm whitespace-pre-wrap">
                          {selectedQuote.type === "subcontractor" 
                            ? selectedQuote.data.scopeOfWork 
                            : selectedQuote.data.description}
                        </p>
                      </div>
                    </div>

                    {/* Specifications for Material */}
                    {selectedQuote.type === "material" && selectedQuote.data.specs && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <Ruler className="w-4 h-4" />
                          Specifications
                        </h4>
                        <div className="p-3 border rounded-lg bg-card">
                          <p className="text-sm whitespace-pre-wrap">{selectedQuote.data.specs}</p>
                        </div>
                      </div>
                    )}

                    {/* Estimated Completion Time for Subcontractor */}
                    {selectedQuote.type === "subcontractor" && selectedQuote.data.estimatedCompletionTime && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <CalendarCheck className="w-4 h-4" />
                          Estimated Completion Time
                        </h4>
                        <div className="p-3 border rounded-lg">
                          <p className="text-sm">{selectedQuote.data.estimatedCompletionTime}</p>
                        </div>
                      </div>
                    )}

                    {/* Notes */}
                    {selectedQuote.data.notes && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <StickyNote className="w-4 h-4" />
                          Notes
                        </h4>
                        <div className="p-3 border rounded-lg bg-card">
                          <p className="text-sm whitespace-pre-wrap">{selectedQuote.data.notes}</p>
                        </div>
                      </div>
                    )}

                    {/* Attached File */}
                    {selectedQuote.data.fileUrl && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <Paperclip className="w-4 h-4" />
                          Attached Document
                        </h4>
                        <div className="p-3 border rounded-lg flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <FileText className="w-8 h-8 text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium">{selectedQuote.data.fileName || "Document"}</p>
                              {selectedQuote.data.fileSize && (
                                <p className="text-xs text-muted-foreground">
                                  {(selectedQuote.data.fileSize / 1024).toFixed(1)} KB
                                </p>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(selectedQuote.data.fileUrl, '_blank')}
                            data-testid="button-view-quote-attachment"
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            View File
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Metadata */}
                    <div className="pt-4 border-t text-xs text-muted-foreground">
                      <p>Added: {format(new Date(selectedQuote.data.createdAt), "MMMM d, yyyy 'at' h:mm a")}</p>
                      {selectedQuote.data.updatedAt !== selectedQuote.data.createdAt && (
                        <p>Updated: {format(new Date(selectedQuote.data.updatedAt), "MMMM d, yyyy 'at' h:mm a")}</p>
                      )}
                    </div>
                  </div>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button 
                    variant="outline" 
                    onClick={() => setShowQuoteDetailDialog(false)}
                    data-testid="button-close-quote-detail"
                  >
                    Close
                  </Button>
                  <Button
                    onClick={() => {
                      if (selectedQuote?.type === "subcontractor") {
                        selectSubQuoteMutation.mutate(selectedQuote.data.id);
                      } else if (selectedQuote?.type === "material") {
                        selectMatQuoteMutation.mutate(selectedQuote.data.id);
                      }
                      setShowQuoteDetailDialog(false);
                    }}
                    disabled={selectSubQuoteMutation.isPending || selectMatQuoteMutation.isPending}
                    data-testid="button-select-quote-from-dialog"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {selectedQuote?.type === "subcontractor" ? "Select & Create Contract" : "Select & Create Procurement"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={showPaymentDialog} onOpenChange={(open) => {
              setShowPaymentDialog(open);
              if (!open) setSelectedContractId(null);
            }}>
              <DialogContent data-testid="dialog-record-payment">
                <DialogHeader>
                  <DialogTitle>Record Subcontractor Payment</DialogTitle>
                  <DialogDescription>
                    Enter payment details. Payments entered here flow to the project financials.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="payment-amount">Amount ($) *</Label>
                    <Input
                      id="payment-amount"
                      type="number"
                      step="0.01"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="0.00"
                      data-testid="input-payment-amount"
                    />
                  </div>
                  <div>
                    <Label htmlFor="payment-description">Description</Label>
                    <Input
                      id="payment-description"
                      value={paymentDescription}
                      onChange={(e) => setPaymentDescription(e.target.value)}
                      placeholder="Progress payment, final payment, etc..."
                      data-testid="input-payment-description"
                    />
                  </div>
                  <div>
                    <Label htmlFor="payment-invoice">Invoice Number</Label>
                    <Input
                      id="payment-invoice"
                      value={paymentInvoiceNumber}
                      onChange={(e) => setPaymentInvoiceNumber(e.target.value)}
                      placeholder="INV-001..."
                      data-testid="input-payment-invoice"
                    />
                  </div>
                  <div>
                    <Label htmlFor="payment-date">Payment Date</Label>
                    <Input
                      id="payment-date"
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      data-testid="input-payment-date"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => {
                    setShowPaymentDialog(false);
                    setSelectedContractId(null);
                  }}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreatePayment}
                    disabled={createPaymentMutation.isPending}
                    data-testid="button-submit-payment"
                  >
                    {createPaymentMutation.isPending ? "Recording..." : "Record Payment"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="labor-rates">
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle>Project Default Labor Rates</CardTitle>
                    <CardDescription>
                      Set the default hourly rates for this project and burden multiplier for payroll taxes, insurance, workers comp, etc.
                    </CardDescription>
                  </div>
                  <Button onClick={handleOpenLaborRatesDialog} data-testid="button-configure-labor-rates">
                    <Edit className="w-4 h-4 mr-2" />
                    {laborRatesConfig ? "Edit Rates" : "Configure Rates"}
                  </Button>
                </CardHeader>
                <CardContent>
                  {laborRatesLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading labor rates...</div>
                  ) : laborRatesConfig ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="text-center p-4 border rounded-md">
                        <p className="text-sm text-muted-foreground mb-1">Regular Rate</p>
                        <p className="text-2xl font-bold font-mono">${parseFloat(laborRatesConfig.defaultRegularRate).toFixed(2)}/hr</p>
                      </div>
                      <div className="text-center p-4 border rounded-md">
                        <p className="text-sm text-muted-foreground mb-1">Overtime Rate</p>
                        <p className="text-2xl font-bold font-mono">${parseFloat(laborRatesConfig.defaultOvertimeRate).toFixed(2)}/hr</p>
                      </div>
                      <div className="text-center p-4 border rounded-md">
                        <p className="text-sm text-muted-foreground mb-1">Burden Multiplier</p>
                        <p className="text-2xl font-bold font-mono">{parseFloat(laborRatesConfig.burdenMultiplier).toFixed(2)}x</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          ({((parseFloat(laborRatesConfig.burdenMultiplier) - 1) * 100).toFixed(0)}% overhead)
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="mb-2">No project-specific rates configured.</p>
                      <p className="text-sm">Using system defaults: $50/hr regular, $75/hr overtime, 1.0x burden</p>
                    </div>
                  )}
                  {laborRatesConfig?.notes && (
                    <div className="mt-4 p-3 bg-muted rounded-md">
                      <p className="text-sm text-muted-foreground">{laborRatesConfig.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle>Employee Rate Overrides</CardTitle>
                    <CardDescription>
                      Set different rates for specific employees on this project. Employee overrides take priority over project defaults.
                    </CardDescription>
                  </div>
                  <Button onClick={() => setShowEmployeeRateDialog(true)} data-testid="button-add-employee-rate">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Override
                  </Button>
                </CardHeader>
                <CardContent>
                  {employeeRatesLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading employee rates...</div>
                  ) : employeeRates.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No employee-specific rate overrides. All employees use the project default rates.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead className="text-right">Regular Rate</TableHead>
                          <TableHead className="text-right">Overtime Rate</TableHead>
                          <TableHead>Notes</TableHead>
                          <TableHead className="w-[80px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {employeeRates.map((rate) => (
                          <TableRow key={rate.id} data-testid={`employee-rate-${rate.id}`}>
                            <TableCell className="font-medium">
                              {rate.employee.firstName} {rate.employee.lastName}
                              <p className="text-xs text-muted-foreground">{rate.employee.email}</p>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${parseFloat(rate.regularRate).toFixed(2)}/hr
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${parseFloat(rate.overtimeRate).toFixed(2)}/hr
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {rate.notes || "-"}
                            </TableCell>
                            <TableCell>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" data-testid={`button-delete-rate-${rate.id}`}>
                                    <Trash2 className="w-4 h-4 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove Rate Override?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will remove the custom rate for {rate.employee.firstName} {rate.employee.lastName}. 
                                      They will use the project default rates instead.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDeleteEmployeeRate(rate.id)}>
                                      Remove
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {financials?.laborRates && (
                <Card>
                  <CardHeader>
                    <CardTitle>Labor Cost Impact</CardTitle>
                    <CardDescription>
                      How labor rates affect your project financials
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Base Labor Cost:</span>
                          <span className="font-mono">${(financials.actualCosts.laborBaseCost || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Burden Multiplier:</span>
                          <span className="font-mono">{financials.laborRates.burdenMultiplier}x</span>
                        </div>
                        <div className="flex justify-between border-t pt-2">
                          <span className="font-medium">Total Labor Cost:</span>
                          <span className="font-mono font-bold">${financials.actualCosts.labor.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Total Labor Hours:</span>
                          <span className="font-mono">{financials.actualCosts.laborHours.toFixed(1)} hrs</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Effective Rate:</span>
                          <span className="font-mono">
                            ${financials.actualCosts.laborHours > 0 
                              ? (financials.actualCosts.labor / financials.actualCosts.laborHours).toFixed(2) 
                              : "0.00"}/hr
                          </span>
                        </div>
                        <div className="flex justify-between border-t pt-2">
                          <span className="text-muted-foreground">Employee Overrides:</span>
                          <span className="font-mono">{financials.laborRates.employeeOverrideCount}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <Dialog open={showLaborRatesDialog} onOpenChange={setShowLaborRatesDialog}>
              <DialogContent data-testid="dialog-labor-rates">
                <DialogHeader>
                  <DialogTitle>Configure Project Labor Rates</DialogTitle>
                  <DialogDescription>
                    Set the default hourly rates and burden multiplier for this project.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="labor-regular-rate">Default Regular Rate ($/hr) *</Label>
                    <Input
                      id="labor-regular-rate"
                      type="number"
                      step="0.01"
                      value={laborRegularRate}
                      onChange={(e) => setLaborRegularRate(e.target.value)}
                      placeholder="50.00"
                      data-testid="input-labor-regular-rate"
                    />
                  </div>
                  <div>
                    <Label htmlFor="labor-overtime-rate">Default Overtime Rate ($/hr) *</Label>
                    <Input
                      id="labor-overtime-rate"
                      type="number"
                      step="0.01"
                      value={laborOvertimeRate}
                      onChange={(e) => setLaborOvertimeRate(e.target.value)}
                      placeholder="75.00"
                      data-testid="input-labor-overtime-rate"
                    />
                  </div>
                  <div>
                    <Label htmlFor="labor-burden-multiplier">Burden Multiplier *</Label>
                    <Select 
                      value={laborBurdenMultiplier}
                      onValueChange={setLaborBurdenMultiplier}
                    >
                      <SelectTrigger id="labor-burden-multiplier" data-testid="select-burden-multiplier">
                        <SelectValue placeholder="Select multiplier" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1.0">1.0x (No burden)</SelectItem>
                        <SelectItem value="1.1">1.1x (10% overhead)</SelectItem>
                        <SelectItem value="1.15">1.15x (15% overhead)</SelectItem>
                        <SelectItem value="1.2">1.2x (20% overhead)</SelectItem>
                        <SelectItem value="1.25">1.25x (25% overhead)</SelectItem>
                        <SelectItem value="1.3">1.3x (30% overhead)</SelectItem>
                        <SelectItem value="1.35">1.35x (35% overhead)</SelectItem>
                        <SelectItem value="1.4">1.4x (40% overhead)</SelectItem>
                        <SelectItem value="1.45">1.45x (45% overhead)</SelectItem>
                        <SelectItem value="1.5">1.5x (50% overhead)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Accounts for payroll taxes, insurance, workers comp, benefits, etc.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="labor-notes">Notes</Label>
                    <Textarea
                      id="labor-notes"
                      value={laborRatesNotes}
                      onChange={(e) => setLaborRatesNotes(e.target.value)}
                      placeholder="Rate assumptions, calculation notes..."
                      data-testid="input-labor-notes"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowLaborRatesDialog(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveLaborRates}
                    disabled={updateLaborRatesMutation.isPending}
                    data-testid="button-save-labor-rates"
                  >
                    {updateLaborRatesMutation.isPending ? "Saving..." : "Save Rates"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={showEmployeeRateDialog} onOpenChange={(open) => {
              setShowEmployeeRateDialog(open);
              if (!open) {
                setSelectedEmployeeId("");
                setEmployeeRegularRate("");
                setEmployeeOvertimeRate("");
                setEmployeeRateNotes("");
              }
            }}>
              <DialogContent data-testid="dialog-employee-rate">
                <DialogHeader>
                  <DialogTitle>Add Employee Rate Override</DialogTitle>
                  <DialogDescription>
                    Set a custom rate for a specific employee on this project.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="employee-select">Employee *</Label>
                    <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                      <SelectTrigger id="employee-select" data-testid="select-employee">
                        <SelectValue placeholder="Select employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {allUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.firstName} {u.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="employee-regular-rate">Regular Rate ($/hr) *</Label>
                    <Input
                      id="employee-regular-rate"
                      type="number"
                      step="0.01"
                      value={employeeRegularRate}
                      onChange={(e) => setEmployeeRegularRate(e.target.value)}
                      placeholder="50.00"
                      data-testid="input-employee-regular-rate"
                    />
                  </div>
                  <div>
                    <Label htmlFor="employee-overtime-rate">Overtime Rate ($/hr) *</Label>
                    <Input
                      id="employee-overtime-rate"
                      type="number"
                      step="0.01"
                      value={employeeOvertimeRate}
                      onChange={(e) => setEmployeeOvertimeRate(e.target.value)}
                      placeholder="75.00"
                      data-testid="input-employee-overtime-rate"
                    />
                  </div>
                  <div>
                    <Label htmlFor="employee-rate-notes">Notes</Label>
                    <Input
                      id="employee-rate-notes"
                      value={employeeRateNotes}
                      onChange={(e) => setEmployeeRateNotes(e.target.value)}
                      placeholder="Reason for custom rate..."
                      data-testid="input-employee-rate-notes"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowEmployeeRateDialog(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveEmployeeRate}
                    disabled={updateEmployeeRateMutation.isPending}
                    data-testid="button-save-employee-rate"
                  >
                    {updateEmployeeRateMutation.isPending ? "Saving..." : "Save Rate"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="job-info">
            <JobInformationForm projectCode={project.code} />
          </TabsContent>

          {FeaturePermissions.VIEW_EQUIPMENT(user?.role) && (
            <TabsContent value="equipment">
              <ProjectEquipmentTab projectId={project.id} projectCode={project.code} userRole={user?.role || ""} />
            </TabsContent>
          )}
        </Tabs>

        {/* Budget Edit Dialog (Admin Only) */}
        <Dialog open={showBudgetEditDialog} onOpenChange={setShowBudgetEditDialog}>
          <DialogContent data-testid="dialog-edit-budget">
            <DialogHeader>
              <DialogTitle>Edit Financial Data</DialogTitle>
              <DialogDescription>
                Update the project budget and contract amount. This data is used for profitability analysis.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-budget">Project Budget ($)</Label>
                <Input
                  id="edit-budget"
                  type="number"
                  step="0.01"
                  value={editBudget}
                  onChange={(e) => setEditBudget(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-edit-budget"
                />
              </div>
              <div>
                <Label htmlFor="edit-contract">Contract Amount ($)</Label>
                <Input
                  id="edit-contract"
                  type="number"
                  step="0.01"
                  value={editContractAmount}
                  onChange={(e) => setEditContractAmount(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-edit-contract"
                />
              </div>
              <div>
                <Label htmlFor="edit-textura-draw-date">Textura Draw Date (Optional Override)</Label>
                <Input
                  id="edit-textura-draw-date"
                  type="date"
                  value={editTexturaDrawDate}
                  onChange={(e) => setEditTexturaDrawDate(e.target.value)}
                  placeholder="YYYY-MM-DD"
                  data-testid="input-edit-textura-draw-date"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Use this to override the recurring draw schedule for a specific month
                </p>
              </div>
              <div>
                <Label htmlFor="edit-draw-day-of-month">Recurring Draw Day of Month</Label>
                <Select 
                  value={editDrawDayOfMonth === "" ? "none" : String(editDrawDayOfMonth)}
                  onValueChange={(value) => setEditDrawDayOfMonth(value === "none" ? "" : parseInt(value))}
                >
                  <SelectTrigger id="edit-draw-day-of-month" data-testid="select-draw-day-of-month">
                    <SelectValue placeholder="Select day of month" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No recurring draw</SelectItem>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {day}{day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'} of each month
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Set the day each month when Textura draws are due (e.g., 1st, 15th, 30th)
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowBudgetEditDialog(false)}
                data-testid="button-cancel-budget-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleBudgetUpdate}
                data-testid="button-save-budget"
              >
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
