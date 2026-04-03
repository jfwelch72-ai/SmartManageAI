import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Globe, Archive, Save, Plus, Trash2 } from "lucide-react";
import type { HiringJob } from "@/types/hiring";

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: "Full Time",
  PART_TIME: "Part Time",
  CONTRACT: "Contract",
  TEMP: "Temporary",
  SEASONAL: "Seasonal",
};

const POSTING_DESTINATIONS = [
  { value: "INDEED", label: "Indeed" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "CRAIGSLIST", label: "Craigslist" },
  { value: "COMPANY_WEBSITE", label: "Company Website" },
  { value: "WORKABLE", label: "Workable (ATS)" },
  { value: "GREENHOUSE", label: "Greenhouse (ATS)" },
  { value: "LEVER", label: "Lever (ATS)" },
];

const JOB_STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "Draft", variant: "secondary" },
  PUBLISHED: { label: "Published", variant: "default" },
  PAUSED: { label: "Paused", variant: "outline" },
  ARCHIVED: { label: "Archived", variant: "destructive" },
};

type EditableJob = Partial<HiringJob> & {
  certificationsList?: string[];
  screeningQuestionsList?: string[];
  postingDestinationsList?: string[];
};

export default function HiringJobDetailPage() {
  const [, params] = useRoute("/hiring/jobs/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const jobId = params?.id;

  const { data: job, isLoading } = useQuery<HiringJob>({
    queryKey: ["/api/hiring/jobs", jobId],
    enabled: !!jobId,
  });

  const [form, setForm] = useState<EditableJob | null>(null);

  function getEditing(): EditableJob {
    if (form) return form;
    if (!job) return {};
    const certsList = job.certificationsRequired
      ? job.certificationsRequired.split("\n").map((s) => s.trim()).filter(Boolean)
      : [];
    let sqList: string[] = [];
    try {
      const parsed = job.screeningQuestionsJson ? JSON.parse(job.screeningQuestionsJson) : [];
      sqList = (parsed as Array<string | { question?: string }>).map(
        (q) => (typeof q === "string" ? q : q.question ?? "")
      );
    } catch { sqList = []; }
    let destList: string[] = [];
    try {
      destList = job.postingDestinationsJson ? JSON.parse(job.postingDestinationsJson) : [];
    } catch { destList = []; }
    return {
      ...job,
      certificationsList: certsList,
      screeningQuestionsList: sqList,
      postingDestinationsList: destList,
    };
  }

  const editing = getEditing();

  function setField(key: keyof EditableJob, value: unknown) {
    setForm((f) => ({ ...(f ?? editing), [key]: value }));
  }

  const isDirty = form !== null;

  const updateMutation = useMutation({
    mutationFn: async (data: EditableJob) => {
      const payload: Record<string, unknown> = { ...data };
      if (data.certificationsList !== undefined) {
        payload.certificationsRequired = data.certificationsList.filter(Boolean).join("\n");
        delete payload.certificationsList;
      }
      if (data.screeningQuestionsList !== undefined) {
        payload.screeningQuestionsJson = JSON.stringify(
          data.screeningQuestionsList.filter(Boolean).map((q) => ({ question: q }))
        );
        delete payload.screeningQuestionsList;
      }
      if (data.postingDestinationsList !== undefined) {
        payload.postingDestinationsJson = JSON.stringify(data.postingDestinationsList.filter(Boolean));
        delete payload.postingDestinationsList;
      }
      const res = await apiRequest("PATCH", `/api/hiring/jobs/${jobId}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs", jobId] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs"] });
      toast({ title: "Job saved" });
      setForm(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const actionMutation = useMutation({
    mutationFn: async (action: string) => {
      const res = await apiRequest("POST", `/api/hiring/jobs/${jobId}/${action}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs", jobId] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Job not found.</p>
        <Button variant="ghost" onClick={() => navigate("/hiring?tab=jobs")} className="px-0 mt-2">
          <ArrowLeft className="w-4 h-4 mr-1" />Back to Jobs
        </Button>
      </div>
    );
  }

  const cfg = JOB_STATUS_CONFIG[job.status] ?? JOB_STATUS_CONFIG.DRAFT;
  const certList: string[] = editing.certificationsList ?? [];
  const sqList: string[] = editing.screeningQuestionsList ?? [];
  const destList: string[] = editing.postingDestinationsList ?? [];

  function addCert() { setField("certificationsList", [...certList, ""]); }
  function removeCert(i: number) { setField("certificationsList", certList.filter((_, idx) => idx !== i)); }
  function updateCert(i: number, val: string) { setField("certificationsList", certList.map((c, idx) => idx === i ? val : c)); }

  function addSQ() { setField("screeningQuestionsList", [...sqList, ""]); }
  function removeSQ(i: number) { setField("screeningQuestionsList", sqList.filter((_, idx) => idx !== i)); }
  function updateSQ(i: number, val: string) { setField("screeningQuestionsList", sqList.map((q, idx) => idx === i ? val : q)); }

  function toggleDest(dest: string) {
    const next = destList.includes(dest)
      ? destList.filter((d) => d !== dest)
      : [...destList, dest];
    setField("postingDestinationsList", next);
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/hiring?tab=jobs")} className="mb-1 -ml-2" data-testid="button-back-jobs">
            <ArrowLeft className="w-4 h-4 mr-1" />Jobs
          </Button>
          <h1 className="text-2xl font-bold" data-testid="heading-job-title">{job.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={cfg.variant}>{cfg.label}</Badge>
            {job.trade && <span className="text-sm text-muted-foreground">{job.trade}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isDirty && (
            <Button onClick={() => updateMutation.mutate(form!)} disabled={updateMutation.isPending} data-testid="button-save-job">
              <Save className="w-4 h-4 mr-1" />
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          )}
          {job.status === "DRAFT" && (
            <Button variant="outline" onClick={() => actionMutation.mutate("publish")} disabled={actionMutation.isPending} data-testid="button-publish-job">
              <Globe className="w-4 h-4 mr-1" />Publish
            </Button>
          )}
          {job.status === "PUBLISHED" && (
            <Button variant="outline" onClick={() => actionMutation.mutate("archive")} disabled={actionMutation.isPending} data-testid="button-archive-job">
              <Archive className="w-4 h-4 mr-1" />Archive
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Job Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Title</Label>
                  <Input value={editing.title ?? ""} onChange={(e) => setField("title", e.target.value)} data-testid="input-edit-job-title" />
                </div>
                <div className="space-y-1">
                  <Label>Department</Label>
                  <Input value={editing.department ?? ""} onChange={(e) => setField("department", e.target.value)} data-testid="input-edit-department" />
                </div>
                <div className="space-y-1">
                  <Label>Trade</Label>
                  <Input value={editing.trade ?? ""} onChange={(e) => setField("trade", e.target.value)} data-testid="input-edit-trade" />
                </div>
                <div className="space-y-1">
                  <Label>Location</Label>
                  <Input value={editing.location ?? ""} onChange={(e) => setField("location", e.target.value)} data-testid="input-edit-location" />
                </div>
                <div className="space-y-1">
                  <Label>Employment Type</Label>
                  <Select value={editing.employmentType ?? ""} onValueChange={(v) => setField("employmentType", v)}>
                    <SelectTrigger data-testid="select-edit-employment-type">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Compensation Type</Label>
                  <Select value={editing.compensationType ?? ""} onValueChange={(v) => setField("compensationType", v)}>
                    <SelectTrigger data-testid="select-edit-compensation-type">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HOURLY">Hourly</SelectItem>
                      <SelectItem value="SALARY">Salary</SelectItem>
                      <SelectItem value="PREVAILING_WAGE">Prevailing Wage</SelectItem>
                      <SelectItem value="PIECE_RATE">Piece Rate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Min Pay</Label>
                  <Input value={editing.compensationMin ?? ""} onChange={(e) => setField("compensationMin", e.target.value)} data-testid="input-edit-comp-min" />
                </div>
                <div className="space-y-1">
                  <Label>Max Pay</Label>
                  <Input value={editing.compensationMax ?? ""} onChange={(e) => setField("compensationMax", e.target.value)} data-testid="input-edit-comp-max" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Description & Requirements</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Job Description</Label>
                <Textarea rows={6} value={editing.description ?? ""} onChange={(e) => setField("description", e.target.value)} data-testid="textarea-edit-description" />
              </div>
              <div className="space-y-1">
                <Label>Requirements</Label>
                <Textarea rows={4} value={editing.requirements ?? ""} onChange={(e) => setField("requirements", e.target.value)} data-testid="textarea-edit-requirements" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Certifications</CardTitle>
                <Button size="sm" variant="outline" onClick={addCert} data-testid="button-add-cert">
                  <Plus className="w-3.5 h-3.5 mr-1" />Add
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {certList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No certifications required. Click Add to specify.</p>
              ) : (
                certList.map((cert, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={cert}
                      onChange={(e) => updateCert(i, e.target.value)}
                      placeholder="e.g. OSHA 10, First Aid, CDL-A"
                      data-testid={`input-cert-${i}`}
                    />
                    <Button size="icon" variant="ghost" className="shrink-0 text-destructive" onClick={() => removeCert(i)} data-testid={`button-remove-cert-${i}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Screening Questions</CardTitle>
                <Button size="sm" variant="outline" onClick={addSQ} disabled={sqList.length >= 5} data-testid="button-add-screening-question">
                  <Plus className="w-3.5 h-3.5 mr-1" />Add
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {sqList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No screening questions. Click Add to create one.</p>
              ) : (
                sqList.map((q, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={q}
                      onChange={(e) => updateSQ(i, e.target.value)}
                      placeholder={`Question ${i + 1}`}
                      data-testid={`input-sq-${i}`}
                    />
                    <Button size="icon" variant="ghost" className="shrink-0 text-destructive" onClick={() => removeSQ(i)} data-testid={`button-remove-sq-${i}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Posting Status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={cfg.variant}>{cfg.label}</Badge>
              </div>
              {job.lastSyncedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Last Synced</span>
                  <span className="text-sm">{new Date(job.lastSyncedAt).toLocaleDateString()}</span>
                </div>
              )}
              {job.externalJobId && (
                <div>
                  <span className="text-xs text-muted-foreground">External ID: {job.externalJobId}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Posting Destinations</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">Select where this job should be posted when published.</p>
              <div className="space-y-2" data-testid="posting-destinations">
                {POSTING_DESTINATIONS.map(({ value, label }) => {
                  const active = destList.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleDest(value)}
                      data-testid={`dest-toggle-${value}`}
                      className={`w-full text-left flex items-center justify-between px-3 py-2 rounded border text-sm transition-all ${
                        active
                          ? "border-primary bg-primary/5 text-primary font-medium"
                          : "border-border text-muted-foreground hover:border-foreground/40"
                      }`}
                    >
                      {label}
                      {active && <span className="text-xs">✓</span>}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
