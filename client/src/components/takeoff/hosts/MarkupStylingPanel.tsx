import { memo, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MARKUP_TOOLBAR_THICKNESSES } from "@/components/markups/PlanMarkupToolbar";
import type { MarkupShape } from "@/components/markups/MarkupRenderer";

export interface MarkupStylingPanelDraft {
  text: string;
  color: string;
  thickness: number;
}

export interface MarkupStylingPanelProps {
  visible: boolean;
  isMulti: boolean;
  selectedCount: number;
  showTextInput: boolean;
  showThicknessInput: boolean;
  isHighlight: boolean;
  draft: MarkupStylingPanelDraft;
  onChangeDraft: (draft: MarkupStylingPanelDraft) => void;
  onClose: () => void;
  /** Single-select delete (shown when isMulti=false). */
  onDeleteSingle: () => void;
  /** Bulk-select delete (shown when isMulti=true). */
  onDeleteBulk: () => void;
  bulkDeletePending: boolean;
  /** Save button is supplied as a slot so the orchestrator can pass the
   *  exported `MarkupStylingPopoverSaveButton` (its disabled/loading
   *  state is locked to BOTH the single + bulk update mutations and the
   *  surrounding tests assert the exact wiring). */
  saveButtonSlot: ReactNode;
}

function MarkupStylingPanelInner(props: MarkupStylingPanelProps) {
  if (!props.visible) return null;
  const {
    isMulti, selectedCount, showTextInput, showThicknessInput, isHighlight,
    draft, onChangeDraft, onClose, onDeleteSingle, onDeleteBulk,
    bulkDeletePending, saveButtonSlot,
  } = props;
  return (
    <div
      className="absolute top-16 right-3 z-50 bg-card border rounded-lg shadow-lg p-3 w-64 space-y-3"
      data-testid="panel-markup-properties"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" data-testid="text-markup-edit-header">
          {isMulti ? `Edit ${selectedCount} markups` : "Edit markup"}
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} data-testid="button-close-markup-properties">
          <X className="w-4 h-4" />
        </Button>
      </div>
      {showTextInput && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Label</label>
          <Input
            value={draft.text}
            onChange={(e) => onChangeDraft({ ...draft, text: e.target.value })}
            data-testid="input-markup-text"
          />
        </div>
      )}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Color</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={draft.color}
            onChange={(e) => onChangeDraft({ ...draft, color: e.target.value })}
            className="h-8 w-12 cursor-pointer rounded border"
            data-testid="input-markup-color"
          />
          <span className="text-xs font-mono">{draft.color}</span>
        </div>
      </div>
      {showThicknessInput && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{isHighlight ? "Border thickness" : "Thickness"}: {draft.thickness}px</label>
          <div className="flex items-center gap-1" data-testid="input-markup-thickness">
            {MARKUP_TOOLBAR_THICKNESSES.map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={draft.thickness === t ? "default" : "ghost"}
                className="h-7 w-7 p-0"
                onClick={() => onChangeDraft({ ...draft, thickness: t })}
                aria-label={`Thickness ${t}`}
                aria-pressed={draft.thickness === t}
                data-testid={`button-markup-thickness-${t}`}
              >
                <span style={{ fontSize: 10 }}>{t}px</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        {!isMulti ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={onDeleteSingle}
            data-testid="button-delete-markup"
          >
            Delete
          </Button>
        ) : (
          // Task #1832 — Multi-select delete now collapses N parallel
          // per-id `deleteMarkupMutation` calls into one bulk DELETE
          // round-trip. The server runs the removal in a transaction
          // so a mid-flight failure rolls back atomically (no
          // half-deleted group). Disabled while the bulk request is
          // in flight to keep accidental double-clicks from racing
          // against the optimistic cache strip.
          <Button
            variant="destructive"
            size="sm"
            disabled={bulkDeletePending}
            onClick={onDeleteBulk}
            data-testid="button-delete-markups-bulk"
          >
            {bulkDeletePending
              ? "Deleting..."
              : `Delete ${selectedCount} markups`}
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-markup-edit">Cancel</Button>
          {saveButtonSlot}
        </div>
      </div>
    </div>
  );
}

export const MarkupStylingPanel = memo(MarkupStylingPanelInner);
MarkupStylingPanel.displayName = "MarkupStylingPanel";

export type { MarkupShape };
