-- Migration: Backfill project financial data (budget and contract_amount)
-- Date: 2025-11-19
-- Purpose: Ensure all projects have complete financial data for AI analysis and profitability tracking

-- Step 1: Backfill budget from related estimates where budget is NULL or 0
UPDATE projects p
SET budget = COALESCE(
  (
    SELECT MAX(e.base_bid_amount)
    FROM estimates e
    WHERE e.project_id = p.id AND e.status = 'APPROVED'
  ),
  (
    SELECT b.bid_amount
    FROM bids b
    WHERE b.code = REPLACE(p.code, 'PROJ-', 'BID-')
    LIMIT 1
  ),
  0
)
WHERE p.budget IS NULL OR p.budget = 0;

-- Step 2: Backfill contract_amount from budget where contract_amount is NULL
UPDATE projects
SET contract_amount = budget
WHERE contract_amount IS NULL AND budget IS NOT NULL AND budget > 0;

-- Step 3: Set default values for projects still missing data (edge cases)
UPDATE projects
SET budget = 0
WHERE budget IS NULL;

UPDATE projects
SET contract_amount = 0
WHERE contract_amount IS NULL;

-- Verification: Check for projects with missing financial data
DO $$
DECLARE
  missing_budget_count INTEGER;
  missing_contract_count INTEGER;
  zero_budget_count INTEGER;
BEGIN
  -- Count projects with NULL budget (should be 0 after backfill)
  SELECT COUNT(*) INTO missing_budget_count 
  FROM projects 
  WHERE budget IS NULL;
  
  -- Count projects with NULL contract_amount (should be 0 after backfill)
  SELECT COUNT(*) INTO missing_contract_count 
  FROM projects 
  WHERE contract_amount IS NULL;
  
  -- Count projects with zero budget (flagged for manual review)
  SELECT COUNT(*) INTO zero_budget_count 
  FROM projects 
  WHERE budget = 0 OR contract_amount = 0;
  
  IF missing_budget_count > 0 OR missing_contract_count > 0 THEN
    RAISE EXCEPTION 'Found projects with NULL financials: % budget, % contract', 
      missing_budget_count, missing_contract_count;
  END IF;
  
  RAISE NOTICE 'Migration successful: All projects have financial data';
  RAISE NOTICE 'Note: % projects have zero budget/contract and may need manual review', zero_budget_count;
END $$;

-- Create index for AI queries on financial data
CREATE INDEX IF NOT EXISTS projects_budget_idx ON projects(budget) WHERE budget > 0;
CREATE INDEX IF NOT EXISTS projects_contract_amount_idx ON projects(contract_amount) WHERE contract_amount > 0;
