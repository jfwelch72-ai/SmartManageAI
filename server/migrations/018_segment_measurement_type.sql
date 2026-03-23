-- Add SEGMENT measurement type to the measurement_type enum
ALTER TYPE measurement_type ADD VALUE IF NOT EXISTS 'SEGMENT';
