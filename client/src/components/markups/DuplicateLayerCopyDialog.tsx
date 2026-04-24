/**
 * Task #1853 — Themed duplicate-copy warning shared by every spot
 * that can create a "(copy)" layer on a sibling sheet.
 *
 * Replaces the browser's native `window.confirm()` with the app's
 * AlertDialog so the prompt matches the rest of the UI and is
 * keyboard-/screen-reader-accessible.
 *
 * Used by both `MarkupLayersPanel` (the picker) and
 * `PageThumbnailStrip` (the drag-to-copy path) so future tweaks to
 * the wording or behaviour live in one place.
 */
import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface DuplicateLayerCopyConfirmRequest {
  /** User-visible name of the source layer being copied. */
  layerName: string;
  /** Label of the destination sheet (e.g. its title or fileName). */
  destinationLabel: string;
  /** How many "(copy)" layers derived from this source already exist
   *  on the destination. Always > 0 when the dialog is shown. */
  existingCount: number;
}

interface PendingRequest extends DuplicateLayerCopyConfirmRequest {
  resolve: (accepted: boolean) => void;
}

export interface UseDuplicateLayerCopyConfirmResult {
  /** Render this once near the consumer; it owns the dialog state. */
  dialog: JSX.Element;
  /** Open the dialog. Resolves true if the user accepts, false on
   *  cancel/dismiss. Safe to call repeatedly — concurrent calls are
   *  serialised so the previous prompt is auto-cancelled. */
  confirm: (req: DuplicateLayerCopyConfirmRequest) => Promise<boolean>;
}

export function useDuplicateLayerCopyConfirm(): UseDuplicateLayerCopyConfirmResult {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  // Mirror the latest pending request in a ref so the open-change
  // handler can resolve the right promise without going stale across
  // renders.
  const pendingRef = useRef<PendingRequest | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback(
    (req: DuplicateLayerCopyConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        // If a previous prompt is still open, treat opening a new one
        // as an implicit cancel of the old one so its caller doesn't
        // hang forever.
        const prev = pendingRef.current;
        if (prev) prev.resolve(false);
        setPending({ ...req, resolve });
      }),
    [],
  );

  const close = useCallback((accepted: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    current.resolve(accepted);
    setPending(null);
  }, []);

  const open = pending !== null;
  const layerName = pending?.layerName ?? "";
  const destinationLabel = pending?.destinationLabel ?? "";
  const existingCount = pending?.existingCount ?? 0;

  const dialog = (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close(false);
      }}
    >
      <AlertDialogContent data-testid="dialog-duplicate-layer-copy">
        <AlertDialogHeader>
          <AlertDialogTitle>Create another copy?</AlertDialogTitle>
          <AlertDialogDescription data-testid="text-duplicate-layer-copy-message">
            {`"${destinationLabel}" already has ${existingCount} ` +
              `cop${existingCount === 1 ? "y" : "ies"} of "${layerName}". ` +
              `Create another copy anyway?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => close(false)}
            data-testid="button-duplicate-layer-copy-cancel"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => close(true)}
            data-testid="button-duplicate-layer-copy-confirm"
          >
            Create another copy
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { dialog, confirm };
}
