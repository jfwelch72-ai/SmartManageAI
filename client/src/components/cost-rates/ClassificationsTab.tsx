import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, Plus, Users, Briefcase, AlertCircle } from "lucide-react";
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

export function JobClassificationsContent({
  classifications,
  classificationsLoading,
  canEdit,
  confirmDelete,
}: {
  classifications: JobClassification[];
  classificationsLoading: boolean;
  canEdit: boolean;
  confirmDelete: (type: string, id: string, name: string) => void;
}) {
  const { toast } = useToast();

  const [showClassificationDialog, setShowClassificationDialog] = useState(false);
  const [editingClassification, setEditingClassification] = useState<JobClassification | null>(null);
  const [classificationName, setClassificationName] = useState("");
  const [classificationCode, setClassificationCode] = useState("");
  const [classificationDescription, setClassificationDescription] = useState("");
  const [classificationDefaultRegRate, setClassificationDefaultRegRate] = useState("");
  const [classificationDefaultOTRate, setClassificationDefaultOTRate] = useState("");
  const [classificationIsActive, setClassificationIsActive] = useState(true);

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

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
            <Button onClick={() => openClassificationDialog()} data-testid="button-add-classification" className="w-full sm:w-auto">
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
            <>
              <div className="hidden md:block">
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
              </div>
              <div className="md:hidden space-y-3">
                {classifications.map((c) => (
                  <div key={c.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-classification-${c.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        {c.code && <p className="text-xs font-mono text-muted-foreground">{c.code}</p>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={c.isActive ? "default" : "secondary"} className="text-xs">
                          {c.isActive ? "Active" : "Inactive"}
                        </Badge>
                        {canEdit && (
                          <>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openClassificationDialog(c)} data-testid={`button-edit-class-m-${c.id}`}>
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("classification", c.id, c.name)} data-testid={`button-delete-class-m-${c.id}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {c.description && <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p>}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Regular</span>
                        <p className="font-mono font-medium">{c.defaultRegularRate ? `$${parseFloat(c.defaultRegularRate).toFixed(2)}/hr` : "-"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Overtime</span>
                        <p className="font-mono font-medium">{c.defaultOvertimeRate ? `$${parseFloat(c.defaultOvertimeRate).toFixed(2)}/hr` : "-"}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
    </>
  );
}

export function EmployeeAssignmentsContent({
  users,
  classifications,
  employeeClassifications,
  empClassLoading,
  canEdit,
  confirmDelete,
}: {
  users: User[];
  classifications: JobClassification[];
  employeeClassifications: EmployeeClassification[];
  empClassLoading: boolean;
  canEdit: boolean;
  confirmDelete: (type: string, id: string, name: string) => void;
}) {
  const { toast } = useToast();

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

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
            <Button onClick={() => openEmployeeClassDialog()} data-testid="button-add-emp-class" className="w-full sm:w-auto">
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
            <>
              <div className="hidden md:block">
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
              </div>
              <div className="md:hidden space-y-3">
                {employeeClassifications.map((ec) => (
                  <div key={ec.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-emp-class-${ec.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{ec.user ? `${ec.user.firstName} ${ec.user.lastName}` : "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">{ec.classification?.name || "Unknown"}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {ec.isPrimary && <Badge className="text-xs">Primary</Badge>}
                        {canEdit && (
                          <>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openEmployeeClassDialog(ec)} data-testid={`button-edit-emp-class-m-${ec.id}`}>
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("employee-class", ec.id, `${ec.user?.firstName || ""} ${ec.user?.lastName || ""} - ${ec.classification?.name || ""}`)} data-testid={`button-delete-emp-class-m-${ec.id}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Regular</span>
                        <p className="font-mono font-medium">${parseFloat(ec.regularRate).toFixed(2)}/hr</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Overtime</span>
                        <p className="font-mono font-medium">${parseFloat(ec.overtimeRate).toFixed(2)}/hr</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Effective: {ec.effectiveDate}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
    </>
  );
}
