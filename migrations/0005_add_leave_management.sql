DO $$ BEGIN
  CREATE TYPE leave_request_status AS ENUM ('PENDING', 'APPROVED', 'DENIED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS leave_types (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  annual_allowance INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leave_types_org_idx ON leave_types(organization_id);

CREATE TABLE IF NOT EXISTS leave_requests (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id VARCHAR NOT NULL REFERENCES users(id),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  leave_type_id VARCHAR NOT NULL REFERENCES leave_types(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status leave_request_status NOT NULL DEFAULT 'PENDING',
  reviewer_id VARCHAR REFERENCES users(id),
  reviewer_note TEXT,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leave_requests_employee_idx ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS leave_requests_org_idx ON leave_requests(organization_id);
CREATE INDEX IF NOT EXISTS leave_requests_status_idx ON leave_requests(status);

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'LEAVE_APPROVED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'LEAVE_DENIED';
