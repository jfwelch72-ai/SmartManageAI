import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  PlayCircle,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  MessageSquarePlus,
} from "lucide-react";

type ComponentStatus = "operational" | "degraded" | "outage" | "unknown";

type AdminComponent = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  probe_kind: string;
  probe_url: string | null;
  probe_expect_status: number;
  probe_timeout_ms: number;
  enabled: boolean;
  sort_order: number;
};

type IncidentStatus = "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
type IncidentImpact = "NONE" | "MINOR" | "MAJOR" | "CRITICAL";

type IncidentUpdate = {
  id: string;
  status: IncidentStatus;
  body: string;
  createdAt: string;
};

type AdminIncident = {
  id: string;
  title: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  affectedComponents: Array<{ id: string; key: string; name: string }>;
  startedAt: string;
  resolvedAt: string | null;
  postmortemUrl: string | null;
  postmortem: string | null;
  updates: IncidentUpdate[];
};

type Subscriber = {
  id: string;
  email: string;
  confirmed: boolean;
  created_at: string;
  confirmed_at: string | null;
};

type SubscriberRemoval = {
  id: string;
  email: string;
  reason: string | null;
  removed_at: string;
  removed_by_user_id: string | null;
  removed_by_email: string | null;
  removed_by_name: string | null;
};

type StatusSummary = {
  overall: ComponentStatus;
  components: Array<{
    id: string;
    key: string;
    name: string;
    status: ComponentStatus;
    uptime24h: number | null;
    uptime30d: number | null;
    lastCheckedAt: string | null;
    lastError: string | null;
  }>;
};

const COMPONENTS_KEY = ["/api/admin/status/components"];
const INCIDENTS_KEY = ["/api/admin/status/incidents"];
const SUBSCRIBERS_KEY = ["/api/admin/status/subscribers"];
const SUBSCRIBER_REMOVALS_KEY = ["/api/admin/status/subscriber-removals"];
const SUMMARY_KEY = ["/api/public/status/summary"];

const IMPACT_OPTIONS: IncidentImpact[] = ["NONE", "MINOR", "MAJOR", "CRITICAL"];
const STATUS_OPTIONS: IncidentStatus[] = ["INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"];
const PROBE_KIND_OPTIONS = [
  "http_get",
  "http_self",
  "http_public",
  "http_self_health",
  "db_ping",
  "object_storage",
  "config_present",
] as const;

type ProbeKind = (typeof PROBE_KIND_OPTIONS)[number];

type ProbeSweepResult = { probed: number; failures: number };

type IncidentCreatePayload = {
  title: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  affectedComponentIds: string[];
  initialUpdate?: string;
  postmortemUrl?: string;
};

type IncidentEditPayload = {
  title: string;
  impact: IncidentImpact;
  affectedComponentIds: string[];
  postmortem: string | null;
  postmortemUrl: string | null;
};

type ComponentSavePayload = {
  key?: string;
  name: string;
  description: string | null;
  probeKind: ProbeKind;
  probeUrl: string | null;
  probeExpectStatus: number;
  probeTimeoutMs: number;
  enabled: boolean;
  sortOrder: number;
};

