-- Migration: Replace 3 financial boolean columns with single financialsAccess enum
-- Maps existing data: canEditFinancials=true → "manage", canViewFinancials/canAccessFinancials=true → "view", else → "none"

-- Step 1: Add the new column to user_dashboard_permissions
ALTER TABLE user_dashboard_permissions ADD COLUMN IF NOT EXISTS financials_access TEXT NOT NULL DEFAULT 'none';

-- Step 2: Migrate existing data
UPDATE user_dashboard_permissions SET financials_access = CASE
  WHEN can_edit_financials = true THEN 'manage'
  WHEN can_view_financials = true OR can_access_financials = true THEN 'view'
  ELSE 'none'
END;

-- Step 3: Drop old columns
ALTER TABLE user_dashboard_permissions DROP COLUMN IF EXISTS can_access_financials;
ALTER TABLE user_dashboard_permissions DROP COLUMN IF EXISTS can_view_financials;
ALTER TABLE user_dashboard_permissions DROP COLUMN IF EXISTS can_edit_financials;

-- Step 4: Add financials_access to hustler_delegates (replacing can_view_financials)
ALTER TABLE hustler_delegates ADD COLUMN IF NOT EXISTS financials_access TEXT NOT NULL DEFAULT 'view';

-- Step 5: Migrate hustler_delegates data
UPDATE hustler_delegates SET financials_access = CASE
  WHEN can_view_financials = true THEN 'view'
  ELSE 'none'
END;

-- Step 6: Drop old column from hustler_delegates
ALTER TABLE hustler_delegates DROP COLUMN IF EXISTS can_view_financials;
