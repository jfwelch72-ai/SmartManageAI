import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Shield, Key, Clock, Database, Lock, FileText, Users, AlertTriangle, Plus, Save, Play, Trash2 } from "lucide-react";
import { FeatureGate } from "@/components/FeatureGate";

type Tab = "sso" | "session" | "retention" | "privacy";

function SSOTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState("OKTA");
  const [entityId, setEntityId] = useState("");
  const [ssoLoginUrl, setSsoLoginUrl] = useState("");
  const [certificate, setCertificate] = useState("");
  const [metadataUrl, setMetadataUrl] = useState("");
  const [enforceSSO, setEnforceSSO] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const { data: configData, isLoading } = useQuery<{ config: any; orgSlug: string | null }>({
    queryKey: ["/api/sso/config"],
  });

  const config = configData?.config;
  const orgSlug = configData?.orgSlug;

  useEffect(() => {
    if (config) {
      setProvider(config.provider || "OKTA");
      setEntityId(config.entityId || "");
      setSsoLoginUrl(config.ssoLoginUrl || "");
      setCertificate(config.certificate || "");
      setMetadataUrl(config.metadataUrl || "");
      setEnforceSSO(config.enforceSSO || false);
      setEnabled(config.enabled || false);
    }
  }, [config]);

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sso/test", { certificate, ssoLoginUrl });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data.valid ? "Configuration Valid" : "Configuration Invalid",
        description: data.valid ? data.message : data.errors?.join(", "),
        variant: data.valid ? "default" : "destructive",
      });
    },
    onError: (err: Error) => toast({ title: "Test Failed", description: err.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/sso/config", {
        provider, entityId, ssoLoginUrl, certificate, metadataUrl, enforceSSO, enabled,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "SSO Configuration Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/sso/config"] });
    },
    onError: (err: Error) => toast({ title: "Save Failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">Loading SSO configuration...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> SAML SSO Configuration</CardTitle>
          <CardDescription>Configure Single Sign-On for your organization</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Identity Provider</label>
              <Select value={provider} onValueChange={setProvider} data-testid="select-sso-provider">
                <SelectTrigger data-testid="select-trigger-sso-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OKTA">Okta</SelectItem>
                  <SelectItem value="AZURE_AD">Azure AD</SelectItem>
                  <SelectItem value="ONELOGIN">OneLogin</SelectItem>
                  <SelectItem value="CUSTOM">Custom SAML</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Entity ID</label>
              <Input
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder="https://your-idp.com/entity-id"
                data-testid="input-entity-id"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">SSO Login URL</label>
            <Input
              value={ssoLoginUrl}
              onChange={(e) => setSsoLoginUrl(e.target.value)}
              placeholder="https://your-idp.com/sso/saml"
              data-testid="input-sso-login-url"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">X.509 Certificate</label>
            <Textarea
              value={certificate}
              onChange={(e) => setCertificate(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
              rows={5}
              data-testid="textarea-certificate"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Metadata URL (Optional)</label>
            <Input
              value={metadataUrl}
              onChange={(e) => setMetadataUrl(e.target.value)}
              placeholder="https://your-idp.com/metadata.xml"
              data-testid="input-metadata-url"
            />
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch checked={enforceSSO} onCheckedChange={setEnforceSSO} data-testid="switch-enforce-sso" />
              <label className="text-sm">Enforce SSO (disable password login)</label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-sso-enabled" />
              <label className="text-sm">SSO Enabled</label>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending} data-testid="button-test-sso">
              <Play className="h-4 w-4 mr-1" />
              {testMutation.isPending ? "Testing..." : "Test Configuration"}
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-sso">
              <Save className="h-4 w-4 mr-1" />
              {saveMutation.isPending ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SSO Login URL</CardTitle>
          <CardDescription>Share this URL with your team to access SSO login</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block p-3 bg-muted rounded-md text-sm break-all" data-testid="text-sso-login-url">
            {window.location.origin}/api/sso/{orgSlug || "<org-slug>"}/login
          </code>
        </CardContent>
      </Card>
    </div>
  );
}

function SessionSecurityTab() {
  const policies = [
    { icon: Clock, title: "Session Timeout", value: "8 hours", description: "Sessions automatically expire after 8 hours of inactivity" },
    { icon: Users, title: "Max Concurrent Sessions", value: "5", description: "Users can have up to 5 active sessions simultaneously" },
    { icon: Lock, title: "Password Minimum Length", value: "8 characters", description: "All passwords must be at least 8 characters long" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {policies.map((p) => (
          <Card key={p.title}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <p.icon className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">{p.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold" data-testid={`text-policy-${p.title.toLowerCase().replace(/\s+/g, "-")}`}>{p.value}</p>
              <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Active Sessions</CardTitle>
          <CardDescription>Session tracking and management</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-md">
            <Badge variant="default" data-testid="badge-session-tracking">Active</Badge>
            <p className="text-sm text-muted-foreground">Session tracking is enabled. All user sessions are monitored for security compliance.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DataRetentionTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedPolicies, setEditedPolicies] = useState<Record<string, { retentionDays?: number; action?: string }>>({});
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: policies, isLoading } = useQuery<any[]>({ queryKey: ["/api/retention/policies"] });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/retention/policies/seed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Default Policies Created" });
      queryClient.invalidateQueries({ queryKey: ["/api/retention/policies"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PUT", `/api/retention/policies/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Policy Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/retention/policies"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/retention/preview");
      return res.json();
    },
    onSuccess: (data: any[]) => setPreviewData(data),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/retention/execute", { dryRun: false });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Retention Executed", description: `${data.results?.length || 0} policies processed` });
      setShowConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/retention/policies"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const getEditValue = (id: string, field: string, original: any) => {
    return editedPolicies[id]?.[field as keyof typeof editedPolicies[string]] ?? original;
  };

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading retention policies...</div>;

  if (!policies?.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Database className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">No retention policies configured yet.</p>
          <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="button-seed-policies">
            <Plus className="h-4 w-4 mr-1" />
            {seedMutation.isPending ? "Creating..." : "Seed Default Policies"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" /> Retention Policies</CardTitle>
              <CardDescription>Configure how long data is retained before cleanup</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending} data-testid="button-preview-retention">
                <Play className="h-4 w-4 mr-1" />
                {previewMutation.isPending ? "Loading..." : "Preview Impact"}
              </Button>
              <Button variant="destructive" onClick={() => setShowConfirm(true)} data-testid="button-execute-retention">
                <AlertTriangle className="h-4 w-4 mr-1" /> Execute Retention
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4 font-medium">Entity Type</th>
                  <th className="py-2 pr-4 font-medium">Retention (Days)</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p: any) => (
                  <tr key={p.id} className="border-b" data-testid={`row-policy-${p.id}`}>
                    <td className="py-3 pr-4">
                      <Badge variant="outline">{p.entityType}</Badge>
                    </td>
                    <td className="py-3 pr-4">
                      <Input
                        type="number"
                        className="w-24"
                        value={getEditValue(p.id, "retentionDays", p.retentionDays)}
                        onChange={(e) => setEditedPolicies((prev) => ({
                          ...prev,
                          [p.id]: { ...prev[p.id], retentionDays: parseInt(e.target.value) || 0 },
                        }))}
                        data-testid={`input-retention-days-${p.id}`}
                      />
                    </td>
                    <td className="py-3 pr-4">
                      <Select
                        value={getEditValue(p.id, "action", p.action) as string}
                        onValueChange={(v) => setEditedPolicies((prev) => ({
                          ...prev,
                          [p.id]: { ...prev[p.id], action: v },
                        }))}
                      >
                        <SelectTrigger className="w-32" data-testid={`select-action-${p.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DELETE">Delete</SelectItem>
                          <SelectItem value="ARCHIVE">Archive</SelectItem>
                          <SelectItem value="ANONYMIZE">Anonymize</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={p.enabled ? "default" : "secondary"}>{p.enabled ? "Enabled" : "Disabled"}</Badge>
                    </td>
                    <td className="py-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const edits = editedPolicies[p.id];
                          if (edits) updateMutation.mutate({ id: p.id, data: edits });
                        }}
                        disabled={!editedPolicies[p.id] || updateMutation.isPending}
                        data-testid={`button-save-policy-${p.id}`}
                      >
                        <Save className="h-3 w-3 mr-1" /> Save
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {previewData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Retention Preview</CardTitle>
            <CardDescription>Records that would be affected by current policies</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {previewData.map((item: any, i: number) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-muted/50 rounded-md" data-testid={`preview-item-${i}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{item.entityType}</Badge>
                    <span className="text-sm text-muted-foreground">{item.action} after {item.retentionDays} days</span>
                  </div>
                  <span className="text-sm font-medium">{item.affectedCount} records affected</span>
                </div>
              ))}
              {previewData.length === 0 && <p className="text-sm text-muted-foreground">No records would be affected.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {showConfirm && (
        <Card className="border-destructive">
          <CardContent className="py-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5" />
              <div className="space-y-3">
                <p className="font-medium">Are you sure you want to execute retention policies?</p>
                <p className="text-sm text-muted-foreground">This action will permanently delete or archive records according to your configured policies. This cannot be undone.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="destructive" onClick={() => executeMutation.mutate()} disabled={executeMutation.isPending} data-testid="button-confirm-execute">
                    {executeMutation.isPending ? "Executing..." : "Yes, Execute"}
                  </Button>
                  <Button variant="outline" onClick={() => setShowConfirm(false)} data-testid="button-cancel-execute">Cancel</Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PrivacyComplianceTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);
  const [recordForm, setRecordForm] = useState({ purpose: "", legalBasis: "LEGITIMATE_INTEREST", dataCategories: "", recipients: "", retentionPeriod: "" });
  const [requestForm, setRequestForm] = useState({ requestType: "ACCESS", subjectEmail: "", subjectName: "", notes: "" });

  const { data: records, isLoading: recordsLoading } = useQuery<any[]>({ queryKey: ["/api/privacy/processing-records"] });
  const { data: requests, isLoading: requestsLoading } = useQuery<any[]>({ queryKey: ["/api/privacy/subject-requests"] });

  const saveRecordMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/privacy/processing-records", {
        ...(editRecord ? { id: editRecord.id } : {}),
        ...recordForm,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: editRecord ? "Record Updated" : "Record Created" });
      queryClient.invalidateQueries({ queryKey: ["/api/privacy/processing-records"] });
      setShowRecordForm(false);
      setEditRecord(null);
      setRecordForm({ purpose: "", legalBasis: "LEGITIMATE_INTEREST", dataCategories: "", recipients: "", retentionPeriod: "" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createRequestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/privacy/subject-requests", requestForm);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Request Created" });
      queryClient.invalidateQueries({ queryKey: ["/api/privacy/subject-requests"] });
      setShowRequestForm(false);
      setRequestForm({ requestType: "ACCESS", subjectEmail: "", subjectName: "", notes: "" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const processMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/privacy/subject-requests/${id}/process`, { action: "process" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Request Processed" });
      queryClient.invalidateQueries({ queryKey: ["/api/privacy/subject-requests"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const statusColor = (s: string) => {
    switch (s) {
      case "COMPLETED": return "default";
      case "IN_PROGRESS": return "secondary";
      case "DENIED": return "destructive";
      default: return "outline";
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Processing Records (ROPA)</CardTitle>
              <CardDescription>Record of Processing Activities for GDPR compliance</CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => { setShowRecordForm(true); setEditRecord(null); setRecordForm({ purpose: "", legalBasis: "LEGITIMATE_INTEREST", dataCategories: "", recipients: "", retentionPeriod: "" }); }}
              data-testid="button-add-record"
            >
              <Plus className="h-4 w-4 mr-1" /> Add Record
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showRecordForm && (
            <div className="mb-4 p-4 border rounded-md space-y-3" data-testid="form-processing-record">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Purpose</label>
                  <Input value={recordForm.purpose} onChange={(e) => setRecordForm({ ...recordForm, purpose: e.target.value })} placeholder="Data processing purpose" data-testid="input-record-purpose" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Legal Basis</label>
                  <Select value={recordForm.legalBasis} onValueChange={(v) => setRecordForm({ ...recordForm, legalBasis: v })}>
                    <SelectTrigger data-testid="select-legal-basis"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CONSENT">Consent</SelectItem>
                      <SelectItem value="CONTRACT">Contract</SelectItem>
                      <SelectItem value="LEGAL_OBLIGATION">Legal Obligation</SelectItem>
                      <SelectItem value="VITAL_INTEREST">Vital Interest</SelectItem>
                      <SelectItem value="PUBLIC_INTEREST">Public Interest</SelectItem>
                      <SelectItem value="LEGITIMATE_INTEREST">Legitimate Interest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Data Categories</label>
                  <Input value={recordForm.dataCategories} onChange={(e) => setRecordForm({ ...recordForm, dataCategories: e.target.value })} placeholder="e.g., Personal, Financial" data-testid="input-data-categories" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Recipients</label>
                  <Input value={recordForm.recipients} onChange={(e) => setRecordForm({ ...recordForm, recipients: e.target.value })} placeholder="e.g., Internal teams" data-testid="input-recipients" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Retention Period</label>
                  <Input value={recordForm.retentionPeriod} onChange={(e) => setRecordForm({ ...recordForm, retentionPeriod: e.target.value })} placeholder="e.g., 7 years" data-testid="input-retention-period" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => saveRecordMutation.mutate()} disabled={saveRecordMutation.isPending} data-testid="button-save-record">
                  <Save className="h-3 w-3 mr-1" /> {saveRecordMutation.isPending ? "Saving..." : "Save"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowRecordForm(false); setEditRecord(null); }} data-testid="button-cancel-record">Cancel</Button>
              </div>
            </div>
          )}
          {recordsLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : !records?.length ? (
            <p className="text-sm text-muted-foreground py-4" data-testid="text-no-records">No processing records yet. Add your first record above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4 font-medium">Purpose</th>
                    <th className="py-2 pr-4 font-medium">Legal Basis</th>
                    <th className="py-2 pr-4 font-medium">Categories</th>
                    <th className="py-2 pr-4 font-medium">Retention</th>
                    <th className="py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r: any) => (
                    <tr key={r.id} className="border-b" data-testid={`row-record-${r.id}`}>
                      <td className="py-3 pr-4">{r.purpose}</td>
                      <td className="py-3 pr-4"><Badge variant="outline">{r.legalBasis}</Badge></td>
                      <td className="py-3 pr-4 text-muted-foreground">{r.dataCategories || "-"}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{r.retentionPeriod || "-"}</td>
                      <td className="py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditRecord(r);
                            setRecordForm({ purpose: r.purpose, legalBasis: r.legalBasis, dataCategories: r.dataCategories || "", recipients: r.recipients || "", retentionPeriod: r.retentionPeriod || "" });
                            setShowRecordForm(true);
                          }}
                          data-testid={`button-edit-record-${r.id}`}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Data Subject Requests</CardTitle>
              <CardDescription>Manage GDPR/CCPA data subject access and deletion requests</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowRequestForm(true)} data-testid="button-add-request">
              <Plus className="h-4 w-4 mr-1" /> New Request
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showRequestForm && (
            <div className="mb-4 p-4 border rounded-md space-y-3" data-testid="form-subject-request">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Request Type</label>
                  <Select value={requestForm.requestType} onValueChange={(v) => setRequestForm({ ...requestForm, requestType: v })}>
                    <SelectTrigger data-testid="select-request-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACCESS">Access (SAR)</SelectItem>
                      <SelectItem value="DELETION">Deletion (Right to be Forgotten)</SelectItem>
                      <SelectItem value="RECTIFICATION">Rectification</SelectItem>
                      <SelectItem value="PORTABILITY">Data Portability</SelectItem>
                      <SelectItem value="RESTRICTION">Restriction of Processing</SelectItem>
                      <SelectItem value="OBJECTION">Objection</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Subject Email</label>
                  <Input value={requestForm.subjectEmail} onChange={(e) => setRequestForm({ ...requestForm, subjectEmail: e.target.value })} placeholder="user@example.com" data-testid="input-subject-email" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Subject Name</label>
                  <Input value={requestForm.subjectName} onChange={(e) => setRequestForm({ ...requestForm, subjectName: e.target.value })} placeholder="Full name" data-testid="input-subject-name" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Notes</label>
                  <Input value={requestForm.notes} onChange={(e) => setRequestForm({ ...requestForm, notes: e.target.value })} placeholder="Additional context" data-testid="input-request-notes" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => createRequestMutation.mutate()} disabled={createRequestMutation.isPending} data-testid="button-submit-request">
                  <Save className="h-3 w-3 mr-1" /> {createRequestMutation.isPending ? "Submitting..." : "Submit Request"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowRequestForm(false)} data-testid="button-cancel-request">Cancel</Button>
              </div>
            </div>
          )}
          {requestsLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : !requests?.length ? (
            <p className="text-sm text-muted-foreground py-4" data-testid="text-no-requests">No data subject requests yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Subject</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Requested</th>
                    <th className="py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r: any) => (
                    <tr key={r.id} className="border-b" data-testid={`row-request-${r.id}`}>
                      <td className="py-3 pr-4"><Badge variant="outline">{r.requestType}</Badge></td>
                      <td className="py-3 pr-4">
                        <div>{r.subjectName || "-"}</div>
                        <div className="text-xs text-muted-foreground">{r.subjectEmail}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={statusColor(r.status)} data-testid={`badge-status-${r.id}`}>{r.status}</Badge>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{new Date(r.requestedAt).toLocaleDateString()}</td>
                      <td className="py-3">
                        {r.status === "PENDING" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => processMutation.mutate(r.id)}
                            disabled={processMutation.isPending}
                            data-testid={`button-process-request-${r.id}`}
                          >
                            <Play className="h-3 w-3 mr-1" /> Process
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const TABS: { key: Tab; label: string; icon: typeof Shield }[] = [
  { key: "sso", label: "SSO Configuration", icon: Key },
  { key: "session", label: "Session Security", icon: Lock },
  { key: "retention", label: "Data Retention", icon: Database },
  { key: "privacy", label: "Privacy & Compliance", icon: FileText },
];

export default function EnterpriseSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("sso");

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Shield className="h-6 w-6" /> Enterprise Settings
        </h1>
        <p className="text-muted-foreground mt-1">Configure enterprise security, compliance, and data governance settings</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-md transition-colors ${
              activeTab === tab.key
                ? "bg-background border border-b-background -mb-px text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`tab-${tab.key}`}
          >
            <tab.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === "sso" && <FeatureGate feature="SSO"><SSOTab /></FeatureGate>}
      {activeTab === "session" && <FeatureGate feature="SESSION_MANAGEMENT"><SessionSecurityTab /></FeatureGate>}
      {activeTab === "retention" && <FeatureGate feature="DATA_RETENTION"><DataRetentionTab /></FeatureGate>}
      {activeTab === "privacy" && <FeatureGate feature="PRIVACY_COMPLIANCE"><PrivacyComplianceTab /></FeatureGate>}
    </div>
  );
}