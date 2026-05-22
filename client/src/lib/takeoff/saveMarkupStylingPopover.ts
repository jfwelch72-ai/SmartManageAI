// ---------------------------------------------------------------------------
// Markup styling popover save handler (Task #1772 / Task #1833)
//
// Extracted from TakeoffWorkspace.tsx so that file exports only React
// components/hooks and qualifies for Vite Fast Refresh (in-place hot-swap
// instead of full module teardown).  The async helper and its types have
// their own unit-test suites at:
//   client/src/components/__tests__/TakeoffWorkspace.recolor-panel-bulk-request.test.ts
//   client/src/components/__tests__/TakeoffWorkspace.styling-popover-bulk-save.test.tsx
// ---------------------------------------------------------------------------

export type MarkupStylingDraft = {
  color: string;
  thickness: number;
  text: string;
};

export type MarkupStylingTarget = {
  id: string;
  tool: string;
  color: string;
  thickness: number;
  text: string | null;
};

export type MarkupSnapshot = {
  id: string;
  color?: string;
  thickness?: number;
  text?: string | null;
};

export type SaveMarkupStylingPopoverArgs = {
  draft: MarkupStylingDraft;
  initial: MarkupStylingDraft;
  showTextInput: boolean;
  isMulti: boolean;
  anchor: MarkupStylingTarget;
  selectedMarkups: MarkupStylingTarget[];
  selectedSheet: string | null;
  updateMarkupMutation: {
    mutateAsync: (vars: {
      id: string;
      color?: string;
      thickness?: number;
      text?: string | null;
      previous?: { color?: string; thickness?: number; text?: string | null };
    }) => Promise<unknown>;
  };
  bulkUpdateMarkupsMutation: {
    mutateAsync: (vars: {
      updates: Array<{ id: string; color?: string; thickness?: number; text?: string | null }>;
    }) => Promise<unknown>;
  };
  takeoffHistory: {
    pushMarkupUpdateBatchAction: (
      before: MarkupSnapshot[],
      after: MarkupSnapshot[],
      sheetId: string,
    ) => void;
  };
  toast: (opts: { title: string }) => void;
  close: () => void;
};

export async function saveMarkupStylingPopover(
  args: SaveMarkupStylingPopoverArgs,
): Promise<void> {
  const {
    draft,
    initial,
    showTextInput,
    isMulti,
    anchor,
    selectedMarkups,
    selectedSheet,
    updateMarkupMutation,
    bulkUpdateMarkupsMutation,
    takeoffHistory,
    toast,
    close,
  } = args;

  const colorChanged = draft.color !== initial.color;
  const thicknessChanged = draft.thickness !== initial.thickness;
  const textChanged = showTextInput && draft.text !== initial.text;
  if (!colorChanged && !thicknessChanged && !textChanged) {
    close();
    return;
  }

  if (!isMulti) {
    const editing = anchor;
    const updates: {
      id: string;
      color?: string;
      thickness?: number;
      text?: string | null;
      previous?: { color?: string; thickness?: number; text?: string | null };
    } = { id: editing.id };
    const previous: { color?: string; thickness?: number; text?: string | null } = {};
    if (colorChanged) {
      updates.color = draft.color;
      previous.color = editing.color;
    }
    if (thicknessChanged && editing.tool !== "TEXT") {
      updates.thickness = draft.thickness;
      previous.thickness = editing.thickness;
    }
    if (textChanged && editing.tool === "TEXT") {
      updates.text = draft.text;
      previous.text = editing.text ?? "";
    }
    if (Object.keys(updates).length === 1) {
      close();
      return;
    }
    updates.previous = previous;
    try {
      await updateMarkupMutation.mutateAsync(updates);
      toast({ title: "Markup updated" });
      close();
    } catch (err) {
      console.warn("[Takeoff] Failed to update markup:", err);
    }
    return;
  }

  const beforeSnaps: MarkupSnapshot[] = [];
  const afterSnaps: MarkupSnapshot[] = [];
  const bulkUpdates: Array<{ id: string; color?: string; thickness?: number; text?: string | null }> = [];
  for (const m of selectedMarkups) {
    const before: MarkupSnapshot = { id: m.id };
    const after: MarkupSnapshot = { id: m.id };
    const updateFields: { color?: string; thickness?: number; text?: string | null } = {};
    let hasChange = false;
    if (colorChanged && m.color !== draft.color) {
      before.color = m.color;
      after.color = draft.color;
      updateFields.color = draft.color;
      hasChange = true;
    }
    // Skip thickness on TEXT members — they have no stroke.
    if (thicknessChanged && m.tool !== "TEXT" && m.thickness !== draft.thickness) {
      before.thickness = m.thickness;
      after.thickness = draft.thickness;
      updateFields.thickness = draft.thickness;
      hasChange = true;
    }
    // Bulk text edit only for TEXT members; each member's before snapshot
    // keeps its individual prior label so Undo restores them independently.
    if (textChanged && m.tool === "TEXT" && (m.text ?? "") !== draft.text) {
      before.text = m.text ?? "";
      after.text = draft.text;
      updateFields.text = draft.text;
      hasChange = true;
    }
    if (!hasChange) continue;
    beforeSnaps.push(before);
    afterSnaps.push(after);
    bulkUpdates.push({ id: m.id, ...updateFields });
  }
  if (bulkUpdates.length === 0) {
    close();
    return;
  }
  // Capture the sheet id before awaiting so a sheet switch mid-flight
  // can't push the history batch into the wrong sheet.
  const sheetIdForBatch = selectedSheet;
  try {
    await bulkUpdateMarkupsMutation.mutateAsync({ updates: bulkUpdates });
  } catch (err) {
    console.warn("[Takeoff] Failed to bulk-update markups:", err);
    return;
  }
  if (sheetIdForBatch) {
    takeoffHistory.pushMarkupUpdateBatchAction(beforeSnaps, afterSnaps, sheetIdForBatch);
  }
  toast({ title: `Updated ${bulkUpdates.length} markups` });
  close();
}
