-- Task #2629 — Takeoff workspace hardening.
--
-- 1. `version` integer on `takeoff_measurements` powers optimistic
--    concurrency: every successful UPDATE through
--    PATCH /api/takeoff/measurements/:id atomically bumps this column,
--    and clients that pass `expectedVersion` (body) or `If-Match`
--    (header) get a compare-and-swap. A stale value 409s with the
--    server's current row so the workspace can show a conflict toast
--    and reload, instead of silently overwriting a teammate's edit.
--
-- 2. `assembly_id`, `assembly_component_id`, `line_item_ref` capture
--    the link from a measurement back to an `ai_estimator_assemblies`
--    row (and optionally the assembly component or a free-form line
--    reference). When this link plus a positive `unit_cost` is
--    present, the PATCH route forwards the value into the org's
--    learned-rate library via `recordMeasurementRateSample`. The
--    org-quality filter (`ai_estimator_excluded_sources`) is shared
--    with the rest of the rate engine so low-quality bids don't
--    poison the library.
--
-- 3. `takeoff_measurements_assembly_idx` keeps the assembly→samples
--    lookup cheap when the rate-recompute job pulls all measurements
--    tagged to a given assembly.
--
-- All operations are idempotent so the file is safe to replay.

ALTER TABLE takeoff_measurements
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE takeoff_measurements
  ADD COLUMN IF NOT EXISTS assembly_id varchar;

ALTER TABLE takeoff_measurements
  ADD COLUMN IF NOT EXISTS assembly_component_id varchar;

ALTER TABLE takeoff_measurements
  ADD COLUMN IF NOT EXISTS line_item_ref text;

CREATE INDEX IF NOT EXISTS takeoff_measurements_assembly_idx
  ON takeoff_measurements (assembly_id);
