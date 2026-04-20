import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Calendar as CalendarIcon,
  Clock,
  AlertTriangle,
  Play,
  Pause,
  Flag,
  Users,
  Zap,
  RefreshCw,
  Lock,
  Unlock,
  TrendingUp,
  BarChart3,
  ArrowRight,
  Link2,
  Target,
  ChevronRight,
  ChevronDown,
  Plus,
  Lightbulb,
  X,
  Eye,
  EyeOff,
  Download,
  FileImage,
  FileText,
  Archive,
  ArchiveRestore,
  Trash2,
  Save,
  History,
  Mail,
  Send,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, differenceInDays, parseISO } from "date-fns";

interface ScheduleTask {
  id: string;
  name: string;
  description?: string;
  tradeType: string;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  durationDays: number;
  dependencies: string[];
  isCriticalPath: boolean;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" | "DELAYED" | "ON_HOLD";
  percentComplete: number;
  crewId?: string;
  crewIds?: string[];
  sortOrder: number;
  earlyStart?: string;
  earlyFinish?: string;
  lateStart?: string;
  lateFinish?: string;
  totalFloat?: number;
  freeFloat?: number;
  baselineStartDate?: string;
  baselineEndDate?: string;
  parentTaskId?: string | null;
  isMilestone?: boolean;
}

interface AIRecommendation {
  id: string;
  recommendationType: string;
  title: string;
  description: string;
  estimatedDaysImprovement?: number | null;
  estimatedCostSavings?: string | null;
  isApplied: boolean;
}

interface ProjectSchedule {
  id: string;
  name: string;
  generatedBy: string;
  baselineStartDate: string;
  baselineEndDate?: string;
  workingDays: number[];
  isActive: boolean;
  createdAt: string;
  baselineLocked?: boolean;
  baselineLockedAt?: string;
  activeBaselineId?: string | null;
  projectedCompletionDate?: string;
  spiValue?: string;
}

interface SavedBaseline {
  id: string;
  scheduleId: string;
  name: string;
  lockedAt: string;
  lockedByUserId: string | null;
  isArchived: boolean;
  scheduleStartDate: string | null;
  scheduleEndDate: string | null;
  notes: string | null;
  createdAt: string;
  lockedByFirstName?: string | null;
  lockedByLastName?: string | null;
  lockedByEmail?: string | null;
}

interface BaselinesResponse {
  baselines: SavedBaseline[];
  activeBaselineId: string | null;
}

interface ForecastData {
  forecast: {
    projectedCompletionDate: string | null;
    spiValue: number | null;
    baselineEndDate: string | null;
    baselineVarianceDays: number | null;
    overallProgress: number;
    criticalPathDaysRemaining: number;
    baselineLocked: boolean;
  } | null;
  snapshots: Array<{
    snapshotDate: string;
    projectedCompletionDate: string;
    spiValue: string;
    overallProgress: number;
  }>;
}

interface ResourceData {
  allocations: Array<{
    crewId: string;
    crewName: string;
    taskId: string;
    taskName: string;
    startDate: string;
    endDate: string;
  }>;
  overAllocations: Array<{
    crewId: string;
    crewName: string;
    date: string;
    tasks: string[];
  }>;
  crews: Array<{ id: string; name: string }>;
}

interface AiSchedulingPanelProps {
  projectId: string;
  projectCode: string;
  projectName: string;
  tradeType?: string;
}

function workingDaysBetweenDates(
  fromIso: string,
  toIso: string,
  workingDays: number[] = [1, 2, 3, 4, 5],
): number {
  const from = parseISO(fromIso);
  const to = parseISO(toIso);
  if (from.getTime() === to.getTime()) return 0;
  const sign = to < from ? -1 : 1;
  const start = sign > 0 ? from : to;
  const end = sign > 0 ? to : from;
  const wd = workingDays.length > 0 ? workingDays : [1, 2, 3, 4, 5];
  let count = 0;
  const cur = new Date(start);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    if (wd.includes(cur.getDay())) count++;
  }
  return sign * count;
}

const STATUS_CONFIG = {
  NOT_STARTED: { color: "bg-gray-100 text-gray-600", icon: Clock, label: "Not Started" },
  IN_PROGRESS: { color: "bg-blue-100 text-blue-600", icon: Play, label: "In Progress" },
  COMPLETE: { color: "bg-green-100 text-green-600", icon: CheckCircle2, label: "Complete" },
  DELAYED: { color: "bg-red-100 text-red-600", icon: AlertTriangle, label: "Delayed" },
  ON_HOLD: { color: "bg-yellow-100 text-yellow-600", icon: Pause, label: "On Hold" },
};

