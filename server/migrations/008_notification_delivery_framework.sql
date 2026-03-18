-- Migration: Notification Delivery Framework (Task #49)
-- Adds DEADLINE_WARNING and REMINDER to notification_type enum,
-- and creates notification_channel_prefs and notification_type_prefs tables.
-- NOTE: These were already applied directly via executeSql during development.
-- This file documents the changes for deployment reproducibility.

-- Add new notification type enum values
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'DEADLINE_WARNING';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'REMINDER';

-- Create notification_channel_prefs table
CREATE TABLE IF NOT EXISTS notification_channel_prefs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  email_enabled BOOLEAN NOT NULL DEFAULT false,
  sms_enabled BOOLEAN NOT NULL DEFAULT false,
  push_enabled BOOLEAN NOT NULL DEFAULT false,
  teams_enabled BOOLEAN NOT NULL DEFAULT false,
  slack_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create notification_type_prefs table
CREATE TABLE IF NOT EXISTS notification_type_prefs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type notification_type NOT NULL,
  email_enabled BOOLEAN NOT NULL DEFAULT false,
  sms_enabled BOOLEAN NOT NULL DEFAULT false,
  push_enabled BOOLEAN NOT NULL DEFAULT false,
  teams_enabled BOOLEAN NOT NULL DEFAULT false,
  slack_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_type_prefs_user_type_unique UNIQUE (user_id, notification_type)
);
