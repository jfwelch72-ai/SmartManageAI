# Mobile Auth API Reference

This document covers the four authentication flows available to the
SmartManageAI mobile app (Expo / React Native): **Google**, **Apple**,
**Microsoft** (all three via the OAuth mobile-exchange pattern) and
**Passkey** (direct JSON, no redirect required).

---

## 1. Provider discovery — `GET /api/auth/providers`

**Public, unauthenticated.** Returns available login methods with the
URLs and metadata a mobile client needs to initiate each flow.
Rate-limited by the shared auth bucket (15 req / 15 min).

### Request

```
GET /api/auth/providers
```

No authentication or body required.

### Response `200 OK`

```json
{
  "providers": [
    {
      "id": "google",
      "name": "Google",
      "iconHint": "google",
      "available": true,
      "flow": "oauth_mobile_exchange",
      "initiateUrl": "https://<host>/api/auth/google?redirect=smartmanageai://auth/callback",
      "mobileExchangeRedeemUrl": "https://<host>/api/auth/mobile-exchange/redeem",
      "deepLinkScheme": "smartmanageai://auth/callback",
      "notes": "Open initiateUrl in a system browser. Append &redirect=<your-deep-link> to override the callback deep link."
    },
    {
      "id": "apple",
      "name": "Apple",
      "iconHint": "apple",
      "available": true,
      "flow": "oauth_mobile_exchange",
      "initiateUrl": "https://<host>/api/auth/apple?redirect=smartmanageai://auth/callback",
      "mobileExchangeRedeemUrl": "https://<host>/api/auth/mobile-exchange/redeem",
      "deepLinkScheme": "smartmanageai://auth/callback"
    },
    {
      "id": "microsoft",
      "name": "Microsoft",
      "iconHint": "microsoft",
      "available": false,
      "flow": "oauth_mobile_exchange",
      "initiateUrl": "https://<host>/api/auth/microsoft?redirect=smartmanageai://auth/callback",
      "mobileExchangeRedeemUrl": "https://<host>/api/auth/mobile-exchange/redeem",
      "deepLinkScheme": "smartmanageai://auth/callback"
    },
    {
      "id": "passkey",
      "name": "Passkey",
      "iconHint": "passkey",
      "available": true,
      "flow": "passkey",
      "notes": "Two-step JSON flow: POST /api/auth/passkey/auth-options then POST /api/auth/passkey/auth-verify. Send X-Mobile-Client: 1 to receive the JWT in the response body."
    }
  ],
  "mobileExchangeRedeemUrl": "https://<host>/api/auth/mobile-exchange/redeem",
  "passkeyAuthOptionsUrl": "https://<host>/api/auth/passkey/auth-options",
  "passkeyAuthVerifyUrl": "https://<host>/api/auth/passkey/auth-verify"
}
```

`available: false` means the provider is not configured on this deployment
(e.g. `MICROSOFT_CLIENT_ID` is not set). The mobile client should hide or
grey out unavailable providers.

---

## 2. OAuth mobile-exchange flow (Google / Apple / Microsoft)

Native apps cannot share cookies with the system browser, so OAuth sign-in
uses a short-lived one-time **exchange code** as an intermediary rather than
setting a cookie directly.

### Full flow

```
Mobile app                    System browser              API server
    │                               │                         │
    │ 1. Open <initiateUrl>         │                         │
    │──────────────────────────────▶│                         │
    │                               │ 2. GET /api/auth/google │
    │                               │    ?redirect=smartmanageai://auth/callback
    │                               │────────────────────────▶│
    │                               │                         │ 3. Validate redirect,
    │                               │                         │    store in cookie,
    │                               │                         │    302 → provider
    │                               │◀────────────────────────│
    │                               │                         │
    │                               │ 4. User consents at     │
    │                               │    provider UI          │
    │                               │                         │
    │                               │ 5. Provider → callback  │
    │                               │────────────────────────▶│
    │                               │                         │ 6. Exchange code for
    │                               │                         │    profile, upsert user,
    │                               │                         │    mint exchange code
    │                               │ 7. 302 → deep link      │
    │                               │    ?code=<exchange_code>│
    │◀──────────────────────────────│◀────────────────────────│
    │                               │                         │
    │ 8. POST /api/auth/mobile-exchange/redeem { code }       │
    │────────────────────────────────────────────────────────▶│
    │                               │                         │ 9. Delete code, return JWT
    │◀────────────────────────────────────────────────────────│
    │ { token }                     │                         │
```

### Step 1 — Initiate OAuth in system browser

Open the provider's initiation URL in the device's system browser
(e.g. `expo-web-browser` / `ASWebAuthenticationSession`).

| Provider  | Initiation URL |
|-----------|---------------|
| Google    | `GET /api/auth/google?redirect=<deep-link>` |
| Apple     | `GET /api/auth/apple?redirect=<deep-link>` |
| Microsoft | `GET /api/auth/microsoft?redirect=<deep-link>` |

**`redirect` parameter** (required for mobile):

- Must be a `smartmanageai://` deep link.
- URL-encode the value: `redirect=smartmanageai%3A%2F%2Fauth%2Fcallback`
- Validated server-side — any other scheme returns `400 Bad Request`.

Example:
```
GET https://app.smartmanageai.com/api/auth/google
    ?redirect=smartmanageai%3A%2F%2Fauth%2Fcallback
```

The server stores the redirect in a short-lived (10 min) httpOnly cookie
bound to the same OAuth state and threads it through the provider's consent
screen. The `redirect` is **never** sent to the OAuth provider itself.

