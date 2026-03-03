import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import StatusBadge from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FileUploadZone from "@/components/FileUploadZone";
import ScopeOfWorkTable from "@/components/ScopeOfWorkTable";
import ScopeProgressTracker from "@/components/ScopeProgressTracker";
import DailyNoteFeed from "@/components/DailyNoteFeed";
import AiSchedulingPanel from "@/components/AiSchedulingPanel";
import AiJobsiteAnalysis from "@/components/AiJobsiteAnalysis";
import ClientPortal from "@/components/ClientPortal";
import ProjectEstimate from "@/components/ProjectEstimate";
import JobInformationForm from "@/components/JobInformationForm";
import DelaysSection from "@/components/DelaysSection";
import InspectionsSection from "@/components/InspectionsSection";
import MaterialBudgetTracker from "@/components/MaterialBudgetTracker";
import ProjectRFIs from "@/components/ProjectRFIs";
import ProjectTransmittals from "@/components/ProjectTransmittals";
import ProjectSubmittals from "@/components/ProjectSubmittals";
import SubcontractorPortalManager from "@/components/SubcontractorPortalManager";
import { Building2, MapPin, User, Phone, Mail, Calendar as CalendarIcon, Plus, CheckCircle, XCircle, Clock, Upload, DollarSign, Edit, AlertTriangle, Download, Eye, FileText, Trash2, ChevronDown, ChevronRight, Package, Users, Ruler, CalendarCheck, ExternalLink, Truck, Wrench, Send, Undo2, Settings2, Link2, CloudRain, HelpCircle, FileCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";

import { FeaturePermissions, hasManagementAccess } from "@/lib/rbac";
import { useProject, useScopeItems, useChangeOrders, useProjectNotes, useProjectEstimates } from "@/hooks/use-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ChangeOrder, ScopeItem, DailyScopeProgress } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ChangeOrdersTab from "@/components/project-tabs/ChangeOrdersTab";
import OverviewTab from "@/components/project-tabs/OverviewTab";
import SubcontractorsTab from "@/components/project-tabs/SubcontractorsTab";
import LaborTab from "@/components/project-tabs/LaborTab";
import PlansTab from "@/components/project-tabs/PlansTab";
import ProcurementTab from "@/components/project-tabs/ProcurementTab";
import ReceiptsTab from "@/components/project-tabs/ReceiptsTab";
import MediaTab from "@/components/project-tabs/MediaTab";
import TimeTab from "@/components/project-tabs/TimeTab";
import { Link } from "wouter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, RefreshCw, Loader2, MessageSquare, UserIcon } from "lucide-react";

// Email types for the project email tab
interface ProjectEmailThread {
  id: string;
  subject: string;
  snippet: string | null;
  primaryClassification: string | null;
  status: string;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string;
  aiSummary: string | null;
}

interface ProjectEmailTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

function ProjectEmailTab({ projectId, projectCode, userRole }: ProjectEmailTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedThread, setSelectedThread] = useState<ProjectEmailThread | null>(null);

  const { data: emailThreads = [], isLoading } = useQuery<ProjectEmailThread[]>({
    queryKey: ["/api/email/threads", { projectId }],
  });

  const linkEmailMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest("POST", `/api/email/threads/${threadId}/link`, { projectId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email linked", description: "Email thread linked to this project" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads", { projectId }] });
    },
    onError: () => {
      toast({ title: "Failed to link email", variant: "destructive" });
    },
  });

  const classificationColors: Record<string, string> = {
    BID_INVITE: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    CHANGE_ORDER: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    SUBMITTAL_REQUEST: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    DELAY_NOTICE: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    SAFETY_ISSUE: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    APPROVAL_NEEDED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    GENERAL: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Project Emails
              </CardTitle>
              <CardDescription>
                Email threads linked to project {projectCode}
              </CardDescription>
            </div>
            <div className="w-full sm:w-auto flex gap-2">
              <Button variant="outline" size="sm" asChild data-testid="link-email-assistant" className="w-full sm:w-auto">
                <Link href="/email-assistant">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Email Assistant
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {emailThreads.length === 0 ? (
            <div className="text-center py-12">
              <Mail className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium text-lg mb-2">No emails linked</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Link email threads to this project from the Email Assistant
              </p>
              <Button variant="outline" asChild data-testid="button-go-email-assistant">
                <Link href="/email-assistant">Go to Email Assistant</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {emailThreads.map((thread) => (
                <div
                  key={thread.id}
                  className="p-4 border rounded-lg hover-elevate cursor-pointer"
                  onClick={() => setSelectedThread(thread)}
                  data-testid={`email-thread-${thread.id}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium truncate">{thread.subject}</h4>
                        {thread.unreadCount > 0 && (
                          <Badge variant="default" className="text-xs">
                            {thread.unreadCount} new
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {thread.snippet || thread.aiSummary || "No preview available"}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        {thread.primaryClassification && (
                          <Badge 
                            variant="outline" 
                            className={classificationColors[thread.primaryClassification] || ""}
                          >
                            {thread.primaryClassification.replace(/_/g, " ")}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          {thread.messageCount} messages
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(thread.lastMessageAt), "MMM d, h:mm a")}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedThread && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>{selectedThread.subject}</CardTitle>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setSelectedThread(null)}
              data-testid="button-close-thread-detail"
            >
              <XCircle className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {selectedThread.aiSummary && (
              <div className="p-4 bg-muted/50 rounded-lg mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="font-medium text-sm">AI Summary</span>
                </div>
                <p className="text-sm text-muted-foreground">{selectedThread.aiSummary}</p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              View full thread details in the Email Assistant for complete message history and actions.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

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

interface ProjectPayrollSummary {
  laborCostToDate: number;
  budget: number;
  laborVsBudget: number;
  totalRegularHours: number;
  totalOvertimeHours: number;
  overtimePercent: number;
  totalEntries: number;
  workers: { userId: string; name: string; role: string; regularHours: number; overtimeHours: number }[];
}

function ProjectPayrollTab({ projectId }: { projectId: string }) {
  const { data: summary, isLoading } = useQuery<ProjectPayrollSummary>({
    queryKey: ["/api/projects", projectId, "payroll-summary"],
  });

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val || 0);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (!summary) {
    return <div className="text-center py-8 text-muted-foreground">No payroll data available</div>;
  }

  const budgetUsedPercent = summary.laborVsBudget;
  const budgetBarColor = budgetUsedPercent > 90 ? "bg-red-500" : budgetUsedPercent > 70 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Labor Cost to Date</p>
            <p className="text-2xl font-bold" data-testid="text-project-labor-cost">{formatCurrency(summary.laborCostToDate)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Labor vs Budget</p>
            <p className="text-2xl font-bold" data-testid="text-project-labor-budget">
              {summary.budget > 0 ? `${budgetUsedPercent.toFixed(1)}%` : "N/A"}
            </p>
            {summary.budget > 0 && (
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2">
                <div className={`${budgetBarColor} h-2 rounded-full transition-all`} style={{ width: `${Math.min(budgetUsedPercent, 100)}%` }} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Overtime %</p>
            <p className="text-2xl font-bold" data-testid="text-project-overtime-pct">{summary.overtimePercent}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.totalOvertimeHours.toFixed(1)} OT / {(summary.totalRegularHours + summary.totalOvertimeHours).toFixed(1)} total hrs
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Workers Assigned</p>
            <p className="text-2xl font-bold" data-testid="text-project-workers">{summary.workers.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{summary.totalEntries} time entries</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Workers on This Project</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.workers.length === 0 ? (
            <p className="text-center py-6 text-muted-foreground">No workers have logged time on this project</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Regular Hours</TableHead>
                  <TableHead>OT Hours</TableHead>
                  <TableHead>Total Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.workers.map(w => (
                  <TableRow key={w.userId} data-testid={`row-project-worker-${w.userId}`}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{w.role}</Badge>
                    </TableCell>
                    <TableCell>{w.regularHours.toFixed(1)}</TableCell>
                    <TableCell>{w.overtimeHours > 0 ? w.overtimeHours.toFixed(1) : "—"}</TableCell>
                    <TableCell className="font-medium">{(w.regularHours + w.overtimeHours).toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

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
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Ruler className="h-5 w-5" />
                Equipment Plan
              </CardTitle>
              <CardDescription>
                Planned equipment for this project (from bid or manually added)
              </CardDescription>
            </div>
            <div className="w-full sm:w-auto flex flex-wrap gap-2">
              {totalPlannedCost > 0 && (
                <Badge variant="secondary" className="text-base">
                  Total: ${totalPlannedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Badge>
              )}
              {canManagePlans && (
                <Button size="sm" onClick={() => setShowAddPlanDialog(true)} data-testid="button-add-equipment-plan" className="w-full sm:w-auto">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Equipment
                </Button>
              )}
            </div>
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
            <>
            <div className="hidden md:block">
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
            </div>

            <div className="md:hidden space-y-3">
              {equipmentPlans.map((plan: any) => (
                <div key={plan.id} className="border rounded-md p-4 space-y-3" data-testid={`card-equipment-plan-mobile-${plan.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{plan.equipmentName}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline">{plan.equipmentType}</Badge>
                      <Badge variant={plan.source === "OWNED" ? "default" : "secondary"}>
                        {plan.source}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Planned Days/Hrs</span>
                      <p>{plan.plannedDays || plan.plannedHours ? `${plan.plannedDays || "-"} days / ${plan.plannedHours || "-"} hrs` : "-"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Rate</span>
                      <p>{plan.dailyRate ? `$${Number(plan.dailyRate).toFixed(2)}/day` : plan.hourlyRate ? `$${Number(plan.hourlyRate).toFixed(2)}/hr` : "-"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Planned Cost</span>
                      <p className="font-medium">{plan.plannedCost ? `$${Number(plan.plannedCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status</span>
                      <div className="mt-1">
                        <Select
                          value={plan.status}
                          onValueChange={(value) => updatePlanStatus.mutate({ planId: plan.id, status: value })}
                          disabled={!canManagePlans || updatePlanStatus.isPending}
                        >
                          <SelectTrigger className="w-full" data-testid={`select-plan-status-mobile-${plan.id}`}>
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
                      </div>
                    </div>
                  </div>
                  {canManagePlans && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {plan.source === "OWNED" && plan.status === "PLANNED" && !plan.equipmentId && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedPlanForAssignment(plan);
                            setShowAssignDialog(true);
                          }}
                          data-testid={`button-assign-plan-mobile-${plan.id}`}
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
                          data-testid={`button-book-rental-mobile-${plan.id}`}
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
                          data-testid={`button-track-rental-mobile-${plan.id}`}
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
                          data-testid={`button-view-equipment-mobile-${plan.id}`}
                        >
                          <Link href={`/equipment/${plan.equipmentCode || plan.equipmentId}`}>
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Link>
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-delete-plan-mobile-${plan.id}`}>
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
                  )}
                </div>
              ))}
            </div>
            </>
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
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
              <Button asChild size="sm" data-testid="button-manage-equipment" className="w-full sm:w-auto">
                <Link href="/equipment">
                  <Settings2 className="h-4 w-4 mr-2" />
                  Manage Equipment
                </Link>
              </Button>
            )}
          </div>
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
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                    data-testid="input-rental-start-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(parseISO(startDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={startDate ? parseISO(startDate) : undefined}
                    onSelect={(date) => setStartDate(date ? format(date, "yyyy-MM-dd") : "")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                    data-testid="input-rental-end-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(parseISO(endDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={endDate ? parseISO(endDate) : undefined}
                    onSelect={(date) => setEndDate(date ? format(date, "yyyy-MM-dd") : "")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
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

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");
  const [, params] = useRoute("/projects/:code");
  const { user, logout, organizationName } = useAuth();
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
  const { data: estimates = [], isLoading: estimatesLoading } = useProjectEstimates(projectCode);


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
    tmTickets?: {
      approved: number;
      approvedTotal: number;
      pending: number;
      pendingTotal: number;
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


  // Query all users for daily notes filter
  const { data: allUsers = [] } = useQuery<Array<{
    id: string;
    firstName: string;
    lastName: string;
    role?: string;
    costRateRegular?: string;
  }>>({
    queryKey: ["/api/users"],
  });

  // Material budget summary query for alerts
  interface MaterialBudgetSummary {
    totalItems: number;
    totalBudgetedCost: number;
    totalActualCost: number;
    variance: number;
    variancePercent: number;
    itemsAtRisk: number;
    alertsTriggered: number;
  }
  
  const { data: materialBudgetSummary } = useQuery<MaterialBudgetSummary>({
    queryKey: ["/api/projects", project?.id, "material-budgets", "summary"],
    enabled: !!project?.id,
  });


  if (projectLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">Loading project...</div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
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
            <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
              <span>This project is missing budget and contract information. Please update the financial data to enable accurate profitability tracking and AI analysis.</span>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setActiveTab("financials")}
                data-testid="button-go-to-financials"
              >
                Set Up Financials
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {materialBudgetSummary && materialBudgetSummary.alertsTriggered > 0 && (
          <Alert variant="destructive" className="mb-6" data-testid="alert-material-budget">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Material Budget Alert</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
              <span>
                {materialBudgetSummary.alertsTriggered} material{materialBudgetSummary.alertsTriggered > 1 ? "s" : ""} have reached 90%+ of budgeted quantity. Consider creating a change order to cover additional materials.
              </span>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => setActiveTab("materials")}
                data-testid="button-view-materials-alert"
              >
                <Package className="h-4 w-4 mr-2" />
                View Materials
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          {/* Mobile dropdown - visible only on small screens */}
          <div className="md:hidden">
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="w-full" data-testid="select-tab-mobile">
                <SelectValue placeholder="Select tab" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overview">Overview</SelectItem>
                <SelectItem value="scope">Scope & Progress</SelectItem>
                <SelectItem value="materials">Materials</SelectItem>
                <SelectItem value="change-orders">
                  Change Orders {changeOrders.filter(co => co.status === "SUBMITTED").length > 0 && `(${changeOrders.filter(co => co.status === "SUBMITTED").length})`}
                </SelectItem>
                <SelectItem value="schedule">Schedule</SelectItem>
                <SelectItem value="delays">Delays</SelectItem>
                <SelectItem value="inspections">Inspections</SelectItem>
                {hasManagementAccess(user?.role) && (
                  <SelectItem value="jobsite-ai">AI Jobsite</SelectItem>
                )}
                {hasManagementAccess(user?.role) && (
                  <SelectItem value="email-communications">Email</SelectItem>
                )}
                <SelectItem value="daily-notes">Daily Notes</SelectItem>
                <SelectItem value="media">Photos & Videos</SelectItem>
                {FeaturePermissions.VIEW_ESTIMATES_TAB(user?.role) && (
                  <SelectItem value="estimate">Estimate</SelectItem>
                )}
                {FeaturePermissions.VIEW_PROCUREMENT_TAB(user?.role) && (
                  <SelectItem value="procurement">Procurement</SelectItem>
                )}
                <SelectItem value="plans">Plans & Takeoff</SelectItem>
                {FeaturePermissions.VIEW_TIME_ENTRIES_TAB(user?.role) && (
                  <SelectItem value="time">Time & T&M</SelectItem>
                )}
                {FeaturePermissions.VIEW_TIME_ENTRIES_TAB(user?.role) && (
                  <SelectItem value="labor">Labor</SelectItem>
                )}
                {FeaturePermissions.VIEW_RECEIPTS_TAB(user?.role) && (
                  <SelectItem value="receipts">Receipts</SelectItem>
                )}
                {FeaturePermissions.VIEW_SUBCONTRACTORS_TAB(user?.role) && (
                  <SelectItem value="subcontractors">Subcontractors</SelectItem>
                )}
                <SelectItem value="job-info">Job Info</SelectItem>
                {FeaturePermissions.VIEW_EQUIPMENT(user?.role) && (
                  <SelectItem value="equipment">Equipment</SelectItem>
                )}
                {hasManagementAccess(user?.role) && (
                  <SelectItem value="rfis">RFIs</SelectItem>
                )}
                {hasManagementAccess(user?.role) && (
                  <SelectItem value="transmittals">Transmittals</SelectItem>
                )}
                {hasManagementAccess(user?.role) && (
                  <SelectItem value="submittals">Submittals</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop tabs - hidden on mobile, flex wrap on larger screens */}
          <TabsList className="hidden md:flex flex-wrap gap-1 h-auto w-full justify-start p-1">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="scope" data-testid="tab-scope">Scope & Progress</TabsTrigger>
            <TabsTrigger value="materials" data-testid="tab-materials">
              <Package className="h-4 w-4 mr-1" />
              Materials
            </TabsTrigger>
            <TabsTrigger value="change-orders" data-testid="tab-change-orders">
              Change Orders
              {changeOrders.filter(co => co.status === "SUBMITTED").length > 0 && (
                <Badge className="ml-2" variant="secondary">
                  {changeOrders.filter(co => co.status === "SUBMITTED").length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="schedule" data-testid="tab-schedule">
              <CalendarIcon className="h-4 w-4 mr-1" />
              Schedule
            </TabsTrigger>
            <TabsTrigger value="delays" data-testid="tab-delays">
              <CloudRain className="h-4 w-4 mr-1" />
              Delays
            </TabsTrigger>
            <TabsTrigger value="inspections" data-testid="tab-inspections">
              <CalendarCheck className="h-4 w-4 mr-1" />
              Inspections
            </TabsTrigger>
            {hasManagementAccess(user?.role) && (
              <TabsTrigger value="jobsite-ai" data-testid="tab-jobsite-ai">
                AI Jobsite
              </TabsTrigger>
            )}
            {hasManagementAccess(user?.role) && (
              <TabsTrigger value="email-communications" data-testid="tab-email-communications">
                <Mail className="h-4 w-4 mr-1" />
                Email
              </TabsTrigger>
            )}
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
              <TabsTrigger value="labor" data-testid="tab-labor">Labor</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_RECEIPTS_TAB(user?.role) && (
              <TabsTrigger value="receipts" data-testid="tab-receipts">Receipts</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_SUBCONTRACTORS_TAB(user?.role) && (
              <TabsTrigger value="subcontractors" data-testid="tab-subcontractors">Subcontractors</TabsTrigger>
            )}
            <TabsTrigger value="job-info" data-testid="tab-job-info">Job Info</TabsTrigger>
            {hasManagementAccess(user?.role) && (
              <TabsTrigger value="payroll" data-testid="tab-payroll">Payroll</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_EQUIPMENT(user?.role) && (
              <TabsTrigger value="equipment" data-testid="tab-equipment">
                <Truck className="h-4 w-4 mr-1" />
                Equipment
              </TabsTrigger>
            )}
            {hasManagementAccess(user?.role) && (
              <TabsTrigger value="rfis" data-testid="tab-rfis">
                <HelpCircle className="h-4 w-4 mr-1" />
                RFIs
              </TabsTrigger>
            )}
            {hasManagementAccess(user?.role) && (
              <TabsTrigger value="transmittals" data-testid="tab-transmittals">
                <Send className="h-4 w-4 mr-1" />
                Transmittals
              </TabsTrigger>
            )}
            {hasManagementAccess(user?.role) && (
              <TabsTrigger value="submittals" data-testid="tab-submittals">
                <FileCheck className="h-4 w-4 mr-1" />
                Submittals
              </TabsTrigger>
            )}
            {hasManagementAccess(user?.role) && (
              <TabsTrigger value="portal-access" data-testid="tab-portal-access">
                <ExternalLink className="h-4 w-4 mr-1" />
                Portal Access
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <OverviewTab
              project={project}
              projectCode={projectCode}
              changeOrders={changeOrders}
              financials={financials}
              financialsLoading={financialsLoading}
              setActiveTab={setActiveTab}
            />
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

          <TabsContent value="materials">
            <MaterialBudgetTracker projectId={project.id} projectCode={projectCode} scopeItems={scopeItems} />
          </TabsContent>

          <TabsContent value="change-orders">
            <ChangeOrdersTab 
              changeOrders={changeOrders}
              projectCode={projectCode}
              projectId={project.id}
              projectName={project.name}
              isLoading={changeOrdersLoading}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="schedule">
            <AiSchedulingPanel 
              projectId={project.id}
              projectCode={projectCode}
              projectName={project.name}
              tradeType={(project as { tradeType?: string }).tradeType}
            />
          </TabsContent>

          <TabsContent value="delays">
            <DelaysSection 
              projectId={project.id}
              projectCode={projectCode}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="inspections">
            <InspectionsSection 
              projectId={project.id}
              projectCode={projectCode}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="jobsite-ai">
            <AiJobsiteAnalysis 
              projectId={project.id}
              projectName={project.name}
            />
          </TabsContent>


          <TabsContent value="email-communications">
            <ProjectEmailTab 
              projectId={project.id}
              projectCode={projectCode}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="daily-notes">
            <DailyNoteFeed projectId={project.id} availableUsers={allUsers} />
          </TabsContent>

          <TabsContent value="media">
            <MediaTab projectCode={projectCode} project={project} />
          </TabsContent>

          <TabsContent value="estimate">
            <ProjectEstimate />
          </TabsContent>

          <TabsContent value="procurement">
            <ProcurementTab projectCode={projectCode} project={project} />
          </TabsContent>

          <TabsContent value="plans" className="space-y-0">
            <PlansTab projectCode={projectCode} project={project} />
          </TabsContent>

          <TabsContent value="time">
            <TimeTab projectCode={projectCode} project={project} userRole={user?.role || ""} />
          </TabsContent>

          <TabsContent value="labor">
            <LaborTab projectCode={projectCode} project={project} financials={financials} />
          </TabsContent>

          <TabsContent value="receipts">
            <ReceiptsTab projectCode={projectCode} project={project} />
          </TabsContent>

          <TabsContent value="subcontractors">
            <SubcontractorsTab projectCode={projectCode} />
          </TabsContent>


          <TabsContent value="job-info">
            <JobInformationForm projectCode={project.code} />
          </TabsContent>

          {hasManagementAccess(user?.role) && (
            <TabsContent value="payroll">
              <ProjectPayrollTab projectId={project.id} />
            </TabsContent>
          )}

          {FeaturePermissions.VIEW_EQUIPMENT(user?.role) && (
            <TabsContent value="equipment">
              <ProjectEquipmentTab projectId={project.id} projectCode={project.code} userRole={user?.role || ""} />
            </TabsContent>
          )}
          {hasManagementAccess(user?.role) && (
            <TabsContent value="rfis">
              <ProjectRFIs projectId={project.id} projectCode={project.code} userRole={user?.role || ""} />
            </TabsContent>
          )}
          {hasManagementAccess(user?.role) && (
            <TabsContent value="transmittals">
              <ProjectTransmittals projectId={project.id} projectCode={project.code} userRole={user?.role || ""} />
            </TabsContent>
          )}
          {hasManagementAccess(user?.role) && (
            <TabsContent value="submittals">
              <ProjectSubmittals projectId={project.id} projectCode={project.code} userRole={user?.role || ""} />
            </TabsContent>
          )}
          {hasManagementAccess(user?.role) && (
            <TabsContent value="portal-access">
              <Tabs defaultValue="client-portal" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="client-portal" data-testid="tab-portal-client">
                    Client Portal
                  </TabsTrigger>
                  <TabsTrigger value="subcontractor-portal" data-testid="tab-portal-subcontractor">
                    Subcontractor Portal
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="client-portal">
                  <ClientPortal
                    projectId={project.id}
                    projectName={project.name}
                  />
                </TabsContent>
                <TabsContent value="subcontractor-portal">
                  <SubcontractorPortalManager projectId={project.id} projectCode={project.code} userRole={user?.role || ""} />
                </TabsContent>
              </Tabs>
            </TabsContent>
          )}
        </Tabs>

      </main>
    </div>
  );
}
