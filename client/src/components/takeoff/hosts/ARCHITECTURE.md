# Takeoff Workspace Hosts

This directory holds the per-area host components for the takeoff workspace.
The orchestrator (`client/src/components/TakeoffWorkspace.tsx`) owns all
state and effects; each host is a thin view layer that subscribes to its
slice of context.

## Hosts

- **RibbonHost** — top toolbar (`<TakeoffToolbar>`). Migrated.
- **PanelHost** — right-side panels and dialogs. Owns the bid-package
  export dialog plus `TakeoffSidebar`, `TakeoffDialogs`,
  `TakeoffVersionHistory`, `TakeoffCrossModulePanel`, `PlanScaleModal`,
  and (now) `IssueDetailPanel`, `<AiTakeoffPanel>` (with its drawing
  opacity wrapper), `MarkupStylingPanel` (which receives the
  hoisted `<MarkupStylingPopoverSaveButton>` as `saveButtonSlot`),
  and `TakeoffPropertiesPanel`. Migrated.
  (`TakeoffSheetCompareDialog` moved to `SheetHost` since it operates
  on sheet revisions. `WorkspaceBottomBar` and `MeasurementTablePanel`
  intentionally mount inline in the orchestrator's flex column —
  see "Bottom row" below.)
- **SheetHost** — sheet status banners (locked-version,
  detected-scale, stale-set, superseded), the full sheet-selector
  toolbar (via the `SheetSelectorBar` sub-component), the page
  thumbnail strip, and the sheet-revision compare dialog. The
  selector bar mounts `<CollabHost />` as the `collabSlot` so
  presence avatars, the working-here pill, the offline badge, and
  the new sheet-lock toggle keep their original visual position.
- **CanvasHost** — full canvas surface. Migrated. Reads
  `CanvasContextSlice` (`{ stage, viewport }`) and delegates to
  `<CanvasViewport>` for the surrounding container `<div>` plus all
  in-canvas DOM overlays (calibration banner, mobile drawing bar,
  mobile gesture guide, mobile FAB tool picker, sheet tabs bar, inner
  status bar, condition quick bar, empty state, markup text input,
  create-link panel, canvas context menu, measurement context menu,
  live cost panel, overlay opacity slider) with `<CanvasStage>` (the
  ~1,900-line Konva tree) slotted in as `stageSlot`. The orchestrator
  no longer holds canvas-surface or Stage JSX.
- **CollabHost** — DOM collaboration overlay: presence avatars,
  "X is working here" pill, offline badge, and the sheet-lock
  toggle button. Mounted by `SheetSelectorBar` via the `collabSlot`
  prop so the visual layout is preserved.

Cursors live in `CanvasHost` because they are Konva nodes; only the DOM
collaboration UI (avatars, lock state, banners) belongs to `CollabHost`.

## Context

`TakeoffWorkspaceContext.tsx` exposes per-host slice interfaces:
`RibbonContextSlice`, `SheetContextSlice`, `CanvasContextSlice`,
`PanelContextSlice`, `CollabContextSlice`. `CanvasContextSlice` is
aliased to `CanvasStageProps` so that the slice contract and the
Stage's rendering contract cannot drift.

### Render isolation

Each slice gets its own `React.createContext`. The provider nests them so
each host subscribes only to its own slice. `RibbonContextSlice`,
`SheetContextSlice`, and `CollabContextSlice` are memoized with
`useMemo`. `CanvasContextSlice` and `PanelContextSlice` are
intentionally *not* memoized — together they reference 200+ pieces of
state, refs, mutations, and handlers, and an exhaustive `useMemo`
dependency array is impractical to keep correct (a stale dep silently
freezes UI state like context menus, the mobile tool picker, or
markup edit visibility). Re-creating these two slice objects every
orchestrator render is the same cost as the pre-migration inline JSX,
which also rebuilt every render. `CanvasHost`, `CanvasViewport`,
`PanelHost`, and the panel sub-hosts remain wrapped in `React.memo` and
re-render at the same cadence as before this migration.

### No bag, no casts

`TakeoffWorkspaceContextValue` is a real interface (`{ ribbon, sheet,
canvas, panel, collab }`) — no `Record<string, unknown>` and no `as any`
in the contract. Side-effect callbacks (fit-to-page, label persistence,
etc.) are pre-bound by the orchestrator so hosts never reimplement
behavior.

## Bottom row

`WorkspaceBottomBar` (status pill, page indicator, calc-progress
toasts, the right-edge minimize/expand handle for `MeasurementTable`)
and `MeasurementTablePanel` mount inline in the orchestrator's
flex-column under `<CanvasHost>`, *not* through `<PanelHost>`. They
share the canvas's vertical layout flow (height-9 bar + height-7 collapsed
table or expanded table below the flex-1 canvas). The orchestrator
still owns the props through `panelSlice.bottomBar` and
`panelSlice.measurementTable`, so the contract remains slice-driven.

## Public surface (must not change)

- Default export `TakeoffWorkspace(props)` and its props.
- Named re-exports: `resolveCrossClassSelection`,
  `MarkupStylingPopoverSaveButton`, `saveMarkupStylingPopover`.
- `client/src/components/markups/*` is untouched.

## Status

Done (#2166):

- Ribbon, Panel, Sheet (banners + selector toolbar + thumbnail strip
  + compare dialog), Canvas (full surface: Stage + every in-canvas DOM
  overlay via `CanvasViewport`), Collab (avatars + working-here pill +
  offline badge + sheet-lock toggle), plus `WorkspaceBottomBar`,
  `MeasurementTablePanel`, `IssueDetailPanel`, `AiTakeoffPanel`,
  `MarkupStylingPanel`, and `TakeoffPropertiesPanel` are all wired
  through per-host context slices.
- `CanvasContextSlice` is `{ stage, viewport }` with `stage` aliased
  to `CanvasStageProps` so the slice contract and rendering contract
  cannot drift; `PanelContextSlice` is `{ rightRail, dialogs,
  bottomBar, measurementTable, issueDetail, aiPanel,
  markupStylingPanel, propertiesPanel }`.
- Per-slice memoization with `React.memo` + `displayName` on every
  host; orchestrator owns all state and passes pre-bound callbacks.

Out of scope for #2166: extracting the orchestrator's custom hooks
(state and effects) to drive the file below ~600 lines; that is a
follow-up that builds on this slice contract.
