-- Null organizationId Audit: Enforce NOT NULL on tenant-scoped tables
-- Tables that legitimately remain nullable:
--   users (users exist before joining an org)
--   error_logs (system errors may lack org context)
--   modifiers (global/system modifiers, all null)
--   permission_presets (global presets, all null)
--   notifications (system notifications without org)
--   rental_equipment_catalog (global catalog items)

-- Data cleanup (run before constraints):
-- DELETE FROM activity_log WHERE organization_id IS NULL; -- 9 orphan rows
-- DELETE FROM crew_members WHERE crew_id IN (SELECT id FROM crews WHERE organization_id IS NULL);
-- DELETE FROM crew_project_assignments WHERE crew_id IN (SELECT id FROM crews WHERE organization_id IS NULL);
-- DELETE FROM crews WHERE organization_id IS NULL; -- 4 orphan rows

-- Enforce NOT NULL on 23 tenant-scoped tables:
ALTER TABLE ai_insights ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE attendance_logs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE conversations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE crm_contacts ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE crm_organisation_notes ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE crm_organisations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE employee_performance_profiles ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE equipment ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE performance_reviews ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE quality_issues ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE safety_incidents ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE supervisor_notes ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE takeoff_markups ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE talent_profiles ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE user_settings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE vendor_pricing_catalogs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE vendor_service_catalog ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE worker_logs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE activity_log ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE crews ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE tm_invoices ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE tasks ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE upload_intents ALTER COLUMN organization_id SET NOT NULL;
