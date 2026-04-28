# Takeoff Measurement-Accuracy UX Review

_Audit produced for Task #2313 — April 2026._

## Scope

The takeoff workspace has the technical ingredients for accurate measuring (7 snap modes, ortho/shift/dim-input constraints, 2-point + standard-scale + AI-detected calibration, sheet versioning, multi-region scale capture). What it lacks is a **user-facing trust system** that tells the estimator how reliable a measurement is _before_ it commits to a bid total.

This document audits six flows, lists what works and what fails silently, and proposes concrete remedies. Five accompanying plan files in `.local/tasks/` cover the highest-impact follow-ups.

Out of scope: changes to the calibration math, snap engine, scale model, schema, or BIM/LiDAR/AI takeoff (referenced only where they touch 2D measurement accuracy).

---

## Executive summary

### Top 5 risks ranked by estimating $ impact

| # | Risk | Why it matters in dollars |
|---|------|---------------------------|
| 1 | **Silent re-calibration invalidates all prior measurements on the sheet.** `takeoff_measurements` does not snapshot `scalePxPerFoot` at capture time; quantities are computed against the sheet's _current_ scale. A bad late re-cal silently changes thousands of LF/SF/CY. | Whole-sheet quantity error. On a 50-sheet civil bid, one re-cal on a paving sheet can shift a bid by $50k–$500k with no audit trail. |
| 2 | **Sheet revision (supersede) carries the parent sheet's scale forward without verification.** No "scale was X before, please confirm for the new revision" prompt. Addenda often re-issue at a different scale or with a different title block. | Cross-revision drift. A 1/8"=1' addendum imported under a 1/4"=1' parent doubles every quantity. Procurement orders 2× material. |
| 3 | **No scale-source / scale-confidence on the sheet record.** A 2-point hand calibration, a standard-scale pick, an AI-detected scale, and a propagated bulk-set scale all look identical to the next user. There is no way to find "every sheet whose scale was AI-inferred low-confidence and never verified". | Bid-wide blind spot. Late catches happen the day before bid lock and require re-walking every sheet. |
| 4 | **No "verify this sheet" gate before the first measurement.** A user can land on the wrong page (e.g. structural plan instead of civil) or an uncalibrated sheet and start clicking; nothing demands a sanity check against a known dim or the title-block scale. | Wrong-sheet measurements get filed against the right cost code and flow to procurement undetected until the field calls. |
| 5 | **No measurement provenance / second-eye review.** High-dollar measurements (e.g. a 200,000 SF asphalt area) cannot be flagged "needs review" or routed to a senior estimator. Reviewer never sees which measurements were captured uncalibrated, snapless, or against a low-confidence scale. | QC bottleneck on bid day. Senior estimator either reviews everything (slow) or nothing (risky). The middle ground — "review only the suspect ones" — is unreachable today. |

### Top 5 quick wins (UX-only, no math changes)

| # | Quick win | Effort | Payoff |
|---|-----------|--------|--------|
| 1 | **Per-click snap chip in the cursor HUD.** `currentSnap` already exists in `use-takeoff-interactions.ts:222` and is computed every move (line 1012) but is only consumed by the canvas cursor visual. Surface "Endpoint", "Midpoint", "Free space" as a 1-line badge on the status bar (mobile) and ribbon (desktop) so estimators can see in real time whether they are landing real snaps. | 1 day | Cuts free-space click rate immediately and trains users to slow down on tricky vertices. |
| 2 | **Replace "Calibrated / Uncalibrated" binary chip with the actual scale label.** `currentSheet.scalePxPerFoot ? "Scale: ft" : "Not Calibrated"` (`WorkspaceBottomBar.tsx:138`) is meaningless. Show `1/4" = 1'-0"` with confidence dot. The detected label is already known (`scaleLabel` column on `takeoff_sheets`). | 0.5 day | Estimators stop re-calibrating sheets that already have a perfectly good detected scale. |
| 3 | **Toast unit fix.** `handleSaveCalibration` toasts `"Scale set: 12.34 px/ft"` (`use-takeoff-interactions.ts:1244`) — `px/ft` is meaningless to estimators, who think in `1/4" = 1'-0"`. Look up the matching preset via `findMatchingPreset` (already in `scaleDetection.ts:159`) and toast the human label. | 0.25 day | Removes a long-running "did I do that right?" friction. |
| 4 | **Show the typed-vs-detected delta in the Inline Calibration Drawer.** When the AI scale-detector has fired for the active sheet (the result is held by the parent), and the user types a calibration distance that yields a `previewScale` differing from the detected scale by >5%, show an inline amber warning ("This calibration disagrees with the detected scale by 8%. Re-pick your reference points or accept the detected scale instead."). | 1 day | Catches typo-class errors on the cheapest possible step. |
| 5 | **Surface multi-region capture as "no-op for now" or actually persist regions.** The drawer captures multiple regions (`multiCalibPoints`) and labels them, but `handleSaveCalibration` only writes one `scalePxPerFoot` to the sheet. Either disable the multi-region UI behind a tooltip ("Coming soon — only the first region is saved today") or finish the schema for per-region scale zones. Today the user thinks they did good work, but the regions silently evaporate. | 0.5 day for the disable, 3–5 days for the full feature. The disable alone is a quick win. |

