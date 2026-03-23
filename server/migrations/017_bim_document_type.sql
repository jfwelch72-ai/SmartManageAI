-- Add BIM value to document_type enum for IFC file support
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'BIM';
