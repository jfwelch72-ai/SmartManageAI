CREATE TYPE IF NOT EXISTS talent_availability AS ENUM ('AVAILABLE', 'OPEN_TO_OFFERS', 'NOT_AVAILABLE');
CREATE TYPE IF NOT EXISTS talent_profile_visibility AS ENUM ('PUBLIC', 'PRIVATE', 'CONNECTIONS_ONLY');

CREATE TABLE IF NOT EXISTS talent_profiles (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id VARCHAR REFERENCES organizations(id) ON DELETE SET NULL,
  bio TEXT,
  trade_specialization TEXT,
  years_of_experience INTEGER,
  availability talent_availability NOT NULL DEFAULT 'AVAILABLE',
  visibility talent_profile_visibility NOT NULL DEFAULT 'PUBLIC',
  desired_pay_min NUMERIC(10,2),
  desired_pay_max NUMERIC(10,2),
  pay_type TEXT,
  preferred_location TEXT,
  work_radius_miles INTEGER,
  portfolio_photos TEXT[] DEFAULT '{}'::text[],
  resume_url TEXT,
  headline TEXT,
  rating NUMERIC(3,2),
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS talent_profiles_user_idx ON talent_profiles(user_id);
CREATE INDEX IF NOT EXISTS talent_profiles_org_idx ON talent_profiles(organization_id);
CREATE INDEX IF NOT EXISTS talent_profiles_trade_idx ON talent_profiles(trade_specialization);
CREATE INDEX IF NOT EXISTS talent_profiles_availability_idx ON talent_profiles(availability);
CREATE INDEX IF NOT EXISTS talent_profiles_published_idx ON talent_profiles(is_published);

CREATE TABLE IF NOT EXISTS hiring_pipeline_stages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_terminal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hiring_pipeline_stages_org_idx ON hiring_pipeline_stages(organization_id);
CREATE INDEX IF NOT EXISTS hiring_pipeline_stages_order_idx ON hiring_pipeline_stages(organization_id, display_order);

ALTER TABLE hiring_candidates ALTER COLUMN current_stage TYPE TEXT USING current_stage::TEXT;
ALTER TABLE hiring_candidate_stage_history ALTER COLUMN from_stage TYPE TEXT USING from_stage::TEXT;
ALTER TABLE hiring_candidate_stage_history ALTER COLUMN to_stage TYPE TEXT USING to_stage::TEXT;
