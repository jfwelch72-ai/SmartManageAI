import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Copy, Trash2, Key, Loader2, Plus, ExternalLink, Webhook } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimitPerMinute: number;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface RequestLogEntry {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number | null;
  scopeUsed: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface ScopesResponse {
  scopes: readonly string[];
  events: readonly string[];
}

interface WebhookSubscription {
  id: string;
  eventType: string;
  targetUrl: string;
  isActive: boolean;
  createdAt: string;
}

export default function DeveloperPortalPage() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ name: string; key: string } | null>(null);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [rateLimit, setRateLimit] = useState<string>("120");
  const [whCreateOpen, setWhCreateOpen] = useState(false);
  const [whEventType, setWhEventType] = useState("");
  const [whTargetUrl, setWhTargetUrl] = useState("");
  const [whApiKey, setWhApiKey] = useState("");
  const [whRevealedSecret, setWhRevealedSecret] = useState<string | null>(null);

  const { data: scopesData } = useQuery<ScopesResponse>({
    queryKey: ["/api/integrations/dev-portal/scopes"],
  });

  const { data: keys, isLoading } = useQuery<ApiKey[]>({
    queryKey: ["/api/integrations/dev-portal/keys"],
  });

  const { data: log } = useQuery<RequestLogEntry[]>({
    queryKey: ["/api/integrations/dev-portal/request-log"],
  });

  const { data: webhooks } = useQuery<{ data: WebhookSubscription[] }>({
    queryKey: ["/api/integrations/dev-portal/webhooks"],
  });

  const createWebhookMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/dev-portal/webhooks", {
        eventType: whEventType,
        targetUrl: whTargetUrl,
        apiKey: whApiKey || undefined,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setWhRevealedSecret(data.secret);
      setWhCreateOpen(false);
      setWhEventType("");
      setWhTargetUrl("");
      setWhApiKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/dev-portal/webhooks"] });
      toast({ title: "Webhook created", description: "Copy the signing secret now — it won't be shown again." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create webhook", description: err.message, variant: "destructive" });
    },
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/integrations/dev-portal/webhooks/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Webhook subscription disabled" });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/dev-portal/webhooks"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to disable", description: err.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/dev-portal/keys", {
        name,
        scopes: selectedScopes,
        rateLimitPerMinute: parseInt(rateLimit, 10) || 120,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setRevealedKey({ name: data.name, key: data.apiKey });
      setCreateOpen(false);
      setName("");
      setSelectedScopes([]);
      setRateLimit("120");
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/dev-portal/keys"] });
      toast({ title: "API key created", description: "Copy the key now — it won't be shown again." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create key", description: err.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/integrations/dev-portal/keys/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "API key revoked" });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/dev-portal/keys"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to revoke", description: err.message, variant: "destructive" });
    },
  });

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  return (
    <div className="space-y-6 p-6" data-testid="page-developer-portal">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Key className="h-6 w-6" />
            Developer Portal
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage API keys and webhooks for the SmartManage Public API.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-api-key">
              <Plus className="h-4 w-4 mr-2" />
              Create API Key
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="key-name">Name</Label>
                <Input
                  id="key-name"
                  data-testid="input-key-name"
                  placeholder="e.g. Internal reporting tool"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rate-limit">Rate limit (requests / minute)</Label>
                <Input
                  id="rate-limit"
                  data-testid="input-rate-limit"
                  type="number"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                />
              </div>
              <div>
                <Label className="mb-2 block">Scopes</Label>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto border rounded p-3">
                  {scopesData?.scopes.map((scope) => (
                    <label key={scope} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={selectedScopes.includes(scope)}
                        onCheckedChange={() => toggleScope(scope)}
                        data-testid={`checkbox-scope-${scope}`}
                      />
                      <span className="font-mono text-xs">{scope}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!name || selectedScopes.length === 0 || createMutation.isPending}
                data-testid="button-submit-create-key"
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Key
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {revealedKey && (
        <Card className="border-green-500" data-testid="card-revealed-key">
          <CardHeader>
            <CardTitle className="text-green-700 dark:text-green-400">
              API Key Created — Copy it now
            </CardTitle>
            <CardDescription>
              This key will only be shown once. Store it securely.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 bg-muted p-3 rounded font-mono text-sm break-all">
              <span className="flex-1" data-testid="text-revealed-key">{revealedKey.key}</span>
              <Button size="sm" variant="ghost" onClick={() => copyToClipboard(revealedKey.key)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setRevealedKey(null)}>
              I've stored it safely
            </Button>
          </CardContent>
        </Card>
      )}

      {whRevealedSecret && (
        <Card className="border-green-500" data-testid="card-revealed-webhook-secret">
          <CardHeader>
            <CardTitle className="text-green-700 dark:text-green-400">Webhook signing secret — Copy it now</CardTitle>
            <CardDescription>This secret signs every outbound delivery (HMAC-SHA256). It will not be shown again.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 bg-muted p-3 rounded font-mono text-sm break-all">
              <span className="flex-1" data-testid="text-revealed-webhook-secret">{whRevealedSecret}</span>
              <Button size="sm" variant="ghost" onClick={() => copyToClipboard(whRevealedSecret)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setWhRevealedSecret(null)}>
              I've stored it safely
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys" data-testid="tab-keys">API Keys</TabsTrigger>
          <TabsTrigger value="webhooks" data-testid="tab-webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="usage" data-testid="tab-usage">Usage Log</TabsTrigger>
          <TabsTrigger value="docs" data-testid="tab-docs">Documentation</TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {isLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : !keys?.length ? (
                <p className="text-center text-muted-foreground py-8">No API keys yet. Create one to get started.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Prefix</TableHead>
                      <TableHead>Scopes</TableHead>
                      <TableHead>Rate Limit</TableHead>
                      <TableHead>Last Used</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((k) => (
                      <TableRow key={k.id} data-testid={`row-api-key-${k.id}`}>
                        <TableCell className="font-medium">{k.name}</TableCell>
                        <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {k.scopes.slice(0, 3).map((s) => (
                              <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                            ))}
                            {k.scopes.length > 3 && <Badge variant="outline" className="text-xs">+{k.scopes.length - 3}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>{k.rateLimitPerMinute}/min</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}
                        </TableCell>
                        <TableCell>
                          {k.revokedAt ? (
                            <Badge variant="destructive">Revoked</Badge>
                          ) : k.isActive ? (
                            <Badge variant="default">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {!k.revokedAt && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => revokeMutation.mutate(k.id)}
                              disabled={revokeMutation.isPending}
                              data-testid={`button-revoke-${k.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Webhook className="h-4 w-4" /> Webhook Subscriptions</CardTitle>
                <CardDescription>Receive HMAC-signed event deliveries when data changes.</CardDescription>
              </div>
              <Dialog open={whCreateOpen} onOpenChange={setWhCreateOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-create-webhook">
                    <Plus className="h-4 w-4 mr-2" /> Subscribe
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>New Webhook Subscription</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Event type</Label>
                      <Select value={whEventType} onValueChange={setWhEventType}>
                        <SelectTrigger data-testid="select-webhook-event">
                          <SelectValue placeholder="Choose an event…" />
                        </SelectTrigger>
                        <SelectContent>
                          {scopesData?.events.map((e) => (
                            <SelectItem key={e} value={e}>{e}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="wh-url">Target URL (HTTPS)</Label>
                      <Input
                        id="wh-url"
                        data-testid="input-webhook-url"
                        placeholder="https://example.com/hooks/smartmanage"
                        value={whTargetUrl}
                        onChange={(e) => setWhTargetUrl(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="wh-key">API key (optional)</Label>
                      <Input
                        id="wh-key"
                        data-testid="input-webhook-apikey"
                        placeholder="ckp_xxxx.yyyy — leave blank to use any active key"
                        value={whApiKey}
                        onChange={(e) => setWhApiKey(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        If provided, scope <code>webhooks:manage</code> on this key is required. Otherwise, your admin session is used.
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setWhCreateOpen(false)}>Cancel</Button>
                    <Button
                      onClick={() => createWebhookMutation.mutate()}
                      disabled={!whEventType || !whTargetUrl || createWebhookMutation.isPending}
                      data-testid="button-submit-create-webhook"
                    >
                      {createWebhookMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Subscribe
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {!webhooks?.data?.length ? (
                <p className="text-center text-muted-foreground py-8">No webhook subscriptions yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Target URL</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhooks.data.map((w) => (
                      <TableRow key={w.id} data-testid={`row-webhook-${w.id}`}>
                        <TableCell><Badge variant="secondary">{w.eventType}</Badge></TableCell>
                        <TableCell className="font-mono text-xs break-all">{w.targetUrl}</TableCell>
                        <TableCell>
                          {w.isActive ? <Badge>Active</Badge> : <Badge variant="secondary">Disabled</Badge>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(w.createdAt).toLocaleString()}</TableCell>
                        <TableCell>
                          {w.isActive && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteWebhookMutation.mutate(w.id)}
                              disabled={deleteWebhookMutation.isPending}
                              data-testid={`button-disable-webhook-${w.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent API Requests</CardTitle>
              <CardDescription>Last 200 requests to /api/v1/public</CardDescription>
            </CardHeader>
            <CardContent>
              {!log?.length ? (
                <p className="text-center text-muted-foreground py-8">No requests recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Path</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Scope</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {log.map((entry) => (
                      <TableRow key={entry.id} data-testid={`row-log-${entry.id}`}>
                        <TableCell className="text-xs">{new Date(entry.createdAt).toLocaleTimeString()}</TableCell>
                        <TableCell><Badge variant="outline">{entry.method}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{entry.path}</TableCell>
                        <TableCell>
                          <Badge variant={entry.statusCode >= 400 ? "destructive" : "default"}>
                            {entry.statusCode}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{entry.durationMs ?? "-"}ms</TableCell>
                        <TableCell className="font-mono text-xs">{entry.scopeUsed ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="docs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Public API Documentation</CardTitle>
              <CardDescription>Base URL: <code className="font-mono">/api/v1/public</code></CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-3">
                <a href="/api-docs" target="_blank" rel="noopener noreferrer" className="inline-flex items-center px-3 py-1.5 rounded border bg-primary text-primary-foreground hover:opacity-90 text-xs font-medium" data-testid="link-openapi-spec">
                  Open Interactive OpenAPI Spec ↗
                </a>
                <span className="text-xs text-muted-foreground self-center">Always in sync with the deployed server.</span>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Authentication</h3>
                <p className="text-muted-foreground mb-2">
                  Pass your API key in the Authorization header:
                </p>
                <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
{`Authorization: Bearer ckp_xxxxxxxx.xxxxxxxxxxxxx
# Or:
X-API-Key: ckp_xxxxxxxx.xxxxxxxxxxxxx`}
                </pre>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Endpoints</h3>
                <ul className="space-y-1 font-mono text-xs">
                  <li><Badge variant="outline">GET</Badge> /projects — list projects (scope: <code>projects:read</code>)</li>
                  <li><Badge variant="outline">GET</Badge> /bids — list bids (scope: <code>bids:read</code>)</li>
                  <li><Badge variant="outline">GET</Badge> /change-orders — list change orders (scope: <code>change_orders:read</code>)</li>
                  <li><Badge variant="outline">GET</Badge> /rfis — list RFIs (scope: <code>rfis:read</code>)</li>
                  <li><Badge variant="outline">GET</Badge> /submittals — list submittals (scope: <code>submittals:read</code>)</li>
                  <li><Badge variant="outline">POST</Badge> /webhooks — subscribe to events (scope: <code>webhooks:manage</code>)</li>
                  <li><Badge variant="outline">GET</Badge> /webhooks — list subscriptions (scope: <code>webhooks:manage</code>)</li>
                  <li><Badge variant="outline">DELETE</Badge> /webhooks/:id — unsubscribe (scope: <code>webhooks:manage</code>)</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Webhook Events</h3>
                <p className="text-muted-foreground mb-2">Outbound webhooks are signed with HMAC-SHA256 in <code>X-Webhook-Signature</code> (with timestamp in <code>X-Webhook-Timestamp</code>).</p>
                <div className="grid grid-cols-2 gap-1 font-mono text-xs">
                  {scopesData?.events.map((e) => (
                    <div key={e}>{e}</div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Rate Limits</h3>
                <p className="text-muted-foreground">
                  Per-key limits enforced per minute. Response headers include <code>X-RateLimit-Limit</code>,{" "}
                  <code>X-RateLimit-Remaining</code>, and <code>X-RateLimit-Reset</code>.
                </p>
              </div>

              <div className="pt-2 border-t">
                <a
                  href="/api/v1/public/health"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary inline-flex items-center gap-1 text-sm"
                >
                  Test API health <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
