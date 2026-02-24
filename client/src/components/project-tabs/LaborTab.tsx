import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Edit, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useProjectLaborRates, useProjectEmployeeRates, useUpdateProjectLaborRates, useUpdateProjectEmployeeRate, useDeleteProjectEmployeeRate } from "@/hooks/use-data";
import ProjectLaborHours from "@/components/ProjectLaborHours";
import type { Project } from "@shared/schema";

interface ProjectFinancials {
  contractAmount: number;
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

interface LaborTabProps {
  projectCode: string;
  project: Project | undefined;
  financials: ProjectFinancials | undefined;
}

export default function LaborTab({ projectCode, project, financials }: LaborTabProps) {
  const { toast } = useToast();

  const { data: laborRatesConfig, isLoading: laborRatesLoading } = useProjectLaborRates(projectCode);
  const { data: employeeRates = [], isLoading: employeeRatesLoading } = useProjectEmployeeRates(projectCode);
  const updateLaborRatesMutation = useUpdateProjectLaborRates();
  const updateEmployeeRateMutation = useUpdateProjectEmployeeRate();
  const deleteEmployeeRateMutation = useDeleteProjectEmployeeRate();

  const { data: allUsers = [] } = useQuery<Array<{
    id: string;
    firstName: string;
    lastName: string;
    role?: string;
    costRateRegular?: string;
  }>>({
    queryKey: ["/api/users"],
  });

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

  return (
    <div className="space-y-6">
      {project && <ProjectLaborHours projectId={project.id} projectCode={project.code} />}

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
                    {u.firstName} {u.lastName} - {u.costRateRegular ? `$${u.costRateRegular}/hr` : u.role}
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
    </div>
  );
}