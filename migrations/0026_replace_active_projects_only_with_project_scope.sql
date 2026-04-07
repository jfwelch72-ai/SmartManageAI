DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_dashboard_permissions' AND column_name = 'project_scope'
  ) THEN
    ALTER TABLE "user_dashboard_permissions"
      ADD COLUMN "project_scope" text NOT NULL DEFAULT 'ALL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_dashboard_permissions' AND column_name = 'can_access_active_projects_only'
  ) THEN
    UPDATE "user_dashboard_permissions"
      SET "project_scope" = 'ACTIVE_ONLY'
      WHERE "can_access_active_projects_only" = true AND "project_scope" = 'ALL';

    ALTER TABLE "user_dashboard_permissions"
      DROP COLUMN "can_access_active_projects_only";
  END IF;
END $$;