---

## Flow-by-flow findings

### 1. Calibration confidence, drift, and multi-sheet propagation

**What works**
- The Inline Calibration Drawer (`InlineCalibrationDrawer.tsx`) is well-built: pass-through pointer events, T-key open, Bluebeam-style typed grammar (`12'6"`, `12<30`), a live `previewScale` readout, and a Bulk-Scale Propagation confirmation dialog (Task #2228) that gates Sheet-Set apply behind a thresholded confirmation with a "don't ask again" toggle.
- `scaleDetection.ts` ranks detected candidates by `hasScaleKeyword > confidence > frequency`, then snaps to the nearest `COMMON_SCALES` preset within 5% — solid heuristic.
- `detectScaleBatch` does cross-sheet voting and back-fills medium-confidence inferences for sheets with no detected text.
- Sheet revisions (`takeoffSheets.supersededById`, `revisionLabel`, `isActive`) provide the schema substrate for per-revision scale handling.

**What fails silently**
- **No scale source / confidence on the sheet record.** `takeoff_sheets` stores `scalePxPerFoot`, `scaleLabel`, and `units` — but nothing about _how_ that scale got there. A 2-point hand calibration by a senior estimator, an AI-detected `low`-confidence scrape from a stamp, and a bulk-propagated scale from a different sheet are indistinguishable to the next user opening the workspace.
- **Confidence is computed and discarded.** `detectScaleFromText` returns `confidence: "high" | "medium" | "low"` and ranks candidates by it (`scaleDetection.ts:218`), but once the user accepts the value, only the numeric `scalePxPerFoot` survives. There's no DB column for `scaleConfidence`.
- **Re-calibration silently re-prices the sheet.** `handleSaveCalibration` (`use-takeoff-interactions.ts:1186`) PATCHes `/api/takeoff/sheets/:sheetId/calibration` with the new `scalePxPerFoot`. All existing measurements on the sheet then re-render at the new scale because their points are stored in pixels and lengths/areas are re-derived live (and were re-derived once at insert time in `computeMeasurementGeometry`, `takeoffMeasurementRoutes.ts:224`). There is no warning that "12 measurements totalling 4,200 LF will be re-priced". The audit log captures the calibration PATCH but not the downstream quantity delta.
- **Sheet revision (supersede) does not lock scale to revision.** When a sheet is superseded (`/api/takeoff/sheets/:sheetId/supersede`), the new sheet inherits the source sheet's `scalePxPerFoot` (`takeoffSheetRoutes.ts:1100`). There's no per-revision lock and no "the parent sheet was at 1/4" — please confirm the new revision's scale" prompt. Addenda regularly arrive at different scales, and this is the largest single dollar-impact gap.
- **Multi-region calibration is captured but never persisted.** The drawer's `multiCalibPoints` array is populated by "Add region" but `handleSaveCalibration` only writes one `scalePxPerFoot`. The region capture is dead UI today.
- **The Inline Calibration Drawer never compares the user's typed dimension to the detected scale.** If AI detected `1/4" = 1'-0"` (96 px/ft) but the user picks two points and types a distance yielding `1/8" = 1'-0"` (48 px/ft), the drawer accepts it silently. This is the single highest-leverage drawer-side check we can add.
- **The "Use Standard Scale" handoff loses context.** Clicking the link in the drawer opens `PlanScaleModal` with no awareness of any AI-detected scale; the user has to re-find the right ratio in the standard list. The detected scale should be highlighted at the top of the standards list.

**Recommendation**
- Add `scaleSource` (enum: `USER_TWO_POINT | STANDARD_SCALE | AI_DETECTED | INHERITED_FROM_PARENT | BULK_PROPAGATED`), `scaleConfidence` (enum: `HIGH | MEDIUM | LOW | UNVERIFIED`), `scaleCalibratedById`, `scaleCalibratedAt`, and `scaleLockedToRevision` (boolean) on `takeoff_sheets`. Backfill existing rows with `UNVERIFIED`.
- On supersede, force `scaleConfidence = UNVERIFIED` and surface a top-of-canvas banner "This revision inherited its scale from the previous sheet — please verify before measuring".
- In the drawer, when an AI-detected scale exists for the active sheet and the user's preview scale departs >5%, show an inline warning with two CTAs: "Use detected" and "Override".
- See follow-up plan file `takeoff-scale-confidence-and-drift.md`.

---

### 2. Pre-measure verification ("verify this sheet" gate)

**What works**
- A `Verify Dimension` tool primitive exists (`use-takeoff-interactions.ts:469-470, 612, 869`): the user picks two points, types an expected distance, and gets `verifyResult: { expected, measured, errorPct }`. The math works.

**What fails silently**
- **Discoverability is poor.** The verify tool is buried in the toolbar — there is no prompt, no "verify before measuring" banner, no first-run nudge.
- **No verification record is persisted.** `verifyResult` is local React state. There is no row in any table saying "user X verified sheet Y on date Z and the error was 0.4%". A reviewer cannot answer "was this sheet verified?".
- **No wrong-sheet check.** Nothing compares the active sheet's title block (already extracted via OCR for scale detection in `scaleDetection.ts`) to the active trade or cost-code group. The user can be on the structural sheet while measuring asphalt with no warning.
- **Uncalibrated-sheet measurement is allowed.** The status bar shows "Not Calibrated" but the user can still click — measurements are saved with no `computedLengthFt` / `computedAreaFt2` because `computeMeasurementGeometry` early-returns when `scalePxPerFoot` is null (`takeoffMeasurementRoutes.ts:229`). The measurement persists with `points` but no quantity. The user only finds out later when totals look wrong.

**Recommendation**
- On first attempt to use a measurement tool on an uncalibrated sheet, intercept with a modal: "This sheet is not calibrated. Calibrate now, pick a standard scale, or open the Verify Dimension tool to confirm an existing scale."
- Promote `verifyResult` from local state to a persisted `takeoff_sheet_verifications` row carrying `sheetId`, `verifiedById`, `verifiedAt`, `expectedFt`, `measuredFt`, `errorPct`. Show a green check chip on the status bar when a sheet has a recent passing verification.
- Optional title-block sanity check: when `scaleDetection` extracts a sheet number/title from the title block, compare against the project's drawing index for trade and warn on mismatch.
- See follow-up plan file `takeoff-pre-measure-verify-gate.md`.

---

### 3. Snap quality (per-click feedback)

**What works**
- Snap modes are configured in `use-takeoff-interactions.ts` (`snapModeConfig`: endpoint / midpoint / intersection / center / perpendicular / nearest / grid).
- `currentSnap: SnapResult | null` is computed every mouse move with the same priority order as the click handler (`use-takeoff-interactions.ts:992-1012`), so the HUD value matches what will actually be applied on click.
- `CanvasStage.tsx` consumes `currentSnap` to render the cursor highlight ring.

**What fails silently**
- **There is no per-click summary of what was actually hit.** The cursor ring is real-time but transient — once the user clicks, there is no readout saying "Endpoint snapped". A free-space click (no snap) looks identical to an endpoint snap from the user's perspective once the mouse moves.
- **The aggregate snap-hit ratio is never computed.** A measurement with 12 vertices, of which 11 hit free space, looks identical in the table to a measurement where every vertex hit an endpoint. There is no `snapHitRatio` on the measurement row.
- **The status bar never shows snap state.** The desktop status bar (`WorkspaceBottomBar.tsx:111-142`) shows zoom and calibration only. The mobile compact row shows even less.
- **`snap_modes_used` is not stored.** Two estimators producing the same polygon — one with snaps on, one with snaps off — produce indistinguishable `takeoffMeasurements` rows.

**Recommendation**
- Surface the live `currentSnap` mode as a 1-line chip in both the desktop status bar and the mobile compact row (e.g. `Snap: Endpoint`, `Snap: Free space ⚠`).
- Track per-vertex snap hits during a measurement draft and persist the resulting `snapHitRatio` (0.0–1.0) and `snapModesUsed` (json string array) to the measurement row at insert time. Flag `needsReview = true` when ratio < 0.6 on a vertex-heavy polygon.
- A red "Free space" badge (with subtle pulse) on the cursor when no snap is active is the highest-leverage single change — it trains the user in real time without any gating.
- See follow-up plan file `takeoff-snap-quality-hud.md`.

---

### 4. Constraint clarity (touch + desktop)

**What works**
- Ortho lock, polar/angle constraint, and pending-dim length constraint are all implemented and applied consistently in the move handler (`use-takeoff-interactions.ts:983-989`).
- The unified ribbon (`UnifiedTakeoffRibbon.tsx`) exposes the snap-mode toggles, ortho mode, and constraint mode for desktop users.

**What fails silently**
- **Mobile / touch users have almost no constraint visibility.** The unified ribbon collapses on small viewports. The new compact mobile status row (`WorkspaceBottomBar.tsx:73-83`) only shows measurement count, calibration state, and zoom — nothing about snap, ortho, or constraint state.
- **No keyboard hints.** Desktop users learn ortho-lock by accident. Bluebeam shows the active constraint as a footer chip ("ORTHO ON"); we don't.
- **Pending dim-input is invisible until you start typing.** A user who toggles "constrain length to 12 ft" via the ribbon has no persistent visual reminder — the next click silently snaps to 12 ft and the user wonders why.
- **No haptic / audio feedback on touch when a snap or constraint engages** — it would be a meaningful accuracy aid given how imprecise touch is.

**Recommendation**
- Add a constraint chip cluster to both status bars: `ORTHO`, `15° polar`, `Snap: Midpoint`, `Length: 12 ft` — each muted when off, accent color when on.
- On touch devices, fire a 10 ms `navigator.vibrate(10)` when a snap engages or releases (gated behind a user setting, defaulting on for tablets).
- This is folded into the snap-quality HUD plan file (`takeoff-snap-quality-hud.md`).

---

### 5. Measurement provenance (calibration source / scale / snap-mode / needs-review)

**What works**
- `takeoff_measurements` carries `source: USER | …` and `status: DRAFT | …` enums.
- Versioning (`takeoffVersionId`) and lock semantics are enforced server-side.
- Audit logger captures create / update / delete events.

**What fails silently**
- **No calibration source on the measurement.** Two measurements drawn with `1/4" = 1'-0"` look identical whether the scale was AI-detected `low`-confidence or hand-calibrated by a senior estimator.
- **No `scaleAtCapture`.** The measurement re-prices live against the sheet's _current_ scale. A late re-calibration silently changes the quantity. Re-running historical bids becomes impossible.
- **No `snapModesUsed` / `snapHitRatio`.** See flow 3.
- **No `needsReview` boolean** and no related `reviewedById` / `reviewedAt` / `reviewNote`.
- **No `confidenceFlag`.** The system has no way to compute or store "this measurement is suspect because the calibration was unverified AND the snap-hit ratio was 0.3 AND the scale was AI-low".

**Recommendation**
- Add to `takeoff_measurements`:
  - `calibrationSource` (enum, mirroring sheet's `scaleSource`)
  - `scaleAtCaptureLabel` (text — human, e.g. `1/4" = 1'-0"`)
  - `scaleAtCapturePxPerFoot` (double precision — immutable copy)
  - `snapModesUsed` (text json — array)
  - `snapHitRatio` (double precision — 0..1)
  - `needsReview` (boolean) and a partial index on `(needsReview = true)` for the review queue
  - `reviewedById`, `reviewedAt`, `reviewNote`
- Compute `needsReview` server-side at insert time using a deterministic rule (e.g. `snapHitRatio < 0.6 OR sheet.scaleConfidence != HIGH OR computedDollarValue > orgThreshold`).
- See follow-up plan file `takeoff-measurement-provenance.md`. This is the foundation everything else builds on.

---

### 6. Second-eye review workflow

**What works**
- `takeoff_issues` exists for plan-level questions (RFI-style). A measurement-review workflow could either reuse this or stand up its own table.

**What fails silently**
- **There is no second-eye review affordance anywhere.** A senior estimator cannot say "show me every measurement on this bid that was captured against an unverified scale" or "review this $80k asphalt area".
- **No review queue UI.** No `/api/measurements/review-queue` endpoint, no queue page, no notifications.
- **No "Send to reviewer" action.** The right-click menu on a measurement does not offer it.
- **No bid-level rollup.** "X% of $-weighted measurements on this bid have not been reviewed" is unanswerable today, so the senior estimator can't tell if the bid is ready to lock.

**Recommendation**
- After provenance lands (flow 5), add:
  - `POST /api/takeoff/measurements/:id/request-review` and `POST /:id/approve-review` endpoints.
  - Right-click "Send to reviewer" menu item on the measurement layer.
  - A `/takeoff/review-queue` page filtered by bid / project / reviewer, sorted by descending dollar value (`computedAreaFt2 * unitCost`).
  - Bid-summary chip: "Reviewed: 14 / 27 measurements ($820k / $1.2M reviewed)". Block bid lock when below threshold (org setting).
- Notify the reviewer via the existing in-app + email notification framework (`notifyUsers`).
- See follow-up plan file `takeoff-second-eye-review.md`.

---

## Benchmark notes (Bluebeam, STACK CT)

- **Bluebeam Revu** shows a persistent footer chip with the current scale label (`1/4" = 1'-0"`), the active layer, and a live ORTHO/SNAP indicator. Re-calibrating prompts a "scale will change for this page; continue?" confirmation. Verify Measurement is a first-class tool with persistent visual confirmation.
- **STACK CT** shows scale source ("Manual", "Detected", "Imported") on the sheet thumbnail and a confidence dot. Measurements can be flagged for review and routed; the bid summary surfaces "% reviewed" gating.
- Both tools surface the snap mode that was hit on click in the immediate cursor area (text label, not just visual ring).
- Neither tool persists per-measurement snap-hit ratio — that would be a differentiator for SmartManageAI.

The patterns above informed the recommendations in flows 1, 3, and 6. The proposed measurement-provenance schema (flow 5) is more thorough than either competitor and would be a defensible quality story in sales demos.

---

## Follow-up tasks

The five highest-impact recommendations are written as plan files in `.local/tasks/`:

1. **`takeoff-measurement-provenance.md`** — Foundational. Adds `calibrationSource`, `scaleAtCapture*`, `snapModesUsed`, `snapHitRatio`, `needsReview`, `reviewedBy*` to `takeoff_measurements`. Required by tasks 3 and 5.
2. **`takeoff-scale-confidence-and-drift.md`** — Adds scale source/confidence on `takeoff_sheets`, locks scale to revision on supersede, drives a top-of-canvas drift banner.
3. **`takeoff-snap-quality-hud.md`** — Surfaces `currentSnap` as a status-bar chip and a free-space cursor warning; populates `snapModesUsed` / `snapHitRatio` from flow 1's foundation.
4. **`takeoff-pre-measure-verify-gate.md`** — Persists verifications to `takeoff_sheet_verifications`, intercepts the first measurement on uncalibrated sheets.
5. **`takeoff-second-eye-review.md`** — Review queue, "Send to reviewer" affordance, bid-level reviewed-% rollup.

Recommended sequencing: 1 → 2 → 3 (parallel with 4) → 5.
