# auth — Authentication, Sessions, MFA, SSO, Password Reset, Token Versioning

## Overview

The auth module provides all identity and session management for the platform. It uses HTTP-only JWT cookies signed with `SESSION_SECRET`, a 5-second per-process auth cache, per-user `tokenVersion` for global session revocation, bcrypt(10) password hashing, TOTP-based MFA, passkey (WebAuthn) support, and optional SAML/OIDC SSO. Every role and feature-permission check flows through `server/auth.ts`.

## Data Models

**Key tables (`shared/schema/features/compliance.ts`, `shared/schema/core.ts`)**

| Table | Description |
|---|---|
| `users` | Core user record — `id`, `email`, `passwordHash`, `role`, `organizationId`, `tokenVersion`, `isActive`, `mfaEnabled`, `mfaSecret`, `emailVerified` |
| `organizations` | Tenant record — `id`, `slug`, `name`, `tradeType`, `isActive`, `onboardingStatus` |
| `password_reset_tokens` | Short-lived bcrypt-hashed tokens for `/forgot-password` / `/reset-password` flows |
| `user_sessions` | Optional session rows for concurrent-session UI; not used for JWT verification |
| `active_sessions` | Aggregated active session counts per user |
| `user_totp_secrets` | TOTP secret + backup codes, encrypted at rest |
| `passkey_credentials` | WebAuthn credentials: `credentialId`, `publicKey`, `counter`, `deviceType` |
| `sso_connections` | Per-org SAML/OIDC connection config (entity ID, metadata URL, certificate) |
| `user_api_keys` | Public API personal access tokens with scope list and rate-limit config |
| `hustler_organizations` | HUSTLER role's delegated access to multiple orgs, with `roleOverride` |
| `user_dashboard_permissions` | Per-user feature permission overrides that layer on top of role defaults |

## Backend Routes

**File: `server/auth.ts`** — middleware exports (not a route file):
- `authMiddleware` — attaches `req.user` from JWT cookie
- `requireAuth` — sends 401 if unauthenticated
- `requireRole(...roles)` — sends 403 if role not in list (HUSTLER users use `effectiveRole`)
- `requireFeaturePermission(key)` — checks granular feature permission
- `getEffectivePermissions(userId, orgId, role)` — merges role defaults with DB overrides

**File: `server/authProfileRoutes.ts`** — auth endpoints:
| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/auth/login` | Email + password login; sets JWT cookie; logs `LOGIN` / `LOGIN_FAILED` audit event | Public + `authLimiter` |
| POST | `/api/auth/register` | Creates new user + org in a transaction | Public + `authLimiter` |
| POST | `/api/auth/logout` | Clears cookie; logs `LOGOUT` | Any |
| GET | `/api/auth/me` | Returns sanitized current user | `requireAuth` |
| POST | `/api/auth/forgot-password` | Sends reset email with short-lived token | Public + `authLimiter` |
| POST | `/api/auth/reset-password` | Validates token, hashes new password, bumps `tokenVersion` | Public + `authLimiter` |
| POST | `/api/auth/resend-verification` | Resends email-verification link | Public + `authLimiter` |
| POST | `/api/auth/verify-email` | Marks `emailVerified = true` | Public |
| POST | `/api/auth/change-password` | Old password check + new bcrypt hash; bumps `tokenVersion`; logs `PASSWORD_CHANGE` | `requireAuth` |
| POST | `/api/auth/set-initial-password` | First-login password set for invited users | Public |

**File: `server/userSettingsRoutes.ts`** — MFA endpoints:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/account/2fa/setup` | Generates TOTP secret + QR code | `requireAuth` |
| POST | `/api/account/2fa/verify` | Validates TOTP code and enables MFA; logs `MFA_ENABLED` | `requireAuth` |
| POST | `/api/account/2fa/disable` | Disables MFA; logs `MFA_DISABLED` | `requireAuth` |
| POST | `/api/account/2fa/validate` | Validates code during login second-factor step | `requireAuth` |
| GET | `/api/account/2fa/backup-codes` | Returns remaining backup codes | `requireAuth` |
| POST | `/api/account/2fa/regenerate-backup-codes` | Regenerates backup codes | `requireAuth` |

