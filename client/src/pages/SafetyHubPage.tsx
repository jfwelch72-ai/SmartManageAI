import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, AlertTriangle, ClipboardList, GraduationCap, FileText, HardHat, Eye, Plus, ExternalLink, Loader2, CheckCircle2, FileBadge, Activity } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface KpiResponse {
  year: string;
  hoursWorked: number;
  lagging: {
    trir: number; dart: number; ltir: number;
    totalRecordable: number; dartCases: number; deaths: number;
    totalDaysAway: number; totalDaysRestricted: number;
  };
  leading: {
    observations: { total: number; positive: number; atRisk: number; open: number; closed: number };
    toolboxTalks: { scheduled: number; completed: number; attendees: number };
    inspections: { total: number; passed: number; failed: number; inProgress: number };
    training: { total: number; completed: number; pending: number; overdue: number; complianceRate: number };
    ppe: { total: number; compliant: number; violations: number; complianceRate: number };
  };
  certifications: { expiringSoon: number; expired: number };
}

interface SafetyObservation {
  id: string;
  observationType: string;
  category: string;
  severity: string;
  location: string | null;
  description: string;
  observedAt: string;
  observedByName: string | null;
  status: string;
  projectId: string | null;
  correctiveActionId: string | null;
}

const CATEGORIES = ["PPE", "FALL_PROTECTION", "HOUSEKEEPING", "ELECTRICAL", "EXCAVATION", "ERGONOMICS", "ENVIRONMENTAL", "BEHAVIOR", "EQUIPMENT", "OTHER"];

