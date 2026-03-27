-- Migration 0015: Payroll & Workforce post-merge fixes
-- Adds missing columns that were defined in Drizzle schema but absent from the database

-- 1. Add cost_code column to time_clock_shifts (needed for cost code tracking on shifts)
ALTER TABLE time_clock_shifts ADD COLUMN IF NOT EXISTS cost_code text;

-- 2. Add double_time columns to pay_run_line_items (needed for DT hour/rate tracking)
ALTER TABLE pay_run_line_items ADD COLUMN IF NOT EXISTS double_time_hours numeric(8,2) NOT NULL DEFAULT 0;
ALTER TABLE pay_run_line_items ADD COLUMN IF NOT EXISTS double_time_rate numeric(10,2) NOT NULL DEFAULT 0;
