import { useState, Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Pencil, Trash2, Shield, Users, ChevronDown, ChevronRight } from "lucide-react";

interface DeductionType {
  id: string;
  organizationId: string;
  name: string;
  category: string;
  calculationMethod: string;
  rate: string | null;
  amount: string | null;
  maxAnnualAmount: string | null;
  isPreTax: boolean;
  isActive: boolean;
  sortOrder: number;
}

interface EmployeeDeductionRow {
  deduction: {
    id: string;
    organizationId: string;
    userId: string;
    deductionTypeId: string;
    overrideAmount: string | null;
    effectiveDate: string;
    endDate: string | null;
    isActive: boolean;
  };
  userName: string;
  deductionTypeName: string;
  deductionTypeCategory: string;
  calculationMethod: string;
  typeRate: string | null;
  typeAmount: string | null;
}

interface PayrollWorker {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  FEDERAL_TAX: "Federal Tax",
  STATE_TAX: "State Tax",
  LOCAL_TAX: "Local Tax",
  FICA: "FICA (Social Security)",
  MEDICARE: "Medicare",
  UNION_DUES: "Union Dues",
  HEALTH_INSURANCE: "Health Insurance",
  DENTAL_INSURANCE: "Dental Insurance",
  VISION_INSURANCE: "Vision Insurance",
  RETIREMENT_401K: "401(k) Retirement",
  GARNISHMENT: "Garnishment",
  CHILD_SUPPORT: "Child Support",
  OTHER: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  FEDERAL_TAX: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  STATE_TAX: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  LOCAL_TAX: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  FICA: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  MEDICARE: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300",
  UNION_DUES: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  HEALTH_INSURANCE: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  DENTAL_INSURANCE: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300",
  VISION_INSURANCE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  RETIREMENT_401K: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
  GARNISHMENT: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300",
  CHILD_SUPPORT: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300",
  OTHER: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
};

const METHOD_LABELS: Record<string, string> = {
  PERCENTAGE: "Percentage",
  FIXED_AMOUNT: "Fixed Amount",
  TIERED: "Tiered",
};

