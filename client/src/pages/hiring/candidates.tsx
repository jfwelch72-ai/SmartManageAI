import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Search, Star, X } from "lucide-react";
import { useHiringCandidates, useHiringJobs } from "@/lib/hiring-api";
import { format, isWithinInterval, parseISO, startOfDay, endOfDay } from "date-fns";
import type { HiringCandidate } from "@/types/hiring";

const STAGE_COLORS: Record<string, string> = {
  APPLIED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  SCREENING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  PHONE_INTERVIEW: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  IN_PERSON_INTERVIEW: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  SKILLS_ASSESSMENT: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400",
  BACKGROUND_CHECK: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  REFERENCE_CHECK: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  OFFER_EXTENDED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  HIRED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  ARCHIVED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const STAGE_LABELS: Record<string, string> = {
  APPLIED: "Applied",
  SCREENING: "Screening",
  PHONE_INTERVIEW: "Phone Interview",
  IN_PERSON_INTERVIEW: "In-Person",
  SKILLS_ASSESSMENT: "Skills Test",
  BACKGROUND_CHECK: "Background Check",
  REFERENCE_CHECK: "References",
  OFFER_EXTENDED: "Offer Extended",
  HIRED: "Hired",
  REJECTED: "Rejected",
  ARCHIVED: "Archived",
};

const SOURCE_LABELS: Record<string, string> = {
  INDEED: "Indeed",
  LINKEDIN: "LinkedIn",
  REFERRAL: "Referral",
  DIRECT: "Direct",
  CRAIGSLIST: "Craigslist",
  COMPANY_WEBSITE: "Company Site",
  ATS_SYNC: "ATS Sync",
  OTHER: "Other",
};

const AI_SCORE_FILTERS = [
  { value: "ALL", label: "All Scores" },
  { value: "HIGH", label: "High (80+)" },
  { value: "MED", label: "Medium (50-79)" },
  { value: "LOW", label: "Low (<50)" },
  { value: "NONE", label: "Not Scored" },
];

const ALL_STAGES = Object.keys(STAGE_LABELS);

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

function matchesAiScore(score: number | null, filter: string): boolean {
  if (filter === "ALL") return true;
  if (filter === "NONE") return score == null;
  if (filter === "HIGH") return score != null && score >= 80;
  if (filter === "MED") return score != null && score >= 50 && score < 80;
  if (filter === "LOW") return score != null && score < 50;
  return true;
}

function matchesDateRange(appliedAt: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!appliedAt) return false;
  const date = parseISO(appliedAt);
  const start = from ? startOfDay(parseISO(from)) : new Date(0);
  const end = to ? endOfDay(parseISO(to)) : new Date(8640000000000000);
  return isWithinInterval(date, { start, end });
}

function reviewerDisplay(candidate: HiringCandidate): string | null {
  if (!candidate.reviewerUserId) return null;
  return candidate.reviewerUserId.slice(0, 6).toUpperCase();
}

export default function HiringCandidatesPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [aiScoreFilter, setAiScoreFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: candidates = [], isLoading } = useHiringCandidates();
  const { data: jobs = [] } = useHiringJobs();

  const jobsById = Object.fromEntries(jobs.map((j) => [j.id, j]));

  const filtered = candidates.filter((c) => {
    const matchSearch =
      !search ||
      c.fullName.toLowerCase().includes(search.toLowerCase()) ||
      (c.email ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStage = selectedStages.length === 0 || selectedStages.includes(c.currentStage);
    const matchSource = sourceFilter === "ALL" || c.source === sourceFilter;
    const matchRole =
      roleFilter === "ALL" || (c.jobId ? jobsById[c.jobId]?.title === roleFilter : false);
    const matchAi = matchesAiScore(c.aiScore, aiScoreFilter);
    const matchDate = matchesDateRange(c.appliedAt, dateFrom, dateTo);
    return matchSearch && matchStage && matchSource && matchRole && matchAi && matchDate;
  });

  const uniqueRoles = Array.from(new Set(
    candidates.filter((c) => c.jobId && jobsById[c.jobId]).map((c) => jobsById[c.jobId!]?.title)
  )).filter(Boolean) as string[];

  function toggleStage(stage: string) {
    setSelectedStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]
    );
  }

  const activeFilters =
    selectedStages.length +
    (sourceFilter !== "ALL" ? 1 : 0) +
    (roleFilter !== "ALL" ? 1 : 0) +
    (aiScoreFilter !== "ALL" ? 1 : 0) +
    (search ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  function clearFilters() {
    setSearch("");
    setSelectedStages([]);
    setSourceFilter("ALL");
    setRoleFilter("ALL");
    setAiScoreFilter("ALL");
    setDateFrom("");
    setDateTo("");
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold" data-testid="heading-candidates">Candidates</h1>
        <p className="text-muted-foreground">All applicants across your open roles</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search candidates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 max-w-xs h-8"
                data-testid="input-candidate-search"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-44 h-8" data-testid="select-role-filter">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Roles</SelectItem>
                {uniqueRoles.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-40 h-8" data-testid="select-source-filter">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Sources</SelectItem>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={aiScoreFilter} onValueChange={setAiScoreFilter}>
              <SelectTrigger className="w-36 h-8" data-testid="select-ai-score-filter">
                <SelectValue placeholder="AI Score" />
              </SelectTrigger>
              <SelectContent>
                {AI_SCORE_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-end gap-1.5">
              <div className="space-y-0.5">
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-8 w-36"
                  data-testid="input-date-from"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-8 w-36"
                  data-testid="input-date-to"
                />
              </div>
            </div>
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 px-2" data-testid="button-clear-filters">
                <X className="w-3 h-3 mr-1" />Clear ({activeFilters})
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-1 mt-2" data-testid="stage-multi-select">
            {ALL_STAGES.map((stage) => {
              const active = selectedStages.includes(stage);
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => toggleStage(stage)}
                  data-testid={`stage-toggle-${stage}`}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-all ${
                    active
                      ? STAGE_COLORS[stage] + " border-current"
                      : "border-border text-muted-foreground hover:border-foreground/40"
                  }`}
                >
                  {STAGE_LABELS[stage]}
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No candidates found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead>AI Score</TableHead>
                  <TableHead>Reviewer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const job = c.jobId ? jobsById[c.jobId] : null;
                  const rev = reviewerDisplay(c);
                  return (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer hover:bg-muted/50"
                      data-testid={`row-candidate-${c.id}`}
                      onClick={() => navigate(`/hiring/candidates/${c.id}`)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate(`/hiring/candidates/${c.id}`); }}
                      tabIndex={0}
                      role="link"
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Link href={`/hiring/candidates/${c.id}`} className="flex items-center gap-2" data-testid={`link-candidate-${c.id}`}>
                          <Avatar className="w-8 h-8">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials(c.fullName)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{c.fullName}</p>
                            {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {job?.title ?? "—"}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[c.currentStage] ?? ""}`}>
                          {STAGE_LABELS[c.currentStage] ?? c.currentStage}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {SOURCE_LABELS[c.source ?? ""] ?? c.source ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {c.appliedAt ? format(new Date(c.appliedAt), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        {c.aiScore != null ? (
                          <div className="flex items-center gap-1">
                            <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                            <span className="text-sm font-medium">{c.aiScore}</span>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {rev ? (
                          <div className="flex items-center gap-1.5" data-testid={`reviewer-${c.id}`}>
                            <Avatar className="w-6 h-6">
                              <AvatarFallback className="text-xs bg-secondary text-secondary-foreground">{rev}</AvatarFallback>
                            </Avatar>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
