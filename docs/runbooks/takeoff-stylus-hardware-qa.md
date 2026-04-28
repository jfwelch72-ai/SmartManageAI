# Takeoff — Mobile / Stylus Hardware QA

This runbook is the human-driven half of Task #2206. The unit tests and
the desktop preview already cover the *contract* of the mobile/stylus
precision pass shipped in Task #2142; what they cannot cover is whether
the **default tuning** (palm-band 24 px, long-press 500 ms,
narrow-viewport collapsed groups) actually feels right with a real
Apple Pencil resting on glass or a Surface Pen scribbling on Edge.

You need ~15 minutes per device. Run it on:

1. **iPad Pro + Apple Pencil** — Safari and Chrome
2. **Surface Pro + Surface Pen** — Edge and Chrome

If anything below feels off, the "Knob" column tells you exactly which
default to change. After tuning, update Section 7 of
`docs/takeoff-interaction-map.md` in the same PR so the contract stays
in sync with the code.

---

## Setup (both devices)

1. Sign in as any user with takeoff access.
2. Open `Settings → Preferences → Takeoff (Mobile/Stylus)` and confirm
   defaults: rotate **off**, palm band **24 px**, long-press **500 ms**.
3. Navigate to `/takeoff/:bidCode` for a project that has at least one
   calibrated sheet with existing markups (so snap targets exist).
4. Force a portrait window narrower than 768 px (rotate the iPad to
   portrait; on the Surface, snap the window to half-screen).

---

## Test 1 — Palm rejection while drawing

**Goal:** A resting palm must never drop strokes mid-draw.

1. Activate the Linear tool (`L`) or tap it in the ribbon.
2. Tap the canvas with the stylus to set the first point.
3. *Lower the side of your hand onto the screen* before placing the
   second point.
4. Continue the stroke with the stylus and commit with `Enter` (or the
   ribbon's "Commit" button).

**Pass:** The line is drawn cleanly, ends where you tapped, and no
phantom palm pan/zoom/rotate occurred.

**Fail symptoms → knob:**

| Symptom                                                   | Knob (in `Settings → Preferences → Takeoff`)        |
| --------------------------------------------------------- | --------------------------------------------------- |
| Palm pans or pinches the canvas                           | Increase `palm_rejection_band_px` in 4 px steps     |
| Stylus tap is being rejected as palm                      | Decrease `palm_rejection_band_px` in 4 px steps     |
| Defaults need to change for everyone                      | `shared/schema/features.ts` (default `24`) + Section 7 |

---

## Test 2 — Stylus long-press → snap HUD

**Goal:** A deliberate long-press with the pen tip opens the snap-mode
HUD reliably; a normal tap never triggers it.

1. With any draw tool active, hover the pen near a snap target
   (endpoint of an existing markup).
2. Press and hold the pen tip for ~½ second without moving it.

**Pass:** The snap-mode HUD opens within ~500 ms; quickly moving the
pen during the press cancels the long-press and starts a draw instead.

**Fail symptoms → knob:**

| Symptom                                                   | Knob                                                |
| --------------------------------------------------------- | --------------------------------------------------- |
| HUD opens too eagerly (during normal taps)                | Increase `stylus_long_press_ms` (try 650, 800)      |
| Have to hold uncomfortably long                           | Decrease `stylus_long_press_ms` (try 400, 350; min 250) |
| HUD never opens                                           | Confirm `pointerType === "pen"` is reported by the OS — Surface "ink" mode must be on, iPad must trust the Pencil pairing |

---

## Test 3 — Two-finger rotate gating

**Goal:** Rotate is **off** by default, and only fires in 90° steps when
the toggle is on.

1. With the toggle **off**, place two fingers on the canvas and twist.
   → Pass: pinch-zoom works, the sheet does **not** rotate.
2. Open `Settings → Preferences → Takeoff (Mobile/Stylus)`, enable
   "Allow two-finger rotate", return to the takeoff page.
3. Twist again. → Pass: each ~quarter-turn snaps the sheet by 90°
   (cumulative). No fractional rotation, no rotation during a pure
   pinch-zoom.

**Fail symptoms:**

- Rotation fires while toggle is off → bug in
  `client/src/lib/pointerInput.ts → interpretPinchPan`
- Rotation is continuous (not snapped to 90°) → bug in the consumer
  inside `client/src/components/markups/PlanMarkupLayer.tsx`
- Pinch-zoom triggers rotate → tighten the rotate threshold in
  `interpretPinchPan`

---

## Test 4 — Narrow-viewport ribbon

**Goal:** At <768 px, every tool button is easy to tap and the ribbon
isn't overwhelming.

1. Confirm tool buttons are large enough to comfortably hit with a
   fingertip without zooming the page. Spec: ≥44 × 44 CSS px.
2. Confirm the ribbon shows **Select / Measure / Annotate** expanded
   and **Snap / Constrain / View / Verify** collapsed by default.
3. Expand a collapsed group, navigate away, come back, and confirm
   your choice is remembered (per-user, per-group state).

**Fail symptoms → knob:**

- Buttons feel too small / too cramped → review the 44 px min in
  `UnifiedTakeoffRibbon.tsx`'s narrow-viewport styles.
- Wrong groups are collapsed/expanded by default → edit the
  `NARROW_DEFAULT_COLLAPSED_GROUPS` set in
  `client/src/components/takeoff/UnifiedTakeoffRibbon.tsx` (currently
  `["snap", "constrain", "view", "verify"]`). Then update Section 7 of
  the interaction map.

---

## Sign-off

Record the result at the bottom of the Task #2206 thread:

```
iPad Pro (Safari):  pass / pass / pass / pass     defaults kept
iPad Pro (Chrome):  pass / pass / pass / pass     defaults kept
Surface (Edge):     pass / pass / pass / pass     defaults kept
Surface (Chrome):   pass / pass / pass / pass     defaults kept
```

If anything was tuned, list the new value next to the device line and
open a follow-up PR that changes the schema default *and* Section 7 of
`docs/takeoff-interaction-map.md` together.
