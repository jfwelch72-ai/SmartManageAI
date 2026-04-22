# Encryption Policy

| Owner | CTO |
| ----- | --- |
| Approver | CEO |
| Review cadence | Annual |

## 1. Encryption in transit

- All client traffic is served over **TLS 1.2 or higher**. TLS 1.0/1.1 and
  SSL are disabled at the edge.
- HTTP requests are redirected to HTTPS; HSTS is enabled at the edge with
  a 1-year `max-age` and `includeSubDomains`.
- Session cookies (`auth_token`, `csrf_token`) are issued with
  `secure: true` in production (`server/auth.ts`, `server/csrf.ts`).
- Inter-service traffic inside the production VPC uses TLS where the
  service supports it; the VPC itself is private.
- Webhook **inbound** traffic must use HTTPS and is verified by signature
  where the provider supports it (e.g. Stripe).

## 2. Encryption at rest

| Store | Algorithm | Key management |
| ----- | --------- | -------------- |
| Postgres (Neon) | AES-256 | Provider-managed (Neon SOC 2) |
| Object storage (GCS) | AES-256 | Provider-managed (Google KMS) |
| Backups (GCS bucket) | AES-256 | Provider-managed; bucket has object-lock |
| Endpoint disks (staff laptops) | FileVault / BitLocker (AES-256) | Per-user; recovery key escrowed in MDM |

## 3. Application-layer cryptography

- Passwords are hashed with **bcrypt** at cost factor 10
  (`server/auth.ts` `hashPassword` / `verifyPassword`).
- Session JWTs are signed with HS256 using `SESSION_SECRET` (required at
  startup; the application refuses to boot without it).
- WebAuthn passkeys (`server/passkeyRoutes.ts`) provide phishing-resistant
  authentication. Public keys are stored base64-encoded.
- CSRF tokens are 32 bytes from `crypto.randomBytes`
  (`server/csrf.ts`).

## 4. Key management

- Application secrets live in the managed environment-variables vault;
  none are committed to the repository.
- Secret rotation:
  - `SESSION_SECRET`: rotated on suspected compromise; rotation
    invalidates all sessions.
  - Provider API keys: rotated annually or on staff change.
  - SSO certificates (`server/ssoRoutes.ts`): customer-managed; we accept
    rotation via the admin UI.

## 5. Prohibited

- Custom-rolled cryptographic primitives.
- MD5 / SHA-1 for any security-relevant purpose.
- Storing plaintext credentials, secrets, or PANs in the database, logs,
  or repository.
