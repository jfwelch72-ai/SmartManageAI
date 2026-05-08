-- 0106_closeout_packages_atomic_columns.sql
-- Task #2689 — GCS-first atomic closeout export.
--
-- Adds the `checksum` (sha256 hex of the verified ZIP bytes) and
-- `completed_at` (transition-to-READY timestamp) columns on
-- closeout_packages so the package row itself is the integrity oracle:
-- consumers gate on `status = 'READY' AND storage_key IS NOT NULL AND
-- file_size IS NOT NULL AND checksum IS NOT NULL AND completed_at IS NOT NULL`.
-- Mirrored at boot by ensureCloseoutPackagesAtomicColumns().

ALTER TABLE closeout_packages
  ADD COLUMN IF NOT EXISTS checksum TEXT;

ALTER TABLE closeout_packages
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
