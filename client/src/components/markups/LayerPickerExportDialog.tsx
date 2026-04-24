/**
 * Task #1703 — Layer-pick dialog launched from the Plans tab's
 * "Download PDF (with markups) → By layer..." menu entry.
 *
 * Reads the document's named layers from
 * `/api/plan-documents/:docId/markup-layers`, lets the user toggle
 * each one (with a Select all / none affordance), and opens
 * `/api/plan-documents/:docId/export.pdf?includeMarkups=true&layerIds=<csv>`
 * in a new tab when the user confirms.
 *
 * The auto-created Default layer is identified in the URL by the
 * `__default__` sentinel rather than its real UUID — this matches the
 * print page's mapping and also captures legacy null-layer markups.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LayerRow {
  id: string;
  planDocumentId: string;
  name: string;
  color: string;
  sortOrder: number;
  isDefault: boolean;
  isVisible: boolean;
  markupCount: number;
}

export const DEFAULT_LAYER_SENTINEL = "__default__";

export interface LayerPickerExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** plan_documents.id of the sheet to export. Null closes the dialog. */
  documentId: string | null;
  /** Optional file/title label shown in the dialog header. */
  documentLabel?: string;
}

/** Stable URL identifier for a layer — default layer collapses to the
 *  `__default__` sentinel so the print page also picks up legacy
 *  null-layer markups. */
function urlIdForLayer(l: LayerRow): string {
  return l.isDefault ? DEFAULT_LAYER_SENTINEL : l.id;
}

export default function LayerPickerExportDialog({
  open,
  onOpenChange,
  documentId,
  documentLabel,
}: LayerPickerExportDialogProps) {
  const layersQueryKey = useMemo(
    () => ["/api/plan-documents", documentId ?? "", "markup-layers"] as const,
    [documentId],
  );

  const {
    data: layers = [],
    isLoading,
    error,
  } = useQuery<LayerRow[]>({
    queryKey: layersQueryKey,
    queryFn: async () => {
      if (!documentId) return [];
      const r = await fetch(
        `/api/plan-documents/${encodeURIComponent(documentId)}/markup-layers`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error(`Failed to load layers (HTTP ${r.status})`);
      return r.json();
    },
    enabled: open && !!documentId,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Default to "all selected" each time the dialog opens with a fresh
  // document, or when the layer list finishes loading. We key on
  // documentId + layer-set identity to avoid clobbering the user's
  // pick during a single open session.
  const [primedKey, setPrimedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setPrimedKey(null);
      return;
    }
    if (!documentId || isLoading) return;
    const key = `${documentId}::${layers.map((l) => l.id).join(",")}`;
    if (key !== primedKey) {
      setSelected(new Set(layers.map(urlIdForLayer)));
      setPrimedKey(key);
    }
  }, [open, documentId, isLoading, layers, primedKey]);

  const allUrlIds = useMemo(() => layers.map(urlIdForLayer), [layers]);
  const allSelected =
    allUrlIds.length > 0 && allUrlIds.every((id) => selected.has(id));
  const noneSelected = allUrlIds.every((id) => !selected.has(id));

  const toggle = (urlId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(urlId)) next.delete(urlId);
      else next.add(urlId);
      return next;
    });
  };

  const setAll = (on: boolean) => {
    setSelected(on ? new Set(allUrlIds) : new Set());
  };

  const handleExport = () => {
    if (!documentId) return;
    const csv = Array.from(selected).join(",");
    const params = new URLSearchParams({
      includeMarkups: "true",
      layerIds: csv,
    });
    window.open(
      `/api/plan-documents/${encodeURIComponent(documentId)}/export.pdf?${params.toString()}`,
      "_blank",
      "noopener",
    );
    onOpenChange(false);
  };

  const canExport = !!documentId && !isLoading && selected.size > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-layer-picker-export">
        <DialogHeader>
          <DialogTitle>Choose layers to print</DialogTitle>
          <DialogDescription>
            {documentLabel
              ? `Select which markup layers to include in the exported PDF for ${documentLabel}.`
              : "Select which markup layers to include in the exported PDF."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid="text-layer-picker-count">
            {selected.size} of {layers.length} selected
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="underline-offset-2 hover:underline disabled:opacity-50"
              onClick={() => setAll(true)}
              disabled={isLoading || allSelected || layers.length === 0}
              data-testid="button-layer-picker-select-all"
            >
              Select all
            </button>
            <span aria-hidden>·</span>
            <button
              type="button"
              className="underline-offset-2 hover:underline disabled:opacity-50"
              onClick={() => setAll(false)}
              disabled={isLoading || noneSelected}
              data-testid="button-layer-picker-select-none"
            >
              Select none
            </button>
          </div>
        </div>

        <ScrollArea className="max-h-[40vh] pr-2">
          {isLoading ? (
            <div
              className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
              data-testid="status-layer-picker-loading"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading layers…
            </div>
          ) : error ? (
            <div
              className="py-6 text-sm text-destructive"
              data-testid="status-layer-picker-error"
            >
              Could not load layers: {(error as Error).message}
            </div>
          ) : layers.length === 0 ? (
            <div
              className="py-6 text-sm text-muted-foreground"
              data-testid="status-layer-picker-empty"
            >
              No layers found for this sheet.
            </div>
          ) : (
            <ul className="flex flex-col gap-1 py-1">
              {layers.map((l) => {
                const urlId = urlIdForLayer(l);
                const checkboxId = `layer-picker-${l.id}`;
                const checked = selected.has(urlId);
                return (
                  <li key={l.id}>
                    <Label
                      htmlFor={checkboxId}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer"
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={checked}
                        onCheckedChange={() => toggle(urlId)}
                        data-testid={`checkbox-layer-${l.id}`}
                      />
                      <span
                        aria-hidden
                        className="inline-block w-3 h-3 rounded-sm border border-border shrink-0"
                        style={{ backgroundColor: l.color }}
                      />
                      <span className="flex-1 truncate text-sm" data-testid={`text-layer-name-${l.id}`}>
                        {l.name}
                        {l.isDefault ? (
                          <span className="ml-1 text-xs text-muted-foreground">(default)</span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {l.markupCount}
                      </span>
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-layer-picker-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={!canExport}
            data-testid="button-layer-picker-export"
          >
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
