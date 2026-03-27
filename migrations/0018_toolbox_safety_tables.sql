CREATE TABLE IF NOT EXISTS toolbox_talk_topics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  category TEXT NOT NULL,
  attachments TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS toolbox_talk_scheduled (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  topic_id VARCHAR NOT NULL REFERENCES toolbox_talk_topics(id) ON DELETE CASCADE,
  project_id VARCHAR REFERENCES projects(id) ON DELETE SET NULL,
  scheduled_date TEXT NOT NULL,
  presenter TEXT,
  presenter_id VARCHAR REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'SCHEDULED',
  notes TEXT,
  completed_at TIMESTAMP,
  created_by VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS toolbox_talk_attendance (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_talk_id VARCHAR NOT NULL REFERENCES toolbox_talk_scheduled(id) ON DELETE CASCADE,
  employee_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  signature TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS safety_checklist_templates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS safety_checklist_instances (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id VARCHAR NOT NULL REFERENCES safety_checklist_templates(id) ON DELETE CASCADE,
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id VARCHAR REFERENCES projects(id) ON DELETE SET NULL,
  completed_by VARCHAR NOT NULL REFERENCES users(id),
  completed_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  responses_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  photo_urls TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
