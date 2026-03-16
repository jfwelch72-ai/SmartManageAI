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
import { Edit, Trash2, Plus, Building2, AlertCircle } from "lucide-react";
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
  const [pwOvertimeMultiplier, setPwOvertimeMultiplier] = useState("1.5");
  const [pwEffectiveDate, setPwEffectiveDate] = useState("");
  const [pwExpirationDate, setPwExpirationDate] = useState("");
  const [pwWageDecision, setPwWageDecision] = useState("");
  const [pwNotes, setPwNotes] = useState("");

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
            <Button onClick={() => openPWRateDialog()} data-testid="button-add-pw-rate" className="w-full sm:w-auto">
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
            <>
              <div className="hidden md:block overflow-x-auto">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[130px]">Project</TableHead>
                      <TableHead className="min-w-[130px]">Classification</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[100px]">Wage Rate</TableHead>
                      <TableHead className="text-right whitespace-nowrap min-w-[80px]">Fringe</TableHead>
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
                        <TableCell className="text-right font-mono whitespace-nowrap">${parseFloat(pw.fringeRate).toFixed(2)}</TableCell>
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
    </>
  );
}
