-- Task #1747: per-type mute snooze deadline.
--
-- Adds a nullable `muted_until` timestamp to `notification_type_prefs`
-- so admins can set a 7-day / 30-day auto-clearing snooze on a
-- notification type (e.g. the project-log email failures digest)
-- instead of being limited to indefinite mutes that they have to
-- remember to manually re-enable later.
--
-- Semantics enforced by the read paths
--   - server/notificationPreferencesRoutes.ts (digest GET/PUT)
--   - server/notificationRoutes2.ts          (in-app feed mute set)
--   - server/services/notificationDelivery.ts (loadEffectivePrefs):
--     * NULL          -> indefinite mute (historical behavior)
--     * future ts     -> active snooze; mute applies until the deadline
--     * past ts       -> override row treated as if it didn't exist;
--                        channel default wins for both the in-app feed
--                        AND outbound delivery (email/SMS/push/Teams/Slack).
--
-- Idempotent — also mirrored by
-- server/utils/ensureNotificationTypePrefsMutedUntil.ts so the
-- column is present after every boot even on environments that don't
-- replay numbered migrations.

ALTER TABLE notification_type_prefs
  ADD COLUMN IF NOT EXISTS muted_until timestamp;
