import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookOpen, Plus, Pencil, RefreshCw, Search, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface CostBookProvider {
  id: string;
  organizationId: string;
  name: string;
  providerKind: string;
  apiEndpoint: string | null;
  apiKeyEnvVar: string | null;
  isActive: boolean;
  defaultRegion: string | null;
  notes: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CostBookEntry {
  id: string;
  sourceCode: string;
  csiDivision: string | null;
  description: string;
  unit: string;
  materialCost: string;
  laborCost: string;
  equipmentCost: string;
  totalCost: string;
  asOfDate: string;
}

const PROVIDER_KINDS = ["BUILTIN", "RSMEANS", "GORDIAN", "CRAFTSMAN", "CUSTOM"];

function emptyForm() {
  return {
    name: "",
    providerKind: "BUILTIN",
    apiEndpoint: "",
    apiKeyEnvVar: "",
    defaultRegion: "",
    notes: "",
    isActive: true,
  };
}

export default function CostBookPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CostBookProvider | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: providers = [], isLoading } = useQuery<CostBookProvider[]>({
    queryKey: ["/api/cost-book/providers"],
  });

  const activeProviderId = useMemo(() => {
    if (selectedProviderId && providers.some((p) => p.id === selectedProviderId)) {
      return selectedProviderId;
    }
    return providers[0]?.id ?? null;
  }, [selectedProviderId, providers]);

  const { data: entries = [], isFetching: entriesLoading } = useQuery<CostBookEntry[]>({
    queryKey: ["/api/cost-book/providers", activeProviderId, "entries", search],
    queryFn: async () => {
      if (!activeProviderId) return [];
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      params.set("limit", "100");
      const res = await fetch(
        `/api/cost-book/providers/${activeProviderId}/entries?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load entries");
      return res.json();
    },
    enabled: !!activeProviderId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = {
        ...data,
        apiEndpoint: data.apiEndpoint || null,
        apiKeyEnvVar: data.apiKeyEnvVar || null,
        defaultRegion: data.defaultRegion || null,
        notes: data.notes || null,
      };
      const res = await apiRequest("POST", "/api/cost-book/providers", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cost-book/providers"] });
      setDialogOpen(false);
      setForm(emptyForm());
      toast({ title: "Provider created" });
    },
    onError: (err: Error) => toast({ title: "Failed to create provider", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof form }) => {
      const payload = {
        ...data,
        apiEndpoint: data.apiEndpoint || null,
        apiKeyEnvVar: data.apiKeyEnvVar || null,
        defaultRegion: data.defaultRegion || null,
        notes: data.notes || null,
      };
      const res = await apiRequest("PATCH", `/api/cost-book/providers/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cost-book/providers"] });
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm());
      toast({ title: "Provider updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update provider", description: err.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/cost-book/providers/${id}/sync`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cost-book/providers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cost-book/providers", activeProviderId, "entries"] });
      toast({
        title: "Sync complete",
        description: typeof data?.upserted === "number" ? `Upserted ${data.upserted} entries` : "Provider refreshed",
      });
    },
    onError: (err: Error) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(p: CostBookProvider) {
    setEditing(p);
    setForm({
      name: p.name,
      providerKind: p.providerKind,
      apiEndpoint: p.apiEndpoint ?? "",
      apiKeyEnvVar: p.apiKeyEnvVar ?? "",
      defaultRegion: p.defaultRegion ?? "",
      notes: p.notes ?? "",
      isActive: p.isActive,
    });
    setDialogOpen(true);
  }

  function submit() {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <BookOpen className="h-7 w-7" />
            Cost Book
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage cost-book providers and search published unit-cost entries.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-provider">
          <Plus className="h-4 w-4 mr-2" />
          Add Provider
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Providers</CardTitle>
          <CardDescription>Configured cost-book sources for your organization.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : providers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-empty-providers">
              No cost-book providers yet. Add one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Last Synced</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((p) => (
                  <TableRow
                    key={p.id}
                    className={activeProviderId === p.id ? "bg-muted/40" : ""}
                    data-testid={`row-provider-${p.id}`}
                  >
                    <TableCell>
                      <button
                        type="button"
                        className="font-medium hover:underline text-left"
                        onClick={() => setSelectedProviderId(p.id)}
                        data-testid={`button-select-provider-${p.id}`}
                      >
                        {p.name}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.providerKind}</Badge>
                    </TableCell>
                    <TableCell>{p.defaultRegion ?? "—"}</TableCell>
                    <TableCell>
                      {p.lastSyncedAt ? format(new Date(p.lastSyncedAt), "MMM d, yyyy h:mm a") : "Never"}
                    </TableCell>
                    <TableCell>
                      {p.isActive ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => syncMutation.mutate(p.id)}
                        disabled={syncMutation.isPending && syncMutation.variables === p.id}
                        data-testid={`button-sync-${p.id}`}
                      >
                        {syncMutation.isPending && syncMutation.variables === p.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        <span className="ml-1">Sync</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(p)}
                        data-testid={`button-edit-${p.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {activeProviderId && (
        <Card>
          <CardHeader>
            <CardTitle>Entries</CardTitle>
            <CardDescription>
              Search published unit-cost line items for the selected provider.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by code or description"
                className="pl-9"
                data-testid="input-search-entries"
              />
            </div>
            {entriesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-empty-entries">
                {search ? "No entries match your search." : "No entries loaded yet. Run Sync to populate."}
              </div>
            ) : (
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Material</TableHead>
                      <TableHead className="text-right">Labor</TableHead>
                      <TableHead className="text-right">Equipment</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((e) => (
                      <TableRow key={e.id} data-testid={`row-entry-${e.id}`}>
                        <TableCell className="font-mono text-xs">{e.sourceCode}</TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell>{e.unit}</TableCell>
                        <TableCell className="text-right">${Number(e.materialCost).toFixed(2)}</TableCell>
                        <TableCell className="text-right">${Number(e.laborCost).toFixed(2)}</TableCell>
                        <TableCell className="text-right">${Number(e.equipmentCost).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-medium">
                          ${Number(e.totalCost).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Provider" : "Add Provider"}</DialogTitle>
            <DialogDescription>
              Configure a cost-book source. Use API endpoint + key env var for external providers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider-name">Name</Label>
              <Input
                id="provider-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. RSMeans 2025"
                data-testid="input-provider-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-kind">Provider Kind</Label>
              <Select
                value={form.providerKind}
                onValueChange={(v) => setForm({ ...form, providerKind: v })}
              >
                <SelectTrigger id="provider-kind" data-testid="select-provider-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="provider-endpoint">API Endpoint</Label>
                <Input
                  id="provider-endpoint"
                  value={form.apiEndpoint}
                  onChange={(e) => setForm({ ...form, apiEndpoint: e.target.value })}
                  placeholder="https://…"
                  data-testid="input-provider-endpoint"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider-keyenv">API Key Env Var</Label>
                <Input
                  id="provider-keyenv"
                  value={form.apiKeyEnvVar}
                  onChange={(e) => setForm({ ...form, apiKeyEnvVar: e.target.value })}
                  placeholder="RSMEANS_API_KEY"
                  data-testid="input-provider-keyenv"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-region">Default Region</Label>
              <Input
                id="provider-region"
                value={form.defaultRegion}
                onChange={(e) => setForm({ ...form, defaultRegion: e.target.value })}
                placeholder="e.g. NATIONAL_AVG"
                data-testid="input-provider-region"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-notes">Notes</Label>
              <Textarea
                id="provider-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                data-testid="input-provider-notes"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                id="provider-active"
                data-testid="switch-provider-active"
              />
              <Label htmlFor="provider-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-provider">
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-provider"
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              {editing ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
