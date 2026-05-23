-- Task #3044: AI Takeoff — Coordinate Extraction & Accuracy Mandate
-- Adds ai_geometry (jsonb) for bounding-box / polygon overlay data
-- and csi_division (text) for CSI Division classification per measurement.
ALTER TABLE "takeoff_measurements"
  ADD COLUMN IF NOT EXISTS "ai_geometry" jsonb,
  ADD COLUMN IF NOT EXISTS "csi_division" text;
