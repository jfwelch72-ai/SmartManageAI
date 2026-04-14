import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft,
  Save,
  Eye,
  Share2,
  History,
  Link2,
  Clock,
  RotateCcw,
  ExternalLink,
  ClipboardCopy,
  XCircle,
  AlertTriangle,
  GitCompare,
  CheckCircle2,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  Loader2,
  Bookmark,
  X,
  ChevronRight,
  Activity,
} from "lucide-react";
import type { ConflictInfo, PerfMetrics, BodyComponent } from "./types";
import { PERF_THRESHOLDS } from "./types";

export function SharePreviewDialog({ pageId, open, onOpenChange }: {
  pageId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState(72);

  const { data: previewLinks = [], isLoading: loadingLinks } = useQuery<any[]>({
    queryKey: ["/api/website/pages", pageId, "preview-links"],
    enabled: open,
  });

  const createLinkMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/website/pages/${pageId}/preview-link`, { expiresInHours });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages", pageId, "preview-links"] });
      toast({ title: "Preview link created" });
    },
    onError: (error: any) => {
      toast({ title: "Error creating link", description: error.message, variant: "destructive" });
    },
  });

  const revokeLinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      return await apiRequest("DELETE", `/api/website/preview-links/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/pages", pageId, "preview-links"] });
      toast({ title: "Preview link revoked" });
    },
  });

  const getPreviewUrl = (token: string) => {
    return `${window.location.origin}/shared-preview/${token}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast({ title: "Link copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const formatExpiry = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h remaining`;
    if (hours > 0) return `${hours}h remaining`;
    return "Expiring soon";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            Share Preview
          </DialogTitle>
          <DialogDescription>
            Generate a read-only preview link. Anyone with the link can view this page without logging in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Select value={String(expiresInHours)} onValueChange={(v) => setExpiresInHours(Number(v))}>
              <SelectTrigger className="w-[140px] flex-shrink-0" data-testid="select-preview-expiry">
                <SelectValue placeholder="Expiration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 hours</SelectItem>
                <SelectItem value="72">3 days</SelectItem>
                <SelectItem value="168">7 days</SelectItem>
                <SelectItem value="720">30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => createLinkMutation.mutate()}
              disabled={createLinkMutation.isPending}
              className="flex-shrink-0"
              data-testid="button-generate-preview-link"
            >
              {createLinkMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4 mr-1" />
              )}
              Generate Link
            </Button>
          </div>

          {loadingLinks ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
            </div>
          ) : previewLinks.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Active Preview Links</Label>
              {previewLinks.map((link: any) => (
                <div key={link.id} className="p-2 border rounded-md space-y-1.5">
                  <div className="flex items-center gap-2">
                    <p className="flex-1 min-w-0 text-xs font-mono truncate">{getPreviewUrl(link.token)}</p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(getPreviewUrl(link.token))}
                        data-testid={`button-copy-preview-${link.id}`}
                      >
                        <ClipboardCopy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.open(getPreviewUrl(link.token), "_blank")}
                        data-testid={`button-open-preview-${link.id}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => revokeLinkMutation.mutate(link.id)}
                        disabled={revokeLinkMutation.isPending}
                        data-testid={`button-revoke-preview-${link.id}`}
                      >
                        <XCircle className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatExpiry(link.expiresAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No active preview links. Generate one to share this page.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VersionHistoryDialog({ pageId, open, onOpenChange, onRevert, isReverting, previewingVersionId, onPreviewVersion, onCompareVersions }: {
  pageId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRevert: (versionId: string) => void;
  isReverting: boolean;
  previewingVersionId: string | null;
  onPreviewVersion: (id: string | null) => void;
  onCompareVersions: (a: string, b: string) => void;
}) {
  const { toast } = useToast();
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelections, setCompareSelections] = useState<string[]>([]);

  const { data: versions = [], isLoading: loadingVersions } = useQuery<any[]>({
    queryKey: ["/api/website/pages", pageId, "versions"],
    enabled: open,
  });

  const { data: previewVersion } = useQuery<any>({
    queryKey: ["/api/website/versions", previewingVersionId],
    enabled: !!previewingVersionId,
  });

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  const getTriggerBadge = (trigger: string) => {
    switch (trigger) {
      case "publish": return <Badge variant="default" className="text-[10px]">Published</Badge>;
      case "revert": return <Badge variant="secondary" className="text-[10px]">Reverted</Badge>;
      case "save": return <Badge variant="outline" className="text-[10px]">Saved</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">{trigger}</Badge>;
    }
  };

  const getComponentCount = (contentJson: string | null) => {
    try {
      if (!contentJson) return 0;
      const parsed = JSON.parse(contentJson);
      return parsed.components?.length || 0;
    } catch {
      return 0;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { onPreviewVersion(null); setConfirmRevertId(null); } }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Version History
          </DialogTitle>
          <DialogDescription>
            View past versions of this page. You can preview, revert, or compare versions.
          </DialogDescription>
        </DialogHeader>

        {!previewingVersionId && versions.length >= 2 && (
          <div className="flex items-center justify-between gap-2 pb-2 border-b">
            <Button
              variant={compareMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setCompareMode(!compareMode);
                setCompareSelections([]);
              }}
              data-testid="button-toggle-compare"
            >
              <GitCompare className="h-3.5 w-3.5 mr-1" />
              {compareMode ? "Cancel Compare" : "Compare Versions"}
            </Button>
            {compareMode && compareSelections.length === 2 && (
              <Button
                size="sm"
                onClick={() => {
                  onCompareVersions(compareSelections[0], compareSelections[1]);
                  setCompareMode(false);
                  setCompareSelections([]);
                }}
                data-testid="button-run-compare"
              >
                View Diff
              </Button>
            )}
            {compareMode && (
              <span className="text-xs text-muted-foreground">
                {compareSelections.length}/2 selected
              </span>
            )}
          </div>
        )}

        {previewingVersionId && previewVersion ? (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between gap-2 pb-2 border-b mb-2">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => onPreviewVersion(null)} data-testid="button-back-versions">
                  <ArrowLeft className="h-3 w-3 mr-1" />
                  Back
                </Button>
                <span className="text-sm font-medium">Version {previewVersion.versionNumber}</span>
                {getTriggerBadge(previewVersion.trigger)}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmRevertId(previewVersion.id)}
                data-testid="button-revert-preview"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Revert
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-2 p-1">
                <div className="text-xs space-y-1">
                  <p><span className="text-muted-foreground">Saved by:</span> {previewVersion.editorName}</p>
                  <p><span className="text-muted-foreground">Date:</span> {formatDate(previewVersion.createdAt)}</p>
                  <p><span className="text-muted-foreground">Summary:</span> {previewVersion.changeSummary || "No summary"}</p>
                  <p><span className="text-muted-foreground">Components:</span> {getComponentCount(previewVersion.contentJson)}</p>
                </div>
                {previewVersion.pageSettingsJson && (
                  <div className="border rounded-md p-2 mt-2">
                    <p className="text-xs font-medium mb-1">Page Settings at this version:</p>
                    {(() => {
                      try {
                        const s = JSON.parse(previewVersion.pageSettingsJson);
                        return (
                          <div className="text-xs space-y-0.5 text-muted-foreground">
                            <p>Title: {s.pageTitle}</p>
                            <p>Slug: /{s.pageSlug}</p>
                            <p>Status: {s.isPublished ? "Published" : "Draft"}</p>
                          </div>
                        );
                      } catch { return null; }
                    })()}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <ScrollArea className="flex-1 max-h-[50vh]">
            {loadingVersions ? (
              <div className="space-y-2 p-1">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : versions.length > 0 ? (
              <div className="space-y-1 p-1">
                {versions.map((v: any) => {
                  const isSelected = compareSelections.includes(v.id);
                  return (
                    <div
                      key={v.id}
                      className={`flex items-center justify-between gap-2 p-2 border rounded-md hover-elevate cursor-pointer ${
                        compareMode && isSelected ? "border-primary bg-primary/5" : ""
                      }`}
                      onClick={() => {
                        if (compareMode) {
                          setCompareSelections(prev => {
                            if (prev.includes(v.id)) return prev.filter(id => id !== v.id);
                            if (prev.length >= 2) return [prev[1], v.id];
                            return [...prev, v.id];
                          });
                        } else {
                          onPreviewVersion(v.id);
                        }
                      }}
                      data-testid={`version-item-${v.id}`}
                    >
                      {compareMode && (
                        <div className={`w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0 ${isSelected ? "bg-primary border-primary" : ""}`}>
                          {isSelected && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">v{v.versionNumber}</span>
                          {getTriggerBadge(v.trigger)}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{v.changeSummary || "No summary"}</p>
                        <p className="text-[10px] text-muted-foreground">{v.editorName} - {formatDate(v.createdAt)}</p>
                      </div>
                      {!compareMode && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); onPreviewVersion(v.id); }}
                            data-testid={`button-preview-version-${v.id}`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); setConfirmRevertId(v.id); }}
                            data-testid={`button-revert-version-${v.id}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <History className="h-10 w-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No version history yet</p>
                <p className="text-xs text-muted-foreground">Versions are created automatically when you save or publish.</p>
              </div>
            )}
          </ScrollArea>
        )}

        {confirmRevertId && (
          <div className="border-t pt-3">
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
              <p className="text-sm font-medium mb-2">Revert to this version?</p>
              <p className="text-xs text-muted-foreground mb-3">
                This will replace the current page content with the selected version. A snapshot of the current state will be saved before reverting.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRevertId(null)}
                  data-testid="button-cancel-revert"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => { onRevert(confirmRevertId); setConfirmRevertId(null); }}
                  disabled={isReverting}
                  data-testid="button-confirm-revert"
                >
                  {isReverting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                  Revert
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ConflictDialog({
  open,
  onOpenChange,
  conflictInfo,
  onReload,
  onOverwrite,
  onSaveAsVersion,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conflictInfo: ConflictInfo | null;
  onReload: () => void;
  onOverwrite: () => void;
  onSaveAsVersion: () => void;
  isSaving: boolean;
}) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Unknown";
    const d = new Date(dateStr);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) +
      " on " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Save Conflict Detected
          </DialogTitle>
          <DialogDescription>
            This page has been modified by another user since you started editing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {conflictInfo && (
            <div className="bg-muted/50 border rounded-md p-3 text-xs space-y-1">
              {conflictInfo.lastEditor && (
                <p><span className="text-muted-foreground">Last saved by:</span> {conflictInfo.lastEditor}</p>
              )}
              {conflictInfo.lastSaved && (
                <p><span className="text-muted-foreground">Saved at:</span> {formatDate(conflictInfo.lastSaved)}</p>
              )}
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Choose how to proceed:
          </p>

          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={onReload}
              data-testid="button-conflict-reload"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              <div className="text-left">
                <div className="text-sm font-medium">Reload latest version</div>
                <div className="text-[10px] text-muted-foreground">Discard your changes and load the latest saved version</div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={onOverwrite}
              disabled={isSaving}
              data-testid="button-conflict-overwrite"
            >
              <Save className="h-4 w-4 mr-2" />
              <div className="text-left">
                <div className="text-sm font-medium">Overwrite with my changes</div>
                <div className="text-[10px] text-muted-foreground">Replace the server version with your current edits</div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={onSaveAsVersion}
              data-testid="button-conflict-save-version"
            >
              <History className="h-4 w-4 mr-2" />
              <div className="text-left">
                <div className="text-sm font-medium">Save as a new version</div>
                <div className="text-[10px] text-muted-foreground">Keep both versions - your changes are saved separately</div>
              </div>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VersionDiffDialog({
  open,
  onOpenChange,
  versionIdA,
  versionIdB,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  versionIdA: string | null;
  versionIdB: string | null;
}) {
  const { data: diffData, isLoading } = useQuery<any>({
    queryKey: ["/api/website/versions/diff", versionIdA, versionIdB],
    enabled: open && !!versionIdA && !!versionIdB,
  });

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  const statusColors: Record<string, string> = {
    added: "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400",
    modified: "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400",
    removed: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400",
    unchanged: "bg-muted/30 border-muted-foreground/10",
  };

  const statusIcons: Record<string, typeof PlusCircle> = {
    added: PlusCircle,
    modified: AlertTriangle,
    removed: MinusCircle,
    unchanged: CheckCircle2,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            Version Comparison
          </DialogTitle>
          {diffData && (
            <DialogDescription>
              Comparing v{diffData.versionA.versionNumber} ({diffData.versionA.editorName}) with v{diffData.versionB.versionNumber} ({diffData.versionB.editorName})
            </DialogDescription>
          )}
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : diffData ? (
          <ScrollArea className="flex-1 max-h-[60vh]">
            <div className="space-y-4 p-1">
              <div className="flex items-center gap-3 flex-wrap text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-green-500/20 border border-green-500/40" />
                  <span>Added ({diffData.summary.added})</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-yellow-500/20 border border-yellow-500/40" />
                  <span>Modified ({diffData.summary.modified})</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-red-500/20 border border-red-500/40" />
                  <span>Removed ({diffData.summary.removed})</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-muted border" />
                  <span>Unchanged ({diffData.summary.unchanged})</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Components</h4>
                {diffData.componentDiff.map((item: any) => {
                  const StatusIcon = statusIcons[item.status] || CheckCircle2;
                  return (
                    <div
                      key={item.id}
                      className={`p-2.5 border rounded-md ${statusColors[item.status] || ""}`}
                      data-testid={`diff-item-${item.id}`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <StatusIcon className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="text-sm font-medium">{item.label || item.type}</span>
                          <Badge variant="outline" className="text-[9px]">{item.type}</Badge>
                        </div>
                        <Badge variant="secondary" className="text-[9px] capitalize">{item.status}</Badge>
                      </div>
                      {item.status === "modified" && item.changes && (
                        <div className="mt-1.5 flex gap-1 flex-wrap">
                          {item.changes.map((c: string) => (
                            <Badge key={c} variant="outline" className="text-[9px]">{c}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {diffData.settingsChanges.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Page Settings</h4>
                  {diffData.settingsChanges.map((change: any) => (
                    <div key={change.field} className="p-2.5 border rounded-md bg-yellow-500/10 border-yellow-500/30">
                      <p className="text-xs font-medium capitalize">{change.field.replace(/([A-Z])/g, " $1").trim()}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs">
                        <span className="text-red-600 dark:text-red-400 line-through">{String(change.oldValue ?? "empty")}</span>
                        <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="text-green-600 dark:text-green-400">{String(change.newValue ?? "empty")}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {diffData.componentDiff.length === 0 && diffData.settingsChanges.length === 0 && (
                <div className="text-center py-6">
                  <CheckCircle2 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">These versions are identical</p>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function SaveGlobalDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  onSave,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as Reusable Component</DialogTitle>
          <DialogDescription>
            Give this component a name so you can reuse it across any page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Component Name</Label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. Hero with Video Background"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  onSave();
                }
              }}
              data-testid="input-global-name"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-save-global">
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={!name.trim() || isPending}
            data-testid="button-confirm-save-global"
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Bookmark className="h-4 w-4 mr-1" />}
            Save Component
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PerfMonitorPanel({
  show,
  perfMetrics,
  componentCount,
  onClose,
}: {
  show: boolean;
  perfMetrics: PerfMetrics;
  componentCount: number;
  onClose: () => void;
}) {
  if (!show) return null;

  return (
    <div className="absolute bottom-4 right-4 z-50 w-80 bg-background border rounded-md shadow-lg" data-testid="perf-monitor-panel">
      <div className="flex items-center justify-between gap-2 p-2 border-b">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Performance Monitor</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-perf">
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="p-3 space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 border rounded-md">
            <p className="text-muted-foreground mb-0.5">Editor Load</p>
            <p className="font-medium" data-testid="perf-editor-load">
              {perfMetrics.editorLoadTime != null ? `${perfMetrics.editorLoadTime}ms` : "---"}
            </p>
            {perfMetrics.editorLoadTime != null && (
              <PerfStatusBadge value={perfMetrics.editorLoadTime} threshold={PERF_THRESHOLDS.editorLoad} />
            )}
          </div>
          <div className="p-2 border rounded-md">
            <p className="text-muted-foreground mb-0.5">Avg Save</p>
            <p className="font-medium" data-testid="perf-avg-save">
              {perfMetrics.saveLatencies.length > 0
                ? `${Math.round(perfMetrics.saveLatencies.reduce((a, b) => a + b, 0) / perfMetrics.saveLatencies.length)}ms`
                : "---"}
            </p>
            {perfMetrics.saveLatencies.length > 0 && (
              <PerfStatusBadge
                value={Math.round(perfMetrics.saveLatencies.reduce((a, b) => a + b, 0) / perfMetrics.saveLatencies.length)}
                threshold={PERF_THRESHOLDS.save}
              />
            )}
          </div>
          <div className="p-2 border rounded-md">
            <p className="text-muted-foreground mb-0.5">Avg Preview</p>
            <p className="font-medium" data-testid="perf-avg-preview">
              {perfMetrics.previewRenderTimes.length > 0
                ? `${Math.round(perfMetrics.previewRenderTimes.reduce((a, b) => a + b, 0) / perfMetrics.previewRenderTimes.length)}ms`
                : "---"}
            </p>
            {perfMetrics.previewRenderTimes.length > 0 && (
              <PerfStatusBadge
                value={Math.round(perfMetrics.previewRenderTimes.reduce((a, b) => a + b, 0) / perfMetrics.previewRenderTimes.length)}
                threshold={PERF_THRESHOLDS.previewRender}
              />
            )}
          </div>
          <div className="p-2 border rounded-md">
            <p className="text-muted-foreground mb-0.5">Components</p>
            <p className="font-medium">{componentCount}</p>
          </div>
        </div>
        {perfMetrics.lastWarnings.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground">Recent Warnings</p>
            {perfMetrics.lastWarnings.slice(-3).map((w, i) => (
              <div key={i} className="flex items-start gap-1 text-[10px] text-muted-foreground">
                <AlertTriangle className="h-3 w-3 text-yellow-500 flex-shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PerfStatusBadge({ value, threshold }: { value: number; threshold: number }) {
  const ok = value <= threshold;
  return (
    <Badge variant={ok ? "outline" : "destructive"} className="text-[9px] mt-0.5">
      {ok ? "OK" : "Slow"}
    </Badge>
  );
}
