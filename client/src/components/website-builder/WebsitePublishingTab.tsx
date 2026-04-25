import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Globe,
  Settings,
  Eye,
  ExternalLink,
  Copy,
  Save,
  Loader2,
  Rocket,
  Shield,
  Link2,
  CheckCircle,
  Power,
  History,
  CircleDot,
  CloudOff,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import type { Website, DeploymentRecord } from "./types";

interface WebsitePublishingTabProps {
  website: Website | null;
  onPublish: () => void;
  publishPending: boolean;
}

export default function WebsitePublishingTab({ website, onPublish, publishPending }: WebsitePublishingTabProps) {
  const { toast } = useToast();
  const [customDomain, setCustomDomain] = useState(website?.customDomain || "");
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);

  useEffect(() => {
    setCustomDomain(website?.customDomain || "");
  }, [website?.customDomain]);

  const deploymentsQuery = useQuery<DeploymentRecord[]>({
    queryKey: ["/api/website/deployments"],
    enabled: !!website,
  });

  const stagingTokenQuery = useQuery<{ token: string | null; subdomain: string }>({
    queryKey: ["/api/website/staging-token"],
    queryFn: async () => {
      const res = await fetch("/api/website/staging-token", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch staging token");
      return res.json();
    },
    enabled: !!website,
  });

  const generateStagingTokenMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/website/staging-token", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/staging-token"] });
      toast({ title: "Staging link generated", description: "You can now share this link for preview." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to generate staging link", description: error.message, variant: "destructive" });
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/website/unpublish", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website"] });
      queryClient.invalidateQueries({ queryKey: ["/api/website/deployments"] });
      toast({ title: "Website unpublished", description: "Your website is now offline." });
      setShowUnpublishConfirm(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to unpublish", description: error.message, variant: "destructive" });
    },
  });

  const maintenanceMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/website/maintenance", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website"] });
      queryClient.invalidateQueries({ queryKey: ["/api/website/deployments"] });
      toast({ title: "Maintenance mode updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Task #1949 — abortable, fail-fast republish. Previously this
  // mutation called `apiRequest` with no timeout, so when the
  // production server was slow to respond the spinner would just
  // hang forever and the user got no feedback at all (no success
  // toast, no error toast). We now race the request against a
  // 30-second client-side timeout and surface a destructive toast
  // pointing the user at the deployment history if it fires.
  const REPUBLISH_CLIENT_TIMEOUT_MS = 30000;
  const republishMutation = useMutation({
    mutationFn: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REPUBLISH_CLIENT_TIMEOUT_MS);
      try {
        const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (csrfToken) headers["x-csrf-token"] = decodeURIComponent(csrfToken[1]);
        const res = await fetch("/api/website/republish", {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({}),
          signal: controller.signal,
        });
        if (!res.ok) {
          let message = `${res.status}: ${res.statusText}`;
          try {
            const body = await res.json();
            if (body?.error) message = body.error;
          } catch {
            // fall through with default message
          }
          throw new Error(message);
        }
        return res;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error("Republish timed out after 30 seconds. Please try again — if it keeps failing, check the deployment history below.");
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website"] });
      queryClient.invalidateQueries({ queryKey: ["/api/website/deployments"] });
      toast({ title: "Website republished!", description: "Your latest changes are now live." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to republish", description: error.message, variant: "destructive" });
    },
  });

  const domainMutation = useMutation({
    mutationFn: async (domain: string) => {
      return await apiRequest("POST", "/api/website/domain", { customDomain: domain });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website"] });
      queryClient.invalidateQueries({ queryKey: ["/api/website/deployments"] });
      toast({ title: "Domain updated", description: "Custom domain has been saved. Verify DNS to activate." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update domain", description: error.message, variant: "destructive" });
    },
  });

  const verifyDomainMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/website/domain/verify", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website"] });
      queryClient.invalidateQueries({ queryKey: ["/api/website/deployments"] });
      toast({ title: "Domain verified!", description: "Your custom domain is now active." });
    },
    onError: (error: Error) => {
      toast({ title: "Verification failed", description: error.message, variant: "destructive" });
    },
  });

  const siteUrl = website?.subdomain ? `https://${website.subdomain}.smartmanageai-sites.com` : null;
  const customUrl = website?.customDomain && website?.domainVerified ? `https://${website.customDomain}` : null;
  const isPublished = website?.status === "PUBLISHED";
  const isMaintenance = website?.status === "MAINTENANCE";
  const isDraft = website?.status === "DRAFT";

  const hasTitle = !!website?.siteTitle;
  const hasSubdomain = !!website?.subdomain;
  const hasLogo = !!website?.logoUrl;
  const hasPrimaryColor = !!website?.primaryColor;
  const hasContactEmail = !!website?.contactEmail;
  const checklistItems = [
    { label: "Site title configured", done: hasTitle },
    { label: "Subdomain set", done: hasSubdomain },
    { label: "Logo uploaded", done: hasLogo },
    { label: "Brand colors set", done: hasPrimaryColor },
    { label: "Contact email added", done: hasContactEmail },
  ];
  const checklistComplete = checklistItems.filter(i => i.done).length;

  const getActionIcon = (action: string) => {
    switch (action) {
      case "PUBLISHED": return <Rocket className="h-4 w-4 text-green-500" />;
      case "REPUBLISHED": return <RefreshCw className="h-4 w-4 text-blue-500" />;
      case "UNPUBLISHED": return <CloudOff className="h-4 w-4 text-red-500" />;
      case "MAINTENANCE_ON": return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "MAINTENANCE_OFF": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "DOMAIN_UPDATED": return <Link2 className="h-4 w-4 text-purple-500" />;
      case "DOMAIN_VERIFIED": return <Shield className="h-4 w-4 text-green-500" />;
      default: return <CircleDot className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case "PUBLISHED": return "Published";
      case "REPUBLISHED": return "Republished";
      case "UNPUBLISHED": return "Unpublished";
      case "MAINTENANCE_ON": return "Maintenance Mode On";
      case "MAINTENANCE_OFF": return "Maintenance Mode Off";
      case "DOMAIN_UPDATED": return "Domain Updated";
      case "DOMAIN_VERIFIED": return "Domain Verified";
      case "SETTINGS_UPDATED": return "Settings Updated";
      default: return action;
    }
  };

  if (!website) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">Create your website first using the Setup tab before publishing.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2" data-testid="text-publish-status-title">
              <Rocket className="h-5 w-5" />
              Deployment Status
            </CardTitle>
            <CardDescription>Manage your website's live deployment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-3">
                <div className={`h-3 w-3 rounded-full ${isPublished ? "bg-green-500 animate-pulse" : isMaintenance ? "bg-yellow-500 animate-pulse" : "bg-gray-400"}`} />
                <div>
                  <p className="font-medium" data-testid="text-deployment-status">
                    {isPublished ? "Live" : isMaintenance ? "Maintenance Mode" : "Offline"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {isPublished ? "Your website is publicly accessible" : isMaintenance ? "Visitors see a maintenance page" : "Your website is not published yet"}
                  </p>
                </div>
              </div>
              <Badge variant={isPublished ? "default" : isMaintenance ? "secondary" : "outline"} className="text-sm" data-testid="badge-deploy-status">
                {website.status}
              </Badge>
            </div>

            {siteUrl && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Live URL</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 p-2.5 rounded-md border bg-background font-mono text-sm">
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate" data-testid="text-live-url">{siteUrl}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { navigator.clipboard.writeText(siteUrl); toast({ title: "URL copied!" }); }}
                    data-testid="button-copy-url"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  {isPublished && (
                    <Button variant="outline" size="sm" asChild data-testid="button-visit-site">
                      <a href={`/site/${website.subdomain}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                </div>
                {customUrl && (
                  <div className="flex items-center gap-2 p-2.5 rounded-md border bg-background font-mono text-sm">
                    <Shield className="h-4 w-4 text-green-500 shrink-0" />
                    <span className="truncate" data-testid="text-custom-url">{customUrl}</span>
                    <Badge variant="outline" className="ml-auto text-xs text-green-600">Verified</Badge>
                  </div>
                )}
              </div>
            )}

            {website.lastPublishedAt && (
              <p className="text-sm text-muted-foreground" data-testid="text-last-published">
                Last published: {format(new Date(website.lastPublishedAt), "MMM d, yyyy 'at' h:mm a")}
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              {isDraft && (
                <Button onClick={onPublish} disabled={publishPending} data-testid="button-publish-tab">
                  {publishPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
                  Publish Website
                </Button>
              )}
              {isPublished && (
                <>
                  <Button onClick={() => republishMutation.mutate()} disabled={republishMutation.isPending} data-testid="button-republish">
                    {republishMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Republish Changes
                  </Button>
                  <Button variant="outline" onClick={() => maintenanceMutation.mutate()} disabled={maintenanceMutation.isPending} data-testid="button-maintenance-on">
                    {maintenanceMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <AlertCircle className="h-4 w-4 mr-2" />}
                    Enable Maintenance
                  </Button>
                  <Button variant="destructive" onClick={() => setShowUnpublishConfirm(true)} data-testid="button-unpublish">
                    <CloudOff className="h-4 w-4 mr-2" />
                    Unpublish
                  </Button>
                </>
              )}
              {isMaintenance && (
                <>
                  <Button onClick={() => maintenanceMutation.mutate()} disabled={maintenanceMutation.isPending} data-testid="button-maintenance-off">
                    {maintenanceMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Power className="h-4 w-4 mr-2" />}
                    Disable Maintenance
                  </Button>
                  <Button variant="destructive" onClick={() => setShowUnpublishConfirm(true)} data-testid="button-unpublish-maint">
                    <CloudOff className="h-4 w-4 mr-2" />
                    Unpublish
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              Pre-Publish Checklist
            </CardTitle>
            <CardDescription>{checklistComplete}/{checklistItems.length} items ready</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={(checklistComplete / checklistItems.length) * 100} className="h-2" />
            <div className="space-y-3">
              {checklistItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2" data-testid={`checklist-item-${idx}`}>
                  {item.done ? (
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <CircleDot className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className={`text-sm ${item.done ? "text-foreground" : "text-muted-foreground"}`}>{item.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {hasSubdomain && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2" data-testid="text-staging-title">
              <Eye className="h-5 w-5" />
              Staging Preview
            </CardTitle>
            <CardDescription>Share a private preview link to review your website before publishing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stagingTokenQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading staging link...
              </div>
            ) : stagingTokenQuery.isError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Failed to load staging link. Please try refreshing the page.</span>
              </div>
            ) : stagingTokenQuery.data?.token ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 p-2.5 rounded-md border bg-background font-mono text-sm">
                    <Eye className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="truncate" data-testid="text-staging-url">
                      {`${window.location.origin}/site/${stagingTokenQuery.data.subdomain}/staging?token=${stagingTokenQuery.data.token}`}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const url = `${window.location.origin}/site/${stagingTokenQuery.data!.subdomain}/staging?token=${stagingTokenQuery.data!.token}`;
                      navigator.clipboard.writeText(url);
                      toast({ title: "Staging URL copied!" });
                    }}
                    data-testid="button-copy-staging-url"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" asChild data-testid="button-visit-staging">
                    <a
                      href={`/site/${stagingTokenQuery.data.subdomain}/staging?token=${stagingTokenQuery.data.token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generateStagingTokenMutation.mutate()}
                    disabled={generateStagingTokenMutation.isPending}
                    data-testid="button-regenerate-staging"
                  >
                    {generateStagingTokenMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Regenerate Link
                  </Button>
                  <p className="text-xs text-muted-foreground">Regenerating invalidates the previous link</p>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Generate a private staging link to preview your website. Anyone with the link can view it, even if the site isn't published yet.
                </p>
                <Button
                  onClick={() => generateStagingTokenMutation.mutate()}
                  disabled={generateStagingTokenMutation.isPending}
                  data-testid="button-generate-staging"
                >
                  {generateStagingTokenMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
                  Generate Staging Link
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Custom Domain
            </CardTitle>
            <CardDescription>Connect your own domain name to your website</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="custom-domain">Domain Name</Label>
              <div className="flex gap-2">
                <Input
                  id="custom-domain"
                  placeholder="www.yourcompany.com"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  data-testid="input-custom-domain"
                />
                <Button
                  onClick={() => domainMutation.mutate(customDomain)}
                  disabled={domainMutation.isPending || !customDomain.trim()}
                  data-testid="button-save-domain"
                >
                  {domainMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {website.customDomain && (
              <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{website.customDomain}</span>
                  <Badge variant={website.domainVerified ? "default" : "secondary"} data-testid="badge-domain-status">
                    {website.domainVerified ? "Verified" : "Pending"}
                  </Badge>
                </div>

                {!website.domainVerified && (
                  <>
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p className="font-medium">DNS Configuration Required:</p>
                      <div className="bg-background rounded p-2 font-mono text-xs space-y-1">
                        <div className="flex gap-4">
                          <span className="text-muted-foreground w-12">Type</span>
                          <span className="text-muted-foreground w-24">Name</span>
                          <span className="text-muted-foreground">Value</span>
                        </div>
                        <div className="flex gap-4">
                          <span className="w-12">CNAME</span>
                          <span className="w-24">www</span>
                          <span>{website.subdomain}.smartmanageai-sites.com</span>
                        </div>
                        <div className="flex gap-4">
                          <span className="w-12">A</span>
                          <span className="w-24">@</span>
                          <span>76.76.21.21</span>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => verifyDomainMutation.mutate()}
                      disabled={verifyDomainMutation.isPending}
                      data-testid="button-verify-domain"
                    >
                      {verifyDomainMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
                      Verify DNS
                    </Button>
                  </>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              <Shield className="h-4 w-4 shrink-0" />
              <span>SSL certificates are automatically provisioned for all domains</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Publishing Settings
            </CardTitle>
            <CardDescription>Configure deployment preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <p className="text-sm font-medium">SSL / HTTPS</p>
                  <p className="text-xs text-muted-foreground">Secure connection for all visitors</p>
                </div>
                <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-200">
                  <Shield className="h-3 w-3 mr-1" />
                  Active
                </Badge>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <p className="text-sm font-medium">Auto-Deploy</p>
                  <p className="text-xs text-muted-foreground">Changes require manual republish</p>
                </div>
                <Badge variant="secondary">Manual</Badge>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <p className="text-sm font-medium">SEO Indexing</p>
                  <p className="text-xs text-muted-foreground">{website.defaultMetaTitle ? "Meta tags configured" : "Configure in Setup tab"}</p>
                </div>
                <Badge variant={website.defaultMetaTitle ? "default" : "secondary"}>
                  {website.defaultMetaTitle ? "Configured" : "Not Set"}
                </Badge>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <p className="text-sm font-medium">Analytics</p>
                  <p className="text-xs text-muted-foreground">{website.googleAnalyticsId ? "Google Analytics connected" : "Not configured"}</p>
                </div>
                <Badge variant={website.googleAnalyticsId ? "default" : "secondary"}>
                  {website.googleAnalyticsId ? "Connected" : "Not Set"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Deployment History
          </CardTitle>
          <CardDescription>Track all publishing actions for your website</CardDescription>
        </CardHeader>
        <CardContent>
          {deploymentsQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : deploymentsQuery.data && deploymentsQuery.data.length > 0 ? (
            <div className="space-y-1">
              {deploymentsQuery.data.map((dep) => (
                <div key={dep.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors" data-testid={`deployment-${dep.id}`}>
                  {getActionIcon(dep.action)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{getActionLabel(dep.action)}</p>
                    {dep.note && <p className="text-xs text-muted-foreground truncate">{dep.note}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{dep.performedByName || "System"}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(dep.createdAt), "MMM d, h:mm a")}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No deployment activity yet</p>
              <p className="text-xs mt-1">Publish your website to see activity here</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showUnpublishConfirm} onOpenChange={setShowUnpublishConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unpublish Website?</DialogTitle>
            <DialogDescription>
              This will take your website offline. Visitors will no longer be able to access it. You can republish at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnpublishConfirm(false)} data-testid="button-cancel-unpublish">Cancel</Button>
            <Button variant="destructive" onClick={() => unpublishMutation.mutate()} disabled={unpublishMutation.isPending} data-testid="button-confirm-unpublish">
              {unpublishMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CloudOff className="h-4 w-4 mr-2" />}
              Unpublish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
