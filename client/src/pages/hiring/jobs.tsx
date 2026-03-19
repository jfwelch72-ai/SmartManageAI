import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHiringJobs, useJobTemplates } from "@/lib/hiring-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Plus, MoreHorizontal, Search, Briefcase, Eye, Globe, Pause, Archive, Copy,
} from "lucide-react";
import type { HiringJob, HiringJobTemplate } from "@/types/hiring";
import { format } from "date-fns";

const JOB_STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "Draft", variant: "secondary" },
  PUBLISHED: { label: "Published", variant: "default" },
  PAUSED: { label: "Paused", variant: "outline" },
  ARCHIVED: { label: "Archived", variant: "destructive" },
};

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: "Full Time",
  PART_TIME: "Part Time",
  CONTRACT: "Contract",
  TEMP: "Temporary",
  SEASONAL: "Seasonal",
};

type Step = 1 | 2 | 3 | 4;

interface JobForm {
  templateId: string;
  title: string;
  department: string;
  trade: string;
  location: string;
  employmentType: string;
  compensationType: string;
  compensationMin: string;
  compensationMax: string;
  description: string;
  requirements: string;
  screeningQuestion1: string;
  screeningQuestion2: string;
}

const EMPTY_FORM: JobForm = {
  templateId: "",
  title: "",
  department: "",
  trade: "",
  location: "",
  employmentType: "",
  compensationType: "",
  compensationMin: "",
  compensationMax: "",
  description: "",
  requirements: "",
  screeningQuestion1: "",
  screeningQuestion2: "",
};

