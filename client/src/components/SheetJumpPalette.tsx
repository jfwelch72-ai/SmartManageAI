/**
 * Task #1609 — Cmd/Ctrl+K palette scoped to plans surface.
 * Searches across plan_documents and drawing_set sheets and emits a callback.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Layers } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useIsMobile } from "@/hooks/use-mobile";

export interface SheetJumpResult {
  type: "DOCUMENT" | "SHEET";
  id: string;
  title: string;
  subtitle?: string;
  documentId?: string;
  pageNumber?: number;
  drawingSetId?: string;
}

export interface SheetJumpPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectCode: string;
  projectId?: string | null;
  onPick: (result: SheetJumpResult) => void;
}

interface DocumentLite {
  id: string;
  title?: string | null;
  fileName: string;
  type?: string | null;
}
interface DrawingSetLite {
  id: string;
  name?: string | null;
}
interface SheetLite {
  id: string;
  projectId?: string | null;
  planId?: string | null;
  sheetIndex?: number | null;
  sheetName?: string | null;
  revisionLabel?: string | null;
}

function score(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 50;
  if (t.includes(q)) return 20;
  // Subsequence match (cheap fuzzy)
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length ? 5 : 0;
}

export default function SheetJumpPalette({
  open,
  onOpenChange,
  projectCode,
  projectId,
  onPick,
}: SheetJumpPaletteProps) {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { data: documents = [] } = useQuery<DocumentLite[]>({
    queryKey: ["/api/projects", projectCode, "documents"],
    enabled: open && !!projectCode,
  });

  const { data: drawingSets = [] } = useQuery<DrawingSetLite[]>({
    queryKey: ["/api/projects", projectId, "drawing-sets"],
    enabled: open && !!projectId,
  });

  const { data: sheets = [] } = useQuery<SheetLite[]>({
    queryKey: ["/api/projects", projectId, "takeoff", "sheets"],
    queryFn: async () => {
      const r = await fetch(
        `/api/projects/${encodeURIComponent(projectId || "")}/takeoff/sheets`,
        { credentials: "include" },
      );
      if (!r.ok) return [];
      return r.json();
    },
    enabled: open && !!projectId,
  });

  const planDocs = useMemo(
    () =>
      documents.filter((d) => {
        const ext = (d.fileName.split(".").pop() || "").toLowerCase();
        const t = (d.type || "").toLowerCase();
        return ext === "pdf" || t.includes("plan") || t.includes("drawing");
      }),
    [documents],
  );

  const docResults = useMemo(() => {
    return planDocs
      .map((d) => {
        const title = d.title || d.fileName;
        return { d, s: score(query, title) };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 10)
      .map<SheetJumpResult>(({ d }) => ({
        type: "DOCUMENT",
        id: `doc-${d.id}`,
        title: d.title || d.fileName,
        subtitle: "Plan Document",
        documentId: d.id,
        pageNumber: 1,
      }));
  }, [planDocs, query]);

  const sheetResults = useMemo(() => {
    return sheets
      .map((s) => {
        const label =
          s.sheetName ||
          (s.sheetIndex != null ? `Sheet ${s.sheetIndex + 1}` : "Sheet");
        return { s, label, score: score(query, label) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map<SheetJumpResult>(({ s, label }) => ({
        type: "SHEET",
        id: `sheet-${s.id}`,
        title: label,
        subtitle: s.revisionLabel ? `Rev ${s.revisionLabel}` : "Sheet",
        pageNumber: typeof s.sheetIndex === "number" ? s.sheetIndex + 1 : undefined,
      }));
  }, [sheets, query]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <CommandInput
        placeholder={isMobile ? "Search sheets…" : "Search sheets and plan documents…"}
        value={query}
        onValueChange={setQuery}
        data-testid="input-sheet-jump-search"
      />
      <CommandList data-testid="list-sheet-jump-results">
        <CommandEmpty>No results found.</CommandEmpty>
        {docResults.length > 0 && (
          <CommandGroup heading="Plan Documents">
            {docResults.map((r) => (
              <CommandItem
                key={r.id}
                value={r.id}
                onSelect={() => {
                  onPick(r);
                  onOpenChange(false);
                }}
                data-testid={`item-sheet-jump-${r.id}`}
              >
                <FileText className="w-4 h-4 mr-2" />
                <span className="truncate">{r.title}</span>
                {r.subtitle && (
                  <span className="ml-auto text-xs text-muted-foreground">{r.subtitle}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {sheetResults.length > 0 && (
          <CommandGroup heading="Sheets">
            {sheetResults.map((r) => (
              <CommandItem
                key={r.id}
                value={r.id}
                onSelect={() => {
                  onPick(r);
                  onOpenChange(false);
                }}
                data-testid={`item-sheet-jump-${r.id}`}
              >
                <Layers className="w-4 h-4 mr-2" />
                <span className="truncate">{r.title}</span>
                {r.subtitle && (
                  <span className="ml-auto text-xs text-muted-foreground">{r.subtitle}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

export function useSheetJumpPaletteHotkey(setOpen: (open: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (!isCmdK) return;
      // Only intercept when the user is on the plans surface
      const onPlans =
        typeof window !== "undefined" &&
        window.location.search.includes("tab=plans");
      if (!onPlans) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    };
    // capture: true so we win against the global CommandPalette listener
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setOpen]);
}
