# Takeoff Workspace — Interaction Map

> Authoritative interaction contract for Task #2065 (Beat Bluebeam, StackCT &
> Procore on Plans + Takeoff). Every later step in the initiative refers back
> here. When changing a binding, change this doc in the same PR so the
> contract and code never drift.

This map is intentionally implementation-agnostic. The unified ribbon, the
Tool Chest, and the canvas controller all consume it; none of them owns it.

---

## 1. Ribbon contract

> **Status:** Implemented (Task #2137) for the standalone Takeoff workspace at
> `/takeoff/:bidCode` and `/takeoff/project/:projectCode`. The legacy
> `TakeoffToolbar` / `RibbonHost` path remains in place for the embedded
> bid-detail and project-detail tabs until those routes migrate.

The unified ribbon replaces the legacy floating toolbar + secondary tool bar.
It exposes one logical group per workflow:

| Group        | Purpose                                       | Tools (canonical order)                                              |
| ------------ | --------------------------------------------- | -------------------------------------------------------------------- |
| Select       | Pointer + selection lasso                     | `select`, `lasso`, `pan`                                             |
| Measure      | Length / area / volume / count                | `linear`, `polyline`, `area`, `polygon`, `arc`, `circle`, `count`    |
| Annotate     | Notes + dimension callouts                    | `note`, `dimension`, `arrow`, `cloud`                                |
| Snap         | Inference modes (toggle-on, multi-select)     | `endpoint`, `midpoint`, `intersection`, `perpendicular`, `center`, `nearest`, `grid` |
| Constrain    | Modal constraint locks (radio)                | `none`, `ortho`, `ortho-angle`, `polar`                              |
| Verify       | Calibration + cross-check                     | `calibrate`, `verify-scale`, `dim-input`                             |
| View         | Layers / overlays                             | `layers`, `overlay`, `versions`, `show-grid`                         |

Rules:
- Each group is collapsible and remembers its open state per user.
- Tools that are unavailable in the current sheet context are *visible but
  disabled*, never hidden, so muscle memory survives.
- The ribbon is keyboard-traversable: `Tab` moves group → group, `←/→` moves
  tool → tool inside a group, `Enter` activates.

---

## 2. Single-key shortcuts

> **Status:** Implemented (Task #2137). `D` (Dimension callout) is currently
> a no-op stub — the keypress is consumed so `D` never falls through to
> browser shortcuts, but the dimension tool itself ships in Step 5.

Single-letter activates a tool. Hold `Shift` to add it to the active set
(snap modes are multi-select; constraints are radio).

| Key   | Action                              | Notes                                                  |
| ----- | ----------------------------------- | ------------------------------------------------------ |
| `V`   | Select / pointer                    |                                                        |
| `H`   | Pan / hand                          | Hold `Space` for momentary pan.                        |
| `L`   | Linear measurement                  |                                                        |
| `P`   | Polyline                            |                                                        |
| `A`   | Area / polygon                      | Press again to switch between rectangle/polygon.       |
| `R`   | Arc                                 |                                                        |
| `C`   | Count                               |                                                        |
| `N`   | Note                                |                                                        |
| `D`   | Dimension callout                   |                                                        |
| `T`   | Calibrate / set scale               | Inline calibration drawer.                             |
| `O`   | Toggle ortho                        | Single-key toggle, not modal.                          |
| `Shift+O` | Cycle ortho preset angle        | 15° → 30° → 45° → 90° → off.                           |

| `G`   | Toggle grid snap                    |                                                        |
| `S`   | Open snap-mode menu                 | Then `1`–`7` toggles individual modes.                 |
| `Esc` | Cancel current draw / clear focus   |                                                        |
| `Enter` | Commit current draw               | Auto-closes polygons.                                  |
| `Backspace` | Drop last vertex              |                                                        |
| `[` / `]` | Previous / next sheet           | `Shift` adds to selection (Sheet Sets).                |
| `,` / `.` | Previous / next version         | When version overlay is on.                            |
| `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` | Undo / redo |                                                        |
| `Cmd/Ctrl+D` | Duplicate selected markups     |                                                        |
| `Cmd/Ctrl+/` | Open shortcut cheat-sheet      |                                                        |

Reserved (do not bind): `F1`–`F12`, browser navigation modifiers, OS
shortcuts.

---

## 3. Snap modes (Step 4)

> **Status:** Implemented (Task #2137) for the snap *contract* — the seven
> mode IDs, their canonical order, the multi-select semantics, the per-user
> persistence, the `S` HUD entry point with `1`–`7` toggles, and the ribbon
> Snap group all ship in this task. The actual target-generator engine (the
> mathematics that turns "endpoint enabled" into a screen-space candidate)
> is Step 4 and tracked separately.

A snap mode is a *target generator*. The canvas controller asks the snap
engine for all enabled targets, then chooses the nearest one within the snap
radius (in screen pixels, scaled by zoom).

| Mode          | Target generator                                                    |
| ------------- | ------------------------------------------------------------------- |
| Endpoint      | First/last vertex of every visible markup.                          |
| Midpoint      | Midpoint of every visible segment.                                  |
| Intersection  | Pairwise intersection of segments from different markups.           |
| Perpendicular | Foot of perpendicular from active anchor onto nearest segment.      |
| Center        | Centroid of every closed polygon; center of arcs/circles.           |
| Nearest       | Closest point on any visible segment.                               |
| Grid          | Nearest grid intersection at the configured spacing.                |

Default snap radius: **12 px** at 100 % zoom; auto-scales with zoom.

---

## 4. Typed-dimension input (Step 5) — Implemented (Task #2140)

When a draw is in progress and the user starts typing, the ribbon's
**Dim Input HUD** captures focus. Implemented as `DimInputHUD`
mounted inside the Measure ribbon group; the parser lives at
`client/src/lib/takeoffTypedInput.ts` and is unit-tested at
`client/src/lib/__tests__/takeoffTypedInput.test.ts`.

Grammar (case-insensitive, all whitespace optional):

```
length        := number unit?
unit          := 'ft' | "'" | 'in' | '"' | 'm' | 'cm' | 'mm'
feet-inches   := number "'" number? '"'?              ; e.g. 12'6"
angle-suffix  := '<' number ('°')?                    ; e.g. <45
typed-input   := length | feet-inches
              [ angle-suffix ]
              [ ',' length ]                          ; second value = explicit Y
```

Examples:

| Input       | Effect                                                  |
| ----------- | ------------------------------------------------------- |
| `12`        | Lock segment length to 12 ft along current direction.   |
| `12'6"`     | Lock segment length to 12 ft 6 in.                      |
| `12<30`     | 12 ft at 30° from anchor.                               |
| `12,6`      | Δx = 12 ft, Δy = 6 ft (signs follow current quadrant).  |
| `Tab`       | Commit; remain in draw to chain another segment.        |
| `Enter`     | Commit and finish the markup.                           |

Ortho preset angles (Step 5): **15°, 30°, 45°, 90°**. `Shift+O` cycles;
the active preset clamps the cursor angle to the nearest multiple before
typed input is applied. The current preset is shown as a badge in the
Constrain ribbon group (`ribbon-ortho-preset` test id) and persisted
alongside the other ribbon prefs.

Tab vs. Enter semantics:

| Key   | Effect                                                      |
| ----- | ----------------------------------------------------------- |
| `Tab` | Append the parsed point to `drawingPoints` and keep drawing. |
| `Enter` | Append, then synthesise an Enter keypress so the existing draw-finish handler closes the polygon / commits the linear / saves the segment. |
| `Esc` | Clears the HUD buffer (one keypress). A second `Esc` (with empty buffer) cancels the entire draw via the legacy handler. |

---

## 5. Inline scale calibration (Step 6) — Implemented (Task #2140)

- `T` opens `InlineCalibrationDrawer` (a side-anchored shadcn `Sheet`)
  over the current sheet. The drawer **does not trap focus** so the
  canvas remains clickable for the two-point pick.
- User picks two reference points; types the real distance using the
  Section 4 typed-input grammar. Live parse errors and a preview
  `px/ft` value are shown beneath the input.
- Multi-region capture (`Add region` button) is preserved; existing
  multi-calib state lives in `TakeoffWorkspace` and stays in sync
  with the sidebar's region list.
- A `Use Standard Scale` link opens the existing `PlanScaleModal`
  for users who'd rather pick a known ratio (e.g. `1/4" = 1'-0"`)
  instead of drawing a calibration line.
- Optional checkbox: **Apply to entire Sheet Set**. **Disabled** in
  this task with a "Coming soon" badge — the Sheet Sets task
  (Step 12) will flip the feature flag and wire the propagation.

---

## 6. Tool Chest (Step 7)

A user-pinned shelf of frequently-used tools / conditions / assemblies.

- Per-user; an item can be marked `shared` to expose it to the whole org.
- Drag from the chest onto the canvas to start drawing with that
  tool/condition pre-selected.
- Items have a sort order; reordering is local-first then synced.

---

## 7. Mobile / stylus precision

| Gesture                    | Action                                       |
| -------------------------- | -------------------------------------------- |
| Single-finger drag         | Pan                                          |
| Two-finger pinch           | Zoom                                         |
| Two-finger rotate          | Rotate sheet (only when explicitly enabled). |
| Stylus tap                 | Place point / activate tool                  |
| Stylus long-press          | Open snap-mode HUD                           |
| Palm-rejection band (24px) | Ignore touches whose contact area > stylus.  |

---

## 8. Versioning, performance, autosave

> **Status:** Implemented (Task #2137) for the *autosave indicator* and the
> `,` / `.` keybindings — the unified ribbon now surfaces an
> offline / syncing / pending-count chip driven by the IndexedDB outbox, and
> the version cycle keys are reserved and routed (no-op when the version
> overlay is off). The tile renderer (Step 8) and the version overlay
> itself (Step 9) remain owned by their respective tasks.

- **Version overlay** (Step 9): `,` / `.` cycle versions; the canvas
  controller always merges the active version's transform with the live
  draw.
- **Heavy-project rendering** (Step 8 — **Implemented**, Task #2138):
  - Architecture: a tile-based PDF renderer that owns `pdfjs` inside a
    dedicated worker (`client/src/workers/pdfTileWorker.ts`). The main
    thread never imports `pdfjs-dist`; it sends typed messages for
    `getPageDims`, `renderPlaceholder`, `renderTile`, `getTextItems`,
    `renderThumbnail`, and `evictSheet`, and receives `ImageBitmap`s
    transferred zero-copy. This keeps sheet switches and zoom changes
    off the main thread (the controller animates Konva at the same
    cadence regardless of what pdfjs is doing).
  - Tile contract (`client/src/lib/takeoff/tileCoords.ts`):
    - `TILE_SIZE_PX = 512`, `BASE_RENDER_SCALE = 1.5`.
    - Zoom buckets: `[0.25, 0.5, 1, 2, 4]`. The renderer picks the
      smallest bucket whose pixel density meets the current
      `stageScale`, then crossfades to the next bucket as the user
      zooms in/out so there is no resolution pop.
    - **World coordinates are unchanged.** Markup, measurement, snap,
      and calibration math still operate against the page rendered at
      `BASE_RENDER_SCALE`. The KonvaImage that fronts the placeholder
      is stretched to `pageDims.{width,height}` so a tile at any bucket
      ends up in the same world-space rectangle calibration recorded.
  - LRU cache (`client/src/lib/takeoff/tileCache.ts`): byte-budgeted at
    ~600 MB by default (`MAX_TILE_CACHE_BYTES_DEFAULT`), 4 bytes/pixel
    estimate per tile. Evictions call `ImageBitmap.close()` so GPU
    memory is returned. `invalidateSheet()` is fired when a sheet is
    deleted/replaced.
  - Scheduler (`client/src/lib/takeoff/tileScheduler.ts`): worker pool
    sized at `min(navigator.hardwareConcurrency, 4)` with a
    distance-from-viewport-center priority queue, so what the user is
    looking at draws first. On viewport / sheet change the scheduler
    not only prunes the queue but posts `cancelTile` to the worker so
    `RenderTask.cancel()` aborts any in-flight pdfjs render that no
    longer matters — fast pans no longer burn CPU on stale tiles.
  - Hook (`client/src/hooks/use-pdf-tile-renderer.ts`) is the single
    owner of the placeholder bitmap; `TakeoffWorkspace` mirrors it into
    `pdfImage` via an effect so there is exactly one 0.25× worker
    render per sheet (no double-paint with the workspace). Tile
    arrivals are RAF-coalesced into one re-render per frame instead of
    one re-render per resolved tile.
  - Rotation: tile coords live in page-native (pre-rotation) space
    because pdfjs renders the page natively and CanvasStage applies
    the rotation on a wrapping `<Group>`. Stage-world viewport rects
    are mapped back through `sheetRotation` via
    `rotateViewportToPageNative` before being handed to the scheduler,
    so 90/180/270° sheets pick the correct tile set (no missing or
    misaligned high-res tiles).
  - Feature flag: **`takeoff_tile_renderer`** — default **on**. Toggle
    via `localStorage["takeoff_tile_renderer"] = "off"` or
    `window.__TAKEOFF_TILE_RENDERER__ = false` for the escape-hatch
    fallback (a single full-resolution worker render per sheet, no tile
    streaming, no zoom-bucket crossfade). The flag also auto-disables
    when `Worker` or `OffscreenCanvas` are unavailable. Per task
    constraint, **pdfjs always runs in the worker** — both paths route
    through `pdfTileWorker.ts`; the flag controls only whether tile
    streaming is on top of that. Flag plumbing lives in
    `client/src/lib/takeoff/tileRendererFlag.ts`; both code paths
    coexist so a regression can be flipped without a deploy. If the
    runtime exposes no `Worker` at all the workspace surfaces an error
    state instead of silently breaking calibration.
  - Perf budget (Playwright harness
    `e2e/takeoff-tile-renderer-perf.spec.ts`): a 300+ sheet civil
    planset must hold p95 frame time < 33 ms (>30 fps) during pan/zoom
    and complete a sheet switch in < 250 ms median, with no main-thread
    task > 100 ms. Budget violations fail CI.
- **Offline autosave** (Step 11): every committed mutation goes into an
  IndexedDB outbox. The canvas controller publishes a `pending` count for
  the ribbon to surface.

---

## 9. Open questions / future bindings

- Cost strip (Step 14) keybinding — TBD; reserve `B` for "billable preview".
- Send-to-Estimate (Step 15) — TBD; reserve `E`.
- Drawing version diff brush (Step 9) — TBD; reserve `Shift+,` / `Shift+.`.

When binding any of the above, update Sections 2 and 9 here in the same PR.
