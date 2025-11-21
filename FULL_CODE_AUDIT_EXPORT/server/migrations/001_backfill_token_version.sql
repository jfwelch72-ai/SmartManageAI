-- Migration: Backfill token_version for existing users
-- Date: 2025-11-18
-- Purpose: Ensure all existing users have token_version set to 0 for JWT revocation system

-- Backfill any NULL values (should be none due to schema default, but defensive)
UPDATE users 
SET token_version = 0 
WHERE token_version IS NULL;

-- Verify constraint is enforced
DO $$
BEGIN
  -- Check if NOT NULL constraint exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'users' 
      AND column_name = 'token_version' 
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'token_version must have NOT NULL constraint';
  END IF;
END $$;

-- Verification: Ensure no NULL values remain
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count 
  FROM users 
  WHERE token_version IS NULL;
  
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Found % users with NULL token_version', null_count;
  END IF;
  
  RAISE NOTICE 'Migration successful: All users have valid token_version';
END $$;
