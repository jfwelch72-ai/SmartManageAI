import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Upload,
  Trash2,
  LayoutGrid,
  List,
  HardDrive,
  Image as ImageIcon,
  FileText,
  Copy,
  Check,
  Loader2,
  Settings as SettingsIcon,
  AlertTriangle,
  X,
} from "lucide-react";

interface MediaFile {
  name: string;
  originalName: string;
  url: string;
  size: number;
  contentType: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MediaResponse {
  files: MediaFile[];
  totalSize: number;
  // Task #1955 — `storageLimit` is now always populated with the
  // per-organization quota (in bytes); the legacy `null` (= unlimited)
  // path is gone now that every org is gated.
  storageLimit: number | null;
  storageQuotaBytes?: number;
  storageUsageBytes?: number;
  storageWarningThreshold?: number;
  canEditQuota?: boolean;
}

interface StorageQuotaResponse {
  usageBytes: number;
  quotaBytes: number;
  remainingBytes: number;
  percentUsed: number;
  warningThreshold: number;
  defaultQuotaBytes: number;
  minQuotaBytes: number;
  maxQuotaBytes: number;
  canEditQuota: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatGB(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

const BYTES_PER_GB = 1024 * 1024 * 1024;

function StorageQuotaEditor({ quota }: { quota: StorageQuotaResponse }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [valueGB, setValueGB] = useState(() =>
    Math.max(1, Math.round(quota.quotaBytes / BYTES_PER_GB)).toString(),
  );

  const minGB = Math.max(1, Math.ceil(quota.minQuotaBytes / BYTES_PER_GB));
  const maxGB = Math.max(minGB, Math.floor(quota.maxQuotaBytes / BYTES_PER_GB));
  const usageGB = quota.usageBytes / BYTES_PER_GB;

  const updateMutation = useMutation({
    mutationFn: async (gb: number) => {
      const res = await apiRequest("PATCH", "/api/website/storage-quota", {
        quotaBytes: Math.round(gb * BYTES_PER_GB),
      });
      return (await res.json()) as StorageQuotaResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/media"] });
      queryClient.invalidateQueries({ queryKey: ["/api/website/storage-quota"] });
      toast({ title: "Storage quota updated" });
      setOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message || "Could not update quota", variant: "destructive" });
    },
  });

