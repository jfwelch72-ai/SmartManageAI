-- Task #494: project-level Davis-Bacon wage decision number used by the
-- WH-347 generator to fall back to cached DOL prevailing-wage rates when
-- no explicit prevailing_wage_rates row exists for a (project, classification).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS wage_decision text;