function KpiCard({ label, value, sub, icon: Icon, tone = "default" }: { label: string; value: string | number; sub?: string; icon: React.ElementType; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneClass = tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-red-600" : "text-foreground";
  return (
    <Card data-testid={`kpi-card-${label.replace(/\s+/g, "-").toLowerCase()}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold ${toneClass}`} data-testid={`kpi-value-${label.replace(/\s+/g, "-").toLowerCase()}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <Icon className={`w-8 h-8 ${toneClass} opacity-60`} />
        </div>
      </CardContent>
    </Card>
  );
}

function SafetyDashboard() {
  const [hoursWorked, setHoursWorked] = useState(200000);
  const year = String(new Date().getFullYear());
  const { data: kpi, isLoading } = useQuery<KpiResponse>({
    queryKey: ["/api/safety/kpi/dashboard", year, hoursWorked],
    queryFn: async () => {
      const res = await fetch(`/api/safety/kpi/dashboard?year=${year}&hoursWorked=${hoursWorked}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load KPIs");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!kpi) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" /> Lagging Indicators ({kpi.year})</CardTitle>
          <CardDescription>OSHA recordable rates per 200,000 hours worked</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <Label htmlFor="hours-input" className="text-sm">Hours Worked YTD:</Label>
            <Input id="hours-input" data-testid="input-hours-worked" type="number" value={hoursWorked} onChange={(e) => setHoursWorked(Number(e.target.value) || 0)} className="w-40" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="TRIR" value={kpi.lagging.trir} sub="Total Recordable Incident Rate" icon={AlertTriangle} tone={kpi.lagging.trir > 3 ? "bad" : kpi.lagging.trir > 1 ? "warn" : "good"} />
            <KpiCard label="DART" value={kpi.lagging.dart} sub="Days Away/Restricted" icon={AlertTriangle} tone={kpi.lagging.dart > 2 ? "bad" : kpi.lagging.dart > 0.5 ? "warn" : "good"} />
            <KpiCard label="LTIR" value={kpi.lagging.ltir} sub="Lost Time Rate" icon={AlertTriangle} />
            <KpiCard label="Recordables" value={kpi.lagging.totalRecordable} sub={`${kpi.lagging.deaths} fatalities`} icon={FileText} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
            <KpiCard label="Days Away" value={kpi.lagging.totalDaysAway} icon={FileText} />
            <KpiCard label="Days Restricted" value={kpi.lagging.totalDaysRestricted} icon={FileText} />
            <KpiCard label="DART Cases" value={kpi.lagging.dartCases} icon={FileText} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Leading Indicators</CardTitle>
          <CardDescription>Proactive safety activity preventing future incidents</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Observations" value={kpi.leading.observations.total} sub={`${kpi.leading.observations.positive} positive / ${kpi.leading.observations.atRisk} at-risk`} icon={Eye} tone="good" />
            <KpiCard label="Open Observations" value={kpi.leading.observations.open} icon={AlertTriangle} tone={kpi.leading.observations.open > 5 ? "warn" : "default"} />
            <KpiCard label="Toolbox Talks" value={kpi.leading.toolboxTalks.completed} sub={`${kpi.leading.toolboxTalks.attendees} attendees`} icon={ClipboardList} tone="good" />
            <KpiCard label="Inspections" value={kpi.leading.inspections.total} sub={`${kpi.leading.inspections.passed} passed / ${kpi.leading.inspections.failed} failed`} icon={CheckCircle2} />
            <KpiCard label="Training Compliance" value={`${Math.round(kpi.leading.training.complianceRate * 100)}%`} sub={`${kpi.leading.training.overdue} overdue`} icon={GraduationCap} tone={kpi.leading.training.complianceRate < 0.8 ? "warn" : "good"} />
            <KpiCard label="PPE Compliance" value={`${Math.round(kpi.leading.ppe.complianceRate * 100)}%`} sub={`${kpi.leading.ppe.violations} violations`} icon={HardHat} tone={kpi.leading.ppe.complianceRate < 0.9 ? "warn" : "good"} />
            <KpiCard label="COIs Expiring ≤ 30d" value={kpi.certifications.expiringSoon} icon={FileBadge} tone={kpi.certifications.expiringSoon > 0 ? "warn" : "good"} />
            <KpiCard label="COIs Expired" value={kpi.certifications.expired} icon={FileBadge} tone={kpi.certifications.expired > 0 ? "bad" : "good"} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ObservationDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    observationType: "AT_RISK",
    category: "PPE",
    severity: "LOW",
    location: "",
    description: "",
    immediateAction: "",
    involvedPartyName: "",
    projectId: "",
  });
  const { toast } = useToast();
  const { data: projects = [] } = useQuery<Array<{ id: string; name: string; code?: string }>>({ queryKey: ["/api/projects"] });

  const createObs = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { ...form };
      if (!payload.projectId) delete payload.projectId;
      return apiRequest("POST", "/api/safety/observations", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety/observations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/safety/kpi/dashboard"] });
      toast({ title: "Observation recorded", description: "Saved successfully" });
      setOpen(false);
      setForm({ observationType: "AT_RISK", category: "PPE", severity: "LOW", location: "", description: "", immediateAction: "", involvedPartyName: "", projectId: "" });
    },
    onError: (e: Error) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-new-observation"><Plus className="w-4 h-4 mr-1" /> New Observation</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Record Safety Observation</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Type</Label>
            <Select value={form.observationType} onValueChange={(v) => setForm({ ...form, observationType: v })}>
              <SelectTrigger data-testid="select-obs-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="POSITIVE">Positive (good behavior)</SelectItem>
                <SelectItem value="AT_RISK">At-risk (hazard)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger data-testid="select-obs-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Severity</Label>
            <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
              <SelectTrigger data-testid="select-obs-severity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Project (optional)</Label>
            <Select value={form.projectId || "none"} onValueChange={(v) => setForm({ ...form, projectId: v === "none" ? "" : v })}>
              <SelectTrigger data-testid="select-obs-project"><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code || p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Location</Label>
            <Input data-testid="input-obs-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Level 3 NW corner" />
          </div>
          <div className="col-span-2">
            <Label>Description *</Label>
            <Textarea data-testid="input-obs-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          </div>
          <div className="col-span-2">
            <Label>Immediate Action Taken</Label>
            <Textarea data-testid="input-obs-action" value={form.immediateAction} onChange={(e) => setForm({ ...form, immediateAction: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label>Involved Party (name/trade)</Label>
            <Input data-testid="input-obs-party" value={form.involvedPartyName} onChange={(e) => setForm({ ...form, involvedPartyName: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button data-testid="button-save-observation" disabled={!form.description || createObs.isPending} onClick={() => createObs.mutate()}>
            {createObs.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ObservationsTab() {
  const { data: obs = [], isLoading } = useQuery<SafetyObservation[]>({ queryKey: ["/api/safety/observations"] });
  const { toast } = useToast();
  const closeMut = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/safety/observations/${id}`, { status: "CLOSED" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety/observations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/safety/kpi/dashboard"] });
      toast({ title: "Observation closed" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Safety Observations</h2>
        <ObservationDialog />
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : obs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground" data-testid="text-no-observations">No safety observations recorded yet. Capture a positive behavior or hazard to get started.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Observer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {obs.map((o) => (
                  <TableRow key={o.id} data-testid={`row-observation-${o.id}`}>
                    <TableCell className="text-sm">{new Date(o.observedAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge variant={o.observationType === "POSITIVE" ? "default" : "destructive"}>{o.observationType}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{o.category.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      <Badge variant={o.severity === "CRITICAL" || o.severity === "HIGH" ? "destructive" : o.severity === "MEDIUM" ? "secondary" : "outline"}>{o.severity}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm">{o.description}</TableCell>
                    <TableCell className="text-sm">{o.observedByName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={o.status === "CLOSED" ? "outline" : "secondary"}>{o.status}</Badge>
                      {o.correctiveActionId && <Badge className="ml-1" variant="outline">CA</Badge>}
                    </TableCell>
                    <TableCell>
                      {o.status !== "CLOSED" && (
                        <Button size="sm" variant="outline" data-testid={`button-close-${o.id}`} onClick={() => closeMut.mutate(o.id)}>Close</Button>
                      )}
                    </TableCell>
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

function LinkCard({ to, title, desc, icon: Icon, badges }: { to: string; title: string; desc: string; icon: React.ElementType; badges?: React.ReactNode }) {
  return (
    <Link href={to}>
      <Card className="hover-elevate active-elevate-2 cursor-pointer transition" data-testid={`card-link-${to.replace(/\//g, "-")}`}>
        <CardContent className="p-4 flex items-start gap-3">
          <Icon className="w-8 h-8 text-primary mt-1" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold flex items-center gap-1">{title} <ExternalLink className="w-3 h-3 opacity-50" /></h3>
            <p className="text-sm text-muted-foreground mt-1">{desc}</p>
            {badges && <div className="flex flex-wrap items-center gap-1 mt-2">{badges}</div>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

interface SwpppSummary {
  openCount: number;
  overdueCount: number;
  maxDaysOverdue: number;
}

function SwpppLinkCard() {
  const { data } = useQuery<SwpppSummary>({ queryKey: ["/api/swppp-inspections/summary"] });
  const open = data?.openCount ?? 0;
  const overdue = data?.overdueCount ?? 0;
  const maxDays = data?.maxDaysOverdue ?? 0;
  const total = open + overdue;
  const badges = data ? (
    <>
      <Badge variant={total > 0 ? "secondary" : "outline"} data-testid="badge-swppp-open-total">
        {total} active
      </Badge>
      {overdue > 0 && (
        <Badge variant="destructive" data-testid="badge-swppp-overdue">
          <AlertTriangle className="h-3 w-3 mr-1" />{overdue} overdue
        </Badge>
      )}
      {maxDays > 0 && (
        <Badge variant="outline" className="border-destructive/60 text-destructive bg-destructive/5" data-testid="badge-swppp-max-days-overdue">
          {maxDays} {maxDays === 1 ? "day" : "days"}
        </Badge>
      )}
    </>
  ) : null;
  return (
    <LinkCard
      to="/swppp-inspections"
      title="SWPPP Inspections"
      desc="Stormwater inspections and corrective actions."
      icon={ClipboardList}
      badges={badges}
    />
  );
}

function ModulesTab() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <LinkCard to="/safety-training" title="Training & Certifications" desc="Manage required courses, assignments, and worker certification status." icon={GraduationCap} />
      <LinkCard to="/compliance" title="Compliance & COIs" desc="Track COIs, bonds, DBE certs, licenses, and expirations." icon={FileBadge} />
      <SwpppLinkCard />
      <LinkCard to="/daily-inspector-reports" title="Daily Inspector Reports" desc="Daily field inspection reports and signoffs." icon={ClipboardList} />
      <LinkCard to="/material-certifications" title="Material Certifications" desc="Mill certs and material conformance records." icon={FileText} />
    </div>
  );
}

function OshaLogTab() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const { data: log, isLoading } = useQuery<{ records: Array<{ id: string; caseNumber: string; employeeName: string; dateOfInjury: string; classification: string; daysAwayFromWork: number; daysOfRestrictedDuty: number; injuryIllnessType: string; eventDescription: string }>; summary: Record<string, number> }>({
    queryKey: ["/api/osha-incidents/300-log", year],
    queryFn: async () => {
      const res = await fetch(`/api/osha-incidents/300-log?year=${year}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label>Year:</Label>
          <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="w-28" data-testid="input-osha-year" />
        </div>
        <Button asChild variant="outline" data-testid="button-300a-pdf">
          <a href={`/api/osha-incidents/300a-pdf?year=${year}`} target="_blank" rel="noopener noreferrer">Download 300A PDF</a>
        </Button>
      </div>
      {isLoading ? (
        <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : !log ? null : (
        <>
          <Card>
            <CardHeader><CardTitle>Annual Summary ({year})</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="Total Recordable" value={log.summary.totalRecordable} icon={FileText} />
                <KpiCard label="Deaths" value={log.summary.deaths} icon={AlertTriangle} tone={log.summary.deaths > 0 ? "bad" : "good"} />
                <KpiCard label="Days Away" value={log.summary.totalDaysAway} icon={FileText} />
                <KpiCard label="Restricted Days" value={log.summary.totalDaysRestricted} icon={FileText} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>OSHA 300 Log Entries</CardTitle></CardHeader>
            <CardContent className="p-0">
              {log.records.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground" data-testid="text-no-osha">No recordable incidents for {year}.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Case #</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Classification</TableHead>
                      <TableHead>Days Away</TableHead>
                      <TableHead>Restricted</TableHead>
                      <TableHead>Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {log.records.map((r) => (
                      <TableRow key={r.id} data-testid={`row-osha-${r.id}`}>
                        <TableCell className="font-mono text-xs">{r.caseNumber}</TableCell>
                        <TableCell>{r.employeeName}</TableCell>
                        <TableCell>{r.dateOfInjury}</TableCell>
                        <TableCell><Badge>{r.classification}</Badge></TableCell>
                        <TableCell>{r.daysAwayFromWork}</TableCell>
                        <TableCell>{r.daysOfRestrictedDuty}</TableCell>
                        <TableCell className="text-xs">{r.injuryIllnessType}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export default function SafetyHubPage() {
  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-safety-hub">Safety & Compliance</h1>
          <p className="text-sm text-muted-foreground">Unified hub for incidents, observations, inspections, training, and OSHA reporting.</p>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="observations" data-testid="tab-observations">Observations</TabsTrigger>
          <TabsTrigger value="osha" data-testid="tab-osha">OSHA Logs</TabsTrigger>
          <TabsTrigger value="modules" data-testid="tab-modules">Modules</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard"><SafetyDashboard /></TabsContent>
        <TabsContent value="observations"><ObservationsTab /></TabsContent>
        <TabsContent value="osha"><OshaLogTab /></TabsContent>
        <TabsContent value="modules"><ModulesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
