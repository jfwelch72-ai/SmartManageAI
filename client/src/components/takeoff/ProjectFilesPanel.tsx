/**
 * Project Files Panel — slide-out drawer mounted alongside the takeoff
 * workspace canvas (next to `SheetSetsPanel`). Surfaces the project's
 * (or bid's) document library inline so estimators can:
 *
 *   • search across plans, specs, addenda, BIM models, photos and
 *     supporting documents without leaving the takeoff,
 *   • preview any file in a modal (uses the same `FilePreview` the
 *     bid Plans tab uses),
 *   • for PDFs, jump straight into a takeoff sheet that was already
 *     imported from the document, OR import the document into takeoff
 *     and select the new sheet,
 *   • download / open in a new tab via the per-file More menu.
 *
 * Document records come from the existing context-scoped endpoints:
 *   GET /api/bids/:bidCode/documents       (bid context)
 *   GET /api/projects/:projectCode/documents (project context)
 *
 * Imports go through the existing import-plan endpoints so the takeoff
 * sheet list stays in lockstep:
 *   POST /api/bids/:bidId/takeoff/import-plan
 *   POST /api/projects/:projectId/takeoff/import-plan
 *
 * Folder grouping is derived client-side from the document `type` enum
 * + mime-type ("image/*" → Photos) so estimators get a familiar
 * Plans / Specs / BIM / Photos / Other tree without requiring any
 * schema change.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FileType,
  Filter,
  Folder,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Search,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import FilePreview from "@/components/FilePreview";
import type { TakeoffSheet } from "@shared/schema";

// ---------------------------------------------------------------------------
// Types

type DocumentType = "PLANS" | "SPECS" | "TAKEOFF" | "OTHER" | "BIM";

interface ProjectFileDoc {
  id: string;
  title: string | null;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedAt: string;
  type: DocumentType;
}

type FolderKey = "plans" | "specs" | "bim" | "photos" | "other";

interface FolderGroup {
  key: FolderKey;
  name: string;
  hint?: string;
  files: ProjectFileDoc[];
  defaultOpen: boolean;
}

type SortMode = "recent" | "name";

export interface ProjectFilesPanelProps {
  open: boolean;
  onClose: () => void;
  /** Discriminates which API + import endpoint to use. */
  contextType: "bid" | "project";
  /** UUID — used by the import-plan endpoint. */
  contextId: string;
  /** Short code — used by the documents list + stream URLs. */
  contextCode: string;
  /** Human label shown in the header chip. */
  contextLabel: string;
  /** Existing takeoff sheets (so we can show "Active" / "In takeoff"
   *  badges and route "Open in takeoff" to the right sheet). */
  sheets: TakeoffSheet[];
  selectedSheet: string | null;
  onSelectSheet: (sheetId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers

function isImageDoc(doc: ProjectFileDoc): boolean {
  return !!doc.mimeType && doc.mimeType.toLowerCase().startsWith("image/");
}

function isPdfDoc(doc: ProjectFileDoc): boolean {
  if (doc.mimeType?.toLowerCase() === "application/pdf") return true;
  return doc.fileName.toLowerCase().endsWith(".pdf");
}

function inferFolderKey(doc: ProjectFileDoc): FolderKey {
  if (isImageDoc(doc)) return "photos";
  if (doc.type === "PLANS") return "plans";
  if (doc.type === "SPECS") return "specs";
  if (doc.type === "BIM") return "bim";
  return "other";
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

const FOLDER_DEFINITIONS: Array<{
  key: FolderKey;
  name: string;
  hint?: string;
  defaultOpen: boolean;
}> = [
  {
    key: "plans",
    name: "Plan Documents",
    hint: "PDFs that can be imported into the takeoff workspace",
    defaultOpen: true,
  },
  { key: "specs", name: "Specs", defaultOpen: false },
  { key: "bim", name: "BIM Models", defaultOpen: false },
  { key: "photos", name: "Photos", defaultOpen: false },
  { key: "other", name: "Other", defaultOpen: false },
];

// ---------------------------------------------------------------------------
// File-icon swatch (kept inline so the panel ships as a single file)

function FileIcon({ doc }: { doc: ProjectFileDoc }) {
  const base =
    "h-8 w-8 rounded-md flex items-center justify-center shrink-0";
  if (isImageDoc(doc)) {
    return (
      <div
        className={cn(
          base,
          "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
        )}
      >
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  if (doc.type === "SPECS") {
    return (
      <div
        className={cn(
          base,
          "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
        )}
      >
        <FileText className="h-4 w-4" />
      </div>
    );
  }
  if (isPdfDoc(doc)) {
    return (
      <div
        className={cn(
          base,
          "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400",
        )}
      >
        <FileType className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        base,
        "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
      )}
    >
      <FileText className="h-4 w-4" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-file row

interface FileItemProps {
  doc: ProjectFileDoc;
  contextType: "bid" | "project";
  contextCode: string;
  /** Sheet id already imported from this doc, if any. */
  importedSheetId: string | null;
  /** True when the imported sheet is the one currently shown on canvas. */
  isActive: boolean;
  onPreview: (doc: ProjectFileDoc) => void;
  onOpenInTakeoff: (doc: ProjectFileDoc) => void;
  importing: boolean;
}

function FileItem({
  doc,
  contextType,
  contextCode,
  importedSheetId,
  isActive,
  onPreview,
  onOpenInTakeoff,
  importing,
}: FileItemProps) {
  const streamUrl =
    contextType === "bid"
      ? `/api/bids/${contextCode}/documents/${doc.id}/stream`
      : `/api/projects/${contextCode}/documents/${doc.id}/stream`;

  const canTakeoff = isPdfDoc(doc);
  const displayName = doc.title?.trim() || doc.fileName;

  return (
    <div
      className="group flex items-start gap-3 px-2 py-2 rounded-md hover-elevate active-elevate-2 cursor-default"
      data-testid={`file-row-${doc.id}`}
    >
      <FileIcon doc={doc} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p
            className="text-sm font-medium text-foreground truncate"
            title={displayName}
            data-testid={`text-file-name-${doc.id}`}
          >
            {displayName}
          </p>
          {isActive && (
            <Badge
              variant="default"
              className="text-[10px] py-0 px-1.5 h-4 shrink-0"
              data-testid={`badge-active-${doc.id}`}
            >
              Active
            </Badge>
          )}
          {!isActive && importedSheetId && (
            <Badge
              variant="secondary"
              className="text-[10px] py-0 px-1.5 h-4 shrink-0"
              data-testid={`badge-in-takeoff-${doc.id}`}
            >
              In takeoff
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span>{formatBytes(doc.fileSize)}</span>
          <span className="text-muted-foreground/50">•</span>
          <span>{formatRelative(doc.uploadedAt)}</span>
        </div>
      </div>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
        <TooltipProvider delayDuration={150}>
          {canTakeoff && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => onOpenInTakeoff(doc)}
                  disabled={importing}
                  data-testid={`button-open-takeoff-${doc.id}`}
                >
                  {importing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {importedSheetId ? "Open in takeoff" : "Import to takeoff"}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => onPreview(doc)}
                data-testid={`button-preview-${doc.id}`}
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Preview</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                data-testid={`button-more-${doc.id}`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {canTakeoff && (
                <DropdownMenuItem
                  onClick={() => onOpenInTakeoff(doc)}
                  disabled={importing}
                  data-testid={`menu-open-takeoff-${doc.id}`}
                >
                  <ArrowUpRight className="h-4 w-4 mr-2" />
                  {importedSheetId ? "Open in takeoff" : "Import to takeoff"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onPreview(doc)}
                data-testid={`menu-preview-${doc.id}`}
              >
                <Eye className="h-4 w-4 mr-2" />
                Preview
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={streamUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`menu-open-new-tab-${doc.id}`}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in new tab
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={streamUrl}
                  download={doc.fileName}
                  data-testid={`menu-download-${doc.id}`}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipProvider>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Folder section

interface FolderSectionProps {
  folder: FolderGroup;
  contextType: "bid" | "project";
  contextCode: string;
  importedByDocId: Map<string, string>;
  activeImportedDocId: string | null;
  onPreview: (doc: ProjectFileDoc) => void;
  onOpenInTakeoff: (doc: ProjectFileDoc) => void;
  importingDocId: string | null;
}

function FolderSection({
  folder,
  contextType,
  contextCode,
  importedByDocId,
  activeImportedDocId,
  onPreview,
  onOpenInTakeoff,
  importingDocId,
}: FolderSectionProps) {
  const [open, setOpen] = useState(folder.defaultOpen);
  const count = folder.files.length;
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover-elevate active-elevate-2 text-left"
        data-testid={`button-folder-${folder.key}`}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <Folder
          className={cn(
            "h-4 w-4 shrink-0",
            open ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="text-sm font-medium text-foreground flex-1">
          {folder.name}
        </span>
        <span
          className="text-xs text-muted-foreground tabular-nums"
          data-testid={`text-folder-count-${folder.key}`}
        >
          {count}
        </span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          {folder.hint && count > 0 && (
            <p className="px-2 pt-1 pb-2 text-[11px] text-muted-foreground/80">
              {folder.hint}
            </p>
          )}
          {count === 0 ? (
            <p
              className="px-2 py-3 text-xs text-muted-foreground italic"
              data-testid={`text-folder-empty-${folder.key}`}
            >
              No files in this folder yet.
            </p>
          ) : (
            <div className="space-y-0.5">
              {folder.files.map((doc) => (
                <FileItem
                  key={doc.id}
                  doc={doc}
                  contextType={contextType}
                  contextCode={contextCode}
                  importedSheetId={importedByDocId.get(doc.id) ?? null}
                  isActive={activeImportedDocId === doc.id}
                  onPreview={onPreview}
                  onOpenInTakeoff={onOpenInTakeoff}
                  importing={importingDocId === doc.id}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel

export function ProjectFilesPanel({
  open,
  onClose,
  contextType,
  contextId,
  contextCode,
  contextLabel,
  sheets,
  selectedSheet,
  onSelectSheet,
}: ProjectFilesPanelProps) {
  const { toast } = useToast();

  const docsQueryKey =
    contextType === "bid"
      ? ["/api/bids", contextCode, "documents"]
      : ["/api/projects", contextCode, "documents"];

  const docsUrl =
    contextType === "bid"
      ? `/api/bids/${contextCode}/documents`
      : `/api/projects/${contextCode}/documents`;

  const docsQuery = useQuery<ProjectFileDoc[]>({
    queryKey: docsQueryKey,
    queryFn: async () => {
      const res = await fetch(docsUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
    enabled: open && !!contextCode,
  });

  // Map document fileUrl → sheetId so we can show "Active" / "In takeoff"
  // badges and route "Open in takeoff" without a round-trip.
  const sheetByDocFileUrl = useMemo(() => {
    const map = new Map<string, string>();
    for (const sheet of sheets) {
      if (sheet.imageUrl && !map.has(sheet.imageUrl)) {
        map.set(sheet.imageUrl, sheet.id);
      }
    }
    return map;
  }, [sheets]);

  const importedByDocId = useMemo(() => {
    const map = new Map<string, string>();
    for (const doc of docsQuery.data ?? []) {
      const sheetId = sheetByDocFileUrl.get(doc.fileUrl);
      if (sheetId) map.set(doc.id, sheetId);
    }
    return map;
  }, [docsQuery.data, sheetByDocFileUrl]);

  const activeImportedDocId = useMemo(() => {
    if (!selectedSheet) return null;
    const entries = Array.from(importedByDocId.entries());
    for (const [docId, sheetId] of entries) {
      if (sheetId === selectedSheet) return docId;
    }
    return null;
  }, [importedByDocId, selectedSheet]);

  // ── Toolbar state ───────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | FolderKey>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [previewDoc, setPreviewDoc] = useState<ProjectFileDoc | null>(null);
  const [importingDocId, setImportingDocId] = useState<string | null>(null);

  // ── Import-plan mutation ────────────────────────────────────────
  const importMutation = useMutation({
    mutationFn: async (docId: string) => {
      const url =
        contextType === "bid"
          ? `/api/bids/${contextId}/takeoff/import-plan`
          : `/api/projects/${contextId}/takeoff/import-plan`;
      const res = await apiRequest("POST", url, { documentId: docId });
      return res.json() as Promise<{
        sheets: TakeoffSheet[];
        pageCount: number;
      }>;
    },
    onSuccess: async (data, docId) => {
      const sheetsKey =
        contextType === "bid"
          ? ["/api/bids", contextId, "takeoff", "sheets"]
          : ["/api/projects", contextId, "takeoff", "sheets"];
      await queryClient.invalidateQueries({ queryKey: sheetsKey });
      const firstNew = data.sheets?.[0];
      if (firstNew?.id) {
        onSelectSheet(firstNew.id);
        toast({
          title: "Plan imported",
          description: `Added ${data.sheets.length} sheet${
            data.sheets.length === 1 ? "" : "s"
          } to takeoff.`,
        });
        onClose();
      } else {
        toast({
          title: "Plan imported",
          description: "Document is now available in the takeoff workspace.",
        });
      }
      setImportingDocId(null);
      // Mark unused so eslint doesn't flag — docId is part of the
      // mutation cache key surface even though we don't read it here.
      void docId;
    },
    onError: (err: any) => {
      setImportingDocId(null);
      toast({
        title: "Could not import plan",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // ── Per-row handlers ───────────────────────────────────────────
  const handleOpenInTakeoff = (doc: ProjectFileDoc) => {
    const existingSheetId = importedByDocId.get(doc.id);
    if (existingSheetId) {
      onSelectSheet(existingSheetId);
      onClose();
      return;
    }
    setImportingDocId(doc.id);
    importMutation.mutate(doc.id);
  };

  const handlePreview = (doc: ProjectFileDoc) => {
    setPreviewDoc(doc);
  };

  // ── Search + filter + sort ─────────────────────────────────────
  const filteredDocs = useMemo(() => {
    const all = docsQuery.data ?? [];
    const q = query.trim().toLowerCase();
    let next = all.filter((doc) => {
      if (typeFilter !== "all" && inferFolderKey(doc) !== typeFilter) {
        return false;
      }
      if (!q) return true;
      const name = (doc.title || doc.fileName || "").toLowerCase();
      return name.includes(q);
    });
    next = [...next].sort((a, b) => {
      if (sortMode === "name") {
        const an = (a.title || a.fileName || "").toLowerCase();
        const bn = (b.title || b.fileName || "").toLowerCase();
        return an.localeCompare(bn);
      }
      const ad = new Date(a.uploadedAt).getTime() || 0;
      const bd = new Date(b.uploadedAt).getTime() || 0;
      return bd - ad;
    });
    return next;
  }, [docsQuery.data, query, typeFilter, sortMode]);

  const folders: FolderGroup[] = useMemo(() => {
    const buckets: Record<FolderKey, ProjectFileDoc[]> = {
      plans: [],
      specs: [],
      bim: [],
      photos: [],
      other: [],
    };
    for (const doc of filteredDocs) {
      buckets[inferFolderKey(doc)].push(doc);
    }
    return FOLDER_DEFINITIONS.map((def) => ({
      ...def,
      files: buckets[def.key],
    }));
  }, [filteredDocs]);

  const totalCount = docsQuery.data?.length ?? 0;
  const totalBytes = useMemo(
    () =>
      (docsQuery.data ?? []).reduce((sum, d) => sum + (d.fileSize || 0), 0),
    [docsQuery.data],
  );

  if (!open) return null;

  const filterLabel =
    typeFilter === "all"
      ? "All types"
      : FOLDER_DEFINITIONS.find((f) => f.key === typeFilter)?.name ?? "All types";

  const sortLabel = sortMode === "recent" ? "Recent" : "Name";

  const previewUrl = previewDoc
    ? contextType === "bid"
      ? `/api/bids/${contextCode}/documents/${previewDoc.id}/stream`
      : `/api/projects/${contextCode}/documents/${previewDoc.id}/stream`
    : null;

  return (
    <>
      <aside
        className="absolute top-0 right-0 h-full w-full sm:w-[420px] max-w-full overflow-hidden border-l bg-background shadow-2xl z-30 flex flex-col"
        data-testid="project-files-drawer"
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Folder className="h-4 w-4 text-primary shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">
                Project Files
              </h2>
              {contextLabel && (
                <Badge
                  variant="secondary"
                  className="text-[10px] py-0 h-4 px-1.5 truncate"
                  data-testid="badge-context-label"
                >
                  {contextLabel}
                </Badge>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={onClose}
              data-testid="button-close-drawer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="relative">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files…"
              className="h-8 pl-8 text-sm"
              data-testid="input-search-files"
            />
          </div>

          <div className="flex items-center gap-1 mt-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  data-testid="button-filter"
                >
                  <Filter className="h-3 w-3" />
                  {filterLabel}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>File type</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={typeFilter === "all"}
                  onCheckedChange={() => setTypeFilter("all")}
                  data-testid="filter-all"
                >
                  All types
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                {FOLDER_DEFINITIONS.map((f) => (
                  <DropdownMenuCheckboxItem
                    key={f.key}
                    checked={typeFilter === f.key}
                    onCheckedChange={() => setTypeFilter(f.key)}
                    data-testid={`filter-${f.key}`}
                  >
                    {f.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  data-testid="button-sort"
                >
                  {sortLabel}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={sortMode === "recent"}
                  onCheckedChange={() => setSortMode("recent")}
                  data-testid="sort-recent"
                >
                  Recent
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={sortMode === "name"}
                  onCheckedChange={() => setSortMode("name")}
                  data-testid="sort-name"
                >
                  Name
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  data-testid="button-upload"
                  disabled
                >
                  <Upload className="h-3 w-3" />
                  Upload
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">
                  Upload from the {contextType === "bid" ? "Bid" : "Project"}{" "}
                  Plans tab.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto" data-testid="folder-tree">
          {docsQuery.isLoading ? (
            <div
              className="flex items-center justify-center py-12 text-sm text-muted-foreground"
              data-testid="state-loading"
            >
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading documents…
            </div>
          ) : docsQuery.isError ? (
            <div
              className="px-4 py-8 text-sm text-destructive flex flex-col items-start gap-2"
              data-testid="state-error"
            >
              <span>Could not load documents.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => docsQuery.refetch()}
                data-testid="button-retry"
              >
                Retry
              </Button>
            </div>
          ) : totalCount === 0 ? (
            <div
              className="px-4 py-12 text-sm text-muted-foreground text-center"
              data-testid="state-empty"
            >
              <Folder className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              <p>No documents uploaded yet.</p>
              <p className="text-xs mt-1">
                Add files from the{" "}
                {contextType === "bid" ? "Bid" : "Project"} Plans tab to see
                them here.
              </p>
            </div>
          ) : (
            folders.map((folder) => (
              <FolderSection
                key={folder.key}
                folder={folder}
                contextType={contextType}
                contextCode={contextCode}
                importedByDocId={importedByDocId}
                activeImportedDocId={activeImportedDocId}
                onPreview={handlePreview}
                onOpenInTakeoff={handleOpenInTakeoff}
                importingDocId={importingDocId}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground flex items-center justify-between shrink-0"
          data-testid="footer-totals"
        >
          <span>
            {totalCount} file{totalCount === 1 ? "" : "s"} ·{" "}
            {formatBytes(totalBytes)}
          </span>
        </div>
      </aside>

      {/* Preview dialog (uses the same FilePreview as bid Plans tab). */}
      <Dialog
        open={!!previewDoc}
        onOpenChange={(o) => {
          if (!o) setPreviewDoc(null);
        }}
      >
        <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b shrink-0">
            <DialogTitle
              className="text-sm font-semibold truncate"
              data-testid="text-preview-title"
            >
              {previewDoc?.title || previewDoc?.fileName || "Preview"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {previewDoc && previewUrl && (
              <FilePreview
                url={previewUrl}
                fileName={previewDoc.fileName}
                title={previewDoc.title || undefined}
                mimeType={previewDoc.mimeType}
                onOpenFile={() => window.open(previewUrl, "_blank")}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ProjectFilesPanel;
