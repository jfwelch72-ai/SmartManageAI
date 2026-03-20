-- Marketplace directory columns on organization_network_settings
ALTER TABLE organization_network_settings
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS founded_year integer,
  ADD COLUMN IF NOT EXISTS license_numbers text[],
  ADD COLUMN IF NOT EXISTS portfolio_photos text[],
  ADD COLUMN IF NOT EXISTS is_directory_listed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avg_rating decimal(3,2),
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0;

-- Marketplace reviews table
CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reviewee_org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  project_ref text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_reviews_reviewer_idx ON marketplace_reviews(reviewer_org_id);
CREATE INDEX IF NOT EXISTS marketplace_reviews_reviewee_idx ON marketplace_reviews(reviewee_org_id);

-- Enforce one review per reviewer-reviewee pair at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_reviews_unique_pair ON marketplace_reviews(reviewer_org_id, reviewee_org_id);
