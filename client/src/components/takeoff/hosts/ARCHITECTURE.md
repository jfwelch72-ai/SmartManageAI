# Takeoff Workspace Hosts

This directory holds the per-area host components for the takeoff workspace.
The orchestrator (`client/src/components/TakeoffWorkspace.tsx`) owns all
state and effects; each host is a thin view layer that subscribes to its
slice of context.

## Hosts

- **RibbonHost** — top toolbar (`<TakeoffToolbar>`). Migrated.
- **PanelHost** — right-side panels and dialogs. Owns the bid-package
  export dialog plus `TakeoffSidebar`, `TakeoffDialogs`,
  `TakeoffVersionHistory`, `TakeoffSheetCompareDialog`,
  `TakeoffCrossModulePanel`, and `PlanScaleModal`. Migrated.
- **SheetHost** — sheet status banners (locked-version,
  detected-scale, stale-set, superseded). Migrated. The full sheet
  selector toolbar still lives in the orchestrator; migration tracked
  on follow-up #2166.
- **CanvasHost** — Konva `Stage` and overlays. Migrated. Owns the
  PDF backdrop, drawing overlay, measurement geometry, markups,
  sheet-link rectangles, AI overlays, gridlines, issue pins, and
  collab cursors. Reads the entire `CanvasContextSlice` and renders
  `<CanvasStage>` (which holds the ~1,900-line Konva tree). The
  orchestrator no longer holds Stage JSX.
- **CollabHost** — DOM collaboration overlay: presence avatars,
  "X is working here" pill, and offline badge. Migrated. Rendered
  inline inside the sheet-selector toolbar's flex row so the layout
  is preserved exactly. The sheet-lock toggle button stays with the
  sheet selector toolbar (it acts on the active sheet and lives next
  to it visually); it will join CollabHost when the sheet selector
  toolbar migrates to SheetHost (follow-up #2166).

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
each host subscribes only to its own slice. The orchestrator memoizes
each slice independently with `useMemo`, so a state change confined to
one slice does not change the `Provider value` of any other slice — and
hosts subscribed to other slices do not rerender.

### No bag, no casts

`TakeoffWorkspaceContextValue` is a real interface (`{ ribbon, sheet,
canvas, panel, collab }`) — no `Record<string, unknown>` and no `as any`
in the contract. Side-effect callbacks (fit-to-page, label persistence,
etc.) are pre-bound by the orchestrator so hosts never reimplement
behavior.

## Public surface (must not change)

- Default export `TakeoffWorkspace(props)` and its props.
- Named re-exports: `resolveCrossClassSelection`,
  `MarkupStylingPopoverSaveButton`, `saveMarkupStylingPopover`.
- `client/src/components/markups/*` is untouched.

## Status

- Done: Ribbon, Panel, Sheet (banners), Canvas (Stage), and Collab
  hosts all wired through context; `CanvasContextSlice` aliased to
  `CanvasStageProps`; per-slice memoization with `React.memo` +
  `displayName` on every host.
- Remaining (#2166): sheet-selector toolbar migration to SheetHost;
  custom-hook extraction from orchestrator; orchestrator-size
  reduction toward the ~600-line target.
