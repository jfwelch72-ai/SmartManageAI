-- Make user_id nullable in rfi_activity so portal-token comments
-- (which have no real user row) can be persisted without a FK violation.
ALTER TABLE rfi_activity ALTER COLUMN user_id DROP NOT NULL;
