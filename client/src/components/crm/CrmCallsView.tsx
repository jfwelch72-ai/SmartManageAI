import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Phone, PhoneIncoming, PhoneOutgoing, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CrmCallRow {
  id: string;
  opportunityId: string | null;
  contactId: string | null;
  crmOrganisationId: string | null;
  direction: "INBOUND" | "OUTBOUND";
  outcome: string | null;
  status: string;
  fromNumber: string | null;
  toNumber: string | null;
  durationSeconds: number;
  startedAt: string;
  endedAt: string | null;
  notes: string | null;
  source: string;
  twilioCallSid: string | null;
  createdById: string | null;
  createdAt: string;
  createdByFirstName: string | null;
  createdByLastName: string | null;
}

const OUTCOME_OPTIONS: { value: string; label: string }[] = [
  { value: "CONNECTED", label: "Connected" },
  { value: "VOICEMAIL", label: "Voicemail" },
  { value: "NO_ANSWER", label: "No Answer" },
  { value: "BUSY", label: "Busy" },
  { value: "FAILED", label: "Failed" },
  { value: "WRONG_NUMBER", label: "Wrong Number" },
  { value: "MEETING_SCHEDULED", label: "Meeting Scheduled" },
];

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatOutcome(o: string | null): string {
  if (!o) return "—";
  return o.replace(/_/g, " ").toLowerCase();
}