export default function AiSchedulingPanel({ projectId, projectCode, projectName, tradeType }: AiSchedulingPanelProps) {
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [manualCreateOpen, setManualCreateOpen] = useState(false);
  const [manualName, setManualName] = useState("Master Schedule");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [selectedTask, setSelectedTask] = useState<ScheduleTask | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [depDialogOpen, setDepDialogOpen] = useState(false);
  const [depTask, setDepTask] = useState<ScheduleTask | null>(null);
  const [depSelected, setDepSelected] = useState<string[]>([]);
  const [activeSubTab, setActiveSubTab] = useState("gantt");
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskDuration, setNewTaskDuration] = useState(1);
  const [newTaskParentId, setNewTaskParentId] = useState<string>("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDuration, setEditDuration] = useState(1);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showBaseline, setShowBaseline] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const ganttExportRef = useRef<HTMLDivElement>(null);
  const [saveBaselineOpen, setSaveBaselineOpen] = useState(false);
  const [newBaselineName, setNewBaselineName] = useState("");
  const [newBaselineNotes, setNewBaselineNotes] = useState("");
  const [manageBaselinesOpen, setManageBaselinesOpen] = useState(false);

  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedRecipientEmails, setSelectedRecipientEmails] = useState<Set<string>>(new Set());
  const [extraRecipientsInput, setExtraRecipientsInput] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  const { toast } = useToast();

  interface ScheduleResponse {
    schedule: ProjectSchedule | null;
    tasks: ScheduleTask[];
  }

  const { data: scheduleData, isLoading, refetch } = useQuery<ScheduleResponse>({
    queryKey: ["/api/projects", projectCode, "schedule"],
  });

  const SERVER_RENDER_TASK_THRESHOLD = 100;
  const SERVER_RENDER_DAY_THRESHOLD = 365;

  const renderGanttPdf = useCallback(async (): Promise<{ blob: Blob; filename: string } | null> => {
    if (!ganttExportRef.current) return null;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const html2canvasMod = await import("html2canvas");
    const html2canvas = html2canvasMod.default;
    const isDark = document.documentElement.classList.contains("dark");
    const bgColor = isDark ? "#0a0a0a" : "#ffffff";
    const target = ganttExportRef.current!;
    const canvas = await html2canvas(target, {
      backgroundColor: bgColor,
      scale: 2,
      useCORS: true,
      windowWidth: target.scrollWidth,
    });
    const jsPdfMod = await import("jspdf");
    const JsPDF = jsPdfMod.jsPDF;
    const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
    const pdf = new JsPDF({
      orientation,
      unit: "pt",
      format: [canvas.width, canvas.height],
    });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
    const today = format(new Date(), "yyyy-MM-dd");
    const safeCode = (projectCode || "project").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${safeCode}-schedule-${today}.pdf`;
    const blob = pdf.output("blob");
    return { blob, filename };
  }, [projectCode]);

  const exportGanttServerSide = useCallback(async (): Promise<boolean> => {
    const isDark = document.documentElement.classList.contains("dark");
    const today = format(new Date(), "yyyy-MM-dd");
    const safeCode = (projectCode || "project").replace(/[^a-zA-Z0-9_-]/g, "_");
    const baseName = `${safeCode}-schedule-${today}`;
    try {
      const res = await apiRequest(
        "POST",
        `/api/projects/${projectCode}/schedule/export-pdf`,
        { theme: isDark ? "dark" : "light", showBaseline: true },
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `${baseName}.pdf`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: "Gantt exported", description: `${baseName}.pdf (server rendered)` });
      return true;
    } catch (err) {
      console.warn("Server-side Gantt export failed, falling back to client renderer", err);
      return false;
    }
  }, [projectCode, toast]);

  const handleExportGantt = useCallback(async (kind: "png" | "pdf") => {
    if (!ganttExportRef.current) return;
    setIsExporting(true);
    try {
      const taskCount = scheduleData?.tasks.length || 0;
      let durationDays = 0;
      const tasks = scheduleData?.tasks || [];
      if (tasks.length > 0) {
        const dates = tasks
          .flatMap((t) => [t.plannedStartDate, t.plannedEndDate])
          .filter(Boolean) as string[];
        if (dates.length > 0) {
          const min = Math.min(...dates.map((d) => new Date(d).getTime()));
          const max = Math.max(...dates.map((d) => new Date(d).getTime()));
          durationDays = Math.max(1, Math.round((max - min) / 86_400_000));
        }
      }
      const shouldUseServer =
        kind === "pdf" &&
        (taskCount > SERVER_RENDER_TASK_THRESHOLD || durationDays > SERVER_RENDER_DAY_THRESHOLD);

      if (shouldUseServer) {
        const ok = await exportGanttServerSide();
        if (ok) {
          return;
        }
        toast({
          title: "Falling back to in-browser export",
          description: "Server renderer unavailable; large schedules may be clipped.",
          variant: "destructive",
        });
      }

      if (kind === "pdf") {
        const result = await renderGanttPdf();
        if (!result) return;
        const link = document.createElement("a");
        link.download = result.filename;
        link.href = URL.createObjectURL(result.blob);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        toast({ title: "Gantt exported", description: result.filename });
      } else {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const html2canvasMod = await import("html2canvas");
        const html2canvas = html2canvasMod.default;
        const isDark = document.documentElement.classList.contains("dark");
        const bgColor = isDark ? "#0a0a0a" : "#ffffff";
        const target = ganttExportRef.current!;
        const canvas = await html2canvas(target, {
          backgroundColor: bgColor,
          scale: 2,
          useCORS: true,
          windowWidth: target.scrollWidth,
        });
        const today = format(new Date(), "yyyy-MM-dd");
        const safeCode = (projectCode || "project").replace(/[^a-zA-Z0-9_-]/g, "_");
        const baseName = `${safeCode}-schedule-${today}`;
        const link = document.createElement("a");
        link.download = `${baseName}.png`;
        link.href = canvas.toDataURL("image/png");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast({ title: "Gantt exported", description: `${baseName}.png` });
      }
    } catch (err) {
      console.error("Gantt export failed", err);
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unable to export Gantt chart",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }, [projectCode, renderGanttPdf, exportGanttServerSide, scheduleData, toast]);

  interface ScheduleEmailRecipient {
    id: string;
    name: string;
    email: string;
    role: string;
    source: "PROJECT_CLIENT" | "GC_CONTACT" | "OWNER_REP_CONTACT";
  }

  const { data: recipientData, isLoading: isRecipientsLoading } = useQuery<{ recipients: ScheduleEmailRecipient[] }>({
    queryKey: ["/api/ai-features/schedule", projectId, "email-recipients"],
    enabled: sendDialogOpen && !!projectId,
  });

  const openSendDialog = useCallback(() => {
    setSendSubject(`${projectName} (${projectCode}) — Schedule update`);
    setSendMessage("Sharing the latest project schedule for your review. Please let us know if you have any questions before our next progress meeting.");
    setSelectedRecipientEmails(new Set());
    setExtraRecipientsInput("");
    setSendDialogOpen(true);
  }, [projectCode, projectName]);

  const toggleRecipient = useCallback((email: string) => {
    setSelectedRecipientEmails(prev => {
      const next = new Set(prev);
      const key = email.trim().toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleSendGanttEmail = useCallback(async () => {
    const directory = recipientData?.recipients || [];
    const directoryByEmail = new Map(directory.map(r => [r.email.trim().toLowerCase(), r] as const));
    const collected: Array<{ email: string; name?: string }> = [];
    const seen = new Set<string>();

    for (const key of Array.from(selectedRecipientEmails)) {
      const r = directoryByEmail.get(key);
      if (!r) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push({ email: r.email, name: r.name });
    }

    const extraRaw = extraRecipientsInput
      .split(/[\s,;]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalid: string[] = [];
    for (const e of extraRaw) {
      if (!emailRe.test(e)) {
        invalid.push(e);
        continue;
      }
      const key = e.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push({ email: e });
    }

    if (invalid.length > 0) {
      toast({
        title: "Invalid email address",
        description: `Could not parse: ${invalid.join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    if (collected.length === 0) {
      toast({
        title: "No recipients selected",
        description: "Pick at least one project contact or enter an email.",
        variant: "destructive",
      });
      return;
    }

    if (!sendSubject.trim()) {
      toast({
        title: "Subject is required",
        description: "Add a subject line before sending.",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);
    try {
      const rendered = await renderGanttPdf();
      if (!rendered) throw new Error("Could not render the Gantt PDF");

      const fd = new FormData();
      fd.append(
        "payload",
        JSON.stringify({
          recipients: collected,
          subject: sendSubject.trim(),
          message: sendMessage,
          filename: rendered.filename,
        }),
      );
      fd.append("pdf", new File([rendered.blob], rendered.filename, { type: "application/pdf" }));

      const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : "";

      const res = await fetch(`/api/ai-features/schedule/${projectId}/email`, {
        method: "POST",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
        body: fd,
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Send failed (${res.status})`);
      }

      const sentCount = data?.successCount ?? collected.length;
      const failed = data?.failureCount ?? 0;
      toast({
        title: "Schedule emailed",
        description:
          failed > 0
            ? `Sent to ${sentCount} of ${sentCount + failed} recipients`
            : `Sent to ${sentCount} recipient${sentCount === 1 ? "" : "s"}`,
      });
      setSendDialogOpen(false);
    } catch (err) {
      toast({
        title: "Failed to send",
        description: err instanceof Error ? err.message : "Unable to email the Gantt PDF",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  }, [extraRecipientsInput, projectId, recipientData, renderGanttPdf, selectedRecipientEmails, sendMessage, sendSubject, toast]);

  const { data: forecastData } = useQuery<ForecastData>({
    queryKey: ["/api/projects", projectCode, "schedule", "forecast"],
    enabled: !!scheduleData?.schedule,
  });

  const { data: resourceData } = useQuery<ResourceData>({
    queryKey: ["/api/projects", projectCode, "schedule", "resource-loading"],
    enabled: !!scheduleData?.schedule,
  });

  const { data: recommendationsData } = useQuery<{ recommendations: AIRecommendation[] }>({
    queryKey: ["/api/projects", projectCode, "schedule", "recommendations"],
    enabled: !!scheduleData?.schedule,
  });

  const { data: baselinesData } = useQuery<BaselinesResponse>({
    queryKey: ["/api/projects", projectCode, "schedule", "baselines"],
    enabled: !!scheduleData?.schedule,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/ai-schedule`, { startDate });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "recommendations"] });
      setGenerateDialogOpen(false);
      toast({ title: "Schedule Generated", description: `AI created ${data.tasks?.length || 0} tasks` });
    },
    onError: (error: any) => {
      toast({ title: "Generation Failed", description: error.message || "Failed to generate schedule", variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, updates }: { taskId: string; updates: Partial<ScheduleTask> }) => {
      const response = await apiRequest("PATCH", `/api/projects/${projectCode}/schedule/tasks/${taskId}`, updates);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      setTaskDialogOpen(false);
      toast({ title: "Task Updated", description: "Schedule recalculated with CPM engine" });
    },
    onError: (error: any) => {
      toast({ title: "Update Failed", description: error.message || "Failed to update task", variant: "destructive" });
    },
  });

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/schedule/recalculate`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      toast({ title: "Schedule Recalculated", description: "CPM engine updated all dates and critical path" });
    },
    onError: (error: any) => {
      toast({ title: "Recalculation Failed", description: error.message, variant: "destructive" });
    },
  });

  const lockBaselineMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/schedule/lock-baseline`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "baselines"] });
      toast({ title: "Baseline Locked", description: "Current schedule dates saved as baseline" });
    },
  });

  const unlockBaselineMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/schedule/unlock-baseline`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "baselines"] });
      toast({ title: "Baseline Unlocked" });
    },
  });

  const createBaselineMutation = useMutation({
    mutationFn: async ({ name, notes }: { name: string; notes?: string }) => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/schedule/baselines`, { name, notes, setActive: true });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "baselines"] });
      setSaveBaselineOpen(false);
      setNewBaselineName("");
      setNewBaselineNotes("");
      toast({ title: "Baseline saved", description: "Current schedule dates saved as a new baseline" });
    },
    onError: (error: any) => {
      toast({ title: "Save failed", description: error.message || "Failed to save baseline", variant: "destructive" });
    },
  });

  const setActiveBaselineMutation = useMutation({
    mutationFn: async (baselineId: string | null) => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/schedule/active-baseline`, { baselineId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "baselines"] });
      toast({ title: "Active baseline updated" });
    },
  });

  const archiveBaselineMutation = useMutation({
    mutationFn: async ({ id, isArchived }: { id: string; isArchived: boolean }) => {
      const response = await apiRequest("PATCH", `/api/projects/${projectCode}/schedule/baselines/${id}`, { isArchived });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "baselines"] });
      toast({ title: "Baseline archived" });
    },
  });

  const deleteBaselineMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/projects/${projectCode}/schedule/baselines/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "baselines"] });
      toast({ title: "Baseline deleted" });
    },
  });

  const updateDepsMutation = useMutation({
    mutationFn: async ({ taskId, dependencies }: { taskId: string; dependencies: string[] }) => {
      const response = await apiRequest("PATCH", `/api/projects/${projectCode}/schedule/tasks/${taskId}/dependencies`, { dependencies });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      setDepDialogOpen(false);
      toast({ title: "Dependencies Updated", description: "Schedule recalculated" });
    },
  });

  const createManualScheduleMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/schedule/create`, {
        name: manualName,
        startDate,
        workingDays,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      setManualCreateOpen(false);
      toast({ title: "Schedule Created", description: "Empty schedule created. Add tasks to get started." });
    },
    onError: (error: any) => {
      toast({ title: "Creation Failed", description: error.message || "Failed to create schedule", variant: "destructive" });
    },
  });

  const addTaskMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectCode}/schedule/tasks`, {
        name: newTaskName,
        description: newTaskDescription,
        durationDays: newTaskDuration,
        parentTaskId: newTaskParentId || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "forecast"] });
      setAddTaskOpen(false);
      setNewTaskName("");
      setNewTaskDescription("");
      setNewTaskDuration(1);
      setNewTaskParentId("");
      toast({ title: "Task Added", description: "New task added to schedule" });
    },
    onError: (error: any) => {
      toast({ title: "Add Failed", description: error.message, variant: "destructive" });
    },
  });

  const dismissRecommendationMutation = useMutation({
    mutationFn: async (recId: string) => {
      const response = await apiRequest("PATCH", `/api/projects/${projectCode}/schedule/recommendations/${recId}/dismiss`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "schedule", "recommendations"] });
      toast({ title: "Recommendation Dismissed" });
    },
  });

  const toggleWorkingDay = (day: number) => {
    setWorkingDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  const handleTaskClick = (task: ScheduleTask) => {
    setSelectedTask(task);
    setEditName(task.name);
    setEditDescription(task.description || "");
    setEditDuration(task.durationDays);
    setTaskDialogOpen(true);
  };

  const handleSaveTaskEdits = () => {
    if (!selectedTask) return;
    const updates: Partial<ScheduleTask> = {};
    if (editName !== selectedTask.name) updates.name = editName;
    if (editDescription !== (selectedTask.description || "")) updates.description = editDescription;
    if (editDuration !== selectedTask.durationDays) updates.durationDays = editDuration;
    if (Object.keys(updates).length > 0) {
      updateTaskMutation.mutate({ taskId: selectedTask.id, updates });
    }
  };

  const toggleCollapse = (taskId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleStatusChange = (status: ScheduleTask["status"]) => {
    if (!selectedTask) return;
    const updates: Partial<ScheduleTask> = { status };
    if (status === "IN_PROGRESS" && !selectedTask.actualStartDate) {
      updates.actualStartDate = format(new Date(), "yyyy-MM-dd");
    }
    if (status === "COMPLETE" && !selectedTask.actualEndDate) {
      updates.actualEndDate = format(new Date(), "yyyy-MM-dd");
      updates.percentComplete = 100;
    }
    updateTaskMutation.mutate({ taskId: selectedTask.id, updates });
  };

  const openDepDialog = (task: ScheduleTask) => {
    setDepTask(task);
    setDepSelected(task.dependencies || []);
    setDepDialogOpen(true);
  };

  const schedule = scheduleData?.schedule;
  const tasks = scheduleData?.tasks || [];

  useEffect(() => {
    if (schedule) setShowBaseline(!!schedule.baselineLocked);
  }, [schedule?.id, schedule?.baselineLocked]);
  const criticalPathTasks = tasks.filter(t => t.isCriticalPath);
  const completedTasks = tasks.filter(t => t.status === "COMPLETE");
  const delayedTasks = tasks.filter(t => t.status === "DELAYED");
  const overallProgress = tasks.length > 0
    ? Math.round(tasks.reduce((sum, t) => sum + (t.percentComplete || 0), 0) / tasks.length)
    : 0;

  const sortedTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    return sorted;
  }, [tasks]);

  const wbsTasks = useMemo(() => {
    const rootTasks = sortedTasks.filter(t => !t.parentTaskId);
    const childMap = new Map<string, ScheduleTask[]>();
    for (const t of sortedTasks) {
      if (t.parentTaskId) {
        if (!childMap.has(t.parentTaskId)) childMap.set(t.parentTaskId, []);
        childMap.get(t.parentTaskId)!.push(t);
      }
    }

    const result: Array<{ task: ScheduleTask; depth: number; hasChildren: boolean }> = [];
    const visited = new Set<string>();
    function addTask(task: ScheduleTask, depth: number) {
      if (visited.has(task.id)) return;
      visited.add(task.id);
      const children = childMap.get(task.id) || [];
      result.push({ task, depth, hasChildren: children.length > 0 });
      if (!collapsedGroups.has(task.id)) {
        for (const child of children) {
          addTask(child, depth + 1);
        }
      }
    }
    for (const root of rootTasks) {
      addTask(root, 0);
    }
    return result;
  }, [sortedTasks, collapsedGroups]);

  const taskMap = useMemo(() => {
    const map = new Map<string, ScheduleTask>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  const getGanttRange = useCallback(() => {
    if (!schedule) return { start: new Date(), end: new Date(), totalDays: 1 };
    const allDates = tasks.flatMap(t => [t.plannedStartDate, t.plannedEndDate, t.baselineStartDate, t.baselineEndDate].filter(Boolean));
    if (schedule.baselineStartDate) allDates.push(schedule.baselineStartDate);
    if (schedule.baselineEndDate) allDates.push(schedule.baselineEndDate);
    if (schedule.projectedCompletionDate) allDates.push(schedule.projectedCompletionDate);

    const dates = allDates.map(d => new Date(d!));
    const start = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
    const end = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();
    const totalDays = Math.max(differenceInDays(end, start), 1);
    return { start, end, totalDays };
  }, [schedule, tasks]);

  const getBarPosition = useCallback((startStr: string, endStr: string) => {
    const { start, totalDays } = getGanttRange();
    const barStart = differenceInDays(parseISO(startStr), start);
    const barDuration = differenceInDays(parseISO(endStr), parseISO(startStr)) + 1;
    return {
      left: `${Math.max(0, (barStart / totalDays) * 100)}%`,
      width: `${Math.min(100, (barDuration / totalDays) * 100)}%`,
    };
  }, [getGanttRange]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const forecast = forecastData?.forecast;
  const spiColor = forecast?.spiValue
    ? forecast.spiValue >= 1 ? "text-green-600" : forecast.spiValue >= 0.9 ? "text-yellow-600" : "text-red-600"
    : "text-muted-foreground";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Project Schedule</h2>
          <p className="text-muted-foreground text-sm">
            {schedule ? `Generated by ${schedule.generatedBy}` : "No schedule yet"}
            {schedule?.baselineLocked && <span className="ml-2 text-green-600">(Baseline Locked)</span>}
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          {schedule && (
            <>
              <Button variant="outline" size="sm" onClick={() => recalculateMutation.mutate()} disabled={recalculateMutation.isPending} data-testid="button-recalculate">
                <RefreshCw className={cn("w-4 h-4 mr-2", recalculateMutation.isPending && "animate-spin")} />
                Recalculate
              </Button>
              {schedule.baselineLocked ? (
                <Button variant="outline" size="sm" onClick={() => unlockBaselineMutation.mutate()} data-testid="button-unlock-baseline">
                  <Unlock className="w-4 h-4 mr-2" />
                  Unlock Baseline
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => lockBaselineMutation.mutate()} data-testid="button-lock-baseline">
                  <Lock className="w-4 h-4 mr-2" />
                  Lock Baseline
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const count = (baselinesData?.baselines.filter(b => !b.isArchived).length ?? 0) + 1;
                  setNewBaselineName(`Baseline ${count}`);
                  setSaveBaselineOpen(true);
                }}
                data-testid="button-save-baseline"
              >
                <Save className="w-4 h-4 mr-2" />
                Save as Baseline
              </Button>
              {(baselinesData?.baselines.length ?? 0) > 0 && (
                <>
                  <Select
                    value={baselinesData?.activeBaselineId ?? "__none__"}
                    onValueChange={(v) => setActiveBaselineMutation.mutate(v === "__none__" ? null : v)}
                  >
                    <SelectTrigger className="w-[200px] h-9" data-testid="select-active-baseline">
                      <SelectValue placeholder="Compare to baseline..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No baseline comparison</SelectItem>
                      {baselinesData?.baselines.filter(b => !b.isArchived).map(b => (
                        <SelectItem key={b.id} value={b.id} data-testid={`option-baseline-${b.id}`}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => setManageBaselinesOpen(true)} data-testid="button-manage-baselines">
                    <History className="w-4 h-4 mr-2" />
                    Manage
                  </Button>
                </>
              )}
            </>
          )}
          {schedule && (
            <Button variant="outline" size="sm" onClick={() => setAddTaskOpen(true)} data-testid="button-add-task">
              <CalendarIcon className="w-4 h-4 mr-2" />
              Add Task
            </Button>
          )}
          <Button size="sm" onClick={() => setGenerateDialogOpen(true)} data-testid="button-generate-schedule" className="flex-1 sm:flex-none">
            <Sparkles className="w-4 h-4 mr-2" />
            {schedule ? "Regenerate" : "Generate with AI"}
          </Button>
          {!schedule && (
            <Button variant="outline" size="sm" onClick={() => setManualCreateOpen(true)} data-testid="button-create-blank" className="flex-1 sm:flex-none">
              <CalendarIcon className="w-4 h-4 mr-2" />
              Create Blank Schedule
            </Button>
          )}
        </div>
      </div>

      {schedule ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <CalendarIcon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Duration</p>
                    <p className="text-2xl font-bold" data-testid="text-duration">
                      {differenceInDays(parseISO(schedule.baselineEndDate || schedule.baselineStartDate), parseISO(schedule.baselineStartDate))} days
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Progress</p>
                    <p className="text-2xl font-bold" data-testid="text-progress">{overallProgress}%</p>
                  </div>
                </div>
                <Progress value={overallProgress} className="mt-3 h-2" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 rounded-lg">
                    <Flag className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Critical Path</p>
                    <p className="text-2xl font-bold" data-testid="text-critical-count">{criticalPathTasks.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg", forecast?.spiValue ? (forecast.spiValue >= 1 ? "bg-green-100" : forecast.spiValue >= 0.9 ? "bg-yellow-100" : "bg-red-100") : "bg-gray-100")}>
                    <TrendingUp className={cn("w-5 h-5", spiColor)} />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">SPI</p>
                    <p className={cn("text-2xl font-bold", spiColor)} data-testid="text-spi">
                      {forecast?.spiValue != null ? forecast.spiValue.toFixed(2) : "N/A"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
            <TabsList>
              <TabsTrigger value="gantt" data-testid="tab-gantt">
                <BarChart3 className="w-4 h-4 mr-1" />
                Gantt Chart
              </TabsTrigger>
              <TabsTrigger value="forecast" data-testid="tab-forecast">
                <TrendingUp className="w-4 h-4 mr-1" />
                Forecast
              </TabsTrigger>
              <TabsTrigger value="resources" data-testid="tab-resources">
                <Users className="w-4 h-4 mr-1" />
                Resources
              </TabsTrigger>
              <TabsTrigger value="critical" data-testid="tab-critical">
                <Flag className="w-4 h-4 mr-1" />
                Critical Path
              </TabsTrigger>
            </TabsList>

            <TabsContent value="gantt">
              <div ref={ganttExportRef} className="bg-background">
                <ScheduleVarianceKpi schedule={schedule} tasks={tasks} />
                <GanttChart
                  tasks={sortedTasks}
                  wbsTasks={wbsTasks}
                  schedule={schedule}
                  taskMap={taskMap}
                  getBarPosition={getBarPosition}
                  getGanttRange={getGanttRange}
                  onTaskClick={handleTaskClick}
                  onEditDeps={openDepDialog}
                  collapsedGroups={collapsedGroups}
                  onToggleCollapse={toggleCollapse}
                  showBaseline={showBaseline}
                  onToggleShowBaseline={() => setShowBaseline(v => !v)}
                  isExporting={isExporting}
                  onExport={handleExportGantt}
                  onSend={openSendDialog}
                />
              </div>
              <RecommendationsPanel
                recommendations={recommendationsData?.recommendations || []}
                onDismiss={(id) => dismissRecommendationMutation.mutate(id)}
              />
            </TabsContent>

            <TabsContent value="forecast">
              <ForecastPanel forecast={forecastData} schedule={schedule} />
            </TabsContent>

            <TabsContent value="resources">
              <ResourcePanel data={resourceData} />
            </TabsContent>

            <TabsContent value="critical">
              <CriticalPathPanel tasks={criticalPathTasks} onTaskClick={handleTaskClick} />
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <CalendarIcon className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Schedule Yet</h3>
              <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                Generate an AI-powered schedule based on your {tradeType || "project"}'s typical workflow and production rates.
              </p>
              <Button onClick={() => setGenerateDialogOpen(true)} data-testid="button-create-schedule">
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Schedule with AI
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate AI Schedule</DialogTitle>
            <DialogDescription>AI will create a schedule based on your {tradeType || "project"} type's typical workflow.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Project Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" type="button" className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")} data-testid="input-start-date">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(parseISO(startDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker mode="single" selected={startDate ? parseISO(startDate) : undefined} onSelect={(date) => date && setStartDate(format(date, "yyyy-MM-dd"))} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Working Days</Label>
              <div className="flex gap-2 mt-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                  <Button key={day} variant={workingDays.includes(index) ? "default" : "outline"} size="sm" onClick={() => toggleWorkingDay(index)} data-testid={`button-day-${day.toLowerCase()}`}>
                    {day}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
              {generateMutation.isPending ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>) : (<><Zap className="w-4 h-4 mr-2" />Generate</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
            <DialogDescription>Update task details, status, and progress</DialogDescription>
          </DialogHeader>
          {selectedTask && (
            <div className="space-y-4 py-4">
              <div>
                <Label>Task Name</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  data-testid="input-task-name"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Task description..."
                  data-testid="input-task-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Duration (days)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={editDuration}
                    onChange={(e) => setEditDuration(parseInt(e.target.value) || 1)}
                    data-testid="input-task-duration"
                  />
                </div>
                <div>
                  <Label>Parent Task</Label>
                  <Select
                    value={selectedTask.parentTaskId || "__none__"}
                    onValueChange={(v) => {
                      updateTaskMutation.mutate({
                        taskId: selectedTask.id,
                        updates: { parentTaskId: v === "__none__" ? null : v },
                      });
                    }}
                  >
                    <SelectTrigger data-testid="select-parent-task">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None (Root Task)</SelectItem>
                      {tasks.filter(t => t.id !== selectedTask.id).map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(editName !== selectedTask.name || editDescription !== (selectedTask.description || "") || editDuration !== selectedTask.durationDays) && (
                <Button size="sm" onClick={handleSaveTaskEdits} disabled={updateTaskMutation.isPending} data-testid="button-save-task-edits">
                  {updateTaskMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Save Changes
                </Button>
              )}
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Planned Start</Label>
                  <p className="font-medium">{selectedTask.plannedStartDate ? format(parseISO(selectedTask.plannedStartDate), "MMM d, yyyy") : "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Planned End</Label>
                  <p className="font-medium">{selectedTask.plannedEndDate ? format(parseISO(selectedTask.plannedEndDate), "MMM d, yyyy") : "—"}</p>
                </div>
              </div>
              {selectedTask.baselineStartDate && selectedTask.baselineEndDate && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Baseline Start</Label>
                    <p className="font-medium text-gray-500">{format(parseISO(selectedTask.baselineStartDate), "MMM d, yyyy")}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Baseline End</Label>
                    <p className="font-medium text-gray-500">{format(parseISO(selectedTask.baselineEndDate), "MMM d, yyyy")}</p>
                  </div>
                </div>
              )}
              {(selectedTask.totalFloat != null || selectedTask.freeFloat != null) && (
                <div className="grid grid-cols-2 gap-4 p-3 bg-muted rounded-lg">
                  <div>
                    <Label className="text-muted-foreground text-xs">Total Float</Label>
                    <p className={cn("font-bold", selectedTask.totalFloat === 0 ? "text-red-600" : "text-green-600")} data-testid="text-total-float">{selectedTask.totalFloat ?? 0} days</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Free Float</Label>
                    <p className="font-bold" data-testid="text-free-float">{selectedTask.freeFloat ?? 0} days</p>
                  </div>
                </div>
              )}
              <Separator />
              <div>
                <Label>Status</Label>
                <Select value={selectedTask.status} onValueChange={(v: ScheduleTask["status"]) => handleStatusChange(v)}>
                  <SelectTrigger data-testid="select-task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <config.icon className="w-4 h-4" />
                          {config.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Progress: {selectedTask.percentComplete}%</Label>
                <Input
                  type="range"
                  min={0}
                  max={100}
                  value={selectedTask.percentComplete}
                  onChange={(e) => {
                    updateTaskMutation.mutate({ taskId: selectedTask.id, updates: { percentComplete: parseInt(e.target.value) } });
                  }}
                  data-testid="input-progress"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Actual Start</Label>
                  <Input
                    type="date"
                    value={selectedTask.actualStartDate || ""}
                    onChange={(e) => updateTaskMutation.mutate({ taskId: selectedTask.id, updates: { actualStartDate: e.target.value || undefined } })}
                    data-testid="input-actual-start"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Actual End</Label>
                  <Input
                    type="date"
                    value={selectedTask.actualEndDate || ""}
                    onChange={(e) => updateTaskMutation.mutate({ taskId: selectedTask.id, updates: { actualEndDate: e.target.value || undefined } })}
                    data-testid="input-actual-end"
                  />
                </div>
              </div>
              {selectedTask.isCriticalPath && (
                <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg">
                  <Flag className="w-4 h-4 text-red-600" />
                  <span className="text-sm text-red-600">This task is on the critical path</span>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setTaskDialogOpen(false); openDepDialog(selectedTask); }} data-testid="button-edit-deps">
                  <Link2 className="w-4 h-4 mr-1" />
                  Edit Dependencies
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={depDialogOpen} onOpenChange={setDepDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Dependencies: {depTask?.name}</DialogTitle>
            <DialogDescription>Select predecessor tasks (Finish-to-Start)</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2 py-2">
              {tasks.filter(t => t.id !== depTask?.id).map(t => (
                <label key={t.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={depSelected.includes(t.id)}
                    onChange={(e) => {
                      setDepSelected(prev => e.target.checked ? [...prev, t.id] : prev.filter(id => id !== t.id));
                    }}
                    data-testid={`checkbox-dep-${t.id}`}
                  />
                  <span className="text-sm">{t.name}</span>
                  {t.isCriticalPath && <Badge variant="destructive" className="text-xs">Critical</Badge>}
                </label>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => depTask && updateDepsMutation.mutate({ taskId: depTask.id, dependencies: depSelected })}
              disabled={updateDepsMutation.isPending}
              data-testid="button-save-deps"
            >
              {updateDepsMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Dependencies
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendDialogOpen} onOpenChange={(open) => { if (!isSending) setSendDialogOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Email Gantt to project contacts</DialogTitle>
            <DialogDescription>
              The current Gantt view will be rendered as a PDF and emailed to the recipients you select.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-2 block">Project contacts</Label>
              <ScrollArea className="max-h-48 rounded border">
                <div className="p-2 space-y-1">
                  {isRecipientsLoading ? (
                    <div className="flex items-center text-sm text-muted-foreground p-2" data-testid="text-recipients-loading">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading contacts…
                    </div>
                  ) : (recipientData?.recipients || []).length === 0 ? (
                    <div className="text-sm text-muted-foreground p-2" data-testid="text-recipients-empty">
                      No project contacts on file. Add an email below.
                    </div>
                  ) : (
                    (recipientData?.recipients || []).map((r) => {
                      const key = r.email.trim().toLowerCase();
                      const checked = selectedRecipientEmails.has(key);
                      return (
                        <label
                          key={r.id}
                          className="flex items-start gap-2 p-2 rounded hover-elevate cursor-pointer"
                          data-testid={`row-recipient-${r.id}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleRecipient(r.email)}
                            data-testid={`checkbox-recipient-${r.id}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{r.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0">{r.role}</Badge>
                        </label>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
            <div>
              <Label htmlFor="extra-recipients" className="mb-1 block">Additional emails</Label>
              <Input
                id="extra-recipients"
                placeholder="name@example.com, another@example.com"
                value={extraRecipientsInput}
                onChange={(e) => setExtraRecipientsInput(e.target.value)}
                data-testid="input-extra-recipients"
              />
              <p className="text-xs text-muted-foreground mt-1">Separate multiple addresses with commas.</p>
            </div>
            <div>
              <Label htmlFor="email-subject" className="mb-1 block">Subject</Label>
              <Input
                id="email-subject"
                value={sendSubject}
                onChange={(e) => setSendSubject(e.target.value)}
                data-testid="input-email-subject"
              />
            </div>
            <div>
              <Label htmlFor="email-message" className="mb-1 block">Note</Label>
              <Textarea
                id="email-message"
                rows={4}
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                data-testid="textarea-email-message"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSendDialogOpen(false)}
              disabled={isSending}
              data-testid="button-cancel-send-gantt"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendGanttEmail}
              disabled={isSending}
              data-testid="button-confirm-send-gantt"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Send Gantt PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualCreateOpen} onOpenChange={setManualCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Blank Schedule</DialogTitle>
            <DialogDescription>Create an empty schedule and add tasks manually.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Schedule Name</Label>
              <Input value={manualName} onChange={(e) => setManualName(e.target.value)} data-testid="input-schedule-name" />
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="input-manual-start-date" />
            </div>
            <div>
              <Label>Working Days</Label>
              <div className="flex gap-2 mt-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                  <Button key={day} variant={workingDays.includes(index) ? "default" : "outline"} size="sm" onClick={() => toggleWorkingDay(index)}>
                    {day}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createManualScheduleMutation.mutate()} disabled={createManualScheduleMutation.isPending} data-testid="button-confirm-create-schedule">
              {createManualScheduleMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Create Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addTaskOpen} onOpenChange={setAddTaskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Task</DialogTitle>
            <DialogDescription>Add a new task to the schedule.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Task Name</Label>
              <Input value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} placeholder="Enter task name" data-testid="input-new-task-name" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={newTaskDescription} onChange={(e) => setNewTaskDescription(e.target.value)} placeholder="Optional description" data-testid="input-new-task-description" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Duration (days)</Label>
                <Input type="number" min={1} value={newTaskDuration} onChange={(e) => setNewTaskDuration(parseInt(e.target.value) || 1)} data-testid="input-new-task-duration" />
              </div>
              <div>
                <Label>Parent Task</Label>
                <Select value={newTaskParentId || "__none__"} onValueChange={(v) => setNewTaskParentId(v === "__none__" ? "" : v)}>
                  <SelectTrigger data-testid="select-new-task-parent">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None (Root Task)</SelectItem>
                    {tasks.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTaskOpen(false)}>Cancel</Button>
            <Button onClick={() => addTaskMutation.mutate()} disabled={addTaskMutation.isPending || !newTaskName} data-testid="button-confirm-add-task">
              {addTaskMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Add Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveBaselineOpen} onOpenChange={setSaveBaselineOpen}>
        <DialogContent data-testid="dialog-save-baseline">
          <DialogHeader>
            <DialogTitle>Save Current Schedule as Baseline</DialogTitle>
            <DialogDescription>
              Capture today's planned dates as a named baseline. You can compare against it later from the Gantt toolbar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="baseline-name">Baseline name</Label>
              <Input
                id="baseline-name"
                value={newBaselineName}
                onChange={(e) => setNewBaselineName(e.target.value)}
                placeholder="e.g. Baseline 2 - After Change Order #4"
                data-testid="input-baseline-name"
              />
            </div>
            <div>
              <Label htmlFor="baseline-notes">Notes (optional)</Label>
              <Textarea
                id="baseline-notes"
                value={newBaselineNotes}
                onChange={(e) => setNewBaselineNotes(e.target.value)}
                placeholder="What changed since the last baseline?"
                rows={3}
                data-testid="input-baseline-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveBaselineOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createBaselineMutation.mutate({ name: newBaselineName.trim(), notes: newBaselineNotes.trim() || undefined })}
              disabled={createBaselineMutation.isPending || !newBaselineName.trim()}
              data-testid="button-confirm-save-baseline"
            >
              {createBaselineMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save Baseline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manageBaselinesOpen} onOpenChange={setManageBaselinesOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-manage-baselines">
          <DialogHeader>
            <DialogTitle>Saved Baselines</DialogTitle>
            <DialogDescription>
              Switch the active comparison baseline, archive old ones, or delete them permanently.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto">
            {(baselinesData?.baselines.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">No baselines saved yet.</p>
            )}
            {baselinesData?.baselines.map(b => {
              const isActive = baselinesData.activeBaselineId === b.id;
              const lockedByName = [b.lockedByFirstName, b.lockedByLastName].filter(Boolean).join(" ") || b.lockedByEmail || "Unknown";
              return (
                <div
                  key={b.id}
                  className={cn(
                    "flex items-start justify-between gap-3 p-3 border rounded-md",
                    isActive && "border-primary bg-primary/5",
                    b.isArchived && "opacity-60"
                  )}
                  data-testid={`row-baseline-${b.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium" data-testid={`text-baseline-name-${b.id}`}>{b.name}</p>
                      {isActive && <Badge variant="default" className="text-xs">Active</Badge>}
                      {b.isArchived && <Badge variant="secondary" className="text-xs">Archived</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Locked {format(parseISO(b.lockedAt), "MMM d, yyyy h:mm a")} by {lockedByName}
                    </p>
                    {b.scheduleStartDate && b.scheduleEndDate && (
                      <p className="text-xs text-muted-foreground">
                        Range: {format(parseISO(b.scheduleStartDate), "MMM d, yyyy")} → {format(parseISO(b.scheduleEndDate), "MMM d, yyyy")}
                      </p>
                    )}
                    {b.notes && <p className="text-xs mt-1">{b.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!b.isArchived && !isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveBaselineMutation.mutate(b.id)}
                        disabled={setActiveBaselineMutation.isPending}
                        data-testid={`button-activate-baseline-${b.id}`}
                      >
                        Set Active
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => archiveBaselineMutation.mutate({ id: b.id, isArchived: !b.isArchived })}
                      disabled={archiveBaselineMutation.isPending}
                      data-testid={`button-archive-baseline-${b.id}`}
                      title={b.isArchived ? "Unarchive" : "Archive"}
                    >
                      {b.isArchived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Delete baseline "${b.name}"? This cannot be undone.`)) {
                          deleteBaselineMutation.mutate(b.id);
                        }
                      }}
                      disabled={deleteBaselineMutation.isPending}
                      data-testid={`button-delete-baseline-${b.id}`}
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageBaselinesOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GanttChart({
  tasks,
  wbsTasks,
  schedule,
  taskMap,
  getBarPosition,
  getGanttRange,
  onTaskClick,
  onEditDeps,
  collapsedGroups,
  onToggleCollapse,
  showBaseline,
  onToggleShowBaseline,
  isExporting,
  onExport,
  onSend,
}: {
  tasks: ScheduleTask[];
  wbsTasks: Array<{ task: ScheduleTask; depth: number; hasChildren: boolean }>;
  schedule: ProjectSchedule;
  taskMap: Map<string, ScheduleTask>;
  getBarPosition: (start: string, end: string) => { left: string; width: string };
  getGanttRange: () => { start: Date; end: Date; totalDays: number };
  onTaskClick: (task: ScheduleTask) => void;
  onEditDeps: (task: ScheduleTask) => void;
  collapsedGroups: Set<string>;
  onToggleCollapse: (taskId: string) => void;
  showBaseline: boolean;
  onToggleShowBaseline: () => void;
  isExporting?: boolean;
  onExport?: (kind: "png" | "pdf") => void;
  onSend?: () => void;
}) {
  const hasAnyBaseline = !!schedule.baselineLocked || tasks.some(t => t.baselineStartDate && t.baselineEndDate);
  const baselineVisible = showBaseline && hasAnyBaseline;
  const workingDaysList = (schedule.workingDays && schedule.workingDays.length > 0) ? schedule.workingDays : [1, 2, 3, 4, 5];
  const ganttBodyRef = useRef<HTMLDivElement>(null);
  const { start: ganttStart, end: ganttEnd, totalDays } = getGanttRange();

  const depLines = useMemo(() => {
    const lines: Array<{ fromIdx: number; toIdx: number; fromLeft: number; toLeft: number }> = [];
    wbsTasks.forEach(({ task }, toIdx) => {
      for (const depId of (task.dependencies || [])) {
        const fromTask = taskMap.get(depId);
        if (!fromTask) continue;
        const fromIdx = wbsTasks.findIndex(w => w.task.id === depId);
        if (fromIdx < 0) continue;

        const fromEnd = fromTask.plannedEndDate;
        const toStart = task.plannedStartDate;
        if (!fromEnd || !toStart) continue;

        const fromEndDay = differenceInDays(parseISO(fromEnd), ganttStart) + 1;
        const toStartDay = differenceInDays(parseISO(toStart), ganttStart);

        lines.push({
          fromIdx,
          toIdx,
          fromLeft: (fromEndDay / totalDays) * 100,
          toLeft: (toStartDay / totalDays) * 100,
        });
      }
    });
    return lines;
  }, [wbsTasks, taskMap, ganttStart, totalDays]);

  const rowHeight = 36;
  const headerHeight = 28;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Gantt Chart
          <div className="ml-auto flex items-center gap-3 text-xs font-normal text-muted-foreground flex-wrap">
            {hasAnyBaseline && (
              <Button
                variant={baselineVisible ? "secondary" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onToggleShowBaseline}
                data-testid="button-toggle-baseline"
              >
                {baselineVisible ? <Eye className="w-3.5 h-3.5 mr-1" /> : <EyeOff className="w-3.5 h-3.5 mr-1" />}
                {baselineVisible ? "Hide baseline" : "Show baseline"}
              </Button>
            )}
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-destructive rounded-sm inline-block" />Critical</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-primary/60 rounded-sm inline-block" />Planned</span>
            {baselineVisible && <span className="flex items-center gap-1"><span className="w-3 h-2 bg-muted-foreground/40 rounded-sm inline-block" />Baseline</span>}
            {baselineVisible && <span className="flex items-center gap-1"><span className="w-3 h-2 bg-destructive/80 rounded-sm inline-block" />Slip</span>}
            {baselineVisible && <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-500 rounded-sm inline-block" />Ahead</span>}
            <span className="flex items-center gap-1"><span className="w-3 h-1 bg-blue-200 dark:bg-blue-900 rounded-sm inline-block" />Float</span>
            {onExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={isExporting}
                    data-testid="button-export-gantt"
                  >
                    {isExporting ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5 mr-1" />
                    )}
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onExport("pdf")} data-testid="button-export-gantt-pdf">
                    <FileText className="w-4 h-4 mr-2" />
                    Export as PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onExport("png")} data-testid="button-export-gantt-png">
                    <FileImage className="w-4 h-4 mr-2" />
                    Export as PNG
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {onSend && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onSend}
                data-testid="button-send-gantt"
              >
                <Mail className="w-3.5 h-3.5 mr-1" />
                Send to...
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          <div className="hidden md:flex items-center text-xs text-muted-foreground mb-2">
            <div className="w-56 shrink-0 font-medium">Task</div>
            <div className="flex-1 flex justify-between px-2">
              <span>{format(ganttStart, "MMM d")}</span>
              <span>{format(ganttEnd, "MMM d")}</span>
            </div>
          </div>
          <Separator className="hidden md:block" />
          <ScrollArea className={isExporting ? "h-auto" : "h-[420px]"}>
            <div className="relative" style={{ minHeight: wbsTasks.length * rowHeight + headerHeight }}>
              <svg className="absolute inset-0 w-full pointer-events-none" style={{ height: wbsTasks.length * rowHeight + headerHeight, zIndex: 5 }}>
                {depLines.map((line, idx) => {
                  const fromY = headerHeight + line.fromIdx * rowHeight + rowHeight / 2;
                  const toY = headerHeight + line.toIdx * rowHeight + rowHeight / 2;
                  const taskAreaStart = 224;
                  const svgWidth = ganttBodyRef.current?.offsetWidth || 800;
                  const ganttWidth = svgWidth - taskAreaStart;
                  const fromX = taskAreaStart + (line.fromLeft / 100) * ganttWidth;
                  const toX = taskAreaStart + (line.toLeft / 100) * ganttWidth;
                  const midX = fromX + 8;

                  return (
                    <g key={idx}>
                      <path
                        d={`M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`}
                        fill="none"
                        stroke="#94a3b8"
                        strokeWidth="1.5"
                        strokeDasharray="4 2"
                      />
                      <polygon
                        points={`${toX},${toY - 3} ${toX},${toY + 3} ${toX + 5},${toY}`}
                        fill="#94a3b8"
                      />
                    </g>
                  );
                })}
              </svg>

              <div ref={ganttBodyRef} className="space-y-0">
                {wbsTasks.map(({ task, depth, hasChildren }) => {
                  const StatusIcon = STATUS_CONFIG[task.status].icon;
                  const barStyle = task.plannedStartDate && task.plannedEndDate ? getBarPosition(task.plannedStartDate, task.plannedEndDate) : { left: "0%", width: "2%" };
                  const hasBaseline = !!(task.baselineStartDate && task.baselineEndDate);
                  const showBaselineForRow = hasBaseline && baselineVisible;
                  const baselineStyle = hasBaseline ? getBarPosition(task.baselineStartDate!, task.baselineEndDate!) : null;

                  const floatWidth = (task.freeFloat || 0) > 0
                    ? `${((task.freeFloat || 0) / totalDays) * 100}%`
                    : "0%";

                  const slipDays = hasBaseline && task.plannedEndDate
                    ? workingDaysBetweenDates(task.baselineEndDate!, task.plannedEndDate, workingDaysList)
                    : null;

                  const slipStyle = (showBaselineForRow && slipDays != null && slipDays > 0 && task.baselineEndDate && task.plannedEndDate)
                    ? getBarPosition(task.baselineEndDate, task.plannedEndDate)
                    : null;
                  const aheadStyle = (showBaselineForRow && slipDays != null && slipDays < 0 && task.baselineEndDate && task.plannedEndDate)
                    ? getBarPosition(task.plannedEndDate, task.baselineEndDate)
                    : null;

                  const isCollapsed = collapsedGroups.has(task.id);

                  const tooltipLines: string[] = [task.name];
                  if (task.plannedStartDate && task.plannedEndDate) {
                    tooltipLines.push(`Planned: ${format(parseISO(task.plannedStartDate), "MMM d, yyyy")} → ${format(parseISO(task.plannedEndDate), "MMM d, yyyy")}`);
                  }
                  if (hasBaseline) {
                    tooltipLines.push(`Baseline: ${format(parseISO(task.baselineStartDate!), "MMM d, yyyy")} → ${format(parseISO(task.baselineEndDate!), "MMM d, yyyy")}`);
                  }
                  if (slipDays != null) {
                    if (slipDays > 0) tooltipLines.push(`Slip: +${slipDays} working day${slipDays === 1 ? "" : "s"} late`);
                    else if (slipDays < 0) tooltipLines.push(`Slip: ${slipDays} working day${slipDays === -1 ? "" : "s"} ahead`);
                    else tooltipLines.push("Slip: on baseline");
                  }
                  tooltipLines.push(`Progress: ${task.percentComplete}%`);
                  const tooltip = tooltipLines.join("\n");

                  return (
                    <div
                      key={task.id}
                      className="flex flex-col md:flex-row md:items-center hover:bg-muted/50 rounded cursor-pointer px-2 gap-1 md:gap-0"
                      style={{ height: rowHeight }}
                      onClick={() => onTaskClick(task)}
                      data-testid={`task-row-${task.id}`}
                    >
                      <div className="md:w-56 shrink-0 flex items-center gap-1.5 md:pr-2 min-w-0" style={{ paddingLeft: depth * 20 }}>
                        {hasChildren && (
                          <button
                            className="shrink-0 p-0.5 rounded hover:bg-muted"
                            onClick={(e) => { e.stopPropagation(); onToggleCollapse(task.id); }}
                            data-testid={`button-collapse-${task.id}`}
                          >
                            {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}
                        <StatusIcon className={cn("w-3.5 h-3.5 shrink-0", STATUS_CONFIG[task.status].color.split(" ")[1])} />
                        <span className={cn("text-xs truncate", hasChildren && "font-semibold")}>{task.name}</span>
                        {task.isCriticalPath && <Badge variant="destructive" className="text-[10px] px-1 py-0 shrink-0">CP</Badge>}
                      </div>
                      <div className="flex-1 relative h-7 bg-muted/30 rounded" onClick={(e) => e.stopPropagation()} title={tooltip}>
                        {showBaselineForRow && baselineStyle && (
                          <div
                            className="absolute h-2 rounded bg-muted-foreground/30 dark:bg-muted-foreground/40 border border-muted-foreground/40"
                            style={{ ...baselineStyle, top: 2 }}
                            title={`Baseline: ${format(parseISO(task.baselineStartDate!), "MMM d")} → ${format(parseISO(task.baselineEndDate!), "MMM d")}`}
                          />
                        )}
                        {aheadStyle && (
                          <div
                            className="absolute h-2 rounded bg-emerald-500/70 dark:bg-emerald-400/70"
                            style={{ ...aheadStyle, top: 2 }}
                            title={`Ahead of baseline by ${Math.abs(slipDays!)} working days`}
                          />
                        )}
                        <div
                          className={cn(
                            "absolute rounded",
                            task.isCriticalPath
                              ? "bg-destructive/70 ring-1 ring-destructive"
                              : "bg-primary/60",
                            task.status === "COMPLETE" && "bg-emerald-500/70",
                            task.status === "DELAYED" && "bg-amber-500/80",
                            showBaselineForRow ? "h-3 top-3" : "h-5 top-1"
                          )}
                          style={barStyle}
                          onClick={() => onTaskClick(task)}
                        >
                          {task.percentComplete > 0 && task.percentComplete < 100 && (
                            <div className="h-full bg-primary rounded-l" style={{ width: `${task.percentComplete}%` }} />
                          )}
                        </div>
                        {slipStyle && (
                          <div
                            className="absolute h-3 rounded-r bg-destructive dark:bg-destructive/90"
                            style={{ ...slipStyle, top: 12 }}
                            title={`Slipped ${slipDays} working days past baseline`}
                          />
                        )}
                        {showBaselineForRow && slipDays != null && slipDays !== 0 && (
                          <div
                            className={cn(
                              "absolute -top-0.5 px-1 py-px rounded text-[9px] font-semibold leading-tight whitespace-nowrap",
                              slipDays > 0
                                ? "bg-destructive text-destructive-foreground"
                                : "bg-emerald-600 text-white dark:bg-emerald-500"
                            )}
                            style={{
                              left: slipDays > 0
                                ? `calc(${slipStyle?.left || barStyle.left} + ${slipStyle?.width || "0%"})`
                                : `calc(${barStyle.left} + ${barStyle.width})`,
                              transform: "translateX(2px)",
                            }}
                            data-testid={`pill-slip-${task.id}`}
                          >
                            {slipDays > 0 ? `+${slipDays}d` : `${slipDays}d`}
                          </div>
                        )}
                        {(task.freeFloat || 0) > 0 && (
                          <div
                            className="absolute h-2 bg-blue-200 dark:bg-blue-900 rounded opacity-50"
                            style={{
                              left: `calc(${barStyle.left} + ${barStyle.width})`,
                              width: floatWidth,
                              top: showBaselineForRow ? 22 : 8,
                            }}
                            title={`Float: ${task.freeFloat} days`}
                          />
                        )}
                        <div
                          className="absolute inset-0 flex items-center justify-center text-[10px] font-medium pointer-events-none"
                          style={barStyle}
                        >
                          {task.durationDays}d
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}

function ScheduleVarianceKpi({ schedule, tasks }: { schedule: ProjectSchedule; tasks: ScheduleTask[] }) {
  const baselineEnd = schedule.baselineLocked ? schedule.baselineEndDate : undefined;
  const projectedEnd = schedule.projectedCompletionDate
    || (tasks.length > 0
      ? tasks.reduce<string | null>((latest, t) => {
          const end = t.plannedEndDate;
          if (!end) return latest;
          return !latest || end > latest ? end : latest;
        }, null) || undefined
      : undefined);

  if (!baselineEnd || !projectedEnd) {
    return null;
  }

  const workingDays = (schedule.workingDays && schedule.workingDays.length > 0) ? schedule.workingDays : [1, 2, 3, 4, 5];
  const variance = workingDaysBetweenDates(baselineEnd, projectedEnd, workingDays);

  const isLate = variance > 0;
  const isAhead = variance < 0;
  const label = isLate
    ? `+${variance} working day${variance === 1 ? "" : "s"} late`
    : isAhead
      ? `${Math.abs(variance)} working day${Math.abs(variance) === 1 ? "" : "s"} ahead`
      : "On schedule";

  return (
    <Card className={cn(
      "mb-3 border",
      isLate ? "border-destructive/40 bg-destructive/5" : "border-emerald-500/30 bg-emerald-500/5",
    )} data-testid="kpi-schedule-variance">
      <CardContent className="py-3 px-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Schedule Variance</span>
            <Badge
              className={cn(
                "text-xs font-semibold",
                isLate
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive"
                  : "bg-emerald-600 text-white hover:bg-emerald-600 dark:bg-emerald-500",
              )}
              data-testid="badge-schedule-variance"
            >
              {label}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-xs md:ml-auto">
            <div className="flex flex-col">
              <span className="text-muted-foreground">Baseline finish</span>
              <span className="font-medium" data-testid="text-kpi-baseline-end">
                {format(parseISO(baselineEnd), "MMM d, yyyy")}
              </span>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="text-muted-foreground">Projected finish</span>
              <span className={cn("font-medium", isLate ? "text-destructive" : isAhead ? "text-emerald-600 dark:text-emerald-400" : "")} data-testid="text-kpi-projected-end">
                {format(parseISO(projectedEnd), "MMM d, yyyy")}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ForecastPanel({ forecast: forecastData, schedule }: { forecast?: ForecastData; schedule: ProjectSchedule }) {
  const data = forecastData?.forecast;
  const snapshots = forecastData?.snapshots || [];

  if (!data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No forecast data available. Lock a baseline to enable forecasting.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Projected Completion</p>
              <p className="text-xl font-bold" data-testid="text-projected-completion">
                {data.projectedCompletionDate ? format(parseISO(data.projectedCompletionDate), "MMM d, yyyy") : "N/A"}
              </p>
              {data.baselineEndDate && (
                <p className="text-xs text-muted-foreground mt-1">
                  Baseline: {format(parseISO(data.baselineEndDate), "MMM d, yyyy")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Schedule Performance Index</p>
              <p className={cn("text-3xl font-bold", data.spiValue ? (data.spiValue >= 1 ? "text-green-600" : data.spiValue >= 0.9 ? "text-yellow-600" : "text-red-600") : "text-muted-foreground")} data-testid="text-spi-large">
                {data.spiValue != null ? data.spiValue.toFixed(2) : "N/A"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.spiValue != null ? (data.spiValue >= 1 ? "Ahead of schedule" : data.spiValue >= 0.9 ? "Slightly behind" : "Behind schedule") : "Lock baseline to calculate"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Baseline Variance</p>
              <p className={cn("text-3xl font-bold", data.baselineVarianceDays != null ? (data.baselineVarianceDays <= 0 ? "text-green-600" : data.baselineVarianceDays <= 5 ? "text-yellow-600" : "text-red-600") : "")} data-testid="text-variance">
                {data.baselineVarianceDays != null ? (data.baselineVarianceDays > 0 ? `+${data.baselineVarianceDays}` : data.baselineVarianceDays) : "N/A"} {data.baselineVarianceDays != null ? "days" : ""}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Critical path remaining: {data.criticalPathDaysRemaining} days
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {snapshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Projected Completion Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <svg viewBox="0 0 600 200" className="w-full h-48" data-testid="chart-completion-trend">
                {(() => {
                  const recentSnaps = snapshots.slice(-15);
                  if (recentSnaps.length < 2) return null;

                  const completionDates = recentSnaps.map(s => s.projectedCompletionDate ? new Date(s.projectedCompletionDate).getTime() : 0).filter(d => d > 0);
                  if (completionDates.length < 2) return null;

                  const minDate = Math.min(...completionDates);
                  const maxDate = Math.max(...completionDates);
                  const dateRange = maxDate - minDate || 1;

                  const padding = { top: 20, bottom: 30, left: 10, right: 10 };
                  const chartW = 600 - padding.left - padding.right;
                  const chartH = 200 - padding.top - padding.bottom;

                  const points = recentSnaps.map((snap, idx) => {
                    const x = padding.left + (idx / (recentSnaps.length - 1)) * chartW;
                    const dateVal = snap.projectedCompletionDate ? new Date(snap.projectedCompletionDate).getTime() : minDate;
                    const y = padding.top + chartH - ((dateVal - minDate) / dateRange) * chartH;
                    const spi = parseFloat(snap.spiValue || "0");
                    return { x, y, spi, snap };
                  });

                  const segments: JSX.Element[] = [];
                  for (let i = 0; i < points.length - 1; i++) {
                    const spi = points[i].spi;
                    const color = spi >= 1 ? "#22c55e" : spi >= 0.9 ? "#eab308" : "#ef4444";
                    segments.push(
                      <line
                        key={`seg-${i}`}
                        x1={points[i].x}
                        y1={points[i].y}
                        x2={points[i + 1].x}
                        y2={points[i + 1].y}
                        stroke={color}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    );
                  }

                  return (
                    <>
                      <line x1={padding.left} y1={padding.top + chartH} x2={padding.left + chartW} y2={padding.top + chartH} stroke="#e5e7eb" strokeWidth="1" />
                      <line x1={padding.left} y1={padding.top} x2={padding.left + chartW} y2={padding.top} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 2" />
                      <line x1={padding.left} y1={padding.top + chartH / 2} x2={padding.left + chartW} y2={padding.top + chartH / 2} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 2" />
                      {segments}
                      {points.map((p, i) => (
                        <g key={i}>
                          <circle cx={p.x} cy={p.y} r="4" fill={p.spi >= 1 ? "#22c55e" : p.spi >= 0.9 ? "#eab308" : "#ef4444"} stroke="white" strokeWidth="1.5" />
                          <title>{`${p.snap.snapshotDate}: ${p.snap.projectedCompletionDate ? format(parseISO(p.snap.projectedCompletionDate), "MMM d") : "?"} (SPI: ${p.spi.toFixed(2)})`}</title>
                        </g>
                      ))}
                      <text x={padding.left} y={padding.top + chartH + 18} className="text-[10px] fill-muted-foreground">{recentSnaps[0].snapshotDate}</text>
                      <text x={padding.left + chartW} y={padding.top + chartH + 18} className="text-[10px] fill-muted-foreground" textAnchor="end">{recentSnaps[recentSnaps.length - 1].snapshotDate}</text>
                      <text x={padding.left + chartW + 5} y={padding.top + 5} className="text-[9px] fill-muted-foreground" textAnchor="start">{format(new Date(maxDate), "MMM d")}</text>
                      <text x={padding.left + chartW + 5} y={padding.top + chartH} className="text-[9px] fill-muted-foreground" textAnchor="start">{format(new Date(minDate), "MMM d")}</text>
                    </>
                  );
                })()}
              </svg>
              <div className="flex justify-center gap-4 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" />SPI &ge; 1.0</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-yellow-500 inline-block" />SPI 0.9-1.0</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 inline-block" />SPI &lt; 0.9</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResourcePanel({ data }: { data?: ResourceData }) {
  if (!data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No resource data available.</p>
        </CardContent>
      </Card>
    );
  }

  const crewGroups = new Map<string, typeof data.allocations>();
  for (const alloc of data.allocations) {
    if (!crewGroups.has(alloc.crewId)) crewGroups.set(alloc.crewId, []);
    crewGroups.get(alloc.crewId)!.push(alloc);
  }

  return (
    <div className="space-y-4">
      {data.overAllocations.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Over-Allocated Crews ({data.overAllocations.length} conflicts)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.overAllocations.slice(0, 10).map((oa, idx) => (
                <div key={idx} className="text-sm">
                  <span className="font-medium text-red-700">{oa.crewName}</span>
                  <span className="text-red-600"> on {format(parseISO(oa.date), "MMM d")}: </span>
                  <span className="text-red-600">{oa.tasks.join(", ")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5" />
            Crew Assignments
          </CardTitle>
        </CardHeader>
        <CardContent>
          {crewGroups.size === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No crews assigned to schedule tasks</p>
          ) : (
            <div className="space-y-4">
              {Array.from(crewGroups.entries()).map(([crewId, allocs]) => (
                <div key={crewId} className="border rounded-lg p-3">
                  <p className="font-medium text-sm mb-2">{allocs[0].crewName}</p>
                  <div className="space-y-1">
                    {allocs.map((a, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{a.taskName}</span>
                        <span>{a.startDate && a.endDate ? `${format(parseISO(a.startDate), "MMM d")} - ${format(parseISO(a.endDate), "MMM d")}` : "No dates"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RecommendationsPanel({ recommendations, onDismiss }: { recommendations: AIRecommendation[]; onDismiss: (id: string) => void }) {
  const activeRecs = recommendations.filter(r => !r.isApplied);
  if (activeRecs.length === 0) return null;

  const typeConfig: Record<string, { color: string; icon: string }> = {
    CRITICAL_PATH: { color: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30", icon: "text-red-500" },
    PARALLEL_WORK: { color: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30", icon: "text-blue-500" },
    RESOURCE_ALLOCATION: { color: "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30", icon: "text-yellow-500" },
    TASK_ORDER: { color: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30", icon: "text-green-500" },
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-yellow-500" />
          AI Optimization Recommendations
          <Badge variant="secondary" className="ml-2">{activeRecs.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {activeRecs.map(rec => {
            const config = typeConfig[rec.recommendationType] || typeConfig.TASK_ORDER;
            return (
              <div key={rec.id} className={cn("border rounded-lg p-3", config.color)} data-testid={`recommendation-${rec.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Lightbulb className={cn("w-4 h-4 shrink-0", config.icon)} />
                      <p className="font-medium text-sm">{rec.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{rec.description}</p>
                    {(rec.estimatedDaysImprovement || rec.estimatedCostSavings) && (
                      <div className="flex items-center gap-3 mt-1">
                        {rec.estimatedDaysImprovement && (
                          <p className="text-xs font-medium text-green-600" data-testid={`text-days-savings-${rec.id}`}>~{rec.estimatedDaysImprovement} days saved</p>
                        )}
                        {rec.estimatedCostSavings && Number(rec.estimatedCostSavings) > 0 && (
                          <p className="text-xs font-medium text-green-600" data-testid={`text-cost-savings-${rec.id}`}>~${Number(rec.estimatedCostSavings).toLocaleString()} saved</p>
                        )}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="shrink-0 h-6 w-6 p-0" onClick={() => onDismiss(rec.id)} data-testid={`button-dismiss-rec-${rec.id}`}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function CriticalPathPanel({ tasks, onTaskClick }: { tasks: ScheduleTask[]; onTaskClick: (task: ScheduleTask) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Flag className="w-5 h-5 text-red-500" />
          Critical Path Chain
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No critical path tasks identified. Run CPM recalculation.</p>
        ) : (
          <div className="space-y-1">
            {tasks.map((task, idx) => (
              <div key={task.id}>
                <div
                  className="flex items-center justify-between gap-2 p-3 rounded-lg border border-red-200 bg-red-50/50 hover:bg-red-100/50 cursor-pointer dark:border-red-900 dark:bg-red-950/30"
                  onClick={() => onTaskClick(task)}
                  data-testid={`critical-task-${task.id}`}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{task.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.plannedStartDate && task.plannedEndDate ? `${format(parseISO(task.plannedStartDate), "MMM d")} - ${format(parseISO(task.plannedEndDate), "MMM d")}` : "No dates"}
                      {task.totalFloat != null && <span className="ml-2">Float: {task.totalFloat}d</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={cn(STATUS_CONFIG[task.status].color, "text-xs")}>{STATUS_CONFIG[task.status].label}</Badge>
                    <span className="text-xs font-medium">{task.durationDays}d</span>
                  </div>
                </div>
                {idx < tasks.length - 1 && (
                  <div className="flex justify-center py-0.5">
                    <ArrowRight className="w-4 h-4 text-red-400" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
