/**
 * Task #2755 — Shared sentinel for permanent OAuth token failures across all
 * integration providers. When a refresh_token call returns a non-retryable
 * error (invalid_grant, revoked consent, expired secret, etc.) the provider
 * MUST throw this class (or a subclass) so that callers can:
 *   1. Mark the integration connection as `needs_reconnect`
 *   2. Stop repeating the refresh attempt on every scheduled sync tick
 *   3. Surface a visible Reconnect banner to org admins
 *
 * Providers that have additional provider-specific metadata may subclass it
 * (see MicrosoftOAuthPermanentError).
 */
export class OAuthPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthPermanentError";
  }
}