export function CrmCallsView() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("ALL");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkOutcome, setBulkOutcome] = useState<string>("__keep__");
  const [bulkNotes, setBulkNotes] = useState<string>("");
  const [bulkNotesEnabled, setBulkNotesEnabled] = useState(false);

  const { data: calls, isLoading } = useQuery<CrmCallRow[]>({
    queryKey: ["/api/crm/calls"],
    queryFn: async () => {
      const res = await fetch("/api/crm/calls?limit=500", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    const rows = calls ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (outcomeFilter !== "ALL" && (r.outcome || "") !== outcomeFilter) return false;
      if (!q) return true;
      const hay = [
        r.notes ?? "",
        r.fromNumber ?? "",
        r.toNumber ?? "",
        r.outcome ?? "",
        r.createdByFirstName ?? "",
        r.createdByLastName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [calls, search, outcomeFilter]);

  const allOnPageSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someOnPageSelected =
    filtered.some((r) => selected.has(r.id)) && !allOnPageSelected;

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const r of filtered) next.delete(r.id);
      } else {
        for (const r of filtered) next.add(r.id);
      }
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkMutation = useMutation({
    mutationFn: async (payload: { ids: string[]; outcome?: string | null; notes?: string | null }) => {
      const res = await apiRequest("PATCH", "/api/crm/calls/bulk", payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Bulk update failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Calls updated",
        description: `${data.updated ?? 0} call${data.updated === 1 ? "" : "s"} updated.`,
      });
      setSelected(new Set());
      setBulkOpen(false);
      setBulkOutcome("__keep__");
      setBulkNotes("");
      setBulkNotesEnabled(false);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/activity"] });
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : "Please try again.";
      toast({
        title: "Bulk update failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const BULK_ID_LIMIT = 200;

  const submitBulk = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (ids.length > BULK_ID_LIMIT) {
      toast({
        title: "Too many calls selected",
        description: `Bulk edit supports up to ${BULK_ID_LIMIT} calls at a time. You have ${ids.length} selected.`,
        variant: "destructive",
      });
      return;
    }
    const payload: { ids: string[]; outcome?: string | null; notes?: string | null } = { ids };
    if (bulkOutcome !== "__keep__") {
      payload.outcome = bulkOutcome === "__clear__" ? null : bulkOutcome;
    }
    if (bulkNotesEnabled) {
      payload.notes = bulkNotes.trim() ? bulkNotes : null;
    }
    if (payload.outcome === undefined && payload.notes === undefined) {
      toast({
        title: "Nothing to update",
        description: "Choose an outcome or update notes before applying.",
        variant: "destructive",
      });
      return;
    }
    bulkMutation.mutate(payload);
  };

  return (
    <Card data-testid="view-crm-calls">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Phone className="w-5 h-5" />
            Logged Calls
            {!isLoading && (
              <Badge variant="secondary" className="ml-1 text-xs font-normal" data-testid="badge-calls-count">
                {filtered.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Search notes, numbers, owner..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-64"
              data-testid="input-search-calls"
            />
            <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
              <SelectTrigger className="w-full sm:w-44" data-testid="select-outcome-filter">
                <SelectValue placeholder="All outcomes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All outcomes</SelectItem>
                {OUTCOME_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {selected.size > 0 && (
          <div
            className="mt-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2"
            data-testid="bulk-action-bar"
          >
            <Badge variant="default" className="text-xs" data-testid="text-selected-count">
              {selected.size} selected
            </Badge>
            <Button
              size="sm"
              onClick={() => setBulkOpen(true)}
              data-testid="button-open-bulk-edit"
            >
              Bulk edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              data-testid="button-clear-selection"
            >
              <X className="w-3.5 h-3.5 mr-1" /> Clear
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40" data-testid="skeleton-calls" />
        ) : filtered.length === 0 ? (
          <p
            className="text-sm text-muted-foreground text-center py-8"
            data-testid="text-calls-empty"
          >
            No calls logged yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 w-8">
                    <Checkbox
                      checked={allOnPageSelected ? true : someOnPageSelected ? "indeterminate" : false}
                      onCheckedChange={togglePage}
                      data-testid="checkbox-select-all"
                      aria-label="Select all calls"
                    />
                  </th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Direction</th>
                  <th className="py-2 pr-3">Outcome</th>
                  <th className="py-2 pr-3">Duration</th>
                  <th className="py-2 pr-3">Number</th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isSelected = selected.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      className={`border-b hover-elevate ${isSelected ? "bg-muted/40" : ""}`}
                      data-testid={`row-call-${r.id}`}
                    >
                      <td className="py-2 pr-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleRow(r.id)}
                          data-testid={`checkbox-call-${r.id}`}
                          aria-label={`Select call ${r.id}`}
                        />
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs">
                        {format(new Date(r.startedAt), "MMM d, h:mm a")}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-1 text-xs">
                          {r.direction === "INBOUND" ? (
                            <PhoneIncoming className="w-3.5 h-3.5 text-emerald-700" />
                          ) : (
                            <PhoneOutgoing className="w-3.5 h-3.5 text-sky-700" />
                          )}
                          {r.direction === "INBOUND" ? "In" : "Out"}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        {r.outcome ? (
                          <Badge variant="secondary" className="text-xs">
                            {formatOutcome(r.outcome)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">{formatDuration(r.durationSeconds)}</td>
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">
                        {(r.direction === "INBOUND" ? r.fromNumber : r.toNumber) || "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">
                        {[r.createdByFirstName, r.createdByLastName].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs max-w-xs truncate" title={r.notes ?? ""}>
                        {r.notes || <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent data-testid="dialog-bulk-edit">
          <DialogHeader>
            <DialogTitle>Bulk edit {selected.size} call{selected.size === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              Apply the same outcome or notes to all selected calls.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Outcome</label>
              <Select value={bulkOutcome} onValueChange={setBulkOutcome}>
                <SelectTrigger data-testid="select-bulk-outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep__">Keep current</SelectItem>
                  <SelectItem value="__clear__">Clear outcome</SelectItem>
                  {OUTCOME_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={bulkNotesEnabled}
                  onCheckedChange={(v) => setBulkNotesEnabled(!!v)}
                  data-testid="checkbox-bulk-notes-enabled"
                />
                Replace notes
              </label>
              <Textarea
                value={bulkNotes}
                onChange={(e) => setBulkNotes(e.target.value)}
                placeholder="New notes (leave blank to clear)"
                rows={4}
                disabled={!bulkNotesEnabled}
                data-testid="textarea-bulk-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkOpen(false)}
              data-testid="button-cancel-bulk"
            >
              Cancel
            </Button>
            <Button
              onClick={submitBulk}
              disabled={bulkMutation.isPending}
              data-testid="button-apply-bulk"
            >
              {bulkMutation.isPending ? "Applying..." : "Apply to selected"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default CrmCallsView;