### Step 2 — Catch the deep link

After the user consents, the server mints a 60-second one-time exchange code
and redirects the system browser to:

```
smartmanageai://auth/callback?code=<exchange_code>
```

Your app must register `smartmanageai://` as a custom URI scheme / universal
link and handle the incoming URL to extract `code`.

### Step 3 — Redeem the exchange code

Exchange the code for a JWT. The code expires in **60 seconds** and is
single-use.

**Request:**

```
POST /api/auth/mobile-exchange/redeem
Content-Type: application/json

{
  "code": "<exchange_code>"
}
```

**Response `200 OK`:**

```json
{
  "token": "<signed-jwt>"
}
```

**Error responses:**

| Status | Body | Meaning |
|--------|------|---------|
| `400`  | `{ "error": "code is required" }` | Empty request body |
| `401`  | `{ "error": "Code is invalid or expired" }` | Code not found, already redeemed, or >60 s old |

**Using the JWT:**

Store the token securely (e.g. SecureStore / Keychain) and send it with every
API request as a `Cookie: auth_token=<token>` header, or include it in the
`Authorization: Bearer <token>` header if the mobile HTTP client doesn't
support cookies.

---

## 3. Passkey auth (mobile)

Passkey authentication is a pure JSON flow — no system browser or redirect
required. Send `X-Mobile-Client: 1` to receive the JWT in the response body
in addition to the cookie.

> **Note:** Passkey *registration* from a mobile device is out of scope for
> this release. Authentication assumes the passkey was registered from a web
> browser on the same relying-party domain.

### Step 1 — Get authentication options

```
POST /api/auth/passkey/auth-options
Content-Type: application/json
Origin: https://<your-rp-domain>

{}
```

**Response `200 OK`:**

```json
{
  "challenge": "<base64url-challenge>",
  "timeout": 60000,
  "rpId": "<rp-id>",
  "allowCredentials": [],
  "userVerification": "preferred",
  "sessionId": "<session-id>"
}
```

Store the `sessionId` — you'll need it in the next step.

### Step 2 — Sign the challenge and verify

Pass the `challenge` to the platform authenticator (e.g.
`navigator.credentials.get()` / `startAuthentication()` from
`@simplewebauthn/browser`). Then submit the signed assertion:

**Request:**

```
POST /api/auth/passkey/auth-verify
Content-Type: application/json
X-Mobile-Client: 1
Origin: https://<your-rp-domain>

{
  "sessionId": "<session-id>",
  "response": {
    "id": "<credential-id>",
    "rawId": "<base64url>",
    "type": "public-key",
    "response": {
      "authenticatorData": "<base64url>",
      "clientDataJSON": "<base64url>",
      "signature": "<base64url>",
      "userHandle": "<base64url>"
    }
  }
}
```

**Response `200 OK` (with `X-Mobile-Client: 1` header):**

```json
{
  "verified": true,
  "user": {
    "id": "<uuid>",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane@example.com",
    "role": "ADMIN",
    "organizationId": "<org-uuid>"
  },
  "redirectTo": "/dashboard",
  "token": "<signed-jwt>"
}
```

`token` is only present when `X-Mobile-Client: 1` is sent. Web clients
receive the JWT only as an httpOnly cookie (`auth_token`).

**Error responses:**

| Status | Body | Meaning |
|--------|------|---------|
| `400`  | `{ "error": "Challenge expired or not found. Please try again." }` | Session expired (> 5 min) |
| `400`  | `{ "error": "...", "code": "NO_PASSKEY_FOR_DOMAIN" }` | No passkey registered on this RP domain |
| `400`  | `{ "error": "...", "code": "RPID_MISMATCH" }` | Passkey was registered on a different domain |
| `400`  | `{ "error": "Passkey authentication failed" }` | Signature invalid |
| `403`  | `{ "error": "Account is disabled" }` | User is inactive |
| `403`  | `{ "error": "...", "suspended": true }` | Organization suspended |

---

## 4. Using the JWT

All API endpoints accept the JWT either as a cookie or a header.

### Cookie (default, web)

The server sets `Set-Cookie: auth_token=<token>; HttpOnly; SameSite=Lax`.
Browsers and Expo web send this automatically.

### Header (React Native)

If your HTTP client doesn't forward cookies, attach the token manually:

```
Cookie: auth_token=<token>
```

or (for clients that support Authorization headers and the server accepts
bearer tokens on the endpoint in question):

```
Authorization: Bearer <token>
```

The JWT is valid for **7 days**. There is currently no refresh-token
endpoint — when the token expires the user must re-authenticate.

---

## 5. Security notes

- The `redirect` query parameter on OAuth initiation routes is validated
  against `smartmanageai://` — any other scheme is rejected with `400`.
- Exchange codes expire in **60 seconds** and are single-use (atomic
  `DELETE … RETURNING` in Postgres).
- The `X-Mobile-Client` header opts *in* to token-in-body; without it the
  JWT is cookie-only, consistent with OWASP guidance for web clients.
- All successful OAuth and passkey logins are written to `audit_log`
  (`entityType=users`, `action=LOGIN`) with a `method` field
  (`OAUTH_GOOGLE`, `OAUTH_APPLE`, `OAUTH_MICROSOFT`, or `PASSKEY`) for
  the SOC 2 trail.
- The discovery endpoint (`GET /api/auth/providers`) is rate-limited at
  15 requests per 15 minutes per IP to prevent enumeration.