export default function HiringJobsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<JobForm>(EMPTY_FORM);

  const { data: jobs = [], isLoading } = useHiringJobs();
  const { data: templates = [] } = useJobTemplates();

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/hiring/jobs", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs"] });
      toast({ title: "Job created successfully" });
      setShowCreate(false);
      setStep(1);
      setForm(EMPTY_FORM);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      const res = await apiRequest("POST", `/api/hiring/jobs/${id}/${action}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (job: HiringJob) => {
      const res = await apiRequest("POST", "/api/hiring/jobs", {
        title: `${job.title} (Copy)`,
        department: job.department,
        trade: job.trade,
        location: job.location,
        employmentType: job.employmentType,
        compensationType: job.compensationType,
        compensationMin: job.compensationMin,
        compensationMax: job.compensationMax,
        description: job.description,
        requirements: job.requirements,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/jobs"] });
      toast({ title: "Job duplicated" });
    },
  });

  const filtered = jobs.filter((j) =>
    j.title.toLowerCase().includes(search.toLowerCase()) ||
    (j.department ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function handleTemplateSelect(tplId: string) {
    if (!tplId) {
      setForm((f) => ({ ...f, templateId: "" }));
      return;
    }
    const tpl = templates.find((t) => t.id === tplId);
    if (tpl) {
      setForm((f) => ({
        ...f,
        templateId: tplId,
        title: tpl.title,
        trade: tpl.trade ?? "",
        employmentType: tpl.employmentType ?? "",
        description: tpl.description ?? "",
        requirements: tpl.requirements ?? "",
      }));
    }
  }

  function handleSubmit() {
    const questions: Array<{ question: string }> = [];
    if (form.screeningQuestion1.trim()) questions.push({ question: form.screeningQuestion1.trim() });
    if (form.screeningQuestion2.trim()) questions.push({ question: form.screeningQuestion2.trim() });
    createMutation.mutate({
      title: form.title,
      department: form.department || null,
      trade: form.trade || null,
      location: form.location || null,
      employmentType: form.employmentType || null,
      compensationType: form.compensationType || null,
      compensationMin: form.compensationMin || null,
      compensationMax: form.compensationMax || null,
      description: form.description || null,
      requirements: form.requirements || null,
      screeningQuestions: questions.length > 0 ? questions : null,
    });
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-hiring-jobs">Job Requisitions</h1>
          <p className="text-muted-foreground">Manage open positions and job postings</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="button-create-job">
          <Plus className="w-4 h-4 mr-1" />
          New Job
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search jobs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs h-8"
              data-testid="input-job-search"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {search ? "No jobs match your search" : "No jobs yet. Create your first job posting."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Trade</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((job) => {
                  const cfg = JOB_STATUS_CONFIG[job.status] ?? JOB_STATUS_CONFIG.DRAFT;
                  return (
                    <TableRow key={job.id} data-testid={`row-job-${job.id}`}>
                      <TableCell>
                        <Link href={`/hiring/jobs/${job.id}`} className="font-medium hover:underline" data-testid={`link-job-${job.id}`}>
                          {job.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{job.department ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{job.trade ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {EMPLOYMENT_TYPE_LABELS[job.employmentType ?? ""] ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={cfg.variant}>{cfg.label}</Badge>
                          {job.status === "PUBLISHED" && job.syncedAt && (
                            <span className="text-xs text-muted-foreground" title={`Synced ${new Date(job.syncedAt).toLocaleDateString()}`} data-testid={`sync-state-${job.id}`}>
                              ✓ synced
                            </span>
                          )}
                          {job.status === "PUBLISHED" && !job.syncedAt && (
                            <span className="text-xs text-yellow-600 dark:text-yellow-400" title="Not yet synced to ATS" data-testid={`sync-state-${job.id}`}>
                              pending
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(job.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`menu-job-${job.id}`}>
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/hiring/jobs/${job.id}`}>
                                <Eye className="w-4 h-4 mr-2" />Edit / View
                              </Link>
                            </DropdownMenuItem>
                            {job.status === "DRAFT" && (
                              <DropdownMenuItem onClick={() => actionMutation.mutate({ id: job.id, action: "publish" })} data-testid={`action-publish-${job.id}`}>
                                <Globe className="w-4 h-4 mr-2" />Publish
                              </DropdownMenuItem>
                            )}
                            {job.status === "PUBLISHED" && (
                              <DropdownMenuItem onClick={() => actionMutation.mutate({ id: job.id, action: "archive" })} data-testid={`action-archive-${job.id}`}>
                                <Pause className="w-4 h-4 mr-2" />Archive
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => duplicateMutation.mutate(job)} data-testid={`action-duplicate-${job.id}`}>
                              <Copy className="w-4 h-4 mr-2" />Duplicate
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={(v) => { setShowCreate(v); if (!v) { setStep(1); setForm(EMPTY_FORM); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Job — Step {step} of 4</DialogTitle>
          </DialogHeader>

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Start from a template or create a blank job.</p>
              <div className="space-y-2">
                <Label>Template (optional)</Label>
                <Select value={form.templateId} onValueChange={handleTemplateSelect}>
                  <SelectTrigger data-testid="select-job-template">
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blank">Blank Job</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1">
                  <Label>Job Title *</Label>
                  <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} data-testid="input-job-title" />
                </div>
                <div className="space-y-1">
                  <Label>Department</Label>
                  <Input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} data-testid="input-job-department" />
                </div>
                <div className="space-y-1">
                  <Label>Trade</Label>
                  <Input value={form.trade} onChange={(e) => setForm((f) => ({ ...f, trade: e.target.value }))} data-testid="input-job-trade" />
                </div>
                <div className="space-y-1">
                  <Label>Location</Label>
                  <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} data-testid="input-job-location" />
                </div>
                <div className="space-y-1">
                  <Label>Employment Type</Label>
                  <Select value={form.employmentType} onValueChange={(v) => setForm((f) => ({ ...f, employmentType: v }))}>
                    <SelectTrigger data-testid="select-employment-type">
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
                  <Select value={form.compensationType} onValueChange={(v) => setForm((f) => ({ ...f, compensationType: v }))}>
                    <SelectTrigger data-testid="select-compensation-type">
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
                  <Label>Pay Min</Label>
                  <Input value={form.compensationMin} onChange={(e) => setForm((f) => ({ ...f, compensationMin: e.target.value }))} placeholder="e.g. 25.00" data-testid="input-comp-min" />
                </div>
                <div className="space-y-1">
                  <Label>Pay Max</Label>
                  <Input value={form.compensationMax} onChange={(e) => setForm((f) => ({ ...f, compensationMax: e.target.value }))} placeholder="e.g. 40.00" data-testid="input-comp-max" />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Job Description</Label>
                <Textarea
                  rows={6}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the role, responsibilities, and team..."
                  data-testid="textarea-job-description"
                />
              </div>
              <div className="space-y-1">
                <Label>Requirements</Label>
                <Textarea
                  rows={4}
                  value={form.requirements}
                  onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
                  placeholder="Required experience, licenses, certifications..."
                  data-testid="textarea-job-requirements"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Add up to 2 screening questions for applicants.</p>
              <div className="space-y-1">
                <Label>Question 1</Label>
                <Input
                  value={form.screeningQuestion1}
                  onChange={(e) => setForm((f) => ({ ...f, screeningQuestion1: e.target.value }))}
                  placeholder="e.g. Do you have a valid CDL?"
                  data-testid="input-screening-q1"
                />
              </div>
              <div className="space-y-1">
                <Label>Question 2</Label>
                <Input
                  value={form.screeningQuestion2}
                  onChange={(e) => setForm((f) => ({ ...f, screeningQuestion2: e.target.value }))}
                  placeholder="e.g. Are you available to start within 2 weeks?"
                  data-testid="input-screening-q2"
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between">
            <Button variant="outline" onClick={() => step > 1 ? setStep((s) => (s - 1) as Step) : setShowCreate(false)} data-testid="button-job-back">
              {step === 1 ? "Cancel" : "Back"}
            </Button>
            {step < 4 ? (
              <Button
                onClick={() => setStep((s) => (s + 1) as Step)}
                disabled={step === 2 && !form.title.trim()}
                data-testid="button-job-next"
              >
                Next
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-job-submit">
                {createMutation.isPending ? "Creating..." : "Create Job"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
