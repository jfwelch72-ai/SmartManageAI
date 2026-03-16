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
import { Edit, Trash2, Plus, Users, DollarSign, Calculator, RefreshCw, AlertCircle } from "lucide-react";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

interface AnnualSalaryCategory {
  id: string;
  organizationId: string;
  name: string;
  baseAnnualSalary: string;
  salaryType: string | null;
  effectiveDate: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BurdenRateConfig {
  id: string;
  organizationId: string;
  name: string;
  burdenPercentage: string;
  fixedBurdenAmount: string | null;
  taxesPercent: string | null;
  benefitsPercent: string | null;
  insurancePercent: string | null;
  overheadPercent: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface EmployeeCostAssignment {
  id: string;
  organizationId: string;
  userId: string;
  salaryCategoryId: string;
  burdenRateId: string | null;
  workingHoursPerYear: number;
  fullyBurdenedCost: string | null;
  derivedHourlyRate: string | null;
  effectiveDate: string;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  userName: string | null;
  userLastName: string | null;
  userEmail: string | null;
  salaryName: string | null;
  baseAnnualSalary: string | null;
  burdenName: string | null;
  burdenPercentage: string | null;
  fixedBurdenAmount: string | null;
}

interface BurdenMultipliersTabProps {
  users: User[];
  salaryCategories: AnnualSalaryCategory[];
  salCatLoading: boolean;
  burdenRatesList: BurdenRateConfig[];
  burdenLoading: boolean;
  costAssignments: EmployeeCostAssignment[];
  costAssignLoading: boolean;
  canEdit: boolean;
  confirmDelete: (type: string, id: string, name: string) => void;
}

export function SalaryCategoriesContent({
  salaryCategories,
  salCatLoading,
  canEdit,
  confirmDelete,
}: {
  salaryCategories: AnnualSalaryCategory[];
  salCatLoading: boolean;
  canEdit: boolean;
  confirmDelete: (type: string, id: string, name: string) => void;
}) {
  const { toast } = useToast();

  const [showSalaryCatDialog, setShowSalaryCatDialog] = useState(false);
  const [editingSalaryCat, setEditingSalaryCat] = useState<AnnualSalaryCategory | null>(null);
  const [salCatName, setSalCatName] = useState("");
  const [salCatBaseSalary, setSalCatBaseSalary] = useState("");
  const [salCatType, setSalCatType] = useState("");
  const [salCatEffDate, setSalCatEffDate] = useState("");
  const [salCatDescription, setSalCatDescription] = useState("");
  const [salCatIsActive, setSalCatIsActive] = useState(true);

  const salaryCatMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingSalaryCat) {
        return await apiRequest("PATCH", `/api/labor-rates/salary-categories/${editingSalaryCat.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/salary-categories", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/salary-categories"] });
      toast({ title: "Success", description: editingSalaryCat ? "Salary category updated" : "Salary category created" });
      resetSalaryCatDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save salary category", variant: "destructive" });
    },
  });

  const resetSalaryCatDialog = () => {
    setShowSalaryCatDialog(false);
    setEditingSalaryCat(null);
    setSalCatName("");
    setSalCatBaseSalary("");
    setSalCatType("");
    setSalCatEffDate("");
    setSalCatDescription("");
    setSalCatIsActive(true);
  };

  const openSalaryCatDialog = (cat?: AnnualSalaryCategory) => {
    if (cat) {
      setEditingSalaryCat(cat);
      setSalCatName(cat.name);
      setSalCatBaseSalary(cat.baseAnnualSalary);
      setSalCatType(cat.salaryType || "");
      setSalCatEffDate(cat.effectiveDate);
      setSalCatDescription(cat.description || "");
      setSalCatIsActive(cat.isActive);
    } else {
      resetSalaryCatDialog();
      setSalCatEffDate(new Date().toISOString().split('T')[0]);
    }
    setShowSalaryCatDialog(true);
  };

  const handleSaveSalaryCat = () => {
    if (!salCatName.trim() || !salCatBaseSalary) {
      toast({ title: "Error", description: "Name and Base Salary are required", variant: "destructive" });
      return;
    }
    salaryCatMutation.mutate({
      name: salCatName.trim(),
      baseAnnualSalary: salCatBaseSalary,
      salaryType: salCatType || null,
      effectiveDate: salCatEffDate || new Date().toISOString().split('T')[0],
      description: salCatDescription.trim() || null,
      isActive: salCatIsActive,
    });
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Annual Salary Categories
            </CardTitle>
            <CardDescription>
              Define salary categories with base annual salaries for cost rate calculations.
            </CardDescription>
          </div>
          {canEdit && (
            <Button onClick={() => openSalaryCatDialog()} data-testid="button-add-salary-cat" className="w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              Add Category
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {salCatLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : salaryCategories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No salary categories defined yet.</p>
              <p className="text-sm mt-1">Create salary categories to standardize annual compensation levels.</p>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <Table className="min-w-[540px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[140px]">Name</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[110px]">Base Salary</TableHead>
                      <TableHead className="min-w-[90px]">Type</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[110px]">Effective Date</TableHead>
                      <TableHead className="min-w-[80px]">Status</TableHead>
                      {canEdit && <TableHead className="text-right w-[90px]">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salaryCategories.map((sc) => (
                      <TableRow key={sc.id} data-testid={`row-salary-cat-${sc.id}`}>
                        <TableCell className="font-medium whitespace-nowrap">{sc.name}</TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap">
                          ${parseFloat(sc.baseAnnualSalary).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {sc.salaryType ? <Badge variant="secondary">{sc.salaryType}</Badge> : "-"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{sc.effectiveDate}</TableCell>
                        <TableCell>
                          <Badge variant={sc.isActive ? "default" : "secondary"}>
                            {sc.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => openSalaryCatDialog(sc)} data-testid={`button-edit-salary-cat-${sc.id}`}>
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => confirmDelete("salary-cat", sc.id, sc.name)} data-testid={`button-delete-salary-cat-${sc.id}`}>
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
                {salaryCategories.map((sc) => (
                  <div key={sc.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-salary-cat-${sc.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{sc.name}</p>
                        <p className="text-lg font-mono font-semibold">${parseFloat(sc.baseAnnualSalary).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={sc.isActive ? "default" : "secondary"} className="text-xs">
                          {sc.isActive ? "Active" : "Inactive"}
                        </Badge>
                        {canEdit && (
                          <>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openSalaryCatDialog(sc)} data-testid={`button-edit-salary-cat-m-${sc.id}`}>
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("salary-cat", sc.id, sc.name)} data-testid={`button-delete-salary-cat-m-${sc.id}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{sc.salaryType || "No type"}</span>
                      <span>Effective: {sc.effectiveDate}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={showSalaryCatDialog} onOpenChange={(open) => !open && resetSalaryCatDialog()}>
        <DialogContent data-testid="dialog-salary-cat">
          <DialogHeader>
            <DialogTitle>{editingSalaryCat ? "Edit Salary Category" : "Add Salary Category"}</DialogTitle>
            <DialogDescription>
              {editingSalaryCat ? "Update salary category details" : "Create a new salary category for your organization"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="sal-cat-name">Name *</Label>
              <Input id="sal-cat-name" value={salCatName} onChange={(e) => setSalCatName(e.target.value)} placeholder="e.g., Senior Engineer" data-testid="input-sal-cat-name" />
            </div>
            <div>
              <Label htmlFor="sal-cat-salary">Base Annual Salary ($) *</Label>
              <Input id="sal-cat-salary" type="number" step="0.01" value={salCatBaseSalary} onChange={(e) => setSalCatBaseSalary(e.target.value)} placeholder="85000.00" data-testid="input-sal-cat-salary" />
            </div>
            <div>
              <Label>Salary Type</Label>
              <Select value={salCatType} onValueChange={setSalCatType}>
                <SelectTrigger data-testid="select-sal-cat-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXED">Fixed</SelectItem>
                  <SelectItem value="CONTRACT">Contract</SelectItem>
                  <SelectItem value="HOURLY_EQUIVALENT">Hourly Equivalent</SelectItem>
                  <SelectItem value="SEASONAL">Seasonal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="sal-cat-eff-date">Effective Date</Label>
              <Input id="sal-cat-eff-date" value={salCatEffDate} onChange={(e) => setSalCatEffDate(e.target.value)} placeholder="YYYY-MM-DD" data-testid="input-sal-cat-eff-date" />
            </div>
            <div>
              <Label htmlFor="sal-cat-desc">Description</Label>
              <Textarea id="sal-cat-desc" value={salCatDescription} onChange={(e) => setSalCatDescription(e.target.value)} placeholder="Optional description..." data-testid="input-sal-cat-desc" />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="sal-cat-active" checked={salCatIsActive} onCheckedChange={(checked) => setSalCatIsActive(checked === true)} data-testid="checkbox-sal-cat-active" />
              <Label htmlFor="sal-cat-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetSalaryCatDialog}>Cancel</Button>
            <Button onClick={handleSaveSalaryCat} disabled={salaryCatMutation.isPending} data-testid="button-save-salary-cat">
              {editingSalaryCat ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BurdenRatesContent({
  burdenRatesList,
  burdenLoading,
  canEdit,
  confirmDelete,
}: {
  burdenRatesList: BurdenRateConfig[];
  burdenLoading: boolean;
  canEdit: boolean;
  confirmDelete: (type: string, id: string, name: string) => void;
}) {
  const { toast } = useToast();

  const [showBurdenDialog, setShowBurdenDialog] = useState(false);
  const [editingBurden, setEditingBurden] = useState<BurdenRateConfig | null>(null);
  const [burdenName, setBurdenName] = useState("");
  const [burdenTaxes, setBurdenTaxes] = useState("");
  const [burdenBenefits, setBurdenBenefits] = useState("");
  const [burdenInsurance, setBurdenInsurance] = useState("");
  const [burdenOverhead, setBurdenOverhead] = useState("");
  const [burdenFixed, setBurdenFixed] = useState("");
  const [burdenDescription, setBurdenDescription] = useState("");
  const [burdenIsActive, setBurdenIsActive] = useState(true);

  const burdenRateMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingBurden) {
        return await apiRequest("PATCH", `/api/labor-rates/burden-rates/${editingBurden.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/burden-rates", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/burden-rates"] });
      toast({ title: "Success", description: editingBurden ? "Burden rate updated" : "Burden rate created" });
      resetBurdenDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save burden rate", variant: "destructive" });
    },
  });

  const resetBurdenDialog = () => {
    setShowBurdenDialog(false);
    setEditingBurden(null);
    setBurdenName("");
    setBurdenTaxes("");
    setBurdenBenefits("");
    setBurdenInsurance("");
    setBurdenOverhead("");
    setBurdenFixed("");
    setBurdenDescription("");
    setBurdenIsActive(true);
  };

  const openBurdenDialog = (burden?: BurdenRateConfig) => {
    if (burden) {
      setEditingBurden(burden);
      setBurdenName(burden.name);
      setBurdenTaxes(burden.taxesPercent || "");
      setBurdenBenefits(burden.benefitsPercent || "");
      setBurdenInsurance(burden.insurancePercent || "");
      setBurdenOverhead(burden.overheadPercent || "");
      setBurdenFixed(burden.fixedBurdenAmount || "");
      setBurdenDescription(burden.description || "");
      setBurdenIsActive(burden.isActive);
    } else {
      resetBurdenDialog();
    }
    setShowBurdenDialog(true);
  };

  const computedBurdenPercent = () => {
    const t = parseFloat(burdenTaxes) || 0;
    const b = parseFloat(burdenBenefits) || 0;
    const i = parseFloat(burdenInsurance) || 0;
    const o = parseFloat(burdenOverhead) || 0;
    return (t + b + i + o).toFixed(2);
  };

  const handleSaveBurden = () => {
    if (!burdenName.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    burdenRateMutation.mutate({
      name: burdenName.trim(),
      burdenPercentage: computedBurdenPercent(),
      taxesPercent: burdenTaxes || null,
      benefitsPercent: burdenBenefits || null,
      insurancePercent: burdenInsurance || null,
      overheadPercent: burdenOverhead || null,
      fixedBurdenAmount: burdenFixed || null,
      description: burdenDescription.trim() || null,
      isActive: burdenIsActive,
    });
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              Burden Rate Configurations
            </CardTitle>
            <CardDescription>
              Define burden rate profiles with component breakdowns for taxes, benefits, insurance, and overhead.
            </CardDescription>
          </div>
          {canEdit && (
            <Button onClick={() => openBurdenDialog()} data-testid="button-add-burden-rate" className="w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              Add Burden Rate
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {burdenLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : burdenRatesList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No burden rates defined yet.</p>
              <p className="text-sm mt-1">Create burden rate profiles to calculate fully burdened employee costs.</p>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <Table className="min-w-[580px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[130px]">Name</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[120px]">Total Burden %</TableHead>
                      <TableHead className="min-w-[160px]">Component Breakdown</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[110px]">Fixed Amount</TableHead>
                      <TableHead className="min-w-[80px]">Status</TableHead>
                      {canEdit && <TableHead className="text-right w-[90px]">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {burdenRatesList.map((br) => (
                      <TableRow key={br.id} data-testid={`row-burden-rate-${br.id}`}>
                        <TableCell className="font-medium">{br.name}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {parseFloat(br.burdenPercentage).toFixed(2)}%
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {br.taxesPercent && <Badge variant="secondary">Taxes: {br.taxesPercent}%</Badge>}
                            {br.benefitsPercent && <Badge variant="secondary">Benefits: {br.benefitsPercent}%</Badge>}
                            {br.insurancePercent && <Badge variant="secondary">Insurance: {br.insurancePercent}%</Badge>}
                            {br.overheadPercent && <Badge variant="secondary">Overhead: {br.overheadPercent}%</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {br.fixedBurdenAmount ? `$${parseFloat(br.fixedBurdenAmount).toLocaleString()}` : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={br.isActive ? "default" : "secondary"}>
                            {br.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => openBurdenDialog(br)} data-testid={`button-edit-burden-${br.id}`}>
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => confirmDelete("burden-rate", br.id, br.name)} data-testid={`button-delete-burden-${br.id}`}>
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
                {burdenRatesList.map((br) => (
                  <div key={br.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-burden-rate-${br.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{br.name}</p>
                        <p className="text-lg font-mono font-semibold">{parseFloat(br.burdenPercentage).toFixed(2)}%</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={br.isActive ? "default" : "secondary"} className="text-xs">
                          {br.isActive ? "Active" : "Inactive"}
                        </Badge>
                        {canEdit && (
                          <>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openBurdenDialog(br)} data-testid={`button-edit-burden-m-${br.id}`}>
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("burden-rate", br.id, br.name)} data-testid={`button-delete-burden-m-${br.id}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {br.taxesPercent && <Badge variant="secondary" className="text-xs">Taxes: {br.taxesPercent}%</Badge>}
                      {br.benefitsPercent && <Badge variant="secondary" className="text-xs">Benefits: {br.benefitsPercent}%</Badge>}
                      {br.insurancePercent && <Badge variant="secondary" className="text-xs">Insurance: {br.insurancePercent}%</Badge>}
                      {br.overheadPercent && <Badge variant="secondary" className="text-xs">Overhead: {br.overheadPercent}%</Badge>}
                    </div>
                    {br.fixedBurdenAmount && (
                      <p className="text-xs text-muted-foreground">Fixed: ${parseFloat(br.fixedBurdenAmount).toLocaleString()}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={showBurdenDialog} onOpenChange={(open) => !open && resetBurdenDialog()}>
        <DialogContent data-testid="dialog-burden-rate">
          <DialogHeader>
            <DialogTitle>{editingBurden ? "Edit Burden Rate" : "Add Burden Rate"}</DialogTitle>
            <DialogDescription>
              {editingBurden ? "Update burden rate configuration" : "Create a new burden rate profile for your organization"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="burden-name">Name *</Label>
              <Input id="burden-name" value={burdenName} onChange={(e) => setBurdenName(e.target.value)} placeholder="e.g., Standard Burden" data-testid="input-burden-name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="burden-taxes">Taxes (%)</Label>
                <Input id="burden-taxes" type="number" step="0.01" value={burdenTaxes} onChange={(e) => setBurdenTaxes(e.target.value)} placeholder="7.65" data-testid="input-burden-taxes" />
              </div>
              <div>
                <Label htmlFor="burden-benefits">Benefits (%)</Label>
                <Input id="burden-benefits" type="number" step="0.01" value={burdenBenefits} onChange={(e) => setBurdenBenefits(e.target.value)} placeholder="15.00" data-testid="input-burden-benefits" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="burden-insurance">Insurance (%)</Label>
                <Input id="burden-insurance" type="number" step="0.01" value={burdenInsurance} onChange={(e) => setBurdenInsurance(e.target.value)} placeholder="5.00" data-testid="input-burden-insurance" />
              </div>
              <div>
                <Label htmlFor="burden-overhead">Overhead (%)</Label>
                <Input id="burden-overhead" type="number" step="0.01" value={burdenOverhead} onChange={(e) => setBurdenOverhead(e.target.value)} placeholder="10.00" data-testid="input-burden-overhead" />
              </div>
            </div>
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm font-medium">Total Burden: <span className="font-mono" data-testid="text-computed-burden">{computedBurdenPercent()}%</span></p>
            </div>
            <div>
              <Label htmlFor="burden-fixed">Fixed Burden Amount ($)</Label>
              <Input id="burden-fixed" type="number" step="0.01" value={burdenFixed} onChange={(e) => setBurdenFixed(e.target.value)} placeholder="0.00" data-testid="input-burden-fixed" />
            </div>
            <div>
              <Label htmlFor="burden-desc">Description</Label>
              <Textarea id="burden-desc" value={burdenDescription} onChange={(e) => setBurdenDescription(e.target.value)} placeholder="Optional description..." data-testid="input-burden-desc" />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="burden-active" checked={burdenIsActive} onCheckedChange={(checked) => setBurdenIsActive(checked === true)} data-testid="checkbox-burden-active" />
              <Label htmlFor="burden-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetBurdenDialog}>Cancel</Button>
            <Button onClick={handleSaveBurden} disabled={burdenRateMutation.isPending} data-testid="button-save-burden">
              {editingBurden ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CostAssignmentsContent({
  users,
  salaryCategories,
  burdenRatesList,
  costAssignments,
  costAssignLoading,
  canEdit,
  confirmDelete,
}: {
  users: User[];
  salaryCategories: AnnualSalaryCategory[];
  burdenRatesList: BurdenRateConfig[];
  costAssignments: EmployeeCostAssignment[];
  costAssignLoading: boolean;
  canEdit: boolean;
  confirmDelete: (type: string, id: string, name: string) => void;
}) {
  const { toast } = useToast();

  const [showCostAssignDialog, setShowCostAssignDialog] = useState(false);
  const [editingCostAssign, setEditingCostAssign] = useState<EmployeeCostAssignment | null>(null);
  const [costAssignUserId, setCostAssignUserId] = useState("");
  const [costAssignSalaryCatId, setCostAssignSalaryCatId] = useState("");
  const [costAssignBurdenId, setCostAssignBurdenId] = useState("");
  const [costAssignHours, setCostAssignHours] = useState("2080");
  const [costAssignEffDate, setCostAssignEffDate] = useState("");
  const [costAssignEndDate, setCostAssignEndDate] = useState("");
  const [costAssignNotes, setCostAssignNotes] = useState("");

  const costAssignMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingCostAssign) {
        return await apiRequest("PATCH", `/api/labor-rates/cost-assignments/${editingCostAssign.id}`, data);
      }
      return await apiRequest("POST", "/api/labor-rates/cost-assignments", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/cost-assignments"] });
      toast({ title: "Success", description: editingCostAssign ? "Cost assignment updated" : "Cost assignment created" });
      resetCostAssignDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save cost assignment", variant: "destructive" });
    },
  });

  const recalculateAllMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/labor-rates/cost-assignments/recalculate");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/cost-assignments"] });
      toast({ title: "Success", description: "All cost assignments recalculated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to recalculate cost assignments", variant: "destructive" });
    },
  });

  const resetCostAssignDialog = () => {
    setShowCostAssignDialog(false);
    setEditingCostAssign(null);
    setCostAssignUserId("");
    setCostAssignSalaryCatId("");
    setCostAssignBurdenId("");
    setCostAssignHours("2080");
    setCostAssignEffDate("");
    setCostAssignEndDate("");
    setCostAssignNotes("");
  };

  const openCostAssignDialog = (assign?: EmployeeCostAssignment) => {
    if (assign) {
      setEditingCostAssign(assign);
      setCostAssignUserId(assign.userId);
      setCostAssignSalaryCatId(assign.salaryCategoryId);
      setCostAssignBurdenId(assign.burdenRateId || "");
      setCostAssignHours(String(assign.workingHoursPerYear));
      setCostAssignEffDate(assign.effectiveDate);
      setCostAssignEndDate(assign.endDate || "");
      setCostAssignNotes(assign.notes || "");
    } else {
      resetCostAssignDialog();
      setCostAssignEffDate(new Date().toISOString().split('T')[0]);
    }
    setShowCostAssignDialog(true);
  };

  const handleSaveCostAssign = () => {
    if (!costAssignUserId || !costAssignSalaryCatId || !costAssignEffDate) {
      toast({ title: "Error", description: "Employee, Salary Category, and Effective Date are required", variant: "destructive" });
      return;
    }
    costAssignMutation.mutate({
      userId: costAssignUserId,
      salaryCategoryId: costAssignSalaryCatId,
      burdenRateId: costAssignBurdenId && costAssignBurdenId !== "none" ? costAssignBurdenId : null,
      workingHoursPerYear: parseInt(costAssignHours) || 2080,
      effectiveDate: costAssignEffDate,
      endDate: costAssignEndDate || null,
      notes: costAssignNotes.trim() || null,
    });
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Employee Cost Assignments
            </CardTitle>
            <CardDescription>
              Assign employees to salary categories and burden rates to calculate fully burdened costs and derived hourly rates.
            </CardDescription>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            {canEdit && (
              <>
                <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => recalculateAllMutation.mutate()} disabled={recalculateAllMutation.isPending} data-testid="button-recalculate-all">
                  <RefreshCw className={`w-4 h-4 mr-2 ${recalculateAllMutation.isPending ? "animate-spin" : ""}`} />
                  Recalculate
                </Button>
                <Button className="flex-1 sm:flex-none" onClick={() => openCostAssignDialog()} data-testid="button-add-cost-assign">
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {costAssignLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : costAssignments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No cost assignments defined yet.</p>
              <p className="text-sm mt-1">Create assignments to link employees with salary categories and burden rates.</p>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap min-w-[130px]">Employee</TableHead>
                      <TableHead className="min-w-[120px]">Salary Category</TableHead>
                      <TableHead className="min-w-[100px]">Burden Rate</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[100px]">Base Salary</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[90px]">Burden %</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[130px]">Fully Burdened</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[100px]">Hourly Rate</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[110px]">Effective Date</TableHead>
                      {canEdit && <TableHead className="text-right w-[90px]">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costAssignments.map((ca) => (
                      <TableRow key={ca.id} data-testid={`row-cost-assign-${ca.id}`}>
                        <TableCell className="font-medium">
                          {ca.userName ? `${ca.userName} ${ca.userLastName || ""}`.trim() : "Unknown"}
                        </TableCell>
                        <TableCell>{ca.salaryName || "Unknown"}</TableCell>
                        <TableCell>{ca.burdenName || "-"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {ca.baseAnnualSalary ? `$${parseFloat(ca.baseAnnualSalary).toLocaleString()}` : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {ca.burdenPercentage ? `${parseFloat(ca.burdenPercentage).toFixed(2)}%` : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {ca.fullyBurdenedCost ? `$${parseFloat(ca.fullyBurdenedCost).toLocaleString()}` : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {ca.derivedHourlyRate ? `$${parseFloat(ca.derivedHourlyRate).toLocaleString()}` : "-"}
                        </TableCell>
                        <TableCell>{ca.effectiveDate}</TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => openCostAssignDialog(ca)} data-testid={`button-edit-cost-assign-${ca.id}`}>
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => confirmDelete("cost-assign", ca.id, `${ca.userName || ""} ${ca.userLastName || ""}`.trim())} data-testid={`button-delete-cost-assign-${ca.id}`}>
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
                {costAssignments.map((ca) => (
                  <div key={ca.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-cost-assign-${ca.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{ca.userName ? `${ca.userName} ${ca.userLastName || ""}`.trim() : "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">{ca.salaryName || "Unknown"}</p>
                        {ca.burdenName && <p className="text-xs text-muted-foreground">{ca.burdenName}</p>}
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openCostAssignDialog(ca)} data-testid={`button-edit-cost-assign-m-${ca.id}`}>
                            <Edit className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("cost-assign", ca.id, `${ca.userName || ""} ${ca.userLastName || ""}`.trim())} data-testid={`button-delete-cost-assign-m-${ca.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Base Salary</span>
                        <p className="font-mono font-medium">{ca.baseAnnualSalary ? `$${parseFloat(ca.baseAnnualSalary).toLocaleString()}` : "-"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Burden</span>
                        <p className="font-mono font-medium">{ca.burdenPercentage ? `${parseFloat(ca.burdenPercentage).toFixed(2)}%` : "-"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Burdened Cost</span>
                        <p className="font-mono font-semibold">{ca.fullyBurdenedCost ? `$${parseFloat(ca.fullyBurdenedCost).toLocaleString()}` : "-"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Hourly Rate</span>
                        <p className="font-mono font-semibold">{ca.derivedHourlyRate ? `$${parseFloat(ca.derivedHourlyRate).toLocaleString()}/hr` : "-"}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Effective: {ca.effectiveDate}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCostAssignDialog} onOpenChange={(open) => !open && resetCostAssignDialog()}>
        <DialogContent data-testid="dialog-cost-assign">
          <DialogHeader>
            <DialogTitle>{editingCostAssign ? "Edit Cost Assignment" : "Add Cost Assignment"}</DialogTitle>
            <DialogDescription>
              {editingCostAssign ? "Update employee cost assignment" : "Assign an employee to a salary category and burden rate"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Employee *</Label>
              <Select value={costAssignUserId} onValueChange={setCostAssignUserId} disabled={!!editingCostAssign}>
                <SelectTrigger data-testid="select-cost-assign-user">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName} - {u.role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Salary Category *</Label>
                <Select value={costAssignSalaryCatId} onValueChange={setCostAssignSalaryCatId}>
                  <SelectTrigger data-testid="select-cost-assign-salary-cat">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {salaryCategories.filter(sc => sc.isActive).map((sc) => (
                      <SelectItem key={sc.id} value={sc.id}>{sc.name} - ${parseFloat(sc.baseAnnualSalary).toLocaleString()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Burden Rate</Label>
                <Select value={costAssignBurdenId} onValueChange={setCostAssignBurdenId}>
                  <SelectTrigger data-testid="select-cost-assign-burden">
                    <SelectValue placeholder="Select burden rate" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {burdenRatesList.filter(br => br.isActive).map((br) => (
                      <SelectItem key={br.id} value={br.id}>{br.name} - {parseFloat(br.burdenPercentage).toFixed(2)}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="cost-assign-hours">Working Hours / Year</Label>
              <Input id="cost-assign-hours" type="number" value={costAssignHours} onChange={(e) => setCostAssignHours(e.target.value)} placeholder="2080" data-testid="input-cost-assign-hours" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="cost-assign-eff-date">Effective Date *</Label>
                <Input id="cost-assign-eff-date" value={costAssignEffDate} onChange={(e) => setCostAssignEffDate(e.target.value)} placeholder="YYYY-MM-DD" data-testid="input-cost-assign-eff-date" />
              </div>
              <div>
                <Label htmlFor="cost-assign-end-date">End Date</Label>
                <Input id="cost-assign-end-date" value={costAssignEndDate} onChange={(e) => setCostAssignEndDate(e.target.value)} placeholder="YYYY-MM-DD" data-testid="input-cost-assign-end-date" />
              </div>
            </div>
            <div>
              <Label htmlFor="cost-assign-notes">Notes</Label>
              <Textarea id="cost-assign-notes" value={costAssignNotes} onChange={(e) => setCostAssignNotes(e.target.value)} placeholder="Optional notes..." data-testid="input-cost-assign-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetCostAssignDialog}>Cancel</Button>
            <Button onClick={handleSaveCostAssign} disabled={costAssignMutation.isPending} data-testid="button-save-cost-assign">
              {editingCostAssign ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