const STATUS_BADGE: Record<ComponentStatus, string> = {
  operational: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  degraded: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  outage: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

const IMPACT_BADGE: Record<IncidentImpact, string> = {
  NONE: "bg-muted text-muted-foreground border-border",
  MINOR: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  MAJOR: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
  CRITICAL: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AdminStatusPage() {
  const { toast } = useToast();

  useEffect(() => {
    document.title = "Status Admin | SmartManageAI";
  }, []);

  const componentsQuery = useQuery<AdminComponent[]>({ queryKey: COMPONENTS_KEY });
  const incidentsQuery = useQuery<AdminIncident[]>({ queryKey: INCIDENTS_KEY });
  const summaryQuery = useQuery<StatusSummary>({ queryKey: SUMMARY_KEY });
  const subscribersQuery = useQuery<Subscriber[]>({ queryKey: SUBSCRIBERS_KEY });
  const subscriberRemovalsQuery = useQuery<SubscriberRemoval[]>({ queryKey: SUBSCRIBER_REMOVALS_KEY });

  const summaryByCompId = useMemo(() => {
    const map = new Map<string, StatusSummary["components"][number]>();
    for (const c of summaryQuery.data?.components ?? []) map.set(c.id, c);
    return map;
  }, [summaryQuery.data]);

  const probeNow = useMutation<ProbeSweepResult, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/status/probe-now");
      return (await res.json()) as ProbeSweepResult;
    },
    onSuccess: (data) => {
      toast({
        title: "Probe sweep complete",
        description: `${data?.probed ?? 0} components probed, ${data?.failures ?? 0} failing`,
      });
      queryClient.invalidateQueries({ queryKey: COMPONENTS_KEY });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
    },
    onError: (err: Error) => {
      toast({ title: "Probe sweep failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="heading-admin-status">
            <Activity className="h-6 w-6" />
            Status page admin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage components and publish incidents shown on{" "}
            <a href="/status" className="underline" target="_blank" rel="noopener noreferrer" data-testid="link-public-status">
              /status
            </a>
            . Incident updates fan out emails to confirmed subscribers.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => probeNow.mutate()}
          disabled={probeNow.isPending}
          data-testid="button-probe-now"
        >
          {probeNow.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4 mr-2" />
          )}
          Run probe sweep
        </Button>
      </div>

      <Tabs defaultValue="incidents">
        <TabsList>
          <TabsTrigger value="incidents" data-testid="tab-incidents">
            Incidents
          </TabsTrigger>
          <TabsTrigger value="components" data-testid="tab-components">
            Components
          </TabsTrigger>
          <TabsTrigger value="subscribers" data-testid="tab-subscribers">
            Subscribers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="incidents" className="space-y-4 mt-4">
          <IncidentsSection
            incidents={incidentsQuery.data ?? []}
            isLoading={incidentsQuery.isLoading}
            components={componentsQuery.data ?? []}
          />
        </TabsContent>

        <TabsContent value="components" className="space-y-4 mt-4">
          <ComponentsSection
            components={componentsQuery.data ?? []}
            isLoading={componentsQuery.isLoading}
            summaryByCompId={summaryByCompId}
          />
        </TabsContent>

        <TabsContent value="subscribers" className="space-y-4 mt-4">
          <SubscribersSection
            subscribers={subscribersQuery.data ?? []}
            isLoading={subscribersQuery.isLoading}
          />
          <RecentRemovalsSection
            removals={subscriberRemovalsQuery.data ?? []}
            isLoading={subscriberRemovalsQuery.isLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// -------------------- Incidents --------------------

function IncidentsSection({
  incidents,
  isLoading,
  components,
}: {
  incidents: AdminIncident[];
  isLoading: boolean;
  components: AdminComponent[];
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground" data-testid="text-incident-count">
          {incidents.length} incident{incidents.length === 1 ? "" : "s"} in the last year
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-new-incident">
          <Plus className="h-4 w-4 mr-2" /> Declare incident
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : incidents.length === 0 ? (
        <Card data-testid="card-empty-incidents">
          <CardContent className="py-12 flex flex-col items-center justify-center text-center text-muted-foreground gap-3">
            <CheckCircle2 className="h-10 w-10" />
            <div>No incidents have been published.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {incidents.map((inc) => (
            <IncidentRow key={inc.id} incident={inc} components={components} />
          ))}
        </div>
      )}

      <CreateIncidentDialog open={createOpen} onOpenChange={setCreateOpen} components={components} />
    </>
  );
}

function IncidentRow({
  incident,
  components,
}: {
  incident: AdminIncident;
  components: AdminComponent[];
}) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/admin/status/incidents/${incident.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INCIDENTS_KEY });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
      toast({ title: "Incident deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const isResolved = incident.status === "RESOLVED";

  return (
    <Card data-testid={`incident-row-${incident.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2" data-testid={`text-incident-title-${incident.id}`}>
              {incident.title}
            </CardTitle>
            <CardDescription className="mt-1 flex items-center gap-1 text-xs">
              <Clock className="h-3 w-3" /> Started {fmt(incident.startedAt)}
              {incident.resolvedAt && <> · Resolved {fmt(incident.resolvedAt)}</>}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={IMPACT_BADGE[incident.impact]} data-testid={`badge-impact-${incident.id}`}>
              {incident.impact}
            </Badge>
            <Badge variant="outline" data-testid={`badge-status-${incident.id}`}>
              {incident.status}
            </Badge>
          </div>
        </div>
        {incident.affectedComponents.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1" data-testid={`row-incident-components-${incident.id}`}>
            {incident.affectedComponents.map((c) => (
              <Badge key={c.id} variant="secondary" data-testid={`badge-incident-${incident.id}-component-${c.key}`}>
                {c.name}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {incident.updates.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            {[...incident.updates].reverse().map((u) => (
              <div key={u.id} className="text-sm" data-testid={`incident-update-${u.id}`}>
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{u.status}</span> · {fmt(u.createdAt)}
                </div>
                <div className="whitespace-pre-wrap">{u.body}</div>
              </div>
            ))}
          </div>
        )}

        {(incident.postmortem || incident.postmortemUrl) && (
          <div className="border-t border-border pt-3 text-sm">
            <div className="font-medium mb-1">Post-mortem</div>
            {incident.postmortem && (
              <div className="whitespace-pre-wrap text-foreground/90">{incident.postmortem}</div>
            )}
            {incident.postmortemUrl && (
              <a
                href={incident.postmortemUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-xs"
              >
                {incident.postmortemUrl}
              </a>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setUpdateOpen(true)}
            disabled={isResolved}
            data-testid={`button-post-update-${incident.id}`}
          >
            <MessageSquarePlus className="h-4 w-4 mr-2" />
            Post update
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditOpen(true)}
            data-testid={`button-edit-incident-${incident.id}`}
          >
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            data-testid={`button-delete-incident-${incident.id}`}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </CardContent>

      <PostUpdateDialog
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        incidentId={incident.id}
        currentStatus={incident.status}
      />
      <EditIncidentDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        incident={incident}
        components={components}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this incident?</AlertDialogTitle>
            <AlertDialogDescription>
              The incident and all its updates will be permanently removed from the public
              status page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-delete-${incident.id}`}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              data-testid={`button-confirm-delete-${incident.id}`}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CreateIncidentDialog({
  open,
  onOpenChange,
  components,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  components: AdminComponent[];
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<IncidentStatus>("INVESTIGATING");
  const [impact, setImpact] = useState<IncidentImpact>("MINOR");
  const [initialUpdate, setInitialUpdate] = useState("");
  const [postmortemUrl, setPostmortemUrl] = useState("");
  const [affectedIds, setAffectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setTitle("");
      setStatus("INVESTIGATING");
      setImpact("MINOR");
      setInitialUpdate("");
      setPostmortemUrl("");
      setAffectedIds([]);
    }
  }, [open]);

  const create = useMutation<{ id: string }, Error, void>({
    mutationFn: async () => {
      const body: IncidentCreatePayload = {
        title,
        status,
        impact,
        affectedComponentIds: affectedIds,
      };
      if (initialUpdate.trim()) body.initialUpdate = initialUpdate.trim();
      if (postmortemUrl.trim()) body.postmortemUrl = postmortemUrl.trim();
      const res = await apiRequest("POST", "/api/admin/status/incidents", body);
      return (await res.json()) as { id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INCIDENTS_KEY });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
      toast({
        title: "Incident published",
        description: "Subscribers have been notified.",
      });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create incident", description: err.message, variant: "destructive" });
    },
  });

  const toggleAffected = (id: string) => {
    setAffectedIds((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Declare an incident</DialogTitle>
          <DialogDescription>
            This publishes immediately and emails confirmed status subscribers.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="incident-title">Title</Label>
            <Input
              id="incident-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Elevated error rate on bid uploads"
              data-testid="input-incident-title"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as IncidentStatus)}>
                <SelectTrigger data-testid="select-incident-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Impact</Label>
              <Select value={impact} onValueChange={(v) => setImpact(v as IncidentImpact)}>
                <SelectTrigger data-testid="select-incident-impact">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPACT_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="incident-initial-update">Initial update (optional)</Label>
            <Textarea
              id="incident-initial-update"
              value={initialUpdate}
              onChange={(e) => setInitialUpdate(e.target.value)}
              rows={4}
              placeholder="What's happening, who's affected, what we're doing about it"
              data-testid="input-incident-initial-update"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="incident-postmortem-url">Post-mortem URL (optional)</Label>
            <Input
              id="incident-postmortem-url"
              type="url"
              value={postmortemUrl}
              onChange={(e) => setPostmortemUrl(e.target.value)}
              placeholder="https://…"
              data-testid="input-incident-postmortem-url"
            />
          </div>
          {components.length > 0 && (
            <div className="space-y-1.5">
              <Label>Affected components</Label>
              <div className="rounded-md border border-border p-2 space-y-1 max-h-40 overflow-y-auto">
                {components.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                    data-testid={`label-affected-${c.key}`}
                  >
                    <Checkbox
                      checked={affectedIds.includes(c.id)}
                      onCheckedChange={() => toggleAffected(c.id)}
                      data-testid={`checkbox-affected-${c.key}`}
                    />
                    <span>{c.name}</span>
                    <span className="text-xs text-muted-foreground">({c.key})</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-create-incident">
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || title.trim().length < 3}
            data-testid="button-submit-create-incident"
          >
            {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Publish incident
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PostUpdateDialog({
  open,
  onOpenChange,
  incidentId,
  currentStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  currentStatus: IncidentStatus;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<IncidentStatus>(currentStatus);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (open) {
      setStatus(currentStatus === "RESOLVED" ? "MONITORING" : currentStatus);
      setBody("");
    }
  }, [open, currentStatus]);

  const post = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/status/incidents/${incidentId}/updates`, {
        status,
        body,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INCIDENTS_KEY });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
      toast({
        title: status === "RESOLVED" ? "Incident resolved" : "Update posted",
        description: "Subscribers have been notified.",
      });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to post update", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Post incident update</DialogTitle>
          <DialogDescription>
            Posting an update with status RESOLVED will close the incident and stamp the resolved
            time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as IncidentStatus)}>
              <SelectTrigger data-testid="select-update-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="update-body">Update</Label>
            <Textarea
              id="update-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What changed, what we're doing next"
              data-testid="input-update-body"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-post-update">
            Cancel
          </Button>
          <Button
            onClick={() => post.mutate()}
            disabled={post.isPending || body.trim().length === 0}
            data-testid="button-submit-post-update"
          >
            {post.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {status === "RESOLVED" ? "Resolve incident" : "Post update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditIncidentDialog({
  open,
  onOpenChange,
  incident,
  components,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incident: AdminIncident;
  components: AdminComponent[];
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(incident.title);
  const [impact, setImpact] = useState<IncidentImpact>(incident.impact);
  const [postmortem, setPostmortem] = useState(incident.postmortem ?? "");
  const [postmortemUrl, setPostmortemUrl] = useState(incident.postmortemUrl ?? "");
  const [affectedIds, setAffectedIds] = useState<string[]>(incident.affectedComponents.map((c) => c.id));

  useEffect(() => {
    if (open) {
      setTitle(incident.title);
      setImpact(incident.impact);
      setPostmortem(incident.postmortem ?? "");
      setPostmortemUrl(incident.postmortemUrl ?? "");
      setAffectedIds(incident.affectedComponents.map((c) => c.id));
    }
  }, [open, incident]);

  const save = useMutation<{ ok: true }, Error, void>({
    mutationFn: async () => {
      const body: IncidentEditPayload = {
        title,
        impact,
        affectedComponentIds: affectedIds,
        postmortem: postmortem.trim() ? postmortem : null,
        postmortemUrl: postmortemUrl.trim() ? postmortemUrl : null,
      };
      const res = await apiRequest("PATCH", `/api/admin/status/incidents/${incident.id}`, body);
      return (await res.json()) as { ok: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INCIDENTS_KEY });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
      toast({ title: "Incident updated" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleAffected = (id: string) => {
    setAffectedIds((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit incident</DialogTitle>
          <DialogDescription>
            Updating these fields does not send an email. Use “Post update” to notify subscribers.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-edit-incident-title"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Impact</Label>
            <Select value={impact} onValueChange={(v) => setImpact(v as IncidentImpact)}>
              <SelectTrigger data-testid="select-edit-impact">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMPACT_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-postmortem-url">Post-mortem URL</Label>
            <Input
              id="edit-postmortem-url"
              type="url"
              value={postmortemUrl}
              onChange={(e) => setPostmortemUrl(e.target.value)}
              placeholder="https://…"
              data-testid="input-edit-postmortem-url"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-postmortem">Post-mortem</Label>
            <Textarea
              id="edit-postmortem"
              rows={5}
              value={postmortem}
              onChange={(e) => setPostmortem(e.target.value)}
              placeholder="Root cause, timeline, remediation"
              data-testid="input-edit-postmortem"
            />
          </div>
          {components.length > 0 && (
            <div className="space-y-1.5">
              <Label>Affected components</Label>
              <div className="rounded-md border border-border p-2 space-y-1 max-h-40 overflow-y-auto">
                {components.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                    data-testid={`label-edit-affected-${c.key}`}
                  >
                    <Checkbox
                      checked={affectedIds.includes(c.id)}
                      onCheckedChange={() => toggleAffected(c.id)}
                      data-testid={`checkbox-edit-affected-${c.key}`}
                    />
                    <span>{c.name}</span>
                    <span className="text-xs text-muted-foreground">({c.key})</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-edit-incident">
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || title.trim().length < 3}
            data-testid="button-save-edit-incident"
          >
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Components --------------------

function ComponentsSection({
  components,
  isLoading,
  summaryByCompId,
}: {
  components: AdminComponent[];
  isLoading: boolean;
  summaryByCompId: Map<string, StatusSummary["components"][number]>;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground" data-testid="text-component-count">
          {components.length} component{components.length === 1 ? "" : "s"} configured
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-new-component">
          <Plus className="h-4 w-4 mr-2" /> Add component
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : components.length === 0 ? (
        <Card data-testid="card-empty-components">
          <CardContent className="py-12 flex flex-col items-center justify-center text-center text-muted-foreground gap-3">
            <AlertCircle className="h-10 w-10" />
            <div>No components configured.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {components.map((c) => (
            <ComponentRow
              key={c.id}
              component={c}
              summary={summaryByCompId.get(c.id)}
            />
          ))}
        </div>
      )}

      <ComponentDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </>
  );
}

function ComponentRow({
  component,
  summary,
}: {
  component: AdminComponent;
  summary?: StatusSummary["components"][number];
}) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const toggleEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("PATCH", `/api/admin/status/components/${component.id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPONENTS_KEY });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
    },
    onError: (err: Error) => {
      toast({ title: "Toggle failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/admin/status/components/${component.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPONENTS_KEY });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
      toast({ title: "Component deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const status: ComponentStatus = summary?.status ?? "unknown";

  return (
    <Card data-testid={`component-row-${component.key}`}>
      <CardContent className="py-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-medium" data-testid={`text-component-name-${component.key}`}>
              {component.name}
            </div>
            <Badge variant="outline" className={STATUS_BADGE[status]} data-testid={`badge-component-status-${component.key}`}>
              {status}
            </Badge>
            <Badge variant="outline" className="font-mono text-xs">
              {component.key}
            </Badge>
            {!component.enabled && (
              <Badge variant="outline" className="bg-muted">
                disabled
              </Badge>
            )}
          </div>
          {component.description && (
            <div className="text-sm text-muted-foreground mt-1">{component.description}</div>
          )}
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
            <span>Probe: {component.probe_kind}</span>
            {component.probe_url && <span className="truncate">URL: {component.probe_url}</span>}
            <span>Last check: {fmt(summary?.lastCheckedAt ?? null)}</span>
          </div>
          {summary?.lastError && status !== "operational" && (
            <div className="text-xs text-red-600 dark:text-red-400 mt-1">
              {summary.lastError}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Switch
              checked={component.enabled}
              onCheckedChange={(v) => toggleEnabled.mutate(v)}
              disabled={toggleEnabled.isPending}
              data-testid={`switch-enabled-${component.key}`}
            />
            <span className="text-xs text-muted-foreground">Enabled</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditOpen(true)}
            data-testid={`button-edit-component-${component.key}`}
          >
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            data-testid={`button-delete-component-${component.key}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>

      <ComponentDialog
        mode="edit"
        component={component}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this component?</AlertDialogTitle>
            <AlertDialogDescription>
              The component and its probe history will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              data-testid={`button-confirm-delete-component-${component.key}`}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ComponentDialog({
  mode,
  component,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  component?: AdminComponent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [probeKind, setProbeKind] = useState<ProbeKind>("http_get");
  const [probeUrl, setProbeUrl] = useState("");
  const [probeExpectStatus, setProbeExpectStatus] = useState(200);
  const [probeTimeoutMs, setProbeTimeoutMs] = useState(8000);
  const [enabled, setEnabled] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && component) {
      setKey(component.key);
      setName(component.name);
      setDescription(component.description ?? "");
      setProbeKind(
        (PROBE_KIND_OPTIONS as readonly string[]).includes(component.probe_kind)
          ? (component.probe_kind as ProbeKind)
          : "http_get",
      );
      setProbeUrl(component.probe_url ?? "");
      setProbeExpectStatus(component.probe_expect_status);
      setProbeTimeoutMs(component.probe_timeout_ms);
      setEnabled(component.enabled);
      setSortOrder(component.sort_order);
    } else {
      setKey("");
      setName("");
      setDescription("");
      setProbeKind("http_get");
      setProbeUrl("");
      setProbeExpectStatus(200);
      setProbeTimeoutMs(8000);
      setEnabled(true);
      setSortOrder(0);
    }
  }, [open, mode, component]);

  const save = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const body: ComponentSavePayload = {
        name,
        description: description.trim() ? description : null,
        probeKind,
        probeUrl: probeUrl.trim() ? probeUrl : null,
        probeExpectStatus,
        probeTimeoutMs,
        enabled,
        sortOrder,
      };
      if (mode === "create") {
        body.key = key;
        const res = await apiRequest("POST", "/api/admin/status/components", body);
        return res.json();
      }
      const res = await apiRequest("PATCH", `/api/admin/status/components/${component!.id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPONENTS_KEY });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
      toast({ title: mode === "create" ? "Component created" : "Component updated" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const requiresUrl = probeKind === "http_get";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add component" : "Edit component"}</DialogTitle>
          <DialogDescription>
            Components appear on the public status page along with uptime and last probe time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="comp-key">Key</Label>
              <Input
                id="comp-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={mode === "edit"}
                placeholder="api"
                data-testid="input-component-key"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comp-name">Name</Label>
              <Input
                id="comp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="API"
                data-testid="input-component-name"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comp-description">Description</Label>
            <Input
              id="comp-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Public REST API"
              data-testid="input-component-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Probe kind</Label>
              <Select value={probeKind} onValueChange={(v) => setProbeKind(v as ProbeKind)}>
                <SelectTrigger data-testid="select-probe-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROBE_KIND_OPTIONS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comp-sort">Sort order</Label>
              <Input
                id="comp-sort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                data-testid="input-component-sort"
              />
            </div>
          </div>
          {requiresUrl && (
            <div className="space-y-1.5">
              <Label htmlFor="comp-url">Probe URL</Label>
              <Input
                id="comp-url"
                type="url"
                value={probeUrl}
                onChange={(e) => setProbeUrl(e.target.value)}
                placeholder="https://…"
                data-testid="input-component-url"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="comp-expect">Expected status</Label>
              <Input
                id="comp-expect"
                type="number"
                value={probeExpectStatus}
                onChange={(e) => setProbeExpectStatus(Number(e.target.value) || 200)}
                data-testid="input-component-expect-status"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comp-timeout">Timeout (ms)</Label>
              <Input
                id="comp-timeout"
                type="number"
                value={probeTimeoutMs}
                onChange={(e) => setProbeTimeoutMs(Number(e.target.value) || 8000)}
                data-testid="input-component-timeout"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-component-enabled" />
            <Label>Enabled</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-component">
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={
              save.isPending ||
              name.trim().length < 1 ||
              (mode === "create" && key.trim().length < 1) ||
              (requiresUrl && probeUrl.trim().length < 1)
            }
            data-testid="button-save-component"
          >
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Subscribers --------------------

function SubscribersSection({
  subscribers,
  isLoading,
}: {
  subscribers: Subscriber[];
  isLoading: boolean;
}) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [bulkReason, setBulkReason] = useState("Bounced email");
  const [pasteReason, setPasteReason] = useState("Bounced email");

  const subscriberIds = useMemo(() => subscribers.map((s) => s.id), [subscribers]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(subscriberIds);
      const next = new Set<string>();
      for (const id of prev) if (valid.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [subscriberIds]);

  const bulkDelete = useMutation<
    { ok: boolean; removed: number; removedEmails: string[] },
    Error,
    { ids?: string[]; emails?: string[]; reason?: string }
  >({
    mutationFn: async (body) => {
      const res = await apiRequest("POST", "/api/admin/status/subscribers/bulk-delete", body);
      return (await res.json()) as { ok: boolean; removed: number; removedEmails: string[] };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: SUBSCRIBERS_KEY });
      queryClient.invalidateQueries({ queryKey: SUBSCRIBER_REMOVALS_KEY });
      setSelectedIds(new Set());
      setBulkConfirmOpen(false);
      setPasteOpen(false);
      setPasteValue("");
      toast({
        title: data.removed === 1 ? "1 subscriber removed" : `${data.removed} subscribers removed`,
        description:
          data.removed === 0
            ? "No matching subscribers were found."
            : data.removedEmails.slice(0, 3).join(", ") +
              (data.removedEmails.length > 3 ? ` +${data.removedEmails.length - 3} more` : ""),
      });
    },
    onError: (err: Error) => {
      toast({ title: "Bulk remove failed", description: err.message, variant: "destructive" });
    },
  });

  const allSelected = subscribers.length > 0 && selectedIds.size === subscribers.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected || someSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(subscriberIds));
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const parsedPasteEmails = useMemo(() => {
    return Array.from(
      new Set(
        pasteValue
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
      ),
    );
  }, [pasteValue]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (subscribers.length === 0) {
    return (
      <Card data-testid="card-empty-subscribers">
        <CardContent className="py-12 flex flex-col items-center justify-center text-center text-muted-foreground gap-3">
          <RefreshCw className="h-10 w-10" />
          <div>No one has subscribed to status updates yet.</div>
        </CardContent>
      </Card>
    );
  }
  const confirmed = subscribers.filter((s) => s.confirmed).length;

  return (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-muted-foreground" data-testid="text-subscriber-count">
          {confirmed} confirmed of {subscribers.length} total
          {selectedIds.size > 0 && (
            <span className="ml-2" data-testid="text-subscribers-selected">
              · {selectedIds.size} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPasteOpen(true)}
            data-testid="button-remove-by-list"
          >
            Remove by email list
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={selectedIds.size === 0 || bulkDelete.isPending}
            onClick={() => setBulkConfirmOpen(true)}
            data-testid="button-remove-selected-subscribers"
          >
            {bulkDelete.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Remove selected
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground">
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              checked={allSelected}
              onChange={toggleAll}
              aria-label="Select all subscribers"
              data-testid="checkbox-select-all-subscribers"
            />
            <span>Select all on this page</span>
          </div>
          <div className="divide-y divide-border">
            {subscribers.map((s) => (
              <SubscriberRow
                key={s.id}
                subscriber={s}
                selected={selectedIds.has(s.id)}
                onToggle={() => toggleOne(s.id)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {selectedIds.size} subscriber{selectedIds.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected subscribers will stop receiving incident emails. They can resubscribe
              from the public status page if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="bulk-removal-reason">Reason (recorded in audit log)</Label>
            <Input
              id="bulk-removal-reason"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              maxLength={500}
              placeholder="e.g. Bounced email"
              data-testid="input-bulk-removal-reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-remove">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                bulkDelete.mutate({
                  ids: Array.from(selectedIds),
                  reason: bulkReason.trim() || undefined,
                });
              }}
              disabled={bulkDelete.isPending}
              data-testid="button-confirm-bulk-remove"
            >
              {bulkDelete.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Removing
                </>
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Remove subscribers by email list</DialogTitle>
            <DialogDescription>
              Paste a list of email addresses (one per line, or separated by commas / spaces). Any
              that match a current subscriber will be removed. Unmatched addresses are ignored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              rows={8}
              placeholder={"bouncing@example.com\nabuse@example.com\n…"}
              data-testid="input-paste-emails"
            />
            <div className="text-xs text-muted-foreground" data-testid="text-paste-email-count">
              {parsedPasteEmails.length} valid email
              {parsedPasteEmails.length === 1 ? "" : "s"} detected
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paste-removal-reason">Reason (recorded in audit log)</Label>
              <Input
                id="paste-removal-reason"
                value={pasteReason}
                onChange={(e) => setPasteReason(e.target.value)}
                maxLength={500}
                placeholder="e.g. Bounced email"
                data-testid="input-paste-removal-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPasteOpen(false)}
              data-testid="button-cancel-paste-remove"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={parsedPasteEmails.length === 0 || bulkDelete.isPending}
              onClick={() =>
                bulkDelete.mutate({
                  emails: parsedPasteEmails,
                  reason: pasteReason.trim() || undefined,
                })
              }
              data-testid="button-confirm-paste-remove"
            >
              {bulkDelete.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Remove {parsedPasteEmails.length || ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const REMOVAL_REASONS = ["bounce", "abuse", "user_request", "other"] as const;
type RemovalReason = (typeof REMOVAL_REASONS)[number];
const REMOVAL_REASON_LABELS: Record<RemovalReason, string> = {
  bounce: "Bounced email",
  abuse: "Spam / abuse",
  user_request: "User requested",
  other: "Other",
};

function SubscriberRow({
  subscriber,
  selected,
  onToggle,
}: {
  subscriber: Subscriber;
  selected: boolean;
  onToggle: () => void;
}) {
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reasonKind, setReasonKind] = useState<RemovalReason>("user_request");
  const [reasonNote, setReasonNote] = useState("");

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const label = REMOVAL_REASON_LABELS[reasonKind];
      const note = reasonNote.trim();
      const reason = note ? `${label}: ${note}` : label;
      await apiRequest("DELETE", `/api/admin/status/subscribers/${subscriber.id}`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUBSCRIBERS_KEY });
      queryClient.invalidateQueries({ queryKey: SUBSCRIBER_REMOVALS_KEY });
      toast({ title: "Subscriber removed", description: subscriber.email });
      setDeleteOpen(false);
      setReasonNote("");
      setReasonKind("user_request");
    },
    onError: (err: Error) => {
      toast({ title: "Remove failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
      data-testid={`subscriber-row-${subscriber.id}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select subscriber ${subscriber.email}`}
          data-testid={`checkbox-subscriber-${subscriber.id}`}
        />
        <div className="font-medium truncate" data-testid={`text-subscriber-email-${subscriber.id}`}>
          {subscriber.email}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={subscriber.confirmed ? "secondary" : "outline"}>
          {subscriber.confirmed ? "confirmed" : "pending"}
        </Badge>
        <span className="text-xs text-muted-foreground">{fmt(subscriber.created_at)}</span>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive h-8 w-8 p-0"
          onClick={() => setDeleteOpen(true)}
          disabled={deleteMutation.isPending}
          aria-label={`Remove subscriber ${subscriber.email}`}
          data-testid={`button-delete-subscriber-${subscriber.id}`}
        >
          {deleteMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this subscriber?</AlertDialogTitle>
            <AlertDialogDescription>
              {subscriber.email} will stop receiving incident emails. They can resubscribe
              themselves from the public status page if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor={`removal-reason-${subscriber.id}`}>Reason</Label>
              <Select value={reasonKind} onValueChange={(v) => setReasonKind(v as RemovalReason)}>
                <SelectTrigger
                  id={`removal-reason-${subscriber.id}`}
                  data-testid={`select-removal-reason-${subscriber.id}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMOVAL_REASONS.map((r) => (
                    <SelectItem key={r} value={r} data-testid={`option-removal-reason-${r}`}>
                      {REMOVAL_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`removal-note-${subscriber.id}`}>Notes (optional)</Label>
              <Textarea
                id={`removal-note-${subscriber.id}`}
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                rows={2}
                maxLength={400}
                placeholder="Anything useful for the audit log"
                data-testid={`input-removal-note-${subscriber.id}`}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-delete-subscriber-${subscriber.id}`}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              data-testid={`button-confirm-delete-subscriber-${subscriber.id}`}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Removing
                </>
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// -------------------- Recently removed subscribers --------------------

function RecentRemovalsSection({
  removals,
  isLoading,
}: {
  removals: SubscriberRemoval[];
  isLoading: boolean;
}) {
  return (
    <Card data-testid="card-subscriber-removals">
      <CardHeader>
        <CardTitle className="text-base">Recently removed</CardTitle>
        <CardDescription>
          The last {removals.length || "few"} subscribers removed by an admin, with the reason recorded at the time of removal.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : removals.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground" data-testid="text-no-removals">
            No subscriber removals recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {removals.map((r) => {
              const actor =
                (r.removed_by_name && r.removed_by_name.length > 0
                  ? r.removed_by_name
                  : r.removed_by_email) || "Unknown admin";
              return (
                <div
                  key={r.id}
                  className="px-4 py-3 text-sm flex flex-col gap-1"
                  data-testid={`removal-row-${r.id}`}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="font-medium truncate" data-testid={`text-removal-email-${r.id}`}>
                      {r.email}
                    </div>
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid={`text-removal-time-${r.id}`}
                    >
                      {fmt(r.removed_at)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground" data-testid={`text-removal-actor-${r.id}`}>
                    Removed by {actor}
                  </div>
                  <div className="text-sm" data-testid={`text-removal-reason-${r.id}`}>
                    {r.reason && r.reason.trim().length > 0 ? (
                      r.reason
                    ) : (
                      <span className="text-muted-foreground italic">No reason recorded</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
