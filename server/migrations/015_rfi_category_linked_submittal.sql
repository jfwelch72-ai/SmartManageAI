-- Add category and linkedSubmittalId fields to rfis table
ALTER TABLE rfis ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE rfis ADD COLUMN IF NOT EXISTS linked_submittal_id varchar REFERENCES submittals(id) ON DELETE SET NULL;
