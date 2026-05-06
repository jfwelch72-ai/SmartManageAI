import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useQueries, useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FileText, Loader2, Plus, Tag, Trash2 } from "lucide-react";
import { SendToEstimateDialog } from "@/components/SendToEstimateDialog";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBids, useProjects } from "@/hooks/use-data";

interface StandaloneTakeoff {
  id: string;
  title: string;
  tradeType: string | null;
  clientName: string | null;
  locationAddress: string | null;
  notes: string | null;
  ownerUserId: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TakeoffSheet {
  id: string;
  sheetIndex: number;
  sheetName: string;
  imageUrl: string;
}

interface TakeoffFile {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
  fileSize: number | null;
}

interface TakeoffTag {
  id: string;
  bidId: string | null;
  projectId: string | null;
  createdAt: string;
}

export default function TakeoffStandalonePage() {
  const [, params] = useRoute("/takeoff/standalone/:id");
  const id = params?.id ?? "";
  const { toast } = useToast();
  const [tagOpen, setTagOpen] = useState(false);

  const takeoffQuery = useQuery<StandaloneTakeoff>({
    queryKey: ["/api/takeoff/standalone", id],
    enabled: !!id,
  });

  const sheetsQuery = useQuery<TakeoffSheet[]>({
    queryKey: ["/api/takeoff/standalone", id, "sheets"],
    enabled: !!id,
  });

  const filesQuery = useQuery<TakeoffFile[]>({
    queryKey: ["/api/takeoff/standalone", id, "files"],
    enabled: !!id,
  });

  const tagsQuery = useQuery<TakeoffTag[]>({
    queryKey: ["/api/takeoff/standalone", id, "tags"],
    enabled: !!id,
  });

  const tagMutation = useMutation({
    mutationFn: async (body: { bidId?: string; projectId?: string }) => {
      const res = await apiRequest("POST", `/api/takeoff/standalone/${id}/tags`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/standalone", id, "tags"] });
      toast({ title: "Tagged", description: "Takeoff linked successfully." });
      setTagOpen(false);
    },
    onError: (err: unknown) =>
      toast({
        title: "Tag failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  const removeTagMutation = useMutation({
    mutationFn: async (tagId: string) => {
      await apiRequest("DELETE", `/api/takeoff/standalone/${id}/tags/${tagId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/standalone", id, "tags"] });
    },
  });

  // Used to resolve tag bidId/projectId -> code/name so we can render a real
  // "Open in workspace" link and a friendly label instead of raw IDs.
  // Hooks must run before any conditional return below.
  const { data: allBids = [] } = useBids();
  const { data: allProjects = [] } = useProjects();

  // After an ObjectUploader completes, persist each upload as a "file" row
  // for record-keeping and — when it's a PDF/image — also create a "sheet"
  // entry so the user immediately sees it in the Sheets list.
  const uploadMutation = useMutation({
    mutationFn: async (uploaded: {
      fileName: string;
      fileUrl: string;
      objectKey: string;
      fileSize: number;
      mimeType: string;
    }) => {
      await apiRequest("POST", `/api/takeoff/standalone/${id}/files`, uploaded);
      const isPlanLike =
        uploaded.mimeType === "application/pdf" ||
        uploaded.mimeType.startsWith("image/") ||
        /\.(pdf|png|jpe?g)$/i.test(uploaded.fileName);
      if (isPlanLike) {
        const sheetName = uploaded.fileName.replace(/\.[^/.]+$/, "");
        await apiRequest("POST", `/api/takeoff/standalone/${id}/sheets`, {
          imageUrl: uploaded.fileUrl,
          sheetName,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/standalone", id, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/standalone", id, "sheets"] });
    },
    onError: (err: unknown) =>
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  const handleUploadComplete = (result: {
    successful?: Array<{
      name?: string;
      type?: string;
      size?: number;
      uploadURL?: string;
      data?: File;
      meta?: Record<string, unknown>;
    }>;
  }) => {
    if (!result.successful?.length) {
      toast({ title: "Upload failed", description: "No file uploaded", variant: "destructive" });
      return;
    }
    let successCount = 0;
    result.successful.forEach((up) => {
      const file = up.data as File | undefined;
      const fileName = file?.name ?? up.name ?? "plan.pdf";
      const mimeType = file?.type ?? up.type ?? "application/octet-stream";
      const fileSize = file?.size ?? up.size ?? 0;
      const fileUrl = (up.uploadURL ?? "").split("?")[0];
      const objectKey = (up.meta?.objectKey as string | undefined) ?? fileUrl;
      if (!fileUrl) return;
      uploadMutation.mutate(
        { fileName, fileUrl, objectKey, fileSize, mimeType },
        {
          onSuccess: () => {
            successCount += 1;
            if (successCount === result.successful!.length) {
              toast({
                title: "Upload complete",
                description: `${successCount} file(s) attached to this takeoff.`,
              });
            }
          },
        },
      );
    });
  };

  if (!id) return <div className="p-6">Missing takeoff id.</div>;
  if (takeoffQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="standalone-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!takeoffQuery.data) {
    return <div className="p-6">Takeoff not found.</div>;
  }

  const t = takeoffQuery.data;
  const sheets = sheetsQuery.data ?? [];
  const files = filesQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const isUploading = uploadMutation.isPending;

  return (
    <div className="container max-w-5xl mx-auto p-6 space-y-6" data-testid="standalone-takeoff-page">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/takeoff" data-testid="link-back-to-takeoff">
          <span className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> All takeoffs
          </span>
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-standalone-title">
            {t.title}
          </h1>
          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
            {t.tradeType && <Badge variant="outline">{t.tradeType}</Badge>}
            {t.clientName && <span>{t.clientName}</span>}
            {t.locationAddress && <span>· {t.locationAddress}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SendToEstimateButton standaloneTakeoffId={t.id} sheetIds={sheets.map((s) => s.id)} />
          <Dialog open={tagOpen} onOpenChange={setTagOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-tag-takeoff">
                <Tag className="w-4 h-4 mr-2" /> Tag to bid/project
              </Button>
            </DialogTrigger>
            <TagDialogContent
              onSubmit={(body) => tagMutation.mutate(body)}
              isSubmitting={tagMutation.isPending}
            />
          </Dialog>
        </div>
      </div>

      {tags.length > 0 && (
        <Card data-testid="standalone-tags-card">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Tagged to
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tags.map((tag) => {
              const bid = tag.bidId
                ? (allBids as Array<{ id: string; code?: string | null; name?: string | null }>).find(
                    (b) => b.id === tag.bidId,
                  )
                : null;
              const project = tag.projectId
                ? (allProjects as Array<{ id: string; code?: string | null; name?: string | null }>).find(
                    (p) => p.id === tag.projectId,
                  )
                : null;
              const label = bid
                ? `${bid.code ?? "Bid"} — ${bid.name ?? bid.id}`
                : project
                  ? `${project.code ?? "Project"} — ${project.name ?? project.id}`
                  : tag.bidId
                    ? `Bid ${tag.bidId}`
                    : `Project ${tag.projectId}`;
              const workspaceHref = bid?.code
                ? `/takeoff/${bid.code}`
                : project?.code
                  ? `/takeoff/project/${project.code}`
                  : null;
              return (
                <div
                  key={tag.id}
                  className="flex items-center justify-between gap-2 text-sm"
                  data-testid={`tag-row-${tag.id}`}
                >
                  <span className="truncate">{label}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {workspaceHref && (
                      <Link href={workspaceHref} data-testid={`link-open-workspace-${tag.id}`}>
                        <Button size="sm" variant="outline">
                          <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Open in workspace
                        </Button>
                      </Link>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeTagMutation.mutate(tag.id)}
                      data-testid={`button-untag-${tag.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Sheets ({sheets.length})
          </CardTitle>
          <ObjectUploader
            maxNumberOfFiles={10}
            allowedFileTypes={[".pdf", ".png", ".jpg", ".jpeg"]}
            fileType="DOCUMENT"
            onComplete={handleUploadComplete}
            testId="button-upload-plan"
          >
            <Button
              size="sm"
              variant="outline"
              disabled={isUploading}
              data-testid="button-add-sheet"
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5 mr-1.5" />
              )}
              Upload plan
            </Button>
          </ObjectUploader>
        </CardHeader>
        <CardContent>
          {sheets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sheets yet. Upload a PDF or image plan above. To get the full
              takeoff workspace (drawing tools, measurements, AI takeoff), tag
              this takeoff to a bid or project.
            </p>
          ) : (
            <div className="space-y-1">
              {sheets.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 text-sm"
                  data-testid={`sheet-row-${s.id}`}
                >
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span>{s.sheetName}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Files ({files.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files attached.</p>
          ) : (
            <div className="space-y-1">
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-2 text-sm" data-testid={`file-row-${f.id}`}>
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <a
                    href={f.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {f.fileName}
                  </a>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TagDialogContent({
  onSubmit,
  isSubmitting,
}: {
  onSubmit: (body: { bidId?: string; projectId?: string }) => void;
  isSubmitting: boolean;
}) {
  const { data: bids = [] } = useBids();
  const { data: projects = [] } = useProjects();
  const [destKind, setDestKind] = useState<"bid" | "project">("bid");
  const [destId, setDestId] = useState<string>("");

  return (
    <DialogContent data-testid="dialog-tag-takeoff">
      <DialogHeader>
        <DialogTitle>Tag this takeoff</DialogTitle>
        <DialogDescription>
          Linking attaches the takeoff to a bid or project. It will appear in their
          Suggested takeoffs and can be sent to their estimate.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Destination type</Label>
          <Select value={destKind} onValueChange={(v) => { setDestKind(v === "project" ? "project" : "bid"); setDestId(""); }}>
            <SelectTrigger data-testid="select-dest-kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bid">Bid</SelectItem>
              <SelectItem value="project">Project</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{destKind === "bid" ? "Bid" : "Project"}</Label>
          <Select value={destId} onValueChange={setDestId}>
            <SelectTrigger data-testid="select-dest-id"><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              {(destKind === "bid" ? bids : projects).map((d) => {
                const opt = d as { id: string; name?: string | null; code?: string | null };
                return (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.name || opt.code || opt.id}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit(destKind === "bid" ? { bidId: destId } : { projectId: destId })}
          disabled={!destId || isSubmitting}
          data-testid="button-confirm-tag"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Tag"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * Task #2404 — Send-to-Estimate trigger for the standalone workspace.
 * Loads the takeoff's measurements (across all sheets) and feeds the
 * full set into <SendToEstimateDialog>. Hidden until the takeoff has at
 * least one measurement so the button isn't a noop.
 */
function SendToEstimateButton({
  standaloneTakeoffId,
  sheetIds,
}: {
  standaloneTakeoffId: string;
  sheetIds: string[];
}) {
  // useQueries (not useQuery in a .map) so the hook count is stable
  // when sheets are added/removed — required by React Rules of Hooks.
  const results = useQueries({
    queries: sheetIds.map((sheetId) => ({
      queryKey: ["/api/takeoff/sheets", sheetId, "measurements"],
      queryFn: async (): Promise<{ id: string }[]> => {
        const res = await fetch(`/api/takeoff/sheets/${sheetId}/measurements`, {
          credentials: "include",
        });
        if (!res.ok) return [];
        return (await res.json()) as { id: string }[];
      },
    })),
  });
  const measurementIds = results.flatMap((q) =>
    ((q.data as { id: string }[] | undefined) || []).map((m) => m.id),
  );
  if (measurementIds.length === 0) return null;
  return (
    <SendToEstimateDialog
      sourceTakeoffId={standaloneTakeoffId}
      measurementIds={measurementIds}
      triggerLabel="Send to Estimate"
    />
  );
}
