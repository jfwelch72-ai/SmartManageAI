import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, Plus, Users, Briefcase, DollarSign, AlertCircle, Building2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon } from "lucide-react";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  costRateRegular: string | null;
  costRateOvertime: string | null;
}

interface JobClassification {
  id: string;
  organizationId: string;
  name: string;
  code: string | null;
  description: string | null;
  defaultRegularRate: string | null;
  defaultOvertimeRate: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface EmployeeClassification {
  id: string;
  userId: string;
  classificationId: string;
  regularRate: string;
  overtimeRate: string;
  isPrimary: boolean;
  effectiveDate: string;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string; email: string } | null;
  classification: { id: string; name: string; code: string | null } | null;
}

interface PrevailingWageRate {
  id: string;
  projectId: string;
  classificationId: string;
  wageRate: string;
  fringeRate: string;
  totalRate: string;
  overtimeMultiplier: string;
  effectiveDate: string;
  expirationDate: string | null;
  wageDecision: string | null;
  notes: string | null;
  createdAt: string;
  project: { id: string; name: string; code: string | null } | null;
  classification: { id: string; name: string; code: string | null } | null;
}

interface Project {
  id: string;
  name: string;
  code: string | null;
}

export default function CostRatesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("employee-rates");
  
  const [showEditRateDialog, setShowEditRateDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editRegularRate, setEditRegularRate] = useState("");
  const [editOvertimeRate, setEditOvertimeRate] = useState("");

  const [showClassificationDialog, setShowClassificationDialog] = useState(false);
  const [editingClassification, setEditingClassification] = useState<JobClassification | null>(null);
  const [classificationName, setClassificationName] = useState("");
  const [classificationCode, setClassificationCode] = useState("");
  const [classificationDescription, setClassificationDescription] = useState("");
  const [classificationDefaultRegRate, setClassificationDefaultRegRate] = useState("");
  const [classificationDefaultOTRate, setClassificationDefaultOTRate] = useState("");
  const [classificationIsActive, setClassificationIsActive] = useState(true);

  const [showEmployeeClassDialog, setShowEmployeeClassDialog] = useState(false);
  const [editingEmployeeClass, setEditingEmployeeClass] = useState<EmployeeClassification | null>(null);
  const [empClassUserId, setEmpClassUserId] = useState("");
  const [empClassClassificationId, setEmpClassClassificationId] = useState("");
  const [empClassRegularRate, setEmpClassRegularRate] = useState("");
  const [empClassOvertimeRate, setEmpClassOvertimeRate] = useState("");
  const [empClassIsPrimary, setEmpClassIsPrimary] = useState(false);
  const [empClassEffectiveDate, setEmpClassEffectiveDate] = useState("");
  const [empClassEndDate, setEmpClassEndDate] = useState("");
  const [empClassNotes, setEmpClassNotes] = useState("");

  const [showPWRateDialog, setShowPWRateDialog] = useState(false);
  const [editingPWRate, setEditingPWRate] = useState<PrevailingWageRate | null>(null);
  const [pwProjectId, setPwProjectId] = useState("");
  const [pwClassificationId, setPwClassificationId] = useState("");
  const [pwWageRate, setPwWageRate] = useState("");
  const [pwFringeRate, setPwFringeRate] = useState("");
  const [pwOvertimeMultiplier, setPwOvertimeMultiplier] = useState("1.5");
  const [pwEffectiveDate, setPwEffectiveDate] = useState("");
  const [pwExpirationDate, setPwExpirationDate] = useState("");
  const [pwWageDecision, setPwWageDecision] = useState("");
  const [pwNotes, setPwNotes] = useState("");

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string; name: string } | null>(null);

  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: classifications = [], isLoading: classificationsLoading } = useQuery<JobClassification[]>({
    queryKey: ["/api/labor-rates/classifications"],
  });

  const { data: employeeClassifications = [], isLoading: empClassLoading } = useQuery<EmployeeClassification[]>({
    queryKey: ["/api/labor-rates/employee-classifications"],
  });

  const { data: prevailingWageRates = [], isLoading: pwRatesLoading } = useQuery<PrevailingWageRate[]>({
    queryKey: ["/api/labor-rates/prevailing-wage-rates"],
  });

  const { data: projectsResponse } = useQuery<{ data: Project[], pagination?: any }>({
    queryKey: ["/api/projects"],
  });
  const projects = projectsResponse?.data || [];

  const updateRatesMutation = useMutation({
    mutationFn: async (data: { userId: string; costRateRegular: string; costRateOvertime: string }) => {
      return await apiRequest("PATCH", `/api/users/${data.userId}/cost-rates`, {
        costRateRegular: data.costRateRegular,
        costRateOvertime: data.costRateOvertime,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "Base rates updated" });
      setShowEditRateDialog(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update rates", variant: "destructive" });
    },
  });

  const classificationMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingClassification) {
        return await apiRequest("PATCH", `/api/labor-rates/classifications/${editingClassification.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/classifications", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/classifications"] });
      toast({ title: "Success", description: editingClassification ? "Classification updated" : "Classification created" });
      resetClassificationDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save classification", variant: "destructive" });
    },
  });

  const deleteClassificationMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/labor-rates/classifications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/classifications"] });
      toast({ title: "Success", description: "Classification deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete classification", variant: "destructive" });
    },
  });

  const employeeClassMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingEmployeeClass) {
        return await apiRequest("PATCH", `/api/labor-rates/employee-classifications/${editingEmployeeClass.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/employee-classifications", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/employee-classifications"] });
      toast({ title: "Success", description: editingEmployeeClass ? "Assignment updated" : "Assignment created" });
      resetEmployeeClassDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save assignment", variant: "destructive" });
    },
  });

  const deleteEmployeeClassMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/labor-rates/employee-classifications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/employee-classifications"] });
      toast({ title: "Success", description: "Assignment deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete assignment", variant: "destructive" });
    },
  });

  const pwRateMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingPWRate) {
        return await apiRequest("PATCH", `/api/labor-rates/prevailing-wage-rates/${editingPWRate.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/prevailing-wage-rates", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/prevailing-wage-rates"] });
      toast({ title: "Success", description: editingPWRate ? "Rate updated" : "Rate created" });
      resetPWRateDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save rate", variant: "destructive" });
    },
  });

  const deletePWRateMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/labor-rates/prevailing-wage-rates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/prevailing-wage-rates"] });
      toast({ title: "Success", description: "Rate deleted" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete rate", variant: "destructive" });
    },
  });

  const handleEditRate = (user: User) => {
    setSelectedUser(user);
    setEditRegularRate(user.costRateRegular || "50");
    setEditOvertimeRate(user.costRateOvertime || "75");
    setShowEditRateDialog(true);
  };

  const handleSaveRate = () => {
    if (!selectedUser) return;
    const regularRate = parseFloat(editRegularRate);
    const overtimeRate = parseFloat(editOvertimeRate);
    if (isNaN(regularRate) || isNaN(overtimeRate) || regularRate < 0 || overtimeRate < 0) {
      toast({ title: "Invalid Input", description: "Rates must be valid non-negative numbers", variant: "destructive" });
      return;
    }
    updateRatesMutation.mutate({
      userId: selectedUser.id,
      costRateRegular: regularRate.toFixed(2),
      costRateOvertime: overtimeRate.toFixed(2),
    });
  };

  const resetClassificationDialog = () => {
    setShowClassificationDialog(false);
    setEditingClassification(null);
    setClassificationName("");
    setClassificationCode("");
    setClassificationDescription("");
    setClassificationDefaultRegRate("");
    setClassificationDefaultOTRate("");
    setClassificationIsActive(true);
  };

  const openClassificationDialog = (classification?: JobClassification) => {
    if (classification) {
      setEditingClassification(classification);
      setClassificationName(classification.name);
      setClassificationCode(classification.code || "");
      setClassificationDescription(classification.description || "");
      setClassificationDefaultRegRate(classification.defaultRegularRate || "");
      setClassificationDefaultOTRate(classification.defaultOvertimeRate || "");
      setClassificationIsActive(classification.isActive);
    } else {
      resetClassificationDialog();
    }
    setShowClassificationDialog(true);
  };

  const handleSaveClassification = () => {
    if (!classificationName.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    classificationMutation.mutate({
      name: classificationName.trim(),
      code: classificationCode.trim() || null,
      description: classificationDescription.trim() || null,
      defaultRegularRate: classificationDefaultRegRate || null,
      defaultOvertimeRate: classificationDefaultOTRate || null,
      isActive: classificationIsActive,
    });
  };

  const resetEmployeeClassDialog = () => {
    setShowEmployeeClassDialog(false);
    setEditingEmployeeClass(null);
    setEmpClassUserId("");
    setEmpClassClassificationId("");
    setEmpClassRegularRate("");
    setEmpClassOvertimeRate("");
    setEmpClassIsPrimary(false);
    setEmpClassEffectiveDate("");
    setEmpClassEndDate("");
    setEmpClassNotes("");
  };

  const openEmployeeClassDialog = (assignment?: EmployeeClassification) => {
    if (assignment) {
      setEditingEmployeeClass(assignment);
      setEmpClassUserId(assignment.userId);
      setEmpClassClassificationId(assignment.classificationId);
      setEmpClassRegularRate(assignment.regularRate);
      setEmpClassOvertimeRate(assignment.overtimeRate);
      setEmpClassIsPrimary(assignment.isPrimary);
      setEmpClassEffectiveDate(assignment.effectiveDate);
      setEmpClassEndDate(assignment.endDate || "");
      setEmpClassNotes(assignment.notes || "");
    } else {
      resetEmployeeClassDialog();
      setEmpClassEffectiveDate(new Date().toISOString().split('T')[0]);
    }
    setShowEmployeeClassDialog(true);
  };

  const handleSaveEmployeeClass = () => {
    if (!empClassUserId || !empClassClassificationId || !empClassRegularRate || !empClassOvertimeRate || !empClassEffectiveDate) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }
    employeeClassMutation.mutate({
      userId: empClassUserId,
      classificationId: empClassClassificationId,
      regularRate: empClassRegularRate,
      overtimeRate: empClassOvertimeRate,
      isPrimary: empClassIsPrimary,
      effectiveDate: empClassEffectiveDate,
      endDate: empClassEndDate || null,
      notes: empClassNotes.trim() || null,
    });
  };

  const resetPWRateDialog = () => {
    setShowPWRateDialog(false);
    setEditingPWRate(null);
    setPwProjectId("");
    setPwClassificationId("");
    setPwWageRate("");
    setPwFringeRate("");
    setPwOvertimeMultiplier("1.5");
    setPwEffectiveDate("");
    setPwExpirationDate("");
    setPwWageDecision("");
    setPwNotes("");
  };

  const openPWRateDialog = (rate?: PrevailingWageRate) => {
    if (rate) {
      setEditingPWRate(rate);
      setPwProjectId(rate.projectId);
      setPwClassificationId(rate.classificationId);
      setPwWageRate(rate.wageRate);
      setPwFringeRate(rate.fringeRate);
      setPwOvertimeMultiplier(rate.overtimeMultiplier);
      setPwEffectiveDate(rate.effectiveDate);
      setPwExpirationDate(rate.expirationDate || "");
      setPwWageDecision(rate.wageDecision || "");
      setPwNotes(rate.notes || "");
    } else {
      resetPWRateDialog();
      setPwEffectiveDate(new Date().toISOString().split('T')[0]);
    }
    setShowPWRateDialog(true);
  };

  const handleSavePWRate = () => {
    if (!pwProjectId || !pwClassificationId || !pwWageRate || !pwEffectiveDate) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }
    pwRateMutation.mutate({
      projectId: pwProjectId,
      classificationId: pwClassificationId,
      wageRate: pwWageRate,
      fringeRate: pwFringeRate || "0",
      overtimeMultiplier: pwOvertimeMultiplier || "1.5",
      effectiveDate: pwEffectiveDate,
      expirationDate: pwExpirationDate || null,
      wageDecision: pwWageDecision.trim() || null,
      notes: pwNotes.trim() || null,
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "classification") {
      deleteClassificationMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "employee-class") {
      deleteEmployeeClassMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "pw-rate") {
      deletePWRateMutation.mutate(deleteTarget.id);
    }
  };

  const confirmDelete = (type: string, id: string, name: string) => {
    setDeleteTarget({ type, id, name });
    setShowDeleteConfirm(true);
  };

  const canEdit = user?.role === "ADMIN" || user?.role === "MANAGER";

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">Labor Cost Rate Management</h1>
          <p className="text-muted-foreground">
            Manage employee base rates, job classifications, and prevailing wage rates for projects
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="employee-rates" className="flex items-center gap-2" data-testid="tab-employee-rates">
              <Users className="w-4 h-4" />
              Employee Rates
            </TabsTrigger>
            <TabsTrigger value="classifications" className="flex items-center gap-2" data-testid="tab-classifications">
              <Briefcase className="w-4 h-4" />
              Job Classifications
            </TabsTrigger>
            <TabsTrigger value="employee-classifications" className="flex items-center gap-2" data-testid="tab-employee-classifications">
              <Users className="w-4 h-4" />
              Employee Assignments
            </TabsTrigger>
            <TabsTrigger value="prevailing-wage" className="flex items-center gap-2" data-testid="tab-prevailing-wage">
              <Building2 className="w-4 h-4" />
              Prevailing Wage
            </TabsTrigger>
          </TabsList>

          <TabsContent value="employee-rates">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Base Employee Rates
                </CardTitle>
                <CardDescription>
                  Default hourly rates for each employee. These are used when no classification or project-specific rate applies.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="text-right">Regular Rate ($/hr)</TableHead>
                        <TableHead className="text-right">Overtime Rate ($/hr)</TableHead>
                        {canEdit && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.id} data-testid={`row-employee-${u.id}`}>
                          <TableCell className="font-medium">{u.firstName} {u.lastName}</TableCell>
                          <TableCell>{u.email}</TableCell>
                          <TableCell><Badge variant="secondary">{u.role}</Badge></TableCell>
                          <TableCell className="text-right font-mono">
                            {u.costRateRegular ? `$${parseFloat(u.costRateRegular).toFixed(2)}` : <span className="text-muted-foreground">Not set</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {u.costRateOvertime ? `$${parseFloat(u.costRateOvertime).toFixed(2)}` : <span className="text-muted-foreground">Not set</span>}
                          </TableCell>
                          {canEdit && (
                            <TableCell className="text-right">
                              <Button size="sm" variant="outline" onClick={() => handleEditRate(u)} data-testid={`button-edit-rate-${u.id}`}>
                                <Edit className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="classifications">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Briefcase className="w-5 h-5" />
                    Job Classifications
                  </CardTitle>
                  <CardDescription>
                    Define labor classifications with default rates. Assign employees to classifications for standardized rate management.
                  </CardDescription>
                </div>
                {canEdit && (
                  <Button onClick={() => openClassificationDialog()} data-testid="button-add-classification">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Classification
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {classificationsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : classifications.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No job classifications defined yet.</p>
                    <p className="text-sm mt-1">Create classifications to standardize labor rates across your organization.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Default Regular</TableHead>
                        <TableHead className="text-right">Default OT</TableHead>
                        <TableHead>Status</TableHead>
                        {canEdit && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {classifications.map((c) => (
                        <TableRow key={c.id} data-testid={`row-classification-${c.id}`}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="font-mono text-sm">{c.code || "-"}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{c.description || "-"}</TableCell>
                          <TableCell className="text-right font-mono">
                            {c.defaultRegularRate ? `$${parseFloat(c.defaultRegularRate).toFixed(2)}` : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {c.defaultOvertimeRate ? `$${parseFloat(c.defaultOvertimeRate).toFixed(2)}` : "-"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={c.isActive ? "default" : "secondary"}>
                              {c.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          {canEdit && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => openClassificationDialog(c)} data-testid={`button-edit-class-${c.id}`}>
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => confirmDelete("classification", c.id, c.name)} data-testid={`button-delete-class-${c.id}`}>
                                  <Trash2 className="w-4 h-4" />
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
          </TabsContent>

          <TabsContent value="employee-classifications">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Employee Classification Assignments
                  </CardTitle>
                  <CardDescription>
                    Assign employees to job classifications with specific rates. Primary classification is used by default.
                  </CardDescription>
                </div>
                {canEdit && (
                  <Button onClick={() => openEmployeeClassDialog()} data-testid="button-add-emp-class">
                    <Plus className="w-4 h-4 mr-2" />
                    Assign Employee
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {empClassLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : employeeClassifications.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No employee assignments yet.</p>
                    <p className="text-sm mt-1">Assign employees to job classifications to track rates by trade.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Classification</TableHead>
                        <TableHead className="text-right">Regular Rate</TableHead>
                        <TableHead className="text-right">OT Rate</TableHead>
                        <TableHead>Primary</TableHead>
                        <TableHead>Effective Date</TableHead>
                        {canEdit && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employeeClassifications.map((ec) => (
                        <TableRow key={ec.id} data-testid={`row-emp-class-${ec.id}`}>
                          <TableCell className="font-medium">
                            {ec.user ? `${ec.user.firstName} ${ec.user.lastName}` : "Unknown"}
                          </TableCell>
                          <TableCell>{ec.classification?.name || "Unknown"}</TableCell>
                          <TableCell className="text-right font-mono">${parseFloat(ec.regularRate).toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono">${parseFloat(ec.overtimeRate).toFixed(2)}</TableCell>
                          <TableCell>
                            {ec.isPrimary && <Badge>Primary</Badge>}
                          </TableCell>
                          <TableCell>{ec.effectiveDate}</TableCell>
                          {canEdit && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => openEmployeeClassDialog(ec)} data-testid={`button-edit-emp-class-${ec.id}`}>
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => confirmDelete("employee-class", ec.id, `${ec.user?.firstName || ""} ${ec.user?.lastName || ""} - ${ec.classification?.name || ""}`)} data-testid={`button-delete-emp-class-${ec.id}`}>
                                  <Trash2 className="w-4 h-4" />
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
          </TabsContent>

          <TabsContent value="prevailing-wage">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="w-5 h-5" />
                    Project Prevailing Wage Rates
                  </CardTitle>
                  <CardDescription>
                    Define prevailing wage rates for specific projects. These override employee base rates and classification rates.
                  </CardDescription>
                </div>
                {canEdit && (
                  <Button onClick={() => openPWRateDialog()} data-testid="button-add-pw-rate">
                    <Plus className="w-4 h-4 mr-2" />
                    Add PW Rate
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {pwRatesLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : prevailingWageRates.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No prevailing wage rates defined yet.</p>
                    <p className="text-sm mt-1">Add rates for public works or government projects that require prevailing wages.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Classification</TableHead>
                        <TableHead className="text-right">Wage Rate</TableHead>
                        <TableHead className="text-right">Fringe</TableHead>
                        <TableHead className="text-right">Total Rate</TableHead>
                        <TableHead className="text-right">OT Mult</TableHead>
                        <TableHead>Effective</TableHead>
                        {canEdit && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {prevailingWageRates.map((pw) => (
                        <TableRow key={pw.id} data-testid={`row-pw-rate-${pw.id}`}>
                          <TableCell className="font-medium">{pw.project?.name || "Unknown"}</TableCell>
                          <TableCell>{pw.classification?.name || "Unknown"}</TableCell>
                          <TableCell className="text-right font-mono">${parseFloat(pw.wageRate).toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono">${parseFloat(pw.fringeRate).toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono font-semibold">${parseFloat(pw.totalRate).toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono">{pw.overtimeMultiplier}x</TableCell>
                          <TableCell>{pw.effectiveDate}</TableCell>
                          {canEdit && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => openPWRateDialog(pw)} data-testid={`button-edit-pw-${pw.id}`}>
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => confirmDelete("pw-rate", pw.id, `${pw.project?.name || ""} - ${pw.classification?.name || ""}`)} data-testid={`button-delete-pw-${pw.id}`}>
                                  <Trash2 className="w-4 h-4" />
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
          </TabsContent>
        </Tabs>

        <Dialog open={showEditRateDialog} onOpenChange={setShowEditRateDialog}>
          <DialogContent data-testid="dialog-edit-base-rate">
            <DialogHeader>
              <DialogTitle>Edit Base Rates</DialogTitle>
              <DialogDescription>
                {selectedUser && `Update base cost rates for ${selectedUser.firstName} ${selectedUser.lastName}`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="regular-rate">Regular Hourly Rate ($)</Label>
                <Input id="regular-rate" type="number" step="0.01" value={editRegularRate} onChange={(e) => setEditRegularRate(e.target.value)} data-testid="input-base-regular-rate" />
              </div>
              <div>
                <Label htmlFor="overtime-rate">Overtime Hourly Rate ($)</Label>
                <Input id="overtime-rate" type="number" step="0.01" value={editOvertimeRate} onChange={(e) => setEditOvertimeRate(e.target.value)} data-testid="input-base-overtime-rate" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditRateDialog(false)}>Cancel</Button>
              <Button onClick={handleSaveRate} disabled={updateRatesMutation.isPending} data-testid="button-save-base-rate">Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showClassificationDialog} onOpenChange={(open) => !open && resetClassificationDialog()}>
          <DialogContent data-testid="dialog-classification">
            <DialogHeader>
              <DialogTitle>{editingClassification ? "Edit Classification" : "Add Classification"}</DialogTitle>
              <DialogDescription>
                {editingClassification ? "Update job classification details" : "Create a new job classification for your organization"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="class-name">Name *</Label>
                  <Input id="class-name" value={classificationName} onChange={(e) => setClassificationName(e.target.value)} placeholder="e.g., Electrician" data-testid="input-class-name" />
                </div>
                <div>
                  <Label htmlFor="class-code">Code</Label>
                  <Input id="class-code" value={classificationCode} onChange={(e) => setClassificationCode(e.target.value)} placeholder="e.g., ELEC" data-testid="input-class-code" />
                </div>
              </div>
              <div>
                <Label htmlFor="class-description">Description</Label>
                <Textarea id="class-description" value={classificationDescription} onChange={(e) => setClassificationDescription(e.target.value)} placeholder="Optional description..." data-testid="input-class-description" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="class-reg-rate">Default Regular Rate ($)</Label>
                  <Input id="class-reg-rate" type="number" step="0.01" value={classificationDefaultRegRate} onChange={(e) => setClassificationDefaultRegRate(e.target.value)} placeholder="50.00" data-testid="input-class-reg-rate" />
                </div>
                <div>
                  <Label htmlFor="class-ot-rate">Default OT Rate ($)</Label>
                  <Input id="class-ot-rate" type="number" step="0.01" value={classificationDefaultOTRate} onChange={(e) => setClassificationDefaultOTRate(e.target.value)} placeholder="75.00" data-testid="input-class-ot-rate" />
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="class-active" checked={classificationIsActive} onCheckedChange={(checked) => setClassificationIsActive(checked === true)} data-testid="checkbox-class-active" />
                <Label htmlFor="class-active">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetClassificationDialog}>Cancel</Button>
              <Button onClick={handleSaveClassification} disabled={classificationMutation.isPending} data-testid="button-save-classification">
                {editingClassification ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showEmployeeClassDialog} onOpenChange={(open) => !open && resetEmployeeClassDialog()}>
          <DialogContent data-testid="dialog-emp-class">
            <DialogHeader>
              <DialogTitle>{editingEmployeeClass ? "Edit Assignment" : "Assign Employee to Classification"}</DialogTitle>
              <DialogDescription>
                {editingEmployeeClass ? "Update employee classification assignment" : "Assign an employee to a job classification with specific rates"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Employee *</Label>
                  <Select value={empClassUserId} onValueChange={setEmpClassUserId} disabled={!!editingEmployeeClass}>
                    <SelectTrigger data-testid="select-emp-class-user">
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName} - {u.role}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Classification *</Label>
                  <Select value={empClassClassificationId} onValueChange={(val) => {
                    setEmpClassClassificationId(val);
                    const cls = classifications.find(c => c.id === val);
                    if (cls && !editingEmployeeClass) {
                      setEmpClassRegularRate(cls.defaultRegularRate || "");
                      setEmpClassOvertimeRate(cls.defaultOvertimeRate || "");
                    }
                  }} disabled={!!editingEmployeeClass}>
                    <SelectTrigger data-testid="select-emp-class-classification">
                      <SelectValue placeholder="Select classification" />
                    </SelectTrigger>
                    <SelectContent>
                      {classifications.filter(c => c.isActive).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="emp-reg-rate">Regular Rate ($/hr) *</Label>
                  <Input id="emp-reg-rate" type="number" step="0.01" value={empClassRegularRate} onChange={(e) => setEmpClassRegularRate(e.target.value)} data-testid="input-emp-class-reg-rate" />
                </div>
                <div>
                  <Label htmlFor="emp-ot-rate">Overtime Rate ($/hr) *</Label>
                  <Input id="emp-ot-rate" type="number" step="0.01" value={empClassOvertimeRate} onChange={(e) => setEmpClassOvertimeRate(e.target.value)} data-testid="input-emp-class-ot-rate" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="emp-eff-date">Effective Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !empClassEffectiveDate && "text-muted-foreground"
                        )}
                        data-testid="input-emp-class-eff-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {empClassEffectiveDate ? format(parseISO(empClassEffectiveDate), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={empClassEffectiveDate ? parseISO(empClassEffectiveDate) : undefined}
                        onSelect={(date) => setEmpClassEffectiveDate(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emp-end-date">End Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !empClassEndDate && "text-muted-foreground"
                        )}
                        data-testid="input-emp-class-end-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {empClassEndDate ? format(parseISO(empClassEndDate), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={empClassEndDate ? parseISO(empClassEndDate) : undefined}
                        onSelect={(date) => setEmpClassEndDate(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="emp-primary" checked={empClassIsPrimary} onCheckedChange={(checked) => setEmpClassIsPrimary(checked === true)} data-testid="checkbox-emp-class-primary" />
                <Label htmlFor="emp-primary">Primary Classification</Label>
              </div>
              <div>
                <Label htmlFor="emp-notes">Notes</Label>
                <Textarea id="emp-notes" value={empClassNotes} onChange={(e) => setEmpClassNotes(e.target.value)} placeholder="Optional notes..." data-testid="input-emp-class-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetEmployeeClassDialog}>Cancel</Button>
              <Button onClick={handleSaveEmployeeClass} disabled={employeeClassMutation.isPending} data-testid="button-save-emp-class">
                {editingEmployeeClass ? "Update" : "Assign"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showPWRateDialog} onOpenChange={(open) => !open && resetPWRateDialog()}>
          <DialogContent className="max-w-lg" data-testid="dialog-pw-rate">
            <DialogHeader>
              <DialogTitle>{editingPWRate ? "Edit Prevailing Wage Rate" : "Add Prevailing Wage Rate"}</DialogTitle>
              <DialogDescription>
                {editingPWRate ? "Update prevailing wage rate for project" : "Add a prevailing wage rate for a project classification"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Project *</Label>
                  <Select value={pwProjectId} onValueChange={setPwProjectId} disabled={!!editingPWRate}>
                    <SelectTrigger data-testid="select-pw-project">
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Classification *</Label>
                  <Select value={pwClassificationId} onValueChange={setPwClassificationId} disabled={!!editingPWRate}>
                    <SelectTrigger data-testid="select-pw-classification">
                      <SelectValue placeholder="Select classification" />
                    </SelectTrigger>
                    <SelectContent>
                      {classifications.filter(c => c.isActive).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="pw-wage-rate">Wage Rate ($/hr) *</Label>
                  <Input id="pw-wage-rate" type="number" step="0.01" value={pwWageRate} onChange={(e) => setPwWageRate(e.target.value)} data-testid="input-pw-wage-rate" />
                </div>
                <div>
                  <Label htmlFor="pw-fringe-rate">Fringe Rate ($/hr)</Label>
                  <Input id="pw-fringe-rate" type="number" step="0.01" value={pwFringeRate} onChange={(e) => setPwFringeRate(e.target.value)} placeholder="0.00" data-testid="input-pw-fringe-rate" />
                </div>
                <div>
                  <Label htmlFor="pw-ot-mult">OT Multiplier</Label>
                  <Input id="pw-ot-mult" type="number" step="0.01" value={pwOvertimeMultiplier} onChange={(e) => setPwOvertimeMultiplier(e.target.value)} data-testid="input-pw-ot-mult" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pw-eff-date">Effective Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !pwEffectiveDate && "text-muted-foreground"
                        )}
                        data-testid="input-pw-eff-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {pwEffectiveDate ? format(parseISO(pwEffectiveDate), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={pwEffectiveDate ? parseISO(pwEffectiveDate) : undefined}
                        onSelect={(date) => setPwEffectiveDate(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pw-exp-date">Expiration Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !pwExpirationDate && "text-muted-foreground"
                        )}
                        data-testid="input-pw-exp-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {pwExpirationDate ? format(parseISO(pwExpirationDate), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={pwExpirationDate ? parseISO(pwExpirationDate) : undefined}
                        onSelect={(date) => setPwExpirationDate(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div>
                <Label htmlFor="pw-decision">Wage Decision Number</Label>
                <Input id="pw-decision" value={pwWageDecision} onChange={(e) => setPwWageDecision(e.target.value)} placeholder="e.g., CA20230001" data-testid="input-pw-decision" />
              </div>
              <div>
                <Label htmlFor="pw-notes">Notes</Label>
                <Textarea id="pw-notes" value={pwNotes} onChange={(e) => setPwNotes(e.target.value)} placeholder="Optional notes..." data-testid="input-pw-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetPWRateDialog}>Cancel</Button>
              <Button onClick={handleSavePWRate} disabled={pwRateMutation.isPending} data-testid="button-save-pw-rate">
                {editingPWRate ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent data-testid="dialog-delete-confirm">
            <DialogHeader>
              <DialogTitle>Confirm Delete</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <Button 
                variant="destructive" 
                onClick={handleDelete} 
                disabled={deleteClassificationMutation.isPending || deleteEmployeeClassMutation.isPending || deletePWRateMutation.isPending}
                data-testid="button-confirm-delete"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
