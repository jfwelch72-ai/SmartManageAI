-- Task #2755: OAuth reconnect alert flow
-- Add needs_reconnect to integration_connection_status so the system can
-- distinguish permanent auth failures (invalid_grant, revoked token) from
-- transient errors — and skip retrying until the user re-authorizes.
ALTER TYPE "public"."integration_connection_status" ADD VALUE IF NOT EXISTS 'needs_reconnect';

-- Add INTEGRATION_RECONNECT_REQUIRED to notification_type so admins receive
-- an in-app bell notification when an OAuth connection expires permanently.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'INTEGRATION_RECONNECT_REQUIRED';
