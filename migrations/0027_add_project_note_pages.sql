-- Create note_block_type enum
DO $$ BEGIN
  CREATE TYPE note_block_type AS ENUM ('HEADING1', 'HEADING2', 'HEADING3', 'PARAGRAPH', 'BULLETED_LIST', 'NUMBERED_LIST', 'TODO', 'DIVIDER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create project_note_pages table
CREATE TABLE IF NOT EXISTS project_note_pages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  author_id VARCHAR NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_note_pages_project_id_idx ON project_note_pages(project_id);
CREATE INDEX IF NOT EXISTS project_note_pages_author_id_idx ON project_note_pages(author_id);

-- Create project_note_blocks table
CREATE TABLE IF NOT EXISTS project_note_blocks (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id VARCHAR NOT NULL REFERENCES project_note_pages(id) ON DELETE CASCADE,
  type note_block_type NOT NULL DEFAULT 'PARAGRAPH',
  content JSON NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  checked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_note_blocks_page_id_idx ON project_note_blocks(page_id);
CREATE INDEX IF NOT EXISTS project_note_blocks_sort_order_idx ON project_note_blocks(sort_order);
