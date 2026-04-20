import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  Plus, ClipboardList, CheckCircle2, XCircle, Clock, Loader2,
  MapPin, User, Calendar, Trash2, Edit2, ChevronRight, FileDown,
  Shield, RefreshCcw, Paperclip, History, ChevronDown,
} from "lucide-react";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { PunchListItem } from "@shared/schema";

interface PunchListTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TRADE_OPTIONS = [
  { value: "GENERAL", label: "General" },
  { value: "ELECTRICAL", label: "Electrical" },
  { value: "PLUMBING", label: "Plumbing" },
  { value: "HVAC", label: "HVAC" },
  { value: "FRAMING", label: "Framing" },
  { value: "DRYWALL", label: "Drywall" },
  { value: "PAINTING", label: "Painting" },
  { value: "ROOFING", label: "Roofing" },
  { value: "FLOORING", label: "Flooring" },
  { value: "CONCRETE", label: "Concrete" },
  { value: "MASONRY", label: "Masonry" },
  { value: "TILE", label: "Tile" },
  { value: "CARPENTRY", label: "Carpentry" },
  { value: "INSULATION", label: "Insulation" },
  { value: "GLAZING", label: "Glazing" },
  { value: "LANDSCAPING", label: "Landscaping" },
  { value: "OTHER", label: "Other" },
];

const PRIORITY_OPTIONS = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
];

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  LOW: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  IN_PROGRESS: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  RESOLVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  VERIFIED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  OPEN: Clock,
  IN_PROGRESS: RefreshCcw,
  RESOLVED: CheckCircle2,
  VERIFIED: Shield,
  REJECTED: XCircle,
};

const LEFT_BORDER: Record<string, string> = {
  CRITICAL: "border-l-4 border-l-red-500",
  HIGH: "border-l-4 border-l-orange-500",
  MEDIUM: "border-l-4 border-l-yellow-400",
  LOW: "border-l-4 border-l-green-400",
};

function isManagement(role: string) {
  return ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"].includes(role);
}

function canVerify(role: string) {
  return ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(role);
}

function canChangeStatus(role: string) {
  return ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER"].includes(role);
}

// ─── User Type ────────────────────────────────────────────────────────────────
interface OrgUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

// ─── Empty State ─────────────────────────────────────────────────────────────
function EmptyState({ canCreate, onAdd }: { canCreate: boolean; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <ClipboardList className="h-14 w-14 text-muted-foreground/40 mb-4" />
      <h3 className="text-lg font-semibold text-foreground mb-2">No punch list items</h3>
      <p className="text-muted-foreground text-sm max-w-xs mb-6">
        Punch list items track deficiencies and open items that need to be fixed before project handover.
      </p>
      {canCreate && (
        <Button onClick={onAdd} data-testid="button-add-first-punch-item">
          <Plus className="h-4 w-4 mr-2" />
          Add First Item
        </Button>
      )}
    </div>
  );
}

// ─── Status History Panel ─────────────────────────────────────────────────────
type StatusHistoryEntry = { status: string; changedBy: string; changedAt: string; note?: string };

