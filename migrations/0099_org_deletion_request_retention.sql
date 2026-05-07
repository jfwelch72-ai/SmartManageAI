-- Task #2487 round-5: align org_deletion_requests with retention semantics.
--
-- 1. requested_by_id must be NULLABLE so the hard-delete sweep can NULL it
--    before deleting the owning user without violating the FK.
-- 2. organization_id FK must be ON DELETE SET NULL (not CASCADE) so the
--    deletion-request audit row survives the org delete itself, matching
--    the retention promise documented in the sweep.

ALTER TABLE org_deletion_requests
  ALTER COLUMN requested_by_id DROP NOT NULL;

ALTER TABLE org_deletion_requests
  DROP CONSTRAINT IF EXISTS org_deletion_requests_organization_id_organizations_id_fk;

ALTER TABLE org_deletion_requests
  ALTER COLUMN organization_id DROP NOT NULL;

ALTER TABLE org_deletion_requests
  ADD CONSTRAINT org_deletion_requests_organization_id_organizations_id_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
