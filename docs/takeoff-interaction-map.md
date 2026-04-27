# Takeoff Workspace — Interaction Map

> Authoritative interaction contract for Task #2065 (Beat Bluebeam, StackCT &
> Procore on Plans + Takeoff). Every later step in the initiative refers back
> here. When changing a binding, change this doc in the same PR so the
> contract and code never drift.

This map is intentionally implementation-agnostic. The unified ribbon, the
Tool Chest, and the canvas controller all consume it; none of them owns it.

---

## 1. Ribbon contract

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

## 4. Typed-dimension input (Step 5)

When a draw is in progress and the user starts typing, the ribbon's
**Dim Input HUD** captures focus.

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
typed input is applied.

---

## 5. Inline scale calibration (Step 6)

- `T` opens the calibration drawer over the current sheet.
- User picks two reference points; types the real distance using the typed
  input grammar above.
- Optional checkbox: **Apply to entire Sheet Set**. When checked, the new
  scale is propagated to every member sheet via the Sheet Sets API
  (Step 12).

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

- **Version overlay** (Step 9): `,` / `.` cycle versions; the canvas
  controller always merges the active version's transform with the live
  draw.
- **Heavy-project rendering** (Step 8): tile renderer + worker; controller
  must not assume synchronous draw.
- **Offline autosave** (Step 11): every committed mutation goes into an
  IndexedDB outbox. The canvas controller publishes a `pending` count for
  the ribbon to surface.

---

## 9. Open questions / future bindings

- Cost strip (Step 14) keybinding — TBD; reserve `B` for "billable preview".
- Send-to-Estimate (Step 15) — TBD; reserve `E`.
- Drawing version diff brush (Step 9) — TBD; reserve `Shift+,` / `Shift+.`.

When binding any of the above, update Sections 2 and 9 here in the same PR.