function StatusHistory({ history }: { history: StatusHistoryEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!history || history.length === 0) return null;
  return (
    <div className="border-t pt-4">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((o) => !o)}
        data-testid="button-toggle-history"
      >
        <History className="h-3.5 w-3.5" />
        Status History ({history.length})
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol className="mt-3 space-y-2 border-l-2 border-muted ml-2 pl-4">
          {[...history].reverse().map((h, idx) => {
            const Icon = STATUS_ICONS[h.status] ?? Clock;
            return (
              <li key={idx} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_COLORS[h.status] ?? ""}`}>
                    <Icon className="h-2.5 w-2.5 inline mr-0.5" />
                    {STATUS_OPTIONS.find((s) => s.value === h.status)?.label ?? h.status}
                  </span>
                  <span className="text-muted-foreground">by {h.changedBy}</span>
                </div>
                <div className="text-muted-foreground mt-0.5">{format(new Date(h.changedAt), "MMM d, yyyy h:mm a")}</div>
                {h.note && <div className="text-foreground mt-0.5 italic">{h.note}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PunchListTab({ projectId, projectCode, userRole }: PunchListTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [tradeFilter, setTradeFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Dialogs
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<PunchListItem | null>(null);
  const [statusNote, setStatusNote] = useState("");

  // Form state
  const emptyForm = {
    title: "", description: "", location: "",
    trade: "GENERAL", priority: "MEDIUM",
    assignedToUserId: "__none__", assignedToName: "", assignedToEmail: "",
    dueDate: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [pdfLoading, setPdfLoading] = useState(false);

  // ─── Query: org users for assignee picker ───────────────────────────────
  const { data: orgUsers = [] } = useQuery<OrgUser[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const r = await fetch("/api/users", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // ─── Query: punch list items ─────────────────────────────────────────────
  const qk = ["/api/projects", projectCode, "punch-list", { statusFilter, priorityFilter, tradeFilter, search }];
  const allQk = ["/api/projects", projectCode, "punch-list", "all-counts"];

  const { data: items = [], isLoading } = useQuery<PunchListItem[]>({
    queryKey: qk,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      if (tradeFilter !== "all") params.set("trade", tradeFilter);
      if (search.trim()) params.set("q", search.trim());
      const r = await fetch(`/api/projects/${projectCode}/punch-list?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch punch list");
      return r.json();
    },
    enabled: !!projectCode,
  });

  const { data: allItems = [] } = useQuery<PunchListItem[]>({
    queryKey: allQk,
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectCode}/punch-list`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectCode,
    staleTime: 30000,
  });

  const counts = {
    open: allItems.filter((i) => i.status === "OPEN").length,
    inProgress: allItems.filter((i) => i.status === "IN_PROGRESS").length,
    resolved: allItems.filter((i) => i.status === "RESOLVED").length,
    verified: allItems.filter((i) => i.status === "VERIFIED").length,
    total: allItems.length,
  };

  // ─── Mutations ──────────────────────────────────────────────────────────
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "punch-list"] });
  };

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => {
      const assignedUser = data.assignedToUserId && data.assignedToUserId !== "__none__"
        ? orgUsers.find((u) => u.id === data.assignedToUserId)
        : null;
      return apiRequest("POST", `/api/projects/${projectCode}/punch-list`, {
        ...data,
        assignedToUserId: assignedUser?.id || null,
        assignedToName: assignedUser
          ? `${assignedUser.firstName} ${assignedUser.lastName}`.trim()
          : data.assignedToName || null,
        assignedToEmail: assignedUser?.email || data.assignedToEmail || null,
        dueDate: data.dueDate || null,
      });
    },
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setForm(emptyForm);
      toast({ title: "Item created", description: "Punch list item added successfully." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/projects/${projectCode}/punch-list/${id}`, data),
    onSuccess: (updated: PunchListItem) => {
      invalidate();
      if (selected && selected.id === updated.id) setSelected(updated);
      toast({ title: "Updated", description: "Punch list item updated." });
    },
    onError: (e: Error) => {
      if (e.message?.includes("Conflict") || e.message?.includes("409")) {
        invalidate();
        toast({ title: "Update conflict", description: "Someone else modified this item. Your view has been refreshed — please try again.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: e.message, variant: "destructive" });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/projects/${projectCode}/punch-list/${id}`),
    onSuccess: () => {
      invalidate();
      setShowDetail(false);
      setSelected(null);
      toast({ title: "Deleted", description: "Punch list item removed." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addAttachmentMutation = useMutation({
    mutationFn: ({ id, attachment }: { id: string; attachment: { url: string; filename: string; mimeType: string } }) =>
      apiRequest("POST", `/api/projects/${projectCode}/punch-list/${id}/attachments`, attachment),
    onSuccess: (updated: PunchListItem) => {
      invalidate();
      if (selected && selected.id === updated.id) setSelected(updated);
      toast({ title: "Attachment added" });
    },
    onError: (e: Error) => toast({ title: "Upload error", description: e.message, variant: "destructive" }),
  });

  const removeAttachmentMutation = useMutation({
    mutationFn: ({ id, filename }: { id: string; filename: string }) =>
      apiRequest("DELETE", `/api/projects/${projectCode}/punch-list/${id}/attachments/${encodeURIComponent(filename)}`),
    onSuccess: (updated: PunchListItem) => {
      invalidate();
      if (selected && selected.id === updated.id) setSelected(updated);
      toast({ title: "Attachment removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleOpenDetail = (item: PunchListItem) => {
    setSelected(item);
    setStatusNote("");
    setShowDetail(true);
  };

  useEffect(() => {
    if (items.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const deepLinkId = params.get("itemId");
    if (deepLinkId) {
      const found = items.find((p) => p.id === deepLinkId);
      if (found) {
        setSelected(found);
        setStatusNote("");
        setShowDetail(true);
      }
    }
  }, [items]);

  const handleOpenEdit = (item: PunchListItem) => {
    setSelected(item);
    const assignedUser = orgUsers.find((u) => u.id === item.assignedToUserId);
    setForm({
      title: item.title,
      description: item.description ?? "",
      location: item.location ?? "",
      trade: item.trade,
      priority: item.priority,
      assignedToUserId: assignedUser ? assignedUser.id : "__none__",
      assignedToName: item.assignedToName ?? "",
      assignedToEmail: item.assignedToEmail ?? "",
      dueDate: item.dueDate ? format(new Date(item.dueDate), "yyyy-MM-dd") : "",
    });
    setShowEdit(true);
  };

  const handleStatusChange = (item: PunchListItem, newStatus: string) => {
    updateMutation.mutate({
      id: item.id,
      data: { status: newStatus, statusNote: statusNote || undefined, lastKnownUpdatedAt: item.updatedAt },
    });
    setStatusNote("");
  };

  const handleExportPdf = async () => {
    try {
      setPdfLoading(true);
      const r = await fetch(`/api/projects/${projectCode}/punch-list/export/pdf`, { credentials: "include" });
      if (!r.ok) throw new Error("Export failed");
      const html = await r.text();
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); w.print(); }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Export failed", description: msg, variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
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
    <div className="space-y-4">

      {/* ── Header Card ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Punch List
            </CardTitle>
            <CardDescription>Track and resolve deficiency items before project handover</CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={pdfLoading} data-testid="button-export-pdf">
              {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
              Export PDF
            </Button>
            {isManagement(userRole) && (
              <Button onClick={() => setShowCreate(true)} data-testid="button-add-punch-item">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {/* ── Summary Stats ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Open", count: counts.open, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
              { label: "In Progress", count: counts.inProgress, color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-900/20" },
              { label: "Resolved", count: counts.resolved, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
              { label: "Verified", count: counts.verified, color: "text-green-600", bg: "bg-green-50 dark:bg-green-900/20" },
            ].map((s) => (
              <Card key={s.label} className={`${s.bg} border-0`}>
                <CardContent className="pt-4 pb-3 text-center">
                  <div className={`text-2xl font-bold ${s.color}`}>{s.count}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── Filters ────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-3 mb-4">
            <Input
              placeholder="Search title, location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && queryClient.invalidateQueries({ queryKey: qk })}
              className="w-52"
              data-testid="input-punch-search"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-40" data-testid="select-priority-filter">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                {PRIORITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={tradeFilter} onValueChange={setTradeFilter}>
              <SelectTrigger className="w-40" data-testid="select-trade-filter">
                <SelectValue placeholder="Trade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Trades</SelectItem>
                {TRADE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* ── Item List ──────────────────────────────────────────── */}
          {items.length === 0 ? (
            <EmptyState canCreate={isManagement(userRole)} onAdd={() => setShowCreate(true)} />
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const StatusIcon = STATUS_ICONS[item.status] ?? Clock;
                return (
                  <Card
                    key={item.id}
                    className={`cursor-pointer hover:shadow-md transition-shadow ${LEFT_BORDER[item.priority] ?? ""}`}
                    onClick={() => handleOpenDetail(item)}
                    data-testid={`card-punch-item-${item.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-xs text-muted-foreground font-mono">{item.itemNumber}</span>
                            <span className="font-medium text-foreground">{item.title}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap mt-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[item.priority]}`}>
                              {item.priority}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${STATUS_COLORS[item.status]}`}>
                              <StatusIcon className="h-3 w-3" />
                              {STATUS_OPTIONS.find((s) => s.value === item.status)?.label ?? item.status}
                            </span>
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                              {TRADE_OPTIONS.find((t) => t.value === item.trade)?.label ?? item.trade}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground flex-wrap">
                            {item.location && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {item.location}
                              </span>
                            )}
                            {(item.assignedToName || item.assignedToUserId) && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {item.assignedToName ?? "Assigned"}
                              </span>
                            )}
                            {item.dueDate && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Due {format(new Date(item.dueDate), "MMM d, yyyy")}
                              </span>
                            )}
                            {Array.isArray(item.attachments) && item.attachments.length > 0 && (
                              <span className="flex items-center gap-1">
                                <Paperclip className="h-3 w-3" />
                                {item.attachments.length}
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─────────────────────────────────────────────────────────────── */}
      {/* CREATE DIALOG                                                   */}
      {/* ─────────────────────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Punch List Item</DialogTitle>
            <DialogDescription>Describe the deficiency and assign it for resolution.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-title">Title *</Label>
              <Input
                id="create-title"
                placeholder="e.g. Paint scuff on west wall"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                data-testid="input-item-title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-description">Description</Label>
              <Textarea
                id="create-description"
                placeholder="Detailed notes about the issue…"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                data-testid="input-item-description"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-location">Location</Label>
              <Input
                id="create-location"
                placeholder="e.g. Room 204, West wall"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                data-testid="input-item-location"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Trade</Label>
                <Select value={form.trade} onValueChange={(v) => setForm((f) => ({ ...f, trade: v }))}>
                  <SelectTrigger data-testid="select-item-trade"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRADE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                  <SelectTrigger data-testid="select-item-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Org user picker */}
            <div className="space-y-1.5">
              <Label>Assign To (team member)</Label>
              <Select value={form.assignedToUserId} onValueChange={(v) => setForm((f) => ({ ...f, assignedToUserId: v }))}>
                <SelectTrigger data-testid="select-assignee-user">
                  <SelectValue placeholder="Select team member…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No team member (manual entry below)</SelectItem>
                  {orgUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} — {u.role.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.assignedToUserId === "__none__" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="create-assignee">Assignee Name (manual)</Label>
                  <Input
                    id="create-assignee"
                    placeholder="Subcontractor or crew name"
                    value={form.assignedToName}
                    onChange={(e) => setForm((f) => ({ ...f, assignedToName: e.target.value }))}
                    data-testid="input-item-assignee"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-email">Assignee Email</Label>
                  <Input
                    id="create-email"
                    type="email"
                    placeholder="email@example.com"
                    value={form.assignedToEmail}
                    onChange={(e) => setForm((f) => ({ ...f, assignedToEmail: e.target.value }))}
                    data-testid="input-item-email"
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="create-due">Due Date</Label>
              <Input
                id="create-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                data-testid="input-item-due"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setForm(emptyForm); }}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.title || createMutation.isPending}
              data-testid="button-create-item"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────── */}
      {/* DETAIL DIALOG                                                   */}
      {/* ─────────────────────────────────────────────────────────────── */}
      {selected && (
        <Dialog open={showDetail} onOpenChange={(o) => { setShowDetail(o); if (!o) setSelected(null); }}>
          <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm text-muted-foreground">{selected.itemNumber}</span>
                <span>{selected.title}</span>
              </DialogTitle>
              <DialogDescription>Punch list item detail and status management</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Status + Priority badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${PRIORITY_COLORS[selected.priority]}`}>
                  {selected.priority} PRIORITY
                </span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1 ${STATUS_COLORS[selected.status]}`}>
                  {(() => { const I = STATUS_ICONS[selected.status]; return <I className="h-3 w-3" />; })()}
                  {STATUS_OPTIONS.find((s) => s.value === selected.status)?.label ?? selected.status}
                </span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                  {TRADE_OPTIONS.find((t) => t.value === selected.trade)?.label ?? selected.trade}
                </span>
              </div>

              {selected.description && (
                <div>
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Description</Label>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{selected.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                {selected.location && (
                  <div>
                    <Label className="text-muted-foreground text-xs uppercase tracking-wide flex items-center gap-1">
                      <MapPin className="h-3 w-3" />Location
                    </Label>
                    <p className="mt-1">{selected.location}</p>
                  </div>
                )}
                {(selected.assignedToName || selected.assignedToEmail) && (
                  <div>
                    <Label className="text-muted-foreground text-xs uppercase tracking-wide flex items-center gap-1">
                      <User className="h-3 w-3" />Assigned To
                    </Label>
                    <p className="mt-1">{selected.assignedToName ?? ""}</p>
                    {selected.assignedToEmail && (
                      <p className="text-xs text-muted-foreground">{selected.assignedToEmail}</p>
                    )}
                  </div>
                )}
                {selected.dueDate && (
                  <div>
                    <Label className="text-muted-foreground text-xs uppercase tracking-wide flex items-center gap-1">
                      <Calendar className="h-3 w-3" />Due Date
                    </Label>
                    <p className="mt-1">{format(new Date(selected.dueDate), "MMM d, yyyy")}</p>
                  </div>
                )}
                {selected.resolvedAt && (
                  <div>
                    <Label className="text-muted-foreground text-xs uppercase tracking-wide">Resolved At</Label>
                    <p className="mt-1">{format(new Date(selected.resolvedAt), "MMM d, yyyy")}</p>
                  </div>
                )}
                {selected.verifiedAt && (
                  <div>
                    <Label className="text-muted-foreground text-xs uppercase tracking-wide">Verified At</Label>
                    <p className="mt-1">{format(new Date(selected.verifiedAt), "MMM d, yyyy")}</p>
                  </div>
                )}
              </div>

              {/* Attachments */}
              <div>
                <Label className="text-muted-foreground text-xs uppercase tracking-wide mb-2 block flex items-center gap-1">
                  <Paperclip className="h-3 w-3" /> Attachments
                </Label>
                {Array.isArray(selected.attachments) && selected.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(selected.attachments as Array<{ url: string; filename: string; mimeType: string }>).map((a) => (
                      <div key={a.filename} className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded border">
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline truncate max-w-[140px]">
                          {a.filename}
                        </a>
                        {isManagement(userRole) && (
                          <button
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => removeAttachmentMutation.mutate({ id: selected.id, filename: a.filename })}
                            data-testid={`button-remove-attachment-${a.filename}`}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {isManagement(userRole) && (
                  <ObjectUploader
                    fileType="MEDIA"
                    maxNumberOfFiles={5}
                    allowedFileTypes={["image/*", "application/pdf"]}
                    onComplete={(result) => {
                      const successful = result.successful ?? [];
                      for (const f of successful) {
                        addAttachmentMutation.mutate({
                          id: selected.id,
                          attachment: {
                            url: f.uploadURL ?? "",
                            filename: f.name ?? "attachment",
                            mimeType: f.type ?? "application/octet-stream",
                          },
                        });
                      }
                    }}
                    testId="uploader-punch-attachment"
                  >
                    <Button variant="outline" size="sm" data-testid="button-add-attachment">
                      <Paperclip className="h-4 w-4 mr-1.5" />
                      Add Photo / File
                    </Button>
                  </ObjectUploader>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Created {format(new Date(selected.createdAt), "MMM d, yyyy")}
              </p>

              {/* ── Status Action Buttons ────────────────────────── */}
              <div className="border-t pt-4">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide mb-2 block">Update Status</Label>

                {/* Optional note for status change */}
                <Input
                  placeholder="Optional note for this status change…"
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  className="mb-3 text-sm h-8"
                  data-testid="input-status-note"
                />

                <div className="flex flex-wrap gap-2">
                  {selected.status === "OPEN" && canChangeStatus(userRole) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusChange(selected, "IN_PROGRESS")}
                      disabled={updateMutation.isPending}
                      data-testid="button-mark-in-progress"
                    >
                      <RefreshCcw className="h-4 w-4 mr-1.5" />
                      Mark In Progress
                    </Button>
                  )}
                  {selected.status === "IN_PROGRESS" && canChangeStatus(userRole) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                      onClick={() => handleStatusChange(selected, "RESOLVED")}
                      disabled={updateMutation.isPending}
                      data-testid="button-mark-resolved"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1.5" />
                      Mark Resolved
                    </Button>
                  )}
                  {selected.status === "RESOLVED" && canVerify(userRole) && (
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleStatusChange(selected, "VERIFIED")}
                      disabled={updateMutation.isPending}
                      data-testid="button-verify"
                    >
                      <Shield className="h-4 w-4 mr-1.5" />
                      Verify
                    </Button>
                  )}
                  {selected.status === "RESOLVED" && canVerify(userRole) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-700 border-red-300 hover:bg-red-50"
                      onClick={() => handleStatusChange(selected, "REJECTED")}
                      disabled={updateMutation.isPending}
                      data-testid="button-reject"
                    >
                      <XCircle className="h-4 w-4 mr-1.5" />
                      Reject
                    </Button>
                  )}
                  {selected.status === "VERIFIED" && canVerify(userRole) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusChange(selected, "OPEN")}
                      disabled={updateMutation.isPending}
                      data-testid="button-reopen"
                    >
                      <RefreshCcw className="h-4 w-4 mr-1.5" />
                      Reopen
                    </Button>
                  )}
                  {isManagement(userRole) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setShowDetail(false); handleOpenEdit(selected); }}
                      data-testid="button-edit-item"
                    >
                      <Edit2 className="h-4 w-4 mr-1.5" />
                      Edit Details
                    </Button>
                  )}
                </div>
              </div>

              {/* ── Status History ───────────────────────────────── */}
              <StatusHistory history={(selected.statusHistory ?? []) as StatusHistoryEntry[]} />
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              {canVerify(userRole) && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" data-testid="button-delete-item">
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Punch List Item?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently remove "{selected.title}" from the punch list. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate(selected.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button variant="outline" onClick={() => { setShowDetail(false); setSelected(null); }}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ─────────────────────────────────────────────────────────────── */}
      {/* EDIT DIALOG                                                     */}
      {/* ─────────────────────────────────────────────────────────────── */}
      {selected && (
        <Dialog open={showEdit} onOpenChange={(o) => { setShowEdit(o); if (!o) setSelected(null); }}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Punch List Item</DialogTitle>
              <DialogDescription>{selected.itemNumber} — {selected.title}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Title *</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  data-testid="input-edit-title"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  data-testid="input-edit-description"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  data-testid="input-edit-location"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Trade</Label>
                  <Select value={form.trade} onValueChange={(v) => setForm((f) => ({ ...f, trade: v }))}>
                    <SelectTrigger data-testid="select-edit-trade"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRADE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                    <SelectTrigger data-testid="select-edit-priority"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Org user picker in edit */}
              <div className="space-y-1.5">
                <Label>Assign To (team member)</Label>
                <Select value={form.assignedToUserId} onValueChange={(v) => setForm((f) => ({ ...f, assignedToUserId: v }))}>
                  <SelectTrigger data-testid="select-edit-assignee-user"><SelectValue placeholder="Select team member…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No team member (manual entry below)</SelectItem>
                    {orgUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName} {u.lastName} — {u.role.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.assignedToUserId === "__none__" && (
                <>
                  <div className="space-y-1.5">
                    <Label>Assignee Name (manual)</Label>
                    <Input
                      value={form.assignedToName}
                      onChange={(e) => setForm((f) => ({ ...f, assignedToName: e.target.value }))}
                      data-testid="input-edit-assignee"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Assignee Email</Label>
                    <Input
                      type="email"
                      value={form.assignedToEmail}
                      onChange={(e) => setForm((f) => ({ ...f, assignedToEmail: e.target.value }))}
                      data-testid="input-edit-email"
                    />
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                  data-testid="input-edit-due"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowEdit(false); setForm(emptyForm); }}>Cancel</Button>
              <Button
                onClick={() => {
                  const assignedUser = form.assignedToUserId && form.assignedToUserId !== "__none__"
                    ? orgUsers.find((u) => u.id === form.assignedToUserId)
                    : null;
                  updateMutation.mutate(
                    {
                      id: selected.id,
                      data: {
                        title: form.title,
                        description: form.description,
                        location: form.location,
                        trade: form.trade,
                        priority: form.priority,
                        assignedToUserId: assignedUser?.id ?? null,
                        assignedToName: assignedUser
                          ? `${assignedUser.firstName} ${assignedUser.lastName}`.trim()
                          : form.assignedToName || null,
                        assignedToEmail: assignedUser?.email || form.assignedToEmail || null,
                        dueDate: form.dueDate || null,
                        lastKnownUpdatedAt: selected.updatedAt,
                      },
                    },
                    { onSuccess: () => { setShowEdit(false); setForm(emptyForm); } },
                  );
                }}
                disabled={!form.title || updateMutation.isPending}
                data-testid="button-save-edit"
              >
                {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
