CREATE TABLE IF NOT EXISTS org_cost_codes (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id VARCHAR NOT NULL,
  code VARCHAR(20) NOT NULL,
  description VARCHAR(255) NOT NULL,
  division VARCHAR(100) NOT NULL,
  is_custom BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS org_cost_codes_org_idx ON org_cost_codes(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS org_cost_codes_org_code_uniq ON org_cost_codes(organization_id, code);
