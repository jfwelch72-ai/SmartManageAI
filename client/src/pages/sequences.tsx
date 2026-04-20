import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Inbox, Plus, Copy, Archive, Trash2, Mail, Phone, ListChecks, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SequenceRow {
  id: string;
  name: string;
  description?: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  ownerName?: string | null;
  stepCount: number;
  activeEnrollments: number;
  totalEnrollments: number;
  repliedCount: number;
  updatedAt: string;
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : status === "DRAFT" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-700";
  return <Badge variant="secondary" className={cls} data-testid={`badge-status-${status}`}>{status}</Badge>;
}

export default function SequencesPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<"library" | "inbox">("library");

  const { data: sequences, isLoading } = useQuery<SequenceRow[]>({
    queryKey: ["/api/crm/sequences"],
  });

  const { data: inbox } = useQuery<{ dueToday: any[]; replied: any[] }>({
    queryKey: ["/api/crm/sequences/inbox/me"],
  });

  const cloneMut = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/crm/sequences/${id}/clone`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences"] });
      toast({ title: "Sequence cloned" });
    },
  });

  const archiveMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      (await apiRequest("PATCH", `/api/crm/sequences/${id}`, { status })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/sequences/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences"] });
      toast({ title: "Sequence deleted" });
    },
  });

  const completeTaskMut = useMutation({
    mutationFn: async (taskId: string) =>
      (await apiRequest("PATCH", `/api/crm/tasks/${taskId}`, { status: "COMPLETED" })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences/inbox/me"] });
      toast({ title: "Step completed" });
    },
  });

  const filtered = (sequences || []).filter((s) =>
    !filter || s.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="p-6 space-y-6" data-testid="page-sequences">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Sequences</h1>
          <p className="text-muted-foreground">Multi-step sales cadences for your CRM</p>
        </div>
        <CreateSequenceDialog open={showCreate} onOpenChange={setShowCreate} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v === "inbox" ? "inbox" : "library")}>
        <TabsList>
          <TabsTrigger value="library" data-testid="tab-library">
            <ListChecks className="h-4 w-4 mr-2" />Library
          </TabsTrigger>
          <TabsTrigger value="inbox" data-testid="tab-inbox">
            <Inbox className="h-4 w-4 mr-2" />My Sequences
            {inbox && (inbox.dueToday.length + inbox.replied.length) > 0 ? (
              <Badge variant="secondary" className="ml-2" data-testid="badge-inbox-count">
                {inbox.dueToday.length + inbox.replied.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search sequences..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              data-testid="input-search-sequences"
              className="max-w-sm"
            />
          </div>
          {isLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">No sequences yet. Create your first to get started.</CardContent></Card>
          ) : (
            <div className="grid gap-3">
              {filtered.map((seq) => (
                <Card key={seq.id} className="hover-elevate" data-testid={`card-sequence-${seq.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Link href={`/sequences/${seq.id}`}>
                            <a className="font-semibold text-lg hover:underline" data-testid={`link-sequence-${seq.id}`}>{seq.name}</a>
                          </Link>
                          <StatusBadge status={seq.status} />
                        </div>
                        {seq.description && <p className="text-sm text-muted-foreground mb-2">{seq.description}</p>}
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span data-testid={`text-step-count-${seq.id}`}>{seq.stepCount} steps</span>
                          <span data-testid={`text-active-${seq.id}`}>{seq.activeEnrollments} active</span>
                          <span data-testid={`text-total-${seq.id}`}>{seq.totalEnrollments} total enrolled</span>
                          <span data-testid={`text-replied-${seq.id}`}>{seq.repliedCount} replied</span>
                          {seq.ownerName && <span>Owner: {seq.ownerName}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => cloneMut.mutate(seq.id)} data-testid={`button-clone-${seq.id}`}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        {seq.status !== "ARCHIVED" ? (
                          <Button size="sm" variant="ghost" onClick={() => archiveMut.mutate({ id: seq.id, status: "ARCHIVED" })} data-testid={`button-archive-${seq.id}`}>
                            <Archive className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => archiveMut.mutate({ id: seq.id, status: "DRAFT" })} data-testid={`button-restore-${seq.id}`}>
                            Restore
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => {
                          if (confirm(`Delete "${seq.name}"? This will also remove all enrollments.`)) deleteMut.mutate(seq.id);
                        }} data-testid={`button-delete-${seq.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="inbox" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Due today</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!inbox || inbox.dueToday.length === 0 ? (
                <p className="text-muted-foreground text-sm">No manual steps due today.</p>
              ) : inbox.dueToday.map((task: any) => (
                <div key={task.id} className="flex items-center justify-between border rounded p-3" data-testid={`row-due-task-${task.id}`}>
                  <div className="flex-1">
                    <p className="font-medium" data-testid={`text-task-title-${task.id}`}>{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Sequence: {task.sequenceName} · Contact: {task.contactName || "—"}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => completeTaskMut.mutate(task.id)} data-testid={`button-complete-task-${task.id}`}>
                    Complete
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Replied — sequences paused</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!inbox || inbox.replied.length === 0 ? (
                <p className="text-muted-foreground text-sm">No paused-on-reply enrollments.</p>
              ) : inbox.replied.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between border rounded p-3" data-testid={`row-replied-${e.id}`}>
                  <div>
                    <p className="font-medium">{e.contactName || "Contact"} replied</p>
                    <p className="text-xs text-muted-foreground">Sequence: {e.sequenceName}</p>
                  </div>
                  <Link href={`/sequences/${e.sequenceId}`}>
                    <Button size="sm" variant="outline" data-testid={`button-view-seq-${e.id}`}>View</Button>
                  </Link>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CreateSequenceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { toast } = useToast();
  const createMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/sequences", { name, description })).json(),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences"] });
      toast({ title: "Sequence created" });
      onOpenChange(false);
      setName(""); setDescription("");
      window.location.href = `/sequences/${created.id}`;
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid="button-new-sequence"><Plus className="h-4 w-4 mr-2" />New sequence</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create sequence</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-seq-name" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-seq-description" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => createMut.mutate()} disabled={!name || createMut.isPending} data-testid="button-create-seq-confirm">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
