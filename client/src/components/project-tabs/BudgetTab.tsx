import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Save, DollarSign, AlertTriangle, Check } from "lucide-react";
import { CostCodeCombobox } from "@/components/CostCodeCombobox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface BudgetLineItem {
  id: string;
  projectId: string;
  costCode: string;
  description: string;
  division: string;
  laborBudget: string;
  materialBudget: string;
  subcontractorBudget: string;
  equipmentBudget: string;
  otherBudget: string;
  totalBudget: string;
}

interface OrgCostCode {
  id: string;
  code: string;
  description: string;
  division: string;
}

interface LocalLine {
  key: string;
  serverId?: string;
  costCode: string;
  description: string;
  division: string;
  laborBudget: string;
  materialBudget: string;
  subcontractorBudget: string;
  equipmentBudget: string;
  otherBudget: string;
  isDirty: boolean;
  isNew: boolean;
}

function parseNum(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function lineTotal(line: LocalLine): number {
  return parseNum(line.laborBudget) + parseNum(line.materialBudget) + parseNum(line.subcontractorBudget)
    + parseNum(line.equipmentBudget) + parseNum(line.otherBudget);
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function serverLineToLocal(l: BudgetLineItem): LocalLine {
  return {
    key: l.id,
    serverId: l.id,
    costCode: l.costCode,
    description: l.description,
    division: l.division,
    laborBudget: l.laborBudget,
    materialBudget: l.materialBudget,
    subcontractorBudget: l.subcontractorBudget,
    equipmentBudget: l.equipmentBudget,
    otherBudget: l.otherBudget,
    isDirty: false,
    isNew: false,
  };
}

export default function BudgetTab({ projectCode, userRole, projectBudget }: { projectCode: string; userRole: string; projectBudget?: number }) {
  const { toast } = useToast();
  const [lines, setLines] = useState<LocalLine[]>([]);
  const [initialized, setInitialized] = useState(false);

  const canEdit = userRole === "ADMIN" || userRole === "MANAGER";

  const { data: serverLines, isLoading } = useQuery<BudgetLineItem[]>({
    queryKey: ["/api/projects", projectCode, "budget-lines"],
    enabled: !!projectCode,
  });

  const { data: orgCostCodes } = useQuery<OrgCostCode[]>({
    queryKey: ["/api/org-cost-codes"],
  });

  useEffect(() => {
    if (serverLines && !initialized) {
      setLines(serverLines.map(serverLineToLocal));
      setInitialized(true);
    }
  }, [serverLines, initialized]);

  const saveRowMutation = useMutation({
    mutationFn: async ({ line, idx }: { line: LocalLine; idx: number }) => {
      if (line.isNew) {
        const res = await apiRequest("POST", `/api/projects/${projectCode}/budget-lines`, {
          costCode: line.costCode,
          description: line.description,
          division: line.division,
          laborBudget: line.laborBudget,
          materialBudget: line.materialBudget,
          subcontractorBudget: line.subcontractorBudget,
          equipmentBudget: line.equipmentBudget,
          otherBudget: line.otherBudget,
        });
        return { data: await res.json() as BudgetLineItem, idx, isNew: true };
      } else {
        const res = await apiRequest("PATCH", `/api/projects/${projectCode}/budget-lines/${line.serverId}`, {
          laborBudget: line.laborBudget,
          materialBudget: line.materialBudget,
          subcontractorBudget: line.subcontractorBudget,
          equipmentBudget: line.equipmentBudget,
          otherBudget: line.otherBudget,
          description: line.description,
          division: line.division,
        });
        return { data: await res.json() as BudgetLineItem, idx, isNew: false };
      }
    },
    onSuccess: ({ data, idx }) => {
      setLines(prev => prev.map((l, i) => i === idx ? serverLineToLocal(data) : l));
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "budget-lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "cost-ledger"] });
      toast({ title: "Saved", description: `Budget line ${data.costCode} saved.` });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save budget line.", variant: "destructive" });
    },
  });

  const deleteRowMutation = useMutation({
    mutationFn: async ({ line, idx }: { line: LocalLine; idx: number }) => {
      if (line.serverId) {
        await apiRequest("DELETE", `/api/projects/${projectCode}/budget-lines/${line.serverId}`);
      }
      return idx;
    },
    onSuccess: (idx) => {
      setLines(prev => prev.filter((_, i) => i !== idx));
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "budget-lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "cost-ledger"] });
      toast({ title: "Deleted", description: "Budget line removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete budget line.", variant: "destructive" });
    },
  });

  const addLine = () => {
    setLines(prev => [...prev, {
      key: `new-${Date.now()}`,
      costCode: "",
      description: "",
      division: "",
      laborBudget: "0",
      materialBudget: "0",
      subcontractorBudget: "0",
      equipmentBudget: "0",
      otherBudget: "0",
      isDirty: true,
      isNew: true,
    }]);
  };

  const removeLine = (idx: number) => {
    const line = lines[idx];
    if (line.isNew) {
      setLines(prev => prev.filter((_, i) => i !== idx));
    } else {
      deleteRowMutation.mutate({ line, idx });
    }
  };

  const updateLine = (idx: number, field: keyof LocalLine, value: string) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value, isDirty: true } : l));
  };

  const handleCostCodeSelect = (idx: number, fullLabel: string) => {
    const parts = fullLabel.split(" - ");
    const code = parts[0]?.trim() || "";
    const desc = parts.slice(1).join(" - ").trim() || code;
    const division = getDivisionFromCode(code);
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, costCode: code, description: desc, division, isDirty: true } : l));
  };

  const handleSaveRow = (idx: number) => {
    const line = lines[idx];
    if (!line.costCode.trim() || !line.description.trim()) {
      toast({ title: "Validation Error", description: "Cost code and description are required.", variant: "destructive" });
      return;
    }
    const dupes = lines.filter((l, i) => i !== idx && l.costCode === line.costCode);
    if (dupes.length > 0) {
      toast({ title: "Validation Error", description: "Duplicate cost code. Each code must be unique.", variant: "destructive" });
      return;
    }
    saveRowMutation.mutate({ line, idx });
  };

  const grandTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const totals = {
    labor: lines.reduce((s, l) => s + parseNum(l.laborBudget), 0),
    material: lines.reduce((s, l) => s + parseNum(l.materialBudget), 0),
    sub: lines.reduce((s, l) => s + parseNum(l.subcontractorBudget), 0),
    equipment: lines.reduce((s, l) => s + parseNum(l.equipmentBudget), 0),
    other: lines.reduce((s, l) => s + parseNum(l.otherBudget), 0),
  };
  const hasDirty = lines.some(l => l.isDirty);

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="budget-loading">Loading budget...</div>;
  }

  return (
    <div className="space-y-4" data-testid="budget-tab">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2" data-testid="text-budget-title">
              <DollarSign className="h-5 w-5" />
              Project Budget by Cost Code
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Define budget allocations per CSI cost code across labor, materials, subcontractors, equipment, and other.
              {orgCostCodes && orgCostCodes.length > 0 && ` ${orgCostCodes.length} cost codes available for your organization.`}
            </p>
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={addLine} data-testid="button-add-budget-line">
              <Plus className="h-4 w-4 mr-1" /> Add Line
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {hasDirty && (
            <div className="mb-3 flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" /> You have unsaved changes. Save individual rows using the save button.
            </div>
          )}
          {projectBudget !== undefined && projectBudget > 0 && grandTotal > 0 && Math.abs(grandTotal - projectBudget) > 0.01 && (
            <div className={`mb-3 flex items-center gap-2 text-sm rounded-md border px-3 py-2 ${
              grandTotal > projectBudget
                ? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800"
                : "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
            }`} data-testid="text-budget-reconciliation-warning">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>
                Budget line total ({fmtCurrency(grandTotal)}) does not match the project budget ({fmtCurrency(projectBudget)}).
                {grandTotal > projectBudget
                  ? ` Over by ${fmtCurrency(grandTotal - projectBudget)}.`
                  : ` Under by ${fmtCurrency(projectBudget - grandTotal)}.`
                }
              </span>
            </div>
          )}
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Cost Code</TableHead>
                  <TableHead className="w-[180px]">Description</TableHead>
                  <TableHead className="w-[100px]">Division</TableHead>
                  <TableHead className="text-right w-[110px]">Labor</TableHead>
                  <TableHead className="text-right w-[110px]">Material</TableHead>
                  <TableHead className="text-right w-[110px]">Subcontractor</TableHead>
                  <TableHead className="text-right w-[110px]">Equipment</TableHead>
                  <TableHead className="text-right w-[110px]">Other</TableHead>
                  <TableHead className="text-right w-[120px]">Total</TableHead>
                  {canEdit && <TableHead className="w-[80px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 10 : 9} className="text-center py-8 text-muted-foreground" data-testid="text-no-budget-lines">
                      No budget lines defined yet.{canEdit ? ' Click "Add Line" to start building your budget.' : ""}
                    </TableCell>
                  </TableRow>
                )}
                {lines.map((line, idx) => (
                  <TableRow key={line.key} className={line.isDirty ? "bg-amber-50/30 dark:bg-amber-950/20" : ""} data-testid={`row-budget-line-${idx}`}>
                    <TableCell>
                      {canEdit && line.isNew ? (
                        <CostCodeCombobox
                          value={line.costCode ? `${line.costCode} - ${line.description}` : ""}
                          onChange={(val) => handleCostCodeSelect(idx, val)}
                        />
                      ) : (
                        <span className="font-mono text-sm">{line.costCode}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Input value={line.description} onChange={(e) => updateLine(idx, "description", e.target.value)} className="h-8 text-sm" data-testid={`input-budget-desc-${idx}`} />
                      ) : (
                        <span className="text-sm">{line.description}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{line.division || "—"}</Badge>
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Input type="number" value={line.laborBudget} onChange={(e) => updateLine(idx, "laborBudget", e.target.value)} className="h-8 text-sm text-right" data-testid={`input-budget-labor-${idx}`} />
                      ) : (
                        <span className="text-sm text-right block">{fmtCurrency(parseNum(line.laborBudget))}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Input type="number" value={line.materialBudget} onChange={(e) => updateLine(idx, "materialBudget", e.target.value)} className="h-8 text-sm text-right" data-testid={`input-budget-material-${idx}`} />
                      ) : (
                        <span className="text-sm text-right block">{fmtCurrency(parseNum(line.materialBudget))}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Input type="number" value={line.subcontractorBudget} onChange={(e) => updateLine(idx, "subcontractorBudget", e.target.value)} className="h-8 text-sm text-right" data-testid={`input-budget-sub-${idx}`} />
                      ) : (
                        <span className="text-sm text-right block">{fmtCurrency(parseNum(line.subcontractorBudget))}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Input type="number" value={line.equipmentBudget} onChange={(e) => updateLine(idx, "equipmentBudget", e.target.value)} className="h-8 text-sm text-right" data-testid={`input-budget-equip-${idx}`} />
                      ) : (
                        <span className="text-sm text-right block">{fmtCurrency(parseNum(line.equipmentBudget))}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Input type="number" value={line.otherBudget} onChange={(e) => updateLine(idx, "otherBudget", e.target.value)} className="h-8 text-sm text-right" data-testid={`input-budget-other-${idx}`} />
                      ) : (
                        <span className="text-sm text-right block">{fmtCurrency(parseNum(line.otherBudget))}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {fmtCurrency(lineTotal(line))}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleSaveRow(idx)}
                            disabled={!line.isDirty || saveRowMutation.isPending}
                            className="h-7 w-7 text-green-600"
                            title="Save row"
                            data-testid={`button-save-budget-row-${idx}`}
                          >
                            {line.isDirty ? <Save className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeLine(idx)}
                            className="h-7 w-7 text-destructive"
                            data-testid={`button-remove-budget-${idx}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
              {lines.length > 0 && (
                <TableFooter>
                  <TableRow className="font-semibold" data-testid="row-budget-totals">
                    <TableCell colSpan={3}>Total Budget</TableCell>
                    <TableCell className="text-right">{fmtCurrency(totals.labor)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(totals.material)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(totals.sub)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(totals.equipment)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(totals.other)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(grandTotal)}</TableCell>
                    {canEdit && <TableCell />}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function getDivisionFromCode(code: string): string {
  const divNum = code.split("-")[0]?.trim();
  const divisionMap: Record<string, string> = {
    "01": "General Requirements", "02": "Existing Conditions", "03": "Concrete",
    "04": "Masonry", "05": "Metals", "06": "Wood, Plastics & Composites",
    "07": "Thermal & Moisture Protection", "08": "Openings", "09": "Finishes",
    "10": "Specialties", "11": "Equipment", "12": "Furnishings",
    "13": "Special Construction", "14": "Conveying Equipment",
    "21": "Fire Suppression", "22": "Plumbing", "23": "HVAC",
    "25": "Integrated Automation", "26": "Electrical",
    "27": "Communications", "28": "Electronic Safety & Security",
    "31": "Earthwork", "32": "Exterior Improvements", "33": "Utilities",
    "34": "Transportation", "35": "Waterway & Marine Construction",
    "40": "Process Integration", "41": "Material Processing & Handling",
    "42": "Process Heating, Cooling & Drying", "43": "Process Gas & Liquid Handling",
    "44": "Pollution & Waste Control", "46": "Water & Wastewater",
    "48": "Electrical Power Generation",
  };
  return divisionMap[divNum] || "Other";
}