**File: `server/passkeyRoutes.ts`** — WebAuthn:
| Method | Path | Description |
|---|---|---|
| POST | `/api/passkeys/register/begin` | Issues registration challenge |
| POST | `/api/passkeys/register/complete` | Verifies attestation and stores credential |
| POST | `/api/passkeys/authenticate/begin` | Issues authentication challenge |
| POST | `/api/passkeys/authenticate/complete` | Verifies assertion and issues JWT |
| GET | `/api/passkeys` | Lists user's registered passkeys |
| DELETE | `/api/passkeys/:id` | Removes a passkey |

**File: `server/ssoRoutes.ts`** — SAML/OIDC:
| Method | Path | Description |
|---|---|---|
| GET | `/api/sso/connections` | Lists org's SSO connections |
| POST | `/api/sso/connections` | Creates/updates SSO connection config |
| POST | `/api/sso/saml/acs` | SAML Assertion Consumer Service endpoint |
| GET | `/api/sso/oidc/callback` | OIDC redirect callback |

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/login` | `client/src/pages/login.tsx` | Email/password + SSO buttons |
| `/register` | `client/src/pages/register.tsx` | New account creation |
| `/forgot-password` | `client/src/pages/forgot-password.tsx` | Password reset request form |
| `/reset-password` | `client/src/pages/reset-password.tsx` | Token-validated password reset |
| `/profile` | `client/src/pages/profile.tsx` | Avatar, name, email, password change |
| `/settings` | `client/src/pages/settings.tsx` | MFA setup, passkeys, session list |

Auth state is provided by `useAuth()` hook (`client/src/hooks/useAuth.tsx`). Token is stored in HTTP-only cookie; the hook reads `GET /api/auth/me` on mount.

## Roles & Permissions

| Role | Capabilities |
|---|---|
| `SUPER_ADMIN` | Bypasses all org and role checks; accesses all endpoints |
| `ADMIN` | Full permissions within their org; manages users, billing, settings |
| `HUSTLER` | Multi-org operator; `effectiveRole` from `hustler_organizations.roleOverride` |
| `MANAGER` | Most permissions except financials edit, AI settings, enterprise settings |
| `SUPERINTENDENT` | Field operations, approvals, time clock management |
| `ESTIMATOR` | Bids, estimates, takeoff, procurement, CRM |
| `FIELD_WORKER` | Dashboard, time clock, daily reports, messages, safety |
| `VENDOR` | Dashboard, messages, bid network inbox |

Feature permissions are the granular `canXxx` flags (75+ keys) stored in `user_dashboard_permissions` and merged with role defaults by `getEffectivePermissions()`.

## Integration Points

- **JWT** — `jsonwebtoken` library; `SESSION_SECRET` env var; 7-day expiry; `tokenVersion` field for revocation
- **bcrypt** — `bcrypt.hash(password, 10)` for password storage
- **SendGrid** — `sendEmail()` used for password reset and email verification messages
- **Audit log** — `logAuthEvent()` in `server/auditLogger.ts` writes `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `PASSWORD_CHANGE`, `PASSWORD_RESET`, `PASSWORD_RESET_REQUESTED`, `MFA_ENABLED`, `MFA_DISABLED`
- **Rate limiting** — `authLimiter` (15 min / 15 requests) on all auth endpoints via `server/rateLimiter.ts`
- **Auth cache** — 5-second TTL `Map<userId, AuthCacheEntry>` in `server/auth.ts`; `invalidateAuthCache(userId)` called on role changes and token revocations
- **Postgres RLS** — `orgContextMiddleware` sets `app.current_org_id` session variable after every auth check (see `docs/architecture/tenant-isolation.md`)
