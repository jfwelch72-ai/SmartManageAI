ALTER TABLE tm_tickets ADD COLUMN IF NOT EXISTS client_signoff_name text;
ALTER TABLE tm_tickets ADD COLUMN IF NOT EXISTS client_signoff_signature text;
ALTER TABLE tm_tickets ADD COLUMN IF NOT EXISTS client_signoff_at timestamp;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS auto_invoice boolean DEFAULT false;
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'TM_INVOICE_AUTO_CREATED';
