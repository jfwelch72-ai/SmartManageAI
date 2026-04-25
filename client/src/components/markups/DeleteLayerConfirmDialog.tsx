/**
 * Task #1878 — Themed delete-layer warning shared by every spot that
 * can delete a non-default markup layer with markups still on it.
 *
 * Replaces the browser's native `window.confirm()` in
 * `MarkupLayersPanel` so the prompt matches the rest of the UI and is
 * keyboard-/screen-reader-accessible. Mirrors the
 * `useDuplicateLayerCopyConfirm` hook so both layer-panel decisions
 * share a single shape.
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

export interface DeleteLayerConfirmRequest {
  /** User-visible name of the layer being deleted. */
  layerName: string;
  /** How many markups currently live on the layer. Always > 0 when
   *  the dialog is shown — empty layers delete without prompting. */
  markupCount: number;
}

interface PendingRequest extends DeleteLayerConfirmRequest {
  resolve: (accepted: boolean) => void;
}

export interface UseDeleteLayerConfirmResult {
  /** Render this once near the consumer; it owns the dialog state. */
  dialog: JSX.Element;
  /** Open the dialog. Resolves true if the user accepts, false on
   *  cancel/dismiss. Safe to call repeatedly — concurrent calls are
   *  serialised so the previous prompt is auto-cancelled. */
  confirm: (req: DeleteLayerConfirmRequest) => Promise<boolean>;
}

export function useDeleteLayerConfirm(): UseDeleteLayerConfirmResult {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  // Mirror the latest pending request in a ref so the open-change
  // handler can resolve the right promise without going stale across
  // renders.
  const pendingRef = useRef<PendingRequest | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback(
    (req: DeleteLayerConfirmRequest) =>
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
  const markupCount = pending?.markupCount ?? 0;

  const dialog = (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close(false);
      }}
    >
      <AlertDialogContent data-testid="dialog-delete-layer">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete layer?</AlertDialogTitle>
          <AlertDialogDescription data-testid="text-delete-layer-message">
            {`Delete layer "${layerName}"? Its ${markupCount} ` +
              `markup${markupCount === 1 ? "" : "s"} will move to the ` +
              `default layer.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => close(false)}
            data-testid="button-delete-layer-cancel"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => close(true)}
            data-testid="button-delete-layer-confirm"
          >
            Delete layer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { dialog, confirm };
}
