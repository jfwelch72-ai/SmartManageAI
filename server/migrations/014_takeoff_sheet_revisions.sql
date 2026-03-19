-- Migration: Add revision tracking to takeoff_sheets
-- Date: 2025-03-19
-- Purpose: Enable sheet-level version history for the takeoff workspace

ALTER TABLE takeoff_sheets ADD COLUMN IF NOT EXISTS revision_label TEXT;
ALTER TABLE takeoff_sheets ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE takeoff_sheets ADD COLUMN IF NOT EXISTS superseded_by_id VARCHAR;
