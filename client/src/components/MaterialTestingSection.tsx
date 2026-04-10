import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, FlaskConical, CheckCircle2, XCircle, Clock, Loader2,
  Edit2, Trash2, FileText, AlertTriangle, Beaker,
} from "lucide-react";

interface MaterialTest {
  id: string;
  projectId: string;
  testNumber: string;
  materialType: string;
  testType: string;
  customTestType: string | null;
  sampleId: string | null;
  testDate: string;
  labName: string | null;
  testResults: string | null;
  status: string;
  specRequirement: string | null;
  reportFileUrl: string | null;
  reportFileName: string | null;
  notes: string | null;
  punchListItemId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

interface MaterialTestingSectionProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

const TEST_TYPE_OPTIONS = [
  { value: "CONCRETE_CYLINDER_BREAK", label: "Concrete Cylinder Break" },
  { value: "SOIL_COMPACTION", label: "Soil Compaction (Proctor)" },
  { value: "STEEL_TENSILE", label: "Steel Tensile" },
  { value: "AGGREGATE_GRADATION", label: "Aggregate Gradation" },
  { value: "ASPHALT_CORE", label: "Asphalt Core" },
  { value: "MOISTURE_CONTENT", label: "Moisture Content" },
  { value: "REBAR_MILL_CERT", label: "Rebar Mill Cert Verification" },
  { value: "OTHER", label: "Other" },
];

const STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "PASSED", label: "Passed" },
  { value: "FAILED", label: "Failed" },
];

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  PASSED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  PENDING: Clock,
  IN_PROGRESS: Loader2,
  PASSED: CheckCircle2,
  FAILED: XCircle,
};

function isManagement(role: string) {
  return ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(role);
}

