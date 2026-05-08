import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQueries, useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowDown, ArrowUp, ExternalLink, FileText, Loader2, Plus, Ruler, Tag, Trash2 } from "lucide-react";
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
  // Task #2561 — AIA discipline classification (set by AI/heuristic on
  // import or by the user via the manual picker).
  discipline: string | null;
  sheetNumber: string | null;
  disciplineConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  disciplineSource: "AI_DETECTED" | "FILENAME_HEURISTIC" | "USER" | null;
}

// Task #2561 — AIA discipline labels (matches SHEET_DISCIPLINES on the
// server). Kept here as a small constant so we don't have to import
// from `@shared/schema` (which pulls Drizzle into the client bundle).
const DISCIPLINE_LABELS: Record<string, string> = {
  G: "General",
  A: "Architectural",
  S: "Structural",
  M: "Mechanical",
  E: "Electrical",
  P: "Plumbing",
  C: "Civil",
  L: "Landscape",
  FP: "Fire Protection",
  T: "Telecom",
  Q: "Equipment",
  I: "Interiors",
  O: "Other",
};
const DISCIPLINE_CODES = Object.keys(DISCIPLINE_LABELS);

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
  // Task #2561 — Filter the Sheets list by AIA discipline. "ALL" shows
  // every sheet; "UNCLASSIFIED" surfaces sheets the indexer left blank
  // so users can fix them.
  const [disciplineFilter, setDisciplineFilter] = useState<string>("ALL");

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

  const reorderSheetsMutation = useMutation({
    mutationFn: async (order: { id: string; sheetIndex: number }[]) => {
      const res = await apiRequest(
        "PATCH",
        `/api/takeoff/standalone/${id}/sheets/reorder`,
        { order },
      );
      return res.json();
    },
    onMutate: async (order) => {
      await queryClient.cancelQueries({
        queryKey: ["/api/takeoff/standalone", id, "sheets"],
      });
      const previous = queryClient.getQueryData<TakeoffSheet[]>([
        "/api/takeoff/standalone",
        id,
        "sheets",
      ]);
      if (previous) {
        const indexById = new Map(order.map((o) => [o.id, o.sheetIndex]));
        const next = [...previous]
          .map((s) => ({ ...s, sheetIndex: indexById.get(s.id) ?? s.sheetIndex }))
          .sort((a, b) => a.sheetIndex - b.sheetIndex);
        queryClient.setQueryData(
          ["/api/takeoff/standalone", id, "sheets"],
          next,
        );
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(
          ["/api/takeoff/standalone", id, "sheets"],
          ctx.previous,
        );
      }
      toast({
        title: "Reorder failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/takeoff/standalone", id, "sheets"],
      });
    },
  });

  const moveSheet = (sheetId: string, direction: "up" | "down") => {
    const current = sheetsQuery.data ?? [];
    const idx = current.findIndex((s) => s.id === sheetId);
    if (idx < 0) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= current.length) return;
    const reordered = [...current];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    reorderSheetsMutation.mutate(
      reordered.map((s, i) => ({ id: s.id, sheetIndex: i })),
    );
  };

  // Task #2561 — Manual discipline override for a single sheet. Stamps
  // disciplineSource="USER" on the server so AI re-passes won't clobber it.
  const setDisciplineMutation = useMutation({
    mutationFn: async (vars: { sheetId: string; discipline: string | null }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/takeoff/standalone/${id}/sheets/${vars.sheetId}/discipline`,
        { discipline: vars.discipline },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/standalone", id, "sheets"] });
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not update discipline",
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
  //
  // Task #2552 — For PDFs we now hit the new `/import-plan` endpoint
  // which detects the page count from GCS and inserts one sheet per
  // page in a single round-trip (mirrors the bid/project import-plan
  // flow). The endpoint also writes the companion file row so we no
  // longer have to POST to `/files` first. For non-PDF plan-like
  // uploads (PNG/JPG) we fall back to the legacy single-sheet path.
  const uploadMutation = useMutation({
    mutationFn: async (uploaded: {
      fileName: string;
      fileUrl: string;
      objectKey: string;
      fileSize: number;
      mimeType: string;
    }): Promise<{ pageCount: number }> => {
      const isPdf =
        uploaded.mimeType === "application/pdf" ||
        /\.pdf$/i.test(uploaded.fileName);
      if (isPdf) {
        const res = await apiRequest("POST", `/api/takeoff/standalone/${id}/import-plan`, uploaded);
        const data = (await res.json()) as { sheets?: unknown[]; pageCount?: number };
        return { pageCount: Number(data.pageCount ?? data.sheets?.length ?? 1) };
      }
      await apiRequest("POST", `/api/takeoff/standalone/${id}/files`, uploaded);
      const isImagePlan =
        uploaded.mimeType.startsWith("image/") ||
        /\.(png|jpe?g)$/i.test(uploaded.fileName);
      if (isImagePlan) {
        const sheetName = uploaded.fileName.replace(/\.[^/.]+$/, "");
        await apiRequest("POST", `/api/takeoff/standalone/${id}/sheets`, {
          imageUrl: uploaded.fileUrl,
          sheetName,
        });
        return { pageCount: 1 };
      }
      return { pageCount: 0 };
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
    let totalSheets = 0;
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
          onSuccess: (data) => {
            successCount += 1;
            totalSheets += data?.pageCount ?? 0;
            if (successCount === result.successful!.length) {
              // Task #2552 — Surface the multi-page expansion in the
              // toast so the user knows a 12-page PDF actually became
              // 12 sheets in one click instead of one merged sheet.
              const sheetSuffix =
                totalSheets > successCount
                  ? ` (${totalSheets} sheets)`
                  : "";
              toast({
                title: "Upload complete",
                description: `${successCount} file(s) attached to this takeoff${sheetSuffix}.`,
              });
            }
          },
        },
      );
    });
  };

  const sheets = sheetsQuery.data ?? [];

  // Task #2561 — Derive per-discipline counts and the grouped/filtered
  // sheet list. Discipline ordering follows DISCIPLINE_CODES so the
  // groups always show in canonical AIA order with "Unclassified" last.
  // NOTE: These hooks must run on every render — keep them above any
  // early returns to satisfy the rules of hooks.
  const disciplineCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sheets) {
      const code = s.discipline ?? "UNCLASSIFIED";
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return counts;
  }, [sheets]);

  const presentDisciplines = useMemo(
    () => DISCIPLINE_CODES.filter((c) => (disciplineCounts.get(c) ?? 0) > 0),
    [disciplineCounts],
  );

  const groupedSheets = useMemo(() => {
    const filtered = sheets.filter((s) => {
      if (disciplineFilter === "ALL") return true;
      if (disciplineFilter === "UNCLASSIFIED") return !s.discipline;
      return s.discipline === disciplineFilter;
    });
    const byCode = new Map<string, TakeoffSheet[]>();
    for (const s of filtered) {
      const code = s.discipline ?? "UNCLASSIFIED";
      const arr = byCode.get(code) ?? [];
      arr.push(s);
      byCode.set(code, arr);
    }
    for (const arr of byCode.values()) {
      arr.sort((a, b) => a.sheetIndex - b.sheetIndex);
    }
    const ordered: { code: string; sheets: TakeoffSheet[] }[] = [];
    for (const code of DISCIPLINE_CODES) {
      const arr = byCode.get(code);
      if (arr && arr.length > 0) ordered.push({ code, sheets: arr });
    }
    const unclassified = byCode.get("UNCLASSIFIED");
    if (unclassified && unclassified.length > 0) {
      ordered.push({ code: "UNCLASSIFIED", sheets: unclassified });
    }
    return ordered;
  }, [sheets, disciplineFilter]);

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
          {/* Task #2550 — Primary entry point into the full takeoff
           *  workspace (drawing tools, calibration, AI takeoff, exports).
           *  Disabled until at least one sheet exists since the workspace
           *  has nothing to render without a plan to draw on. */}
          <Button
            asChild={sheets.length > 0}
            variant="default"
            disabled={sheets.length === 0}
            title={
              sheets.length === 0
                ? "Upload a plan sheet first to open the workspace"
                : undefined
            }
            data-testid="button-open-workspace"
          >
            {sheets.length > 0 ? (
              <Link href={`/takeoff/standalone/${t.id}/workspace`}>
                <Ruler className="w-4 h-4 mr-2" /> Open workspace
              </Link>
            ) : (
              <span>
                <Ruler className="w-4 h-4 mr-2" /> Open workspace
              </span>
            )}
          </Button>
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
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Sheets ({sheets.length})
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Task #2561 — Filter the Sheets list by AIA discipline. The
             *  list below is rendered grouped by discipline so this
             *  doubles as a jump target for large plan sets. */}
            {sheets.length > 0 && (
              <Select value={disciplineFilter} onValueChange={setDisciplineFilter}>
                <SelectTrigger
                  className="h-8 w-[180px] text-xs"
                  data-testid="select-discipline-filter"
                >
                  <SelectValue placeholder="Filter by discipline" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All disciplines</SelectItem>
                  <SelectItem value="UNCLASSIFIED">Unclassified</SelectItem>
                  {presentDisciplines.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code} — {DISCIPLINE_LABELS[code] ?? code} ({disciplineCounts.get(code) ?? 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <ObjectUploader
              maxNumberOfFiles={10}
              allowedFileTypes={[".pdf", ".png", ".jpg", ".jpeg"]}
              fileType="DOCUMENT"
              onComplete={handleUploadComplete as React.ComponentProps<typeof ObjectUploader>["onComplete"]}
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
          </div>
        </CardHeader>
        <CardContent>
          {sheets.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-sheets-empty">
              No sheets yet. Upload a PDF or image plan above, then click
              "Open workspace" to start drawing measurements.
            </p>
          ) : groupedSheets.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-sheets-filtered-empty">
              No sheets match this discipline filter.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Task #2561 — Grouped by AIA discipline so a multi-sheet
               *  plan set is browsable by trade (mirrors bid workspace).
               *  Within a group, sheets keep their original sheet-index
               *  order. The unclassified bucket is shown last so common
               *  cases stay at the top.
               *  Task #2560 — Reorder buttons (up/down) operate on the
               *  global sheet-index regardless of grouping, so they're
               *  disabled at the global ends, not the group ends. */}
              {groupedSheets.map((group) => (
                <div
                  key={group.code}
                  className="space-y-1"
                  data-testid={`sheet-group-${group.code}`}
                >
                  <div className="flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <span>
                      {group.code === "UNCLASSIFIED"
                        ? "Unclassified"
                        : `${group.code} — ${DISCIPLINE_LABELS[group.code] ?? group.code}`}
                    </span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                      {group.sheets.length}
                    </Badge>
                  </div>
                  {group.sheets.map((s) => {
                    const globalIdx = sheets.findIndex((g) => g.id === s.id);
                    return (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 text-sm rounded px-2 py-1.5 hover:bg-muted"
                        data-testid={`sheet-row-${s.id}`}
                      >
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            disabled={globalIdx <= 0 || reorderSheetsMutation.isPending}
                            onClick={() => moveSheet(s.id, "up")}
                            title="Move up"
                            data-testid={`button-move-sheet-up-${s.id}`}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            disabled={globalIdx === sheets.length - 1 || reorderSheetsMutation.isPending}
                            onClick={() => moveSheet(s.id, "down")}
                            title="Move down"
                            data-testid={`button-move-sheet-down-${s.id}`}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <Link
                          href={`/takeoff/standalone/${t.id}/workspace?sheet=${s.id}`}
                          className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
                          data-testid={`sheet-link-${s.id}`}
                        >
                          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="flex-1 truncate">{s.sheetName}</span>
                          {s.discipline && (
                            <Badge
                              variant={s.disciplineSource === "USER" ? "default" : "outline"}
                              className="text-[10px] h-5 px-1.5 shrink-0"
                              title={
                                s.disciplineSource === "USER"
                                  ? "Set manually"
                                  : s.disciplineSource === "AI_DETECTED"
                                    ? `AI-detected (${s.disciplineConfidence ?? "n/a"})`
                                    : `Filename heuristic (${s.disciplineConfidence ?? "n/a"})`
                              }
                              data-testid={`badge-discipline-${s.id}`}
                            >
                              {s.discipline}
                            </Badge>
                          )}
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        </Link>
                        {/* Manual discipline picker — overrides the AI/heuristic
                         *  classification (server stamps source="USER"). */}
                        <Select
                          value={s.discipline ?? "NONE"}
                          onValueChange={(value) =>
                            setDisciplineMutation.mutate({
                              sheetId: s.id,
                              discipline: value === "NONE" ? null : value,
                            })
                          }
                        >
                          <SelectTrigger
                            className="h-7 w-[110px] text-xs"
                            data-testid={`select-discipline-${s.id}`}
                          >
                            <SelectValue placeholder="Set" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">— Clear —</SelectItem>
                            {DISCIPLINE_CODES.map((code) => (
                              <SelectItem key={code} value={code}>
                                {code} — {DISCIPLINE_LABELS[code]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
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