  const numericValue = Number(valueGB);
  const isInvalid = !Number.isFinite(numericValue) || numericValue < minGB || numericValue > maxGB;
  const wouldBeBelowUsage = Number.isFinite(numericValue) && numericValue < usageGB;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => { setValueGB(Math.max(1, Math.round(quota.quotaBytes / BYTES_PER_GB)).toString()); setOpen(true); }}
        data-testid="button-edit-storage-quota"
      >
        <SettingsIcon className="h-4 w-4 mr-1" />
        Edit Quota
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
        <DialogHeader>
          <DialogTitle>Organization Storage Quota</DialogTitle>
          <DialogDescription>
            Set the maximum storage your organization can use across the website builder media library and social media uploads. Currently using {formatGB(quota.usageBytes)} GB of {formatGB(quota.quotaBytes)} GB.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={minGB}
              max={maxGB}
              step={1}
              value={valueGB}
              onChange={(e) => setValueGB(e.target.value)}
              data-testid="input-storage-quota-gb"
            />
            <span className="text-sm text-muted-foreground">GB</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Allowed range: {minGB} – {maxGB} GB. Default is {Math.round(quota.defaultQuotaBytes / BYTES_PER_GB)} GB.
          </p>
          {wouldBeBelowUsage && !isInvalid && (
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400" data-testid="text-storage-quota-below-usage">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                The new quota is below current usage. Existing files will not be deleted, but no new uploads will be accepted until usage drops below the new limit.
              </span>
            </div>
          )}
        </div>
        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-quota-edit">Cancel</Button>
          <Button
            onClick={() => updateMutation.mutate(numericValue)}
            disabled={isInvalid || updateMutation.isPending}
            data-testid="button-save-storage-quota"
          >
            {updateMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Save Quota
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MediaLibraryTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MediaFile | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<MediaResponse>({
    queryKey: ["/api/website/media"],
  });

  const { data: quota } = useQuery<StorageQuotaResponse>({
    queryKey: ["/api/website/storage-quota"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileName: string) => {
      await apiRequest("DELETE", `/api/website/media/${fileName}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/media"] });
      queryClient.invalidateQueries({ queryKey: ["/api/website/storage-quota"] });
      toast({ title: "File deleted" });
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const handleUpload = useCallback(async (files: FileList) => {
    if (!data) return;

    setUploading(true);
    let successCount = 0;
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast({ title: "Skipped " + file.name, description: "Only image files are supported.", variant: "destructive" });
          continue;
        }
        if (file.size > 100 * 1024 * 1024) {
          toast({ title: "Skipped " + file.name, description: "Maximum file size is 100MB per file.", variant: "destructive" });
          continue;
        }
        const formData = new FormData();
        formData.append("image", file);
        const res = await fetch("/api/website/upload-image", { method: "POST", body: formData, credentials: "include" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Upload failed" }));
          // Task #1955: surface a friendlier message when the server rejects
          // the upload because the org has hit its storage quota.
          if (res.status === 413 && err?.code === "STORAGE_QUOTA_EXCEEDED") {
            const usedGB = formatGB(err.currentUsageBytes ?? 0);
            const quotaGB = formatGB(err.quotaBytes ?? 0);
            toast({
              title: "Storage limit reached",
              description: `Your organization is using ${usedGB} GB of its ${quotaGB} GB quota. Delete unused files or ask an admin to raise the limit.`,
              variant: "destructive",
            });
            break;
          }
          toast({ title: "Failed: " + file.name, description: err.error, variant: "destructive" });
          continue;
        }
        successCount++;
      }
      if (successCount > 0) {
        toast({ title: `${successCount} file${successCount > 1 ? "s" : ""} uploaded` });
        queryClient.invalidateQueries({ queryKey: ["/api/website/media"] });
        queryClient.invalidateQueries({ queryKey: ["/api/website/storage-quota"] });
      }
    } finally {
      setUploading(false);
    }
  }, [data, toast]);

  const handleCopyUrl = useCallback((url: string) => {
    const fullUrl = window.location.origin + url;
    navigator.clipboard.writeText(fullUrl);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
    toast({ title: "URL copied to clipboard" });
  }, [toast]);

  const files = data?.files || [];
  const totalSize = data?.totalSize || 0;
  const quotaBytes = data?.storageQuotaBytes ?? quota?.quotaBytes ?? null;
  const warningThreshold = data?.storageWarningThreshold ?? quota?.warningThreshold ?? 0.8;
  const percentUsed = quotaBytes && quotaBytes > 0 ? Math.min(1, totalSize / quotaBytes) : 0;
  const isAtLimit = quotaBytes != null && totalSize >= quotaBytes;
  const isWarning = !isAtLimit && quotaBytes != null && percentUsed >= warningThreshold;
  const canEditQuota = quota?.canEditQuota ?? data?.canEditQuota ?? false;
  const progressColorClass = isAtLimit
    ? "[&>div]:bg-destructive"
    : isWarning
      ? "[&>div]:bg-amber-500"
      : "";

  const filteredFiles = searchQuery
    ? files.filter((f) => {
        const q = searchQuery.toLowerCase();
        return f.originalName.toLowerCase().includes(q) || f.name.toLowerCase().includes(q);
      })
    : files;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px] space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            {quotaBytes != null ? (
              <span data-testid="text-storage-usage">
                {formatGB(totalSize)} GB of {formatGB(quotaBytes)} GB used
                {" "}({Math.round(percentUsed * 100)}%)
              </span>
            ) : (
              <span data-testid="text-storage-usage">{formatGB(totalSize)} GB used</span>
            )}
          </div>
          {quotaBytes != null && (
            <Progress
              value={percentUsed * 100}
              className={`h-2 ${progressColorClass}`}
              data-testid="progress-storage-usage"
            />
          )}
          {isAtLimit && (
            <div
              className="flex items-start gap-2 text-xs text-destructive mt-1"
              data-testid="banner-storage-blocked"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                You've reached your organization's {formatGB(quotaBytes)} GB storage limit. Delete unused files or ask an admin to raise the quota to upload more.
              </span>
            </div>
          )}
          {isWarning && (
            <div
              className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 mt-1"
              data-testid="banner-storage-warning"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                Heads up — you're using {Math.round(percentUsed * 100)}% of your {formatGB(quotaBytes)} GB storage quota. Consider cleaning up unused files before you hit the limit.
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canEditQuota && quota && <StorageQuotaEditor quota={quota} />}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) { handleUpload(e.target.files); e.target.value = ""; } }}
            data-testid="input-media-upload-file"
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || isAtLimit}
            data-testid="button-upload-media"
          >
            {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            Upload Media
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by filename..."
            className="pl-8"
            data-testid="input-media-search"
          />
        </div>
        <Button
          variant={viewMode === "grid" ? "default" : "outline"}
          size="icon"
          onClick={() => setViewMode("grid")}
          data-testid="button-view-grid"
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        <Button
          variant={viewMode === "list" ? "default" : "outline"}
          size="icon"
          onClick={() => setViewMode("list")}
          data-testid="button-view-list"
        >
          <List className="h-4 w-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md" />
          ))}
        </div>
      ) : filteredFiles.length === 0 ? (
        <Card className="py-12">
          <CardContent className="text-center">
            <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {searchQuery ? "No files match your search" : "No media files yet"}
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery ? "Try a different search term" : "Upload images to use across your website"}
            </p>
            {!searchQuery && (
              <Button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="button-upload-first-media">
                <Upload className="h-4 w-4 mr-1" />
                Upload Media
              </Button>
            )}
          </CardContent>
        </Card>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filteredFiles.map((file) => (
            <Card key={file.name} className="group relative overflow-visible" data-testid={`card-media-${file.name}`}>
              <div className="aspect-square bg-muted rounded-t-md overflow-hidden">
                <img
                  src={file.url}
                  alt={file.originalName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                    (e.target as HTMLImageElement).parentElement!.classList.add("flex", "items-center", "justify-center");
                    const placeholder = document.createElement("div");
                    placeholder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
                    (e.target as HTMLImageElement).parentElement!.appendChild(placeholder);
                  }}
                />
              </div>
              <CardContent className="p-2">
                <p className="text-xs truncate" title={file.originalName} data-testid={`text-filename-${file.name}`}>
                  {file.originalName}
                </p>
                <div className="flex items-center gap-1">
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                  {file.source === "social-media" && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4" data-testid={`badge-source-${file.name}`}>Social</Badge>
                  )}
                </div>
              </CardContent>
              <div className="absolute top-1 right-1 flex gap-1 invisible group-hover:visible">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 bg-background/80 backdrop-blur-sm"
                  onClick={() => handleCopyUrl(file.url)}
                  data-testid={`button-copy-url-${file.name}`}
                >
                  {copiedUrl === file.url ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 bg-background/80 backdrop-blur-sm"
                  onClick={() => setDeleteTarget(file)}
                  data-testid={`button-delete-media-${file.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {filteredFiles.map((file) => (
            <div
              key={file.name}
              className="flex items-center gap-3 p-2 rounded-md hover-elevate group"
              data-testid={`row-media-${file.name}`}
            >
              <div className="h-10 w-10 rounded-md bg-muted overflow-hidden flex-shrink-0">
                <img
                  src={file.url}
                  alt={file.originalName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" data-testid={`text-list-filename-${file.name}`}>{file.originalName}</p>
                <div className="flex items-center gap-1">
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                  {file.source === "social-media" && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4" data-testid={`badge-list-source-${file.name}`}>Social</Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-1 invisible group-hover:visible">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleCopyUrl(file.url)}
                  data-testid={`button-list-copy-${file.name}`}
                >
                  {copiedUrl === file.url ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleteTarget(file)}
                  data-testid={`button-list-delete-${file.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.originalName}"? This cannot be undone. Any pages using this image will show a broken image.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} data-testid="button-cancel-delete">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.name); }}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function MediaLibraryPicker({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = useQuery<MediaResponse>({
    queryKey: ["/api/website/media"],
  });

  const files = data?.files || [];
  const filteredFiles = searchQuery
    ? files.filter((f) => {
        const q = searchQuery.toLowerCase();
        return f.originalName.toLowerCase().includes(q) || f.name.toLowerCase().includes(q);
      })
    : files;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search media..."
          className="pl-8"
          data-testid="input-media-picker-search"
        />
      </div>
      {isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md" />
          ))}
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <ImageIcon className="h-8 w-8 mx-auto mb-2" />
          <p className="text-sm">{searchQuery ? "No matching files" : "No media files. Upload some first."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto">
          {filteredFiles.map((file) => (
            <button
              key={file.name}
              className="aspect-square rounded-md bg-muted overflow-hidden hover-elevate cursor-pointer border-2 border-transparent hover:border-primary focus:border-primary outline-none"
              onClick={() => { onSelect(file.url); onClose(); }}
              data-testid={`button-pick-media-${file.name}`}
            >
              <img
                src={file.url}
                alt={file.originalName}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
