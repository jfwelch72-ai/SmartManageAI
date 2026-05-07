-- Task #2484: COI & Insurance Compliance Lifecycle
-- Creates the COI domain (certificates, per-coverage limits, project
-- insurance requirement profiles, reminder log, override audit) plus
-- the supporting Postgres enums.

DO $$ BEGIN
  CREATE TYPE insurance_coverage_type AS ENUM (
    'GENERAL_LIABILITY','AUTO_LIABILITY','WORKERS_COMP','UMBRELLA',
    'PROFESSIONAL','POLLUTION','BUILDERS_RISK','CYBER','OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE insurance_certificate_status AS ENUM (
    'ACTIVE','EXPIRING','EXPIRED','REVOKED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE coi_party_type AS ENUM ('SUBCONTRACTOR','VENDOR','CRM_ORG');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE coi_compliance_status AS ENUM ('COMPLIANT','EXPIRING','EXPIRED','MISSING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE coi_override_entity_type AS ENUM (
    'PAY_APPLICATION','PURCHASE_ORDER','SUBCONTRACTOR_PAYMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS insurance_certificates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  party_type coi_party_type NOT NULL,
  party_id varchar NOT NULL,
  party_name text NOT NULL,
  carrier text NOT NULL,
  policy_number text NOT NULL,
  effective_date date NOT NULL,
  expiry_date date NOT NULL,
  additional_insured boolean NOT NULL DEFAULT false,
  waiver_of_subrogation boolean NOT NULL DEFAULT false,
  primary_non_contributory boolean NOT NULL DEFAULT false,
  status insurance_certificate_status NOT NULL DEFAULT 'ACTIVE',
  file_key text,
  file_name text,
  uploaded_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  extracted_data jsonb,
  extraction_confidence double precision,
  confirmed_at timestamp,
  confirmed_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ic_org_party_idx ON insurance_certificates(organization_id, party_type, party_id);
CREATE INDEX IF NOT EXISTS ic_org_expiry_idx ON insurance_certificates(organization_id, expiry_date);
CREATE INDEX IF NOT EXISTS ic_org_status_idx ON insurance_certificates(organization_id, status);

CREATE TABLE IF NOT EXISTS insurance_certificate_coverages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id varchar NOT NULL REFERENCES insurance_certificates(id) ON DELETE CASCADE,
  coverage_type insurance_coverage_type NOT NULL,
  per_occurrence_limit numeric(14,2),
  aggregate_limit numeric(14,2),
  deductible numeric(14,2),
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT icc_cert_coverage_unique UNIQUE (certificate_id, coverage_type)
);
CREATE INDEX IF NOT EXISTS icc_cert_idx ON insurance_certificate_coverages(certificate_id);

CREATE TABLE IF NOT EXISTS project_insurance_requirements (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id varchar NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  coverage_type insurance_coverage_type NOT NULL,
  min_per_occurrence numeric(14,2),
  min_aggregate numeric(14,2),
  requires_additional_insured boolean NOT NULL DEFAULT false,
  requires_waiver_of_subrogation boolean NOT NULL DEFAULT false,
  requires_primary_non_contributory boolean NOT NULL DEFAULT false,
  required boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT pir_project_coverage_unique UNIQUE (project_id, coverage_type)
);
CREATE INDEX IF NOT EXISTS pir_org_project_idx ON project_insurance_requirements(organization_id, project_id);

CREATE TABLE IF NOT EXISTS coi_reminder_log (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id varchar NOT NULL REFERENCES insurance_certificates(id) ON DELETE CASCADE,
  days_before_expiry integer NOT NULL,
  recipient text NOT NULL,
  sent_at timestamp NOT NULL DEFAULT now(),
  ok boolean NOT NULL DEFAULT true,
  error_message text,
  CONSTRAINT crl_cert_bucket_unique UNIQUE (certificate_id, days_before_expiry, recipient)
);
CREATE INDEX IF NOT EXISTS crl_cert_idx ON coi_reminder_log(certificate_id);

CREATE TABLE IF NOT EXISTS coi_compliance_overrides (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type coi_override_entity_type NOT NULL,
  entity_id varchar NOT NULL,
  project_id varchar REFERENCES projects(id) ON DELETE SET NULL,
  party_type coi_party_type,
  party_id varchar,
  reason text NOT NULL,
  expires_at timestamp,
  created_by_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cco_entity_idx ON coi_compliance_overrides(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS cco_org_idx ON coi_compliance_overrides(organization_id, created_at);