export default function DeductionsTab() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [empDedDialogOpen, setEmpDedDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<DeductionType | null>(null);
  const [editingEmpDed, setEditingEmpDed] = useState<EmployeeDeductionRow | null>(null);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);

  const [typeForm, setTypeForm] = useState({
    name: "",
    category: "OTHER",
    calculationMethod: "FIXED_AMOUNT",
    rate: "",
    amount: "",
    maxAnnualAmount: "",
    isPreTax: false,
    isActive: true,
    sortOrder: 0,
  });

  const [empDedForm, setEmpDedForm] = useState({
    userId: "",
    deductionTypeId: "",
    overrideAmount: "",
    effectiveDate: new Date().toISOString().split("T")[0],
    endDate: "",
    isActive: true,
  });

  const { data: deductionTypes, isLoading: typesLoading } = useQuery<DeductionType[]>({
    queryKey: ["/api/payroll/deduction-types"],
  });

  const { data: employeeDeductionsList, isLoading: empDedsLoading } = useQuery<EmployeeDeductionRow[]>({
    queryKey: ["/api/payroll/employee-deductions"],
  });

  const { data: workers } = useQuery<PayrollWorker[]>({
    queryKey: ["/api/payroll/workers"],
  });

  const createTypeMutation = useMutation({
    mutationFn: async (data: any) => await apiRequest("POST", "/api/payroll/deduction-types", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/deduction-types"] });
      setTypeDialogOpen(false);
      toast({ title: "Deduction type created" });
    },
    onError: (error: any) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const updateTypeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => await apiRequest("PATCH", `/api/payroll/deduction-types/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/deduction-types"] });
      setTypeDialogOpen(false);
      setEditingType(null);
      toast({ title: "Deduction type updated" });
    },
    onError: (error: any) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const deleteTypeMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("DELETE", `/api/payroll/deduction-types/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/deduction-types"] });
      toast({ title: "Deduction type deleted" });
    },
    onError: (error: any) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const createEmpDedMutation = useMutation({
    mutationFn: async (data: any) => await apiRequest("POST", "/api/payroll/employee-deductions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employee-deductions"] });
      setEmpDedDialogOpen(false);
      toast({ title: "Employee deduction assigned" });
    },
    onError: (error: any) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const updateEmpDedMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => await apiRequest("PATCH", `/api/payroll/employee-deductions/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employee-deductions"] });
      setEmpDedDialogOpen(false);
      setEditingEmpDed(null);
      toast({ title: "Employee deduction updated" });
    },
    onError: (error: any) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const deleteEmpDedMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("DELETE", `/api/payroll/employee-deductions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employee-deductions"] });
      toast({ title: "Employee deduction removed" });
    },
    onError: (error: any) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const openCreateType = () => {
    setEditingType(null);
    setTypeForm({ name: "", category: "OTHER", calculationMethod: "FIXED_AMOUNT", rate: "", amount: "", maxAnnualAmount: "", isPreTax: false, isActive: true, sortOrder: 0 });
    setTypeDialogOpen(true);
  };

  const openEditType = (t: DeductionType) => {
    setEditingType(t);
    setTypeForm({
      name: t.name,
      category: t.category,
      calculationMethod: t.calculationMethod,
      rate: t.rate || "",
      amount: t.amount || "",
      maxAnnualAmount: t.maxAnnualAmount || "",
      isPreTax: t.isPreTax,
      isActive: t.isActive,
      sortOrder: t.sortOrder,
    });
    setTypeDialogOpen(true);
  };

  const submitType = () => {
    const payload: any = {
      name: typeForm.name,
      category: typeForm.category,
      calculationMethod: typeForm.calculationMethod,
      isPreTax: typeForm.isPreTax,
      isActive: typeForm.isActive,
      sortOrder: typeForm.sortOrder,
    };
    if (typeForm.calculationMethod === "PERCENTAGE" && typeForm.rate) payload.rate = typeForm.rate;
    if (typeForm.calculationMethod !== "PERCENTAGE" && typeForm.amount) payload.amount = typeForm.amount;
    if (typeForm.maxAnnualAmount) payload.maxAnnualAmount = typeForm.maxAnnualAmount;

    if (editingType) {
      updateTypeMutation.mutate({ id: editingType.id, data: payload });
    } else {
      createTypeMutation.mutate(payload);
    }
  };

  const openCreateEmpDed = () => {
    setEditingEmpDed(null);
    setEmpDedForm({ userId: "", deductionTypeId: "", overrideAmount: "", effectiveDate: new Date().toISOString().split("T")[0], endDate: "", isActive: true });
    setEmpDedDialogOpen(true);
  };

  const openEditEmpDed = (ed: EmployeeDeductionRow) => {
    setEditingEmpDed(ed);
    setEmpDedForm({
      userId: ed.deduction.userId,
      deductionTypeId: ed.deduction.deductionTypeId,
      overrideAmount: ed.deduction.overrideAmount || "",
      effectiveDate: ed.deduction.effectiveDate,
      endDate: ed.deduction.endDate || "",
      isActive: ed.deduction.isActive,
    });
    setEmpDedDialogOpen(true);
  };

  const submitEmpDed = () => {
    const payload: any = {
      userId: empDedForm.userId,
      deductionTypeId: empDedForm.deductionTypeId,
      effectiveDate: empDedForm.effectiveDate,
      isActive: empDedForm.isActive,
    };
    if (empDedForm.overrideAmount) payload.overrideAmount = empDedForm.overrideAmount;
    if (empDedForm.endDate) payload.endDate = empDedForm.endDate;

    if (editingEmpDed) {
      updateEmpDedMutation.mutate({ id: editingEmpDed.deduction.id, data: payload });
    } else {
      createEmpDedMutation.mutate(payload);
    }
  };

  const formatAmount = (type: DeductionType) => {
    if (type.calculationMethod === "PERCENTAGE" && type.rate) return `${type.rate}%`;
    if (type.amount) return `$${parseFloat(type.amount).toFixed(2)}`;
    return "—";
  };

  const employeeGroups = (employeeDeductionsList || []).reduce((acc, ed) => {
    const key = ed.deduction.userId;
    if (!acc[key]) acc[key] = { name: ed.userName, deductions: [] };
    acc[key].deductions.push(ed);
    return acc;
  }, {} as Record<string, { name: string; deductions: EmployeeDeductionRow[] }>);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-lg">Deduction Types</CardTitle>
            </div>
            <Button size="sm" onClick={openCreateType} data-testid="button-add-deduction-type">
              <Plus className="w-4 h-4 mr-1" />
              Add Type
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {typesLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !deductionTypes?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>No deduction types configured</p>
              <p className="text-sm">Add deduction types like Federal Tax, FICA, Health Insurance, etc.</p>
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              {deductionTypes.map(dt => (
                <Card key={dt.id} data-testid={`card-deduction-type-${dt.id}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{dt.name}</span>
                      <Badge className={CATEGORY_COLORS[dt.category]}>{CATEGORY_LABELS[dt.category]}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Method</p>
                        <p>{METHOD_LABELS[dt.calculationMethod]}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Rate/Amount</p>
                        <p className="font-medium">{formatAmount(dt)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Pre-Tax</p>
                        <p>{dt.isPreTax ? "Yes" : "No"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Active</p>
                        <p>{dt.isActive ? "Yes" : "No"}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditType(dt)} data-testid={`button-edit-type-${dt.id}`}>
                        <Pencil className="w-3 h-3 mr-1" /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="text-red-500" onClick={() => { if (confirm("Delete this deduction type?")) deleteTypeMutation.mutate(dt.id); }} data-testid={`button-delete-type-${dt.id}`}>
                        <Trash2 className="w-3 h-3 mr-1" /> Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Rate/Amount</TableHead>
                    <TableHead>Max Annual</TableHead>
                    <TableHead>Pre-Tax</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deductionTypes.map(dt => (
                    <TableRow key={dt.id} data-testid={`row-deduction-type-${dt.id}`}>
                      <TableCell className="font-medium">{dt.name}</TableCell>
                      <TableCell><Badge className={CATEGORY_COLORS[dt.category]}>{CATEGORY_LABELS[dt.category]}</Badge></TableCell>
                      <TableCell>{METHOD_LABELS[dt.calculationMethod]}</TableCell>
                      <TableCell className="font-medium">{formatAmount(dt)}</TableCell>
                      <TableCell>{dt.maxAnnualAmount ? `$${parseFloat(dt.maxAnnualAmount).toLocaleString()}` : "—"}</TableCell>
                      <TableCell>{dt.isPreTax ? <Badge variant="outline" className="text-xs">Pre-Tax</Badge> : "Post-Tax"}</TableCell>
                      <TableCell>{dt.isActive ? <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditType(dt)} data-testid={`button-edit-type-${dt.id}`}><Pencil className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700" onClick={() => { if (confirm("Delete this deduction type?")) deleteTypeMutation.mutate(dt.id); }} data-testid={`button-delete-type-${dt.id}`}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-lg">Employee Deductions</CardTitle>
            </div>
            <Button size="sm" onClick={openCreateEmpDed} disabled={!deductionTypes?.length} data-testid="button-assign-deduction">
              <Plus className="w-4 h-4 mr-1" />
              Assign Deduction
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {empDedsLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : Object.keys(employeeGroups).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>No employee deductions assigned</p>
              <p className="text-sm">Assign deduction types to employees to calculate payroll deductions</p>
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(employeeGroups).map(([userId, group]) => (
                <div key={userId} className="border rounded-md" data-testid={`group-employee-${userId}`}>
                  <button
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                    onClick={() => setExpandedEmployee(expandedEmployee === userId ? null : userId)}
                    data-testid={`button-expand-employee-${userId}`}
                  >
                    <div className="flex items-center gap-2">
                      {expandedEmployee === userId ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      <span className="font-medium">{group.name}</span>
                      <Badge variant="outline" className="text-xs">{group.deductions.length} deduction{group.deductions.length !== 1 ? "s" : ""}</Badge>
                    </div>
                  </button>
                  {expandedEmployee === userId && (
                    <div className="border-t px-3 pb-3">
                      {isMobile ? (
                        <div className="space-y-2 pt-2">
                          {group.deductions.map(ed => (
                            <div key={ed.deduction.id} className="bg-muted/30 rounded-md p-3 space-y-1" data-testid={`card-emp-ded-${ed.deduction.id}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-sm">{ed.deductionTypeName}</span>
                                <Badge className={CATEGORY_COLORS[ed.deductionTypeCategory]} >{CATEGORY_LABELS[ed.deductionTypeCategory]}</Badge>
                              </div>
                              <div className="grid grid-cols-2 gap-1 text-xs">
                                <div><span className="text-muted-foreground">Override:</span> {ed.deduction.overrideAmount ? `$${parseFloat(ed.deduction.overrideAmount).toFixed(2)}` : "Default"}</div>
                                <div><span className="text-muted-foreground">Effective:</span> {ed.deduction.effectiveDate}</div>
                              </div>
                              <div className="flex gap-2 pt-1">
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEditEmpDed(ed)} data-testid={`button-edit-emp-ded-${ed.deduction.id}`}>Edit</Button>
                                <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500" onClick={() => { if (confirm("Remove this deduction?")) deleteEmpDedMutation.mutate(ed.deduction.id); }} data-testid={`button-delete-emp-ded-${ed.deduction.id}`}>Remove</Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Deduction</TableHead>
                              <TableHead>Category</TableHead>
                              <TableHead>Override</TableHead>
                              <TableHead>Effective</TableHead>
                              <TableHead>End Date</TableHead>
                              <TableHead>Active</TableHead>
                              <TableHead>Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.deductions.map(ed => (
                              <TableRow key={ed.deduction.id} data-testid={`row-emp-ded-${ed.deduction.id}`}>
                                <TableCell className="font-medium">{ed.deductionTypeName}</TableCell>
                                <TableCell><Badge className={CATEGORY_COLORS[ed.deductionTypeCategory]}>{CATEGORY_LABELS[ed.deductionTypeCategory]}</Badge></TableCell>
                                <TableCell>{ed.deduction.overrideAmount ? `$${parseFloat(ed.deduction.overrideAmount).toFixed(2)}` : "Default"}</TableCell>
                                <TableCell className="text-sm">{ed.deduction.effectiveDate}</TableCell>
                                <TableCell className="text-sm">{ed.deduction.endDate || "—"}</TableCell>
                                <TableCell>{ed.deduction.isActive ? "Yes" : "No"}</TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    <Button variant="ghost" size="icon" onClick={() => openEditEmpDed(ed)} data-testid={`button-edit-emp-ded-${ed.deduction.id}`}><Pencil className="w-4 h-4" /></Button>
                                    <Button variant="ghost" size="icon" className="text-red-500" onClick={() => { if (confirm("Remove?")) deleteEmpDedMutation.mutate(ed.deduction.id); }} data-testid={`button-delete-emp-ded-${ed.deduction.id}`}><Trash2 className="w-4 h-4" /></Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingType ? "Edit Deduction Type" : "Add Deduction Type"}</DialogTitle>
            <DialogDescription>Configure a payroll deduction type for your organization.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={typeForm.name} onChange={e => setTypeForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Federal Income Tax" data-testid="input-type-name" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={typeForm.category} onValueChange={v => setTypeForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger data-testid="select-type-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Calculation Method</Label>
                <Select value={typeForm.calculationMethod} onValueChange={v => setTypeForm(p => ({ ...p, calculationMethod: v }))}>
                  <SelectTrigger data-testid="select-type-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                    <SelectItem value="FIXED_AMOUNT">Fixed Amount</SelectItem>
                    <SelectItem value="TIERED">Tiered</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {typeForm.calculationMethod === "PERCENTAGE" ? (
                <div className="space-y-2">
                  <Label>Rate (%)</Label>
                  <Input type="number" step="0.01" value={typeForm.rate} onChange={e => setTypeForm(p => ({ ...p, rate: e.target.value }))} placeholder="e.g. 6.2" data-testid="input-type-rate" />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Amount ($)</Label>
                  <Input type="number" step="0.01" value={typeForm.amount} onChange={e => setTypeForm(p => ({ ...p, amount: e.target.value }))} placeholder="e.g. 150.00" data-testid="input-type-amount" />
                </div>
              )}
              <div className="space-y-2">
                <Label>Max Annual Amount ($)</Label>
                <Input type="number" step="0.01" value={typeForm.maxAnnualAmount} onChange={e => setTypeForm(p => ({ ...p, maxAnnualAmount: e.target.value }))} placeholder="Optional" data-testid="input-type-max-annual" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <Switch checked={typeForm.isPreTax} onCheckedChange={v => setTypeForm(p => ({ ...p, isPreTax: v }))} data-testid="switch-type-pretax" />
                <Label>Pre-Tax Deduction</Label>
              </div>
              <div className="space-y-2">
                <Label>Sort Order</Label>
                <Input type="number" value={typeForm.sortOrder} onChange={e => setTypeForm(p => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))} data-testid="input-type-sort" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTypeDialogOpen(false)} data-testid="button-cancel-type">Cancel</Button>
            <Button onClick={submitType} disabled={!typeForm.name || createTypeMutation.isPending || updateTypeMutation.isPending} data-testid="button-save-type">
              {editingType ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={empDedDialogOpen} onOpenChange={setEmpDedDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEmpDed ? "Edit Employee Deduction" : "Assign Deduction to Employee"}</DialogTitle>
            <DialogDescription>Set up a deduction for an employee. Optionally override the default amount.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select value={empDedForm.userId} onValueChange={v => setEmpDedForm(p => ({ ...p, userId: v }))}>
                <SelectTrigger data-testid="select-emp-ded-user"><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {workers?.map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Deduction Type</Label>
              <Select value={empDedForm.deductionTypeId} onValueChange={v => setEmpDedForm(p => ({ ...p, deductionTypeId: v }))}>
                <SelectTrigger data-testid="select-emp-ded-type"><SelectValue placeholder="Select deduction type" /></SelectTrigger>
                <SelectContent>
                  {deductionTypes?.filter(dt => dt.isActive).map(dt => (
                    <SelectItem key={dt.id} value={dt.id}>{dt.name} ({CATEGORY_LABELS[dt.category]})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Override Amount (optional)</Label>
              <Input type="number" step="0.01" value={empDedForm.overrideAmount} onChange={e => setEmpDedForm(p => ({ ...p, overrideAmount: e.target.value }))} placeholder="Leave blank to use type default" data-testid="input-emp-ded-override" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Effective Date</Label>
                <Input type="date" value={empDedForm.effectiveDate} onChange={e => setEmpDedForm(p => ({ ...p, effectiveDate: e.target.value }))} data-testid="input-emp-ded-effective" />
              </div>
              <div className="space-y-2">
                <Label>End Date (optional)</Label>
                <Input type="date" value={empDedForm.endDate} onChange={e => setEmpDedForm(p => ({ ...p, endDate: e.target.value }))} data-testid="input-emp-ded-end" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmpDedDialogOpen(false)} data-testid="button-cancel-emp-ded">Cancel</Button>
            <Button onClick={submitEmpDed} disabled={!empDedForm.userId || !empDedForm.deductionTypeId || createEmpDedMutation.isPending || updateEmpDedMutation.isPending} data-testid="button-save-emp-ded">
              {editingEmpDed ? "Update" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