export default function MaterialTestingSection({ projectId, projectCode, userRole }: MaterialTestingSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selected, setSelected] = useState<MaterialTest | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const emptyForm = {
    materialType: "",
    testType: "",
    customTestType: "",
    sampleId: "",
    testDate: new Date().toISOString().split("T")[0],
    labName: "",
    testResults: "",
    status: "PENDING",
    specRequirement: "",
    notes: "",
    reportFileUrl: "",
    reportFileName: "",
  };
  const [form, setForm] = useState(emptyForm);

  const qk = ["/api/projects", projectCode, "material-tests"];

  const { data: tests = [], isLoading } = useQuery<MaterialTest[]>({
    queryKey: qk,
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectCode}/material-tests`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch material tests");
      return r.json();
    },
    enabled: !!projectCode,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest("POST", `/api/projects/${projectCode}/material-tests`, {
        ...data,
        customTestType: data.customTestType || null,
        sampleId: data.sampleId || null,
        labName: data.labName || null,
        testResults: data.testResults || null,
        specRequirement: data.specRequirement || null,
        notes: data.notes || null,
        reportFileUrl: data.reportFileUrl || null,
        reportFileName: data.reportFileName || null,
      }),
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setForm(emptyForm);
      toast({ title: "Material test created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectCode}/material-tests/${id}`, data);
      return (await res.json()) as MaterialTest;
    },
    onSuccess: (updated: MaterialTest) => {
      invalidate();
      setShowEdit(false);
      toast({ title: "Material test updated" });
      if (updated.punchListItemId && selected && !selected.punchListItemId) {
        toast({ title: "Punch list item created", description: "A punch list item was auto-generated for this failed test." });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/projects/${projectCode}/material-tests/${id}`),
    onSuccess: () => {
      invalidate();
      setShowDetail(false);
      setSelected(null);
      toast({ title: "Material test deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleOpenEdit = (test: MaterialTest) => {
    setSelected(test);
    setForm({
      materialType: test.materialType,
      testType: test.testType,
      customTestType: test.customTestType || "",
      sampleId: test.sampleId || "",
      testDate: test.testDate,
      labName: test.labName || "",
      testResults: test.testResults || "",
      status: test.status,
      specRequirement: test.specRequirement || "",
      notes: test.notes || "",
      reportFileUrl: test.reportFileUrl || "",
      reportFileName: test.reportFileName || "",
    });
    setShowEdit(true);
  };

  const filteredTests = tests.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (typeFilter !== "all" && t.testType !== typeFilter) return false;
    return true;
  });

  const counts = {
    pending: tests.filter((t) => t.status === "PENDING").length,
    inProgress: tests.filter((t) => t.status === "IN_PROGRESS").length,
    passed: tests.filter((t) => t.status === "PASSED").length,
    failed: tests.filter((t) => t.status === "FAILED").length,
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="material-testing-section">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Material Testing
            </CardTitle>
            <CardDescription>Log and track material test records for QC compliance</CardDescription>
          </div>
          {isManagement(userRole) && (
            <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} data-testid="button-add-material-test">
              <Plus className="h-4 w-4 mr-2" />
              New Test
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Pending", count: counts.pending, color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-900/20" },
              { label: "In Progress", count: counts.inProgress, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
              { label: "Passed", count: counts.passed, color: "text-green-600", bg: "bg-green-50 dark:bg-green-900/20" },
              { label: "Failed", count: counts.failed, color: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20" },
            ].map((s) => (
              <Card key={s.label} className={`${s.bg} border-0`}>
                <CardContent className="pt-4 pb-3 text-center">
                  <div className={`text-2xl font-bold ${s.color}`}>{s.count}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 mb-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" data-testid="select-test-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-52" data-testid="select-test-type-filter">
                <SelectValue placeholder="Test Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {TEST_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {filteredTests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Beaker className="h-14 w-14 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No material tests</h3>
              <p className="text-muted-foreground text-sm max-w-xs mb-6">
                Material tests track lab results for concrete, soil, steel, and other construction materials.
              </p>
              {isManagement(userRole) && (
                <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} data-testid="button-add-first-test">
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Test
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTests.map((test) => {
                const StatusIcon = STATUS_ICONS[test.status] || Clock;
                const typeLabel = TEST_TYPE_OPTIONS.find((t) => t.value === test.testType)?.label || test.testType;
                return (
                  <Card
                    key={test.id}
                    className={`cursor-pointer hover:shadow-md transition-shadow ${test.status === "FAILED" ? "border-l-4 border-l-red-500" : test.status === "PASSED" ? "border-l-4 border-l-green-500" : ""}`}
                    onClick={() => { setSelected(test); setShowDetail(true); }}
                    data-testid={`card-material-test-${test.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-xs text-muted-foreground font-mono">{test.testNumber}</span>
                            <span className="font-medium text-foreground">{test.materialType}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${STATUS_COLORS[test.status]}`}>
                              <StatusIcon className="h-3 w-3" />
                              {STATUS_OPTIONS.find((s) => s.value === test.status)?.label || test.status}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
                            <span>{typeLabel}</span>
                            {test.sampleId && <span>Sample: {test.sampleId}</span>}
                            <span>Date: {new Date(test.testDate).toLocaleDateString()}</span>
                            {test.labName && <span>Lab: {test.labName}</span>}
                          </div>
                          {test.punchListItemId && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-orange-600">
                              <AlertTriangle className="h-3 w-3" />
                              Punch list item generated
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {(showCreate || showEdit) && (
        <Dialog open={true} onOpenChange={() => { setShowCreate(false); setShowEdit(false); setSelected(null); }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-material-test-form">
            <DialogHeader>
              <DialogTitle>{showEdit ? "Edit Material Test" : "New Material Test"}</DialogTitle>
              <DialogDescription>
                {showEdit ? "Update the material test record." : "Log a new material test for this project."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Material Type *</Label>
                  <Input
                    value={form.materialType}
                    onChange={(e) => setForm({ ...form, materialType: e.target.value })}
                    placeholder="e.g., Concrete, Soil, Steel"
                    data-testid="input-material-type"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Test Type *</Label>
                  <Select value={form.testType} onValueChange={(v) => setForm({ ...form, testType: v })}>
                    <SelectTrigger data-testid="select-test-type"><SelectValue placeholder="Select test type" /></SelectTrigger>
                    <SelectContent>
                      {TEST_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {form.testType === "OTHER" && (
                <div className="space-y-1.5">
                  <Label>Custom Test Type</Label>
                  <Input
                    value={form.customTestType}
                    onChange={(e) => setForm({ ...form, customTestType: e.target.value })}
                    placeholder="Describe the test type"
                    data-testid="input-custom-test-type"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Sample ID</Label>
                  <Input
                    value={form.sampleId}
                    onChange={(e) => setForm({ ...form, sampleId: e.target.value })}
                    placeholder="e.g., CYL-001"
                    data-testid="input-sample-id"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Test Date *</Label>
                  <Input
                    type="date"
                    value={form.testDate}
                    onChange={(e) => setForm({ ...form, testDate: e.target.value })}
                    data-testid="input-test-date"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Lab / Testing Agency</Label>
                  <Input
                    value={form.labName}
                    onChange={(e) => setForm({ ...form, labName: e.target.value })}
                    placeholder="Lab name"
                    data-testid="input-lab-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger data-testid="select-test-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Test Results</Label>
                <Textarea
                  rows={2}
                  value={form.testResults}
                  onChange={(e) => setForm({ ...form, testResults: e.target.value })}
                  placeholder="e.g., 4500 PSI at 28 days"
                  data-testid="input-test-results"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Spec Requirement</Label>
                <Input
                  value={form.specRequirement}
                  onChange={(e) => setForm({ ...form, specRequirement: e.target.value })}
                  placeholder="e.g., Min 4000 PSI at 28 days"
                  data-testid="input-spec-requirement"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Additional notes..."
                  data-testid="input-test-notes"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Lab Report URL</Label>
                  <Input
                    value={form.reportFileUrl}
                    onChange={(e) => setForm({ ...form, reportFileUrl: e.target.value })}
                    placeholder="https://... or file link"
                    data-testid="input-report-url"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Report File Name</Label>
                  <Input
                    value={form.reportFileName}
                    onChange={(e) => setForm({ ...form, reportFileName: e.target.value })}
                    placeholder="e.g., lab-report-001.pdf"
                    data-testid="input-report-filename"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowCreate(false); setShowEdit(false); setSelected(null); }}>Cancel</Button>
              <Button
                onClick={() => {
                  if (showEdit && selected) {
                    updateMutation.mutate({ id: selected.id, data: { ...form, customTestType: form.customTestType || null, sampleId: form.sampleId || null, labName: form.labName || null, testResults: form.testResults || null, specRequirement: form.specRequirement || null, notes: form.notes || null, reportFileUrl: form.reportFileUrl || null, reportFileName: form.reportFileName || null } });
                  } else {
                    createMutation.mutate(form);
                  }
                }}
                disabled={!form.materialType || !form.testType || !form.testDate || createMutation.isPending || updateMutation.isPending}
                data-testid="button-submit-material-test"
              >
                {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : showEdit ? "Update" : "Create Test"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {showDetail && selected && (
        <Dialog open={true} onOpenChange={() => { setShowDetail(false); setSelected(null); }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-material-test-detail">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                {selected.testNumber}
              </DialogTitle>
              <DialogDescription>{selected.materialType}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2">
                {(() => {
                  const StatusIcon = STATUS_ICONS[selected.status] || Clock;
                  return (
                    <span className={`text-sm px-3 py-1 rounded-full font-medium flex items-center gap-1.5 ${STATUS_COLORS[selected.status]}`}>
                      <StatusIcon className="h-4 w-4" />
                      {STATUS_OPTIONS.find((s) => s.value === selected.status)?.label || selected.status}
                    </span>
                  );
                })()}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="font-medium text-muted-foreground">Test Type:</span> <span>{TEST_TYPE_OPTIONS.find((t) => t.value === selected.testType)?.label || selected.testType}</span></div>
                {selected.customTestType && <div><span className="font-medium text-muted-foreground">Custom Type:</span> <span>{selected.customTestType}</span></div>}
                {selected.sampleId && <div><span className="font-medium text-muted-foreground">Sample ID:</span> <span>{selected.sampleId}</span></div>}
                <div><span className="font-medium text-muted-foreground">Test Date:</span> <span>{new Date(selected.testDate).toLocaleDateString()}</span></div>
                {selected.labName && <div><span className="font-medium text-muted-foreground">Lab:</span> <span>{selected.labName}</span></div>}
              </div>

              {selected.testResults && (
                <div className="text-sm">
                  <span className="font-medium text-muted-foreground">Test Results:</span>
                  <p className="mt-1">{selected.testResults}</p>
                </div>
              )}

              {selected.specRequirement && (
                <div className="text-sm">
                  <span className="font-medium text-muted-foreground">Spec Requirement:</span>
                  <p className="mt-1">{selected.specRequirement}</p>
                </div>
              )}

              {selected.notes && (
                <div className="text-sm">
                  <span className="font-medium text-muted-foreground">Notes:</span>
                  <p className="mt-1">{selected.notes}</p>
                </div>
              )}

              {selected.reportFileUrl && (
                <div className="text-sm">
                  <span className="font-medium text-muted-foreground">Lab Report:</span>
                  <div className="mt-1">
                    <a
                      href={selected.reportFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                      data-testid="link-lab-report"
                    >
                      <FileText className="h-4 w-4" />
                      {selected.reportFileName || "View Report"}
                    </a>
                  </div>
                </div>
              )}

              {selected.punchListItemId && (
                <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg text-sm">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <span className="text-orange-800 dark:text-orange-400">A punch list item was auto-generated for this failed test.</span>
                </div>
              )}

              {isManagement(userRole) && (
                <div className="flex gap-2 border-t pt-4">
                  <Button variant="outline" size="sm" onClick={() => { setShowDetail(false); handleOpenEdit(selected); }} data-testid="button-edit-test">
                    <Edit2 className="h-4 w-4 mr-1" /> Edit
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => { if (confirm("Delete this material test?")) deleteMutation.mutate(selected.id); }} data-testid="button-delete-test">
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
