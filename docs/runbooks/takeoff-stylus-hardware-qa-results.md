# Takeoff — Mobile / Stylus Hardware QA Results

Recorded outcomes from runs of
[`takeoff-stylus-hardware-qa.md`](./takeoff-stylus-hardware-qa.md).
Each row is an independent device + browser session; defaults that
were kept are listed alongside any tuning that was applied.

Test legend (matches Section 7 of `docs/takeoff-interaction-map.md`
and the runbook):

- **T1** — Palm rejection while drawing
- **T2** — Stylus long-press → snap HUD
- **T3** — Two-finger rotate gating (off by default; 90° steps when on)
- **T4** — Narrow-viewport ribbon (≥44 px hit-targets, secondary
  groups collapsed by default)

Defaults shipped at time of testing:

- `palm_rejection_band_px = 24`
- `stylus_long_press_ms = 500`
- `NARROW_DEFAULT_COLLAPSED_GROUPS = { snap, constrain, view, verify }`

---

## 2026-04-28 — Task #2206 verification round

| Device + browser     | T1   | T2   | T3   | T4   | Defaults                      |
| -------------------- | ---- | ---- | ---- | ---- | ----------------------------- |
| iPad Pro (Safari)    | pass | pass | pass | pass | keep (24 px / 500 ms / set as shipped) |
| iPad Pro (Chrome)    | pass | pass | pass | pass | keep (24 px / 500 ms / set as shipped) |
| Surface Pro (Edge)   | pass | pass | pass | pass | keep (24 px / 500 ms / set as shipped) |
| Surface Pro (Chrome) | pass | pass | pass | pass | keep (24 px / 500 ms / set as shipped) |

**Outcome:** all four ribbon / interaction scenarios pass on all four
target device + browser combinations. No interaction defaults were
tuned.

**Follow-up tweaks applied during verification:**

1. **`SheetSelectorBar` was cramped on iPad portrait.** The sheet
   selector was 128px wide (causing realistic sheet names like "TFR
   Construction 2025" to wrap mid-word) and the right-hand cluster of
   secondary controls was crowding the calibration badge. We widened
   the narrow-viewport selector to 176px, dropped the redundant
   "Sheet:" label below `sm`, and hid the Properties Panel /
   Hide-Resolved / Cross-Module toggles below `md`.
2. **Plan Scale modal cut off the Done / Cancel footer on small
   viewports.** The non-fullscreen variant had no `max-h`, so the
   dialog could grow taller than the viewport and push the footer
   off-screen. We clamped it to `max-h-[90dvh]` (dynamic viewport
   height — survives iOS Safari's URL-bar collapse), made it a flex
   column, and converted the standards `<ScrollArea>` from a fixed
   `h-[240px]` to `flex-1 min-h-0` so the footer is always pinned at
   the bottom while the scale list scrolls.
3. **Finger-driven measurement was broken on iPad.** The canvas-level
   palm rejector in `use-takeoff-interactions.ts` was dropping *every*
   single-finger touch whose contact diameter exceeded the 24 px band
   — without first checking whether a stylus was actually in contact.
   On iPad fingertip contacts are routinely 30–60 px, so plain finger
   taps never produced a measurement. We added a window-level pen
   tracker (`activePenIdsRef`) and gated the rejector on
   `penActive`, matching the contract documented for the shared
   `shouldRejectAsPalm` utility. The tracker self-heals on tab hide /
   window blur so a missed `pointerup` (pen lifts out of hover range,
   app-switch, etc.) cannot leave the rejector permanently armed.
4. **Categories sidebar + properties panel were squeezing the canvas
   to a sliver on iPad portrait** (the symptom that read as "PDF
   didn't load" — there was no room left to render it). The persisted
   `sidebarCollapsed` was a desktop-only preference that didn't react
   to viewport. We added a parallel `narrowSidebarOpen` state in
   `TakeoffWorkspace` that always starts collapsed when `isMobile`
   becomes true (and resets on every transition into mobile mode), so
   the sidebar opens via tap-toggle rather than always-on. The 288 px
   inline properties panel is now suppressed on mobile entirely — the
   user can still inspect a measurement via the floating selection
   toolbar / context menu. Rotating back to desktop restores the
   user's persisted desktop preference unchanged.

Section 7 of the interaction map records the new behaviors.

---

## How to add a new run

1. Run the runbook on the target device(s).
2. Append a dated section above with one row per device + browser.
3. If any default was changed, update both `shared/schema/features.ts`
   (or `UnifiedTakeoffRibbon.tsx` for the collapsed-groups set) and
   Section 7 of `docs/takeoff-interaction-map.md` in the same PR.
