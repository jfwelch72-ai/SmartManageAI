import { useState } from "react";
import {
  X,
  Search,
  ChevronDown,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  FileType,
  Folder,
  MoreHorizontal,
  Eye,
  ExternalLink,
  Download,
  Upload,
  Filter,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type FileKind = "pdf" | "image" | "doc" | "spec";

interface FileRow {
  id: string;
  name: string;
  kind: FileKind;
  size: string;
  updated: string;
  pages?: number;
  inTakeoff?: boolean;
  badge?: string;
}

interface FolderGroup {
  id: string;
  name: string;
  count: number;
  files: FileRow[];
  defaultOpen?: boolean;
  hint?: string;
}

const FOLDERS: FolderGroup[] = [
  {
    id: "plans",
    name: "Plan Documents",
    count: 4,
    defaultOpen: true,
    hint: "PDFs imported into the takeoff workspace",
    files: [
      {
        id: "p1",
        name: "TRR-Architectural-Set-Rev3.pdf",
        kind: "pdf",
        size: "48.2 MB",
        updated: "2d ago",
        pages: 142,
        inTakeoff: true,
        badge: "Active",
      },
      {
        id: "p2",
        name: "TRR-Structural-Set-Rev2.pdf",
        kind: "pdf",
        size: "31.7 MB",
        updated: "5d ago",
        pages: 86,
        inTakeoff: true,
      },
      {
        id: "p3",
        name: "TRR-MEP-Set-Rev1.pdf",
        kind: "pdf",
        size: "27.4 MB",
        updated: "1w ago",
        pages: 64,
      },
      {
        id: "p4",
        name: "TRR-Civil-GradingPlan.pdf",
        kind: "pdf",
        size: "12.8 MB",
        updated: "2w ago",
        pages: 18,
      },
    ],
  },
  {
    id: "addenda",
    name: "Addenda",
    count: 3,
    defaultOpen: true,
    hint: "Subject to carryover-on-revision",
    files: [
      {
        id: "a1",
        name: "Addendum-03_Window-Schedule-Update.pdf",
        kind: "pdf",
        size: "2.1 MB",
        updated: "Yesterday",
        pages: 6,
        badge: "New",
      },
      {
        id: "a2",
        name: "Addendum-02_Site-Logistics.pdf",
        kind: "pdf",
        size: "4.8 MB",
        updated: "1w ago",
        pages: 12,
      },
      {
        id: "a3",
        name: "Addendum-01_RFI-Responses.pdf",
        kind: "pdf",
        size: "1.6 MB",
        updated: "3w ago",
        pages: 4,
      },
    ],
  },
  {
    id: "photos",
    name: "Photos",
    count: 12,
    files: [
      {
        id: "ph1",
        name: "SitePrep-NorthElevation-2026-04-22.jpg",
        kind: "image",
        size: "5.4 MB",
        updated: "8d ago",
      },
      {
        id: "ph2",
        name: "Excavation-Day3.jpg",
        kind: "image",
        size: "4.9 MB",
        updated: "10d ago",
      },
      {
        id: "ph3",
        name: "Existing-CurbCut-Survey.jpg",
        kind: "image",
        size: "6.1 MB",
        updated: "2w ago",
      },
    ],
  },
  {
    id: "specs",
    name: "Specs",
    count: 5,
    files: [
      {
        id: "s1",
        name: "Div-03-Concrete-Specifications.pdf",
        kind: "spec",
        size: "8.3 MB",
        updated: "4d ago",
        pages: 48,
      },
      {
        id: "s2",
        name: "Div-09-Finishes.pdf",
        kind: "spec",
        size: "6.7 MB",
        updated: "1w ago",
        pages: 32,
      },
    ],
  },
  {
    id: "other",
    name: "Other",
    count: 7,
    files: [
      {
        id: "o1",
        name: "Geotechnical-Report-2026.pdf",
        kind: "doc",
        size: "14.2 MB",
        updated: "3w ago",
        pages: 56,
      },
      {
        id: "o2",
        name: "Pre-Bid-MeetingMinutes.docx",
        kind: "doc",
        size: "184 KB",
        updated: "1mo ago",
      },
    ],
  },
];

function FileIcon({ kind }: { kind: FileKind }) {
  const base = "h-8 w-8 rounded-md flex items-center justify-center shrink-0";
  switch (kind) {
    case "pdf":
      return (
        <div className={cn(base, "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400")}>
          <FileType className="h-4 w-4" />
        </div>
      );
    case "image":
      return (
        <div className={cn(base, "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400")}>
          <ImageIcon className="h-4 w-4" />
        </div>
      );
    case "spec":
      return (
        <div className={cn(base, "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400")}>
          <FileText className="h-4 w-4" />
        </div>
      );
    default:
      return (
        <div className={cn(base, "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400")}>
          <FileText className="h-4 w-4" />
        </div>
      );
  }
}

function FileItem({ file }: { file: FileRow }) {
  const isPlan = file.kind === "pdf" && (file.pages ?? 0) > 0;
  return (
    <div
      className="group flex items-start gap-3 px-2 py-2 rounded-md hover-elevate active-elevate-2 cursor-pointer"
      data-testid={`file-row-${file.id}`}
    >
      <FileIcon kind={file.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-foreground truncate" title={file.name}>
            {file.name}
          </p>
          {file.badge && (
            <Badge
              variant={file.badge === "Active" ? "default" : "secondary"}
              className="text-[10px] py-0 px-1.5 h-4 shrink-0"
            >
              {file.badge}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span>{file.size}</span>
          <span className="text-muted-foreground/50">•</span>
          <span>{file.updated}</span>
          {file.pages && (
            <>
              <span className="text-muted-foreground/50">•</span>
              <span>{file.pages} pages</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <TooltipProvider delayDuration={150}>
          {isPlan && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  data-testid={`button-open-takeoff-${file.id}`}
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Open in takeoff</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                data-testid={`button-preview-${file.id}`}
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
                data-testid={`button-more-${file.id}`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {isPlan && (
                <DropdownMenuItem>
                  <ArrowUpRight className="h-4 w-4 mr-2" />
                  Open in takeoff
                </DropdownMenuItem>
              )}
              <DropdownMenuItem>
                <Eye className="h-4 w-4 mr-2" />
                Preview
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in new tab
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Download className="h-4 w-4 mr-2" />
                Download
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Compare versions…</DropdownMenuItem>
              <DropdownMenuItem>Move to folder…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive">
                Remove from project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipProvider>
      </div>
    </div>
  );
}

function FolderSection({ folder }: { folder: FolderGroup }) {
  const [open, setOpen] = useState(folder.defaultOpen ?? false);
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover-elevate active-elevate-2 text-left"
        data-testid={`button-folder-${folder.id}`}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <Folder
          className={cn(
            "h-4 w-4 shrink-0",
            open ? "text-primary" : "text-muted-foreground"
          )}
        />
        <span className="text-sm font-medium text-foreground flex-1">
          {folder.name}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {folder.count}
        </span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          {folder.hint && (
            <p className="px-2 pt-1 pb-2 text-[11px] text-muted-foreground/80">
              {folder.hint}
            </p>
          )}
          <div className="space-y-0.5">
            {folder.files.map((f) => (
              <FileItem key={f.id} file={f} />
            ))}
            {folder.files.length < folder.count && (
              <button
                className="w-full text-left px-2 py-1.5 text-xs text-primary hover:underline"
                data-testid={`button-show-all-${folder.id}`}
              >
                Show all {folder.count} files →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Drawer() {
  const [query, setQuery] = useState("");

  return (
    <div className="min-h-screen bg-muted/40 flex justify-end">
      {/* Drawer panel (slides in from right) */}
      <aside
        className="w-full max-w-[460px] h-screen bg-background border-l border-border shadow-xl flex flex-col"
        data-testid="project-files-drawer"
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Folder className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                Project Files
              </h2>
              <Badge variant="secondary" className="text-[10px] py-0 h-4 px-1.5">
                The Reserve @ Chatford
              </Badge>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
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
              placeholder="Search files, sheets, addenda…"
              className="h-8 pl-8 pr-8 text-sm"
              data-testid="input-search-files"
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 border border-border">
              ⌘K
            </kbd>
          </div>

          <div className="flex items-center gap-1 mt-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              data-testid="button-filter"
            >
              <Filter className="h-3 w-3" />
              All types
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              data-testid="button-sort"
            >
              Recent
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              data-testid="button-upload"
            >
              <Upload className="h-3 w-3" />
              Upload
            </Button>
          </div>
        </div>

        {/* Folder tree */}
        <div className="flex-1 overflow-y-auto">
          {FOLDERS.map((folder) => (
            <FolderSection key={folder.id} folder={folder} />
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground flex items-center justify-between">
          <span>31 files · 156 MB</span>
          <button
            className="text-primary hover:underline"
            data-testid="button-manage-all"
          >
            Manage all in Documents →
          </button>
        </div>
      </aside>
    </div>
  );
}
