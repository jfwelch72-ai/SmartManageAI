import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, Plus, Building2, AlertCircle, Upload, FileSpreadsheet, CheckCircle2, XCircle, Download, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon } from "lucide-react";

interface JobClassification {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
}

interface PrevailingWageRate {
  id: string;
  projectId: string;
  classificationId: string;
  wageRate: string;
  fringeRate: string;
  fringeHealthRate?: string | null;
  fringePensionRate?: string | null;
  fringeVacationRate?: string | null;
  fringeTrainingRate?: string | null;
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

interface PrevailingWageTabProps {
  classifications: JobClassification[];
  prevailingWageRates: PrevailingWageRate[];
  pwRatesLoading: boolean;
  projects: Project[];
  canEdit: boolean;
  confirmDelete: (type: string, id: string, name: string) => void;
}

export function PrevailingWageTab({
  classifications,
  prevailingWageRates,
  pwRatesLoading,
  projects,
  canEdit,
  confirmDelete,
}: PrevailingWageTabProps) {
  const { toast } = useToast();

  const [showPWRateDialog, setShowPWRateDialog] = useState(false);
  const [editingPWRate, setEditingPWRate] = useState<PrevailingWageRate | null>(null);
  const [pwProjectId, setPwProjectId] = useState("");
  const [pwClassificationId, setPwClassificationId] = useState("");
  const [pwWageRate, setPwWageRate] = useState("");
  const [pwFringeRate, setPwFringeRate] = useState("");
  const [pwFringeHealth, setPwFringeHealth] = useState("");
  const [pwFringePension, setPwFringePension] = useState("");
  const [pwFringeVacation, setPwFringeVacation] = useState("");
  const [pwFringeTraining, setPwFringeTraining] = useState("");
  const [pwOvertimeMultiplier, setPwOvertimeMultiplier] = useState("1.5");
  const [pwEffectiveDate, setPwEffectiveDate] = useState("");
  const [pwExpirationDate, setPwExpirationDate] = useState("");
  const [pwWageDecision, setPwWageDecision] = useState("");
  const [pwNotes, setPwNotes] = useState("");

  type ImportPreviewRowDTO = {
    rowNumber: number;
    rawClassification: string;
    classificationId: string | null;
    classificationName: string | null;
    wageRate: string;
    fringeHealthRate: string;
    fringePensionRate: string;
    fringeVacationRate: string;
    fringeTrainingRate: string;
    fringeRate: string;
    totalRate: string;
    overtimeMultiplier: string;
    effectiveDate: string;
    expirationDate: string | null;
    wageDecision: string | null;
    notes: string | null;
    action: "CREATE" | "UPDATE" | "ERROR";
    existingId: string | null;
    errors: string[];
    createClassification: boolean;
    newClassificationName: string | null;
  };

  type ImportPreviewResponse = {
    projectId: string;
    projectName: string;
    headersDetected: string[];
    summary: { totalRows: number; toCreate: number; toUpdate: number; withErrors: number; classificationsToCreate: number };
    rows: ImportPreviewRowDTO[];
  };

  type ImportResultResponse = {
    created: number;
    updated: number;
    skipped: number;
    errors: { rowNumber?: number; message: string }[];
    classificationsCreated?: number;
  };

  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importProjectId, setImportProjectId] = useState("");
  const [importDefaultDate, setImportDefaultDate] = useState(new Date().toISOString().split("T")[0]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewResponse | null>(null);
  const [importCreateMissing, setImportCreateMissing] = useState(false);
  const [newClassCodePrefix, setNewClassCodePrefix] = useState("");
  const [newClassDescription, setNewClassDescription] = useState("");
  const [newClassIsActive, setNewClassIsActive] = useState(true);
  const [newClassSortOrder, setNewClassSortOrder] = useState("");

  const TEMPLATE_HEADERS = [
    "Classification",
    "Wage Rate",
    "Health",
    "Pension",
    "Vacation",
    "Training",
    "Fringe",
    "OT Multiplier",
    "Effective Date",
    "Expiration Date",
    "Wage Decision",
    "Notes",
  ];

  const buildTemplateExampleRow = () => [
    "Carpenter",
    "42.50",
    "8.25",
    "6.10",
    "3.00",
    "0.55",
    "17.90",
    "1.5",
    new Date().toISOString().split("T")[0],
    "",
    "CA20230001",
    "Example row - replace with your data",
  ];

  const downloadImportTemplate = () => {
    const headers = TEMPLATE_HEADERS;
    const example = buildTemplateExampleRow();
    const escape = (v: string) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.map(escape).join(","), example.map(escape).join(",")].join("\r\n") + "\r\n";
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prevailing-wage-import-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadImportTemplateXlsx = async () => {
    try {
      await buildAndSaveImportTemplateXlsx();
    } catch (err) {
      toast({
        title: "Excel template failed",
        description: err instanceof Error ? err.message : "Could not generate the Excel template",
        variant: "destructive",
      });
    }
  };

  const buildAndSaveImportTemplateXlsx = async () => {
    const headers = TEMPLATE_HEADERS;
    const example = buildTemplateExampleRow();

    const aoa: (string | number)[][] = [headers, example];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    ws["!cols"] = [
      { wch: 22 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 40 },
    ];

    const dateColIndexes = [8, 9];
    for (let r = 0; r < aoa.length; r++) {
      for (let c = 0; c < headers.length; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;
        if (r === 0) {
          cell.t = "s";
          continue;
        }
        if (dateColIndexes.includes(c)) {
          cell.t = "s";
          cell.z = "@";
          cell.v = String(cell.v ?? "");
        } else {
          cell.t = "s";
          cell.v = String(cell.v ?? "");
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Prevailing Wage Rates");

    const xlsxArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const zip = await JSZip.loadAsync(xlsxArrayBuffer);
    const sheetPath = "xl/worksheets/sheet1.xml";
    const sheetFile = zip.file(sheetPath);
    if (sheetFile) {
      const sheetXml = await sheetFile.async("string");
      const sheetViewsXml =
        "<sheetViews>" +
        '<sheetView workbookViewId="0">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
        "</sheetView>" +
        "</sheetViews>";
      const patchedXml = sheetXml.replace(
        /<sheetViews>[\s\S]*?<\/sheetViews>/,
        sheetViewsXml,
      );
      zip.file(sheetPath, patchedXml);
    }

    const finalBlob = await zip.generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      compression: "DEFLATE",
    });
    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prevailing-wage-import-template.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const resetImportDialog = () => {
    setShowImportDialog(false);
    setImportProjectId("");
    setImportDefaultDate(new Date().toISOString().split("T")[0]);
    setImportFile(null);
    setImportPreview(null);
    setImportCreateMissing(false);
    setNewClassCodePrefix("");
    setNewClassDescription("");
    setNewClassIsActive(true);
    setNewClassSortOrder("");
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!importFile || !importProjectId) throw new Error("Project and file required");
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("projectId", importProjectId);
      if (importDefaultDate) fd.append("defaultEffectiveDate", importDefaultDate);
      if (importCreateMissing) fd.append("createMissing", "true");
      const res = await fetch("/api/labor-rates/prevailing-wage-rates/import-preview", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to preview file" })) as { error?: string };
        throw new Error(err.error || "Failed to preview file");
      }
      return (await res.json()) as ImportPreviewResponse;
    },
    onSuccess: (data) => {
      setImportPreview(data);
    },
    onError: (e: Error) => {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!importPreview) throw new Error("Run preview first");
      const rows = importPreview.rows.filter((r) => r.action !== "ERROR");
      const sortOrderNum = newClassSortOrder.trim() === "" ? undefined : parseInt(newClassSortOrder, 10);
      const newClassificationDefaults = importCreateMissing
        ? {
            codePrefix: newClassCodePrefix.trim() || undefined,
            description: newClassDescription.trim() || undefined,
            isActive: newClassIsActive,
            sortOrder: Number.isFinite(sortOrderNum) ? sortOrderNum : undefined,
          }
        : undefined;
      return await apiRequest("POST", "/api/labor-rates/prevailing-wage-rates/import", {
        projectId: importPreview.projectId,
        rows,
        createMissing: importCreateMissing,
        newClassificationDefaults,
      });
    },
    onSuccess: async (res) => {
      const data = (await res.json()) as ImportResultResponse;
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/prevailing-wage-rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/classifications"] });
      const errCount = (data.errors || []).length;
      const classCount = data.classificationsCreated ?? 0;
      const classNote = classCount > 0 ? `, ${classCount} new classification${classCount === 1 ? "" : "s"}` : "";
      toast({
        title: "Import complete",
        description: `Created ${data.created}, updated ${data.updated}${classNote}, skipped ${data.skipped}${errCount ? ` (${errCount} errors)` : ""}`,
      });
      resetImportDialog();
    },
    onError: (e: Error) => {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
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

  const resetPWRateDialog = () => {
    setShowPWRateDialog(false);
    setEditingPWRate(null);
    setPwProjectId("");
    setPwClassificationId("");
    setPwWageRate("");
    setPwFringeRate("");
    setPwFringeHealth("");
    setPwFringePension("");
    setPwFringeVacation("");
    setPwFringeTraining("");
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
      setPwFringeHealth(rate.fringeHealthRate || "");
      setPwFringePension(rate.fringePensionRate || "");
      setPwFringeVacation(rate.fringeVacationRate || "");
      setPwFringeTraining(rate.fringeTrainingRate || "");
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
    const breakdownSum =
      parseFloat(pwFringeHealth || "0") +
      parseFloat(pwFringePension || "0") +
      parseFloat(pwFringeVacation || "0") +
      parseFloat(pwFringeTraining || "0");
    const effectiveFringe = pwFringeRate.trim() !== ""
      ? pwFringeRate
      : (breakdownSum > 0 ? breakdownSum.toFixed(2) : "0");
    pwRateMutation.mutate({
      projectId: pwProjectId,
      classificationId: pwClassificationId,
      wageRate: pwWageRate,
      fringeRate: effectiveFringe,
      fringeHealthRate: pwFringeHealth || "0",
      fringePensionRate: pwFringePension || "0",
      fringeVacationRate: pwFringeVacation || "0",
      fringeTrainingRate: pwFringeTraining || "0",
      overtimeMultiplier: pwOvertimeMultiplier || "1.5",
      effectiveDate: pwEffectiveDate,
      expirationDate: pwExpirationDate || null,
      wageDecision: pwWageDecision.trim() || null,
      notes: pwNotes.trim() || null,
    });
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                onClick={() => setShowImportDialog(true)}
                data-testid="button-import-pw-rates"
                className="w-full sm:w-auto"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import CSV/XLSX
              </Button>
              <Button onClick={() => openPWRateDialog()} data-testid="button-add-pw-rate" className="w-full sm:w-auto">
                <Plus className="w-4 h-4 mr-2" />
                Add PW Rate
              </Button>
            </div>
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
            <>
              <div className="hidden md:block overflow-x-auto">
                <Table className="min-w-[1100px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[130px]">Project</TableHead>
                      <TableHead className="min-w-[130px]">Classification</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[100px]">Wage Rate</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[90px]">H&amp;W</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[90px]">Pension</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[90px]">Vac/Hol</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[90px]">Training</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[90px]">Fringe Total</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[100px]">Total Rate</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[80px]">OT Mult</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[100px]">Effective</TableHead>
                      {canEdit && <TableHead className="text-right w-[90px]">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {prevailingWageRates.map((pw) => (
                      <TableRow key={pw.id} data-testid={`row-pw-rate-${pw.id}`}>
                        <TableCell className="font-medium whitespace-nowrap">{pw.project?.name || "Unknown"}</TableCell>
                        <TableCell className="whitespace-nowrap">{pw.classification?.name || "Unknown"}</TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap">${parseFloat(pw.wageRate).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap text-muted-foreground" data-testid={`text-pw-fringe-health-${pw.id}`}>${parseFloat(pw.fringeHealthRate || "0").toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap text-muted-foreground" data-testid={`text-pw-fringe-pension-${pw.id}`}>${parseFloat(pw.fringePensionRate || "0").toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap text-muted-foreground" data-testid={`text-pw-fringe-vacation-${pw.id}`}>${parseFloat(pw.fringeVacationRate || "0").toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap text-muted-foreground" data-testid={`text-pw-fringe-training-${pw.id}`}>${parseFloat(pw.fringeTrainingRate || "0").toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap" data-testid={`text-pw-fringe-total-${pw.id}`}>${parseFloat(pw.fringeRate).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono font-semibold whitespace-nowrap">${parseFloat(pw.totalRate).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap">{pw.overtimeMultiplier}x</TableCell>
                        <TableCell className="whitespace-nowrap">{pw.effectiveDate}</TableCell>
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
              </div>
              <div className="md:hidden space-y-3">
                {prevailingWageRates.map((pw) => (
                  <div key={pw.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-pw-rate-${pw.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{pw.project?.name || "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">{pw.classification?.name || "Unknown"}</p>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openPWRateDialog(pw)} data-testid={`button-edit-pw-m-${pw.id}`}>
                            <Edit className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => confirmDelete("pw-rate", pw.id, `${pw.project?.name || ""} - ${pw.classification?.name || ""}`)} data-testid={`button-delete-pw-m-${pw.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Wage</span>
                        <p className="font-mono font-medium">${parseFloat(pw.wageRate).toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Fringe</span>
                        <p className="font-mono font-medium">${parseFloat(pw.fringeRate).toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total</span>
                        <p className="font-mono font-semibold">${parseFloat(pw.totalRate).toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-[11px] border-t pt-2">
                      <div>
                        <span className="text-muted-foreground">H&amp;W</span>
                        <p className="font-mono" data-testid={`text-pw-fringe-health-m-${pw.id}`}>${parseFloat(pw.fringeHealthRate || "0").toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Pension</span>
                        <p className="font-mono" data-testid={`text-pw-fringe-pension-m-${pw.id}`}>${parseFloat(pw.fringePensionRate || "0").toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Vac/Hol</span>
                        <p className="font-mono" data-testid={`text-pw-fringe-vacation-m-${pw.id}`}>${parseFloat(pw.fringeVacationRate || "0").toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Training</span>
                        <p className="font-mono" data-testid={`text-pw-fringe-training-m-${pw.id}`}>${parseFloat(pw.fringeTrainingRate || "0").toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>OT: {pw.overtimeMultiplier}x</span>
                      <span>Effective: {pw.effectiveDate}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={showPWRateDialog} onOpenChange={(open) => !open && resetPWRateDialog()}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-pw-rate">
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
                <Label htmlFor="pw-fringe-rate">Total Fringe ($/hr)</Label>
                <Input id="pw-fringe-rate" type="number" step="0.01" value={pwFringeRate} onChange={(e) => setPwFringeRate(e.target.value)} placeholder="auto-sum" data-testid="input-pw-fringe-rate" />
              </div>
              <div>
                <Label htmlFor="pw-ot-mult">OT Multiplier</Label>
                <Input id="pw-ot-mult" type="number" step="0.01" value={pwOvertimeMultiplier} onChange={(e) => setPwOvertimeMultiplier(e.target.value)} data-testid="input-pw-ot-mult" />
              </div>
            </div>
            <div className="rounded-md border p-3 space-y-3 bg-muted/30">
              <div>
                <Label className="text-sm font-semibold">Fringe Breakdown ($/hr)</Label>
                <p className="text-xs text-muted-foreground">Used for the per-classification fringe table on certified payroll PDFs.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <Label htmlFor="pw-fringe-health" className="text-xs">Health/Welfare</Label>
                  <Input id="pw-fringe-health" type="number" step="0.01" value={pwFringeHealth} onChange={(e) => setPwFringeHealth(e.target.value)} placeholder="0.00" data-testid="input-pw-fringe-health" />
                </div>
                <div>
                  <Label htmlFor="pw-fringe-pension" className="text-xs">Pension</Label>
                  <Input id="pw-fringe-pension" type="number" step="0.01" value={pwFringePension} onChange={(e) => setPwFringePension(e.target.value)} placeholder="0.00" data-testid="input-pw-fringe-pension" />
                </div>
                <div>
                  <Label htmlFor="pw-fringe-vacation" className="text-xs">Vacation/Holiday</Label>
                  <Input id="pw-fringe-vacation" type="number" step="0.01" value={pwFringeVacation} onChange={(e) => setPwFringeVacation(e.target.value)} placeholder="0.00" data-testid="input-pw-fringe-vacation" />
                </div>
                <div>
                  <Label htmlFor="pw-fringe-training" className="text-xs">Training</Label>
                  <Input id="pw-fringe-training" type="number" step="0.01" value={pwFringeTraining} onChange={(e) => setPwFringeTraining(e.target.value)} placeholder="0.00" data-testid="input-pw-fringe-training" />
                </div>
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

      <Dialog open={showImportDialog} onOpenChange={(open) => !open && resetImportDialog()}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col" data-testid="dialog-import-pw-rates">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              Import Prevailing Wage Rates
            </DialogTitle>
            <DialogDescription>
              Upload a CSV or XLSX file. Required columns: <code>Classification</code> and <code>Wage Rate</code>.
              Optional: <code>Health</code>, <code>Pension</code>, <code>Vacation</code>, <code>Training</code>,
              {" "}<code>Fringe</code>, <code>OT Multiplier</code>, <code>Effective Date</code>, <code>Expiration Date</code>,
              {" "}<code>Wage Decision</code>, <code>Notes</code>. Matching classifications will be updated; new ones created.
            </DialogDescription>
            <div className="pt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-sm"
                onClick={downloadImportTemplate}
                data-testid="button-download-import-template"
              >
                <Download className="w-4 h-4 mr-1" />
                Download CSV template
              </Button>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-sm"
                onClick={downloadImportTemplateXlsx}
                data-testid="button-download-import-template-xlsx"
              >
                <Download className="w-4 h-4 mr-1" />
                Download Excel template
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-4 overflow-hidden flex flex-col flex-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>Project *</Label>
                <Select value={importProjectId} onValueChange={(v) => { setImportProjectId(v); setImportPreview(null); }}>
                  <SelectTrigger data-testid="select-import-project">
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
                <Label htmlFor="import-default-date">Default Effective Date</Label>
                <Input
                  id="import-default-date"
                  type="date"
                  value={importDefaultDate}
                  onChange={(e) => { setImportDefaultDate(e.target.value); setImportPreview(null); }}
                  data-testid="input-import-default-date"
                />
                <p className="text-xs text-muted-foreground mt-1">Used when row has no date.</p>
              </div>
              <div>
                <Label htmlFor="import-file">File *</Label>
                <Input
                  id="import-file"
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportPreview(null); }}
                  data-testid="input-import-file"
                />
              </div>
            </div>

            <div className="rounded-md border p-3 bg-muted/30 space-y-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="import-create-missing"
                  checked={importCreateMissing}
                  onCheckedChange={(v) => { setImportCreateMissing(v === true); setImportPreview(null); }}
                  data-testid="checkbox-import-create-missing"
                />
                <div className="space-y-1 leading-none">
                  <Label htmlFor="import-create-missing" className="cursor-pointer">
                    Create missing classifications
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically create new job classifications for any rows whose classification doesn't exist yet. Wage defaults are derived from the row's wage rate.
                  </p>
                </div>
              </div>

              {importCreateMissing && (
                <div className="pl-6 space-y-3 border-l-2 border-muted-foreground/20" data-testid="section-new-class-defaults">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Defaults for new classifications
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="new-class-code-prefix" className="text-xs">Code prefix</Label>
                      <Input
                        id="new-class-code-prefix"
                        placeholder="e.g. PW"
                        value={newClassCodePrefix}
                        onChange={(e) => setNewClassCodePrefix(e.target.value)}
                        maxLength={20}
                        data-testid="input-new-class-code-prefix"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Codes become <code>PREFIX-NAME</code>. Leave blank for no code.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="new-class-sort-order" className="text-xs">Sort order</Label>
                      <Input
                        id="new-class-sort-order"
                        type="number"
                        placeholder="0"
                        value={newClassSortOrder}
                        onChange={(e) => setNewClassSortOrder(e.target.value)}
                        data-testid="input-new-class-sort-order"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="new-class-description" className="text-xs">Description</Label>
                    <Textarea
                      id="new-class-description"
                      placeholder="Auto-created during prevailing wage import"
                      value={newClassDescription}
                      onChange={(e) => setNewClassDescription(e.target.value)}
                      rows={2}
                      maxLength={500}
                      data-testid="input-new-class-description"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="new-class-is-active"
                      checked={newClassIsActive}
                      onCheckedChange={(v) => setNewClassIsActive(v === true)}
                      data-testid="checkbox-new-class-is-active"
                    />
                    <Label htmlFor="new-class-is-active" className="cursor-pointer text-sm">
                      Mark new classifications as active
                    </Label>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => previewMutation.mutate()}
                disabled={!importFile || !importProjectId || previewMutation.isPending}
                data-testid="button-preview-import"
              >
                {previewMutation.isPending ? "Parsing..." : "Preview"}
              </Button>
              {importPreview && (
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <Badge variant="outline" data-testid="badge-import-total">{importPreview.summary.totalRows} rows</Badge>
                  <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300" data-testid="badge-import-create">
                    {importPreview.summary.toCreate} new
                  </Badge>
                  <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300" data-testid="badge-import-update">
                    {importPreview.summary.toUpdate} update
                  </Badge>
                  {importPreview.summary.classificationsToCreate > 0 && (
                    <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 gap-1" data-testid="badge-import-new-classifications">
                      <Sparkles className="w-3 h-3" />
                      {importPreview.summary.classificationsToCreate} new classification{importPreview.summary.classificationsToCreate === 1 ? "" : "s"}
                    </Badge>
                  )}
                  {importPreview.summary.withErrors > 0 && (
                    <Badge variant="destructive" data-testid="badge-import-errors">
                      {importPreview.summary.withErrors} errors
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {importPreview && (
              <ScrollArea className="flex-1 border rounded-md">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead className="w-[60px]">Row</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead>Classification</TableHead>
                      <TableHead className="text-right">Wage</TableHead>
                      <TableHead className="text-right">H/W</TableHead>
                      <TableHead className="text-right">Pension</TableHead>
                      <TableHead className="text-right">Vac.</TableHead>
                      <TableHead className="text-right">Train.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.rows.map((r) => (
                      <TableRow
                        key={r.rowNumber}
                        className={r.action === "ERROR" ? "bg-destructive/10" : ""}
                        data-testid={`row-import-${r.rowNumber}`}
                      >
                        <TableCell className="font-mono text-xs">{r.rowNumber}</TableCell>
                        <TableCell>
                          {r.action === "ERROR" ? (
                            <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Error</Badge>
                          ) : r.action === "UPDATE" ? (
                            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 gap-1">
                              <CheckCircle2 className="w-3 h-3" />Update
                            </Badge>
                          ) : (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 gap-1">
                              <CheckCircle2 className="w-3 h-3" />New
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm flex items-center gap-1.5">
                            <span>{r.classificationName || r.rawClassification || <span className="text-muted-foreground italic">-</span>}</span>
                            {r.createClassification && r.action !== "ERROR" && (
                              <Badge
                                variant="outline"
                                className="text-[10px] py-0 px-1.5 h-4 border-purple-400 text-purple-700 dark:border-purple-500 dark:text-purple-300 gap-0.5"
                                data-testid={`badge-new-class-${r.rowNumber}`}
                              >
                                <Sparkles className="w-2.5 h-2.5" />
                                new
                              </Badge>
                            )}
                          </div>
                          {r.errors.length > 0 && (
                            <div className="text-xs text-destructive mt-0.5" data-testid={`text-import-errors-${r.rowNumber}`}>
                              {r.errors.join("; ")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">${r.wageRate}</TableCell>
                        <TableCell className="text-right font-mono text-xs">${r.fringeHealthRate}</TableCell>
                        <TableCell className="text-right font-mono text-xs">${r.fringePensionRate}</TableCell>
                        <TableCell className="text-right font-mono text-xs">${r.fringeVacationRate}</TableCell>
                        <TableCell className="text-right font-mono text-xs">${r.fringeTrainingRate}</TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold">${r.totalRate}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{r.effectiveDate || "-"}</TableCell>
                        <TableCell className="text-xs max-w-[160px] truncate">{r.notes || ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetImportDialog}>Cancel</Button>
            <Button
              onClick={() => importMutation.mutate()}
              disabled={
                !importPreview ||
                importMutation.isPending ||
                (importPreview.summary.toCreate + importPreview.summary.toUpdate) === 0
              }
              data-testid="button-confirm-import"
            >
              {importMutation.isPending
                ? "Importing..."
                : importPreview
                  ? `Import ${importPreview.summary.toCreate + importPreview.summary.toUpdate} rows`
                  : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
