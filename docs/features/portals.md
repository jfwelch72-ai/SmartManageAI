# portals — Unified Portal, Client Portal, Sub/Vendor Portal, Portal Chat, Portal Activity Log, Public Booking/Form Pages

## Overview

The portals module provides externally-facing web experiences for three audiences: **clients** (project owners who can view progress, approve pay apps, and download reports); **subcontractors and vendors** (who can respond to bid invitations, submit pay apps, upload compliance docs, and track payments); and **general public** (lead forms, booking pages, public website pages). Each portal user has a separate authentication flow (token-based) isolated from internal org accounts.

## Data Models

**Key tables (`shared/schema/features/portal.ts`)**

| Table | Description |
|---|---|
| `portal_access_links` | `projectId`, `organizationId`, `recipientEmail`, `recipientName`, `accessLevel` (VIEW/APPROVE/FULL), `token`, `expiresAt`, `lastAccessedAt` |
| `portal_users` | Portal-specific user accounts: `email`, `organizationId`, `type` (CLIENT/SUB/VENDOR), `passwordHash`, `isActive` |
| `portal_sessions` | Portal user sessions (separate from main JWT auth) |
| `portal_activity_log` | All portal actions: `portalUserId`, `action`, `entityType`, `entityId`, `ipAddress`, `timestamp` |
| `portal_pay_applications` | Sub/vendor pay apps submitted through the portal |
| `portal_documents` | Documents uploaded through the portal |
| `portal_conversations` | Chat conversations accessible from the portal side |
| `sub_portal_access` | Subcontractor portal access records: `subcontractorId`, `projectId`, `allowedSections` (JSON) |
| `client_portal_settings` | Per-project portal configuration: `showBudget`, `showSchedule`, `showPayApps`, `showDocuments`, `customBranding` |
| `rfq_responses` | RFQ (Request for Quote) responses from vendors: `token`, `vendorName`, `items` (JSON), `total`, `submittedAt` |
| `quote_acceptances` | Client quote acceptance records: `token`, `acceptedByName`, `acceptedByEmail`, `signature`, `acceptedAt` |

## Backend Routes

**File: `server/unifiedPortalRoutes.ts`** — client portal:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/portal/:token/overview` | Project overview for client | portal token |
| GET | `/api/portal/:token/pay-applications` | Pay apps for client approval | portal token |
| POST | `/api/portal/:token/pay-applications/:id/approve` | Client approves pay app | portal token |
| GET | `/api/portal/:token/documents` | Project documents | portal token |
| GET | `/api/portal/:token/schedule` | Project schedule | portal token |
| GET | `/api/portal/:token/rfis` | RFI log | portal token |

**File: `server/subPortalRoutes.ts`** — sub/vendor portal:
| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/sub-portal/auth` | Sub/vendor portal login | Public |
| GET | `/api/sub-portal/projects` | Projects accessible to sub | sub session |
| POST | `/api/sub-portal/pay-applications` | Submit pay app | sub session |
| POST | `/api/sub-portal/documents/upload` | Upload compliance doc | sub session |
| GET | `/api/sub-portal/payments` | Payment history | sub session |

**File: `server/portalAccessRoutes.ts`** — managing portal invites (internal):
| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/portal-access` | Creates portal access link | `requireAuth` + `canManagePortals` |
| GET | `/api/portal-access` | Lists access links for org | `requireAuth` + `canManagePortals` |
| DELETE | `/api/portal-access/:id` | Revokes access link | `requireAuth` + `canManagePortals` |

**File: `server/publicPortalRoutes.ts`** — public portal pages:
| Method | Path | Description |
|---|---|---|
| GET | `/api/public/portal/:projectId` | Public project info (if org has public sharing enabled) |

**File: `server/rfqResponseRoutes.ts`** — RFQ response form:
| Method | Path | Description |
|---|---|---|
| GET | `/api/rfq/:token` | Public RFQ response form data |
| POST | `/api/rfq/:token/submit` | Submits vendor quote |

**File: `server/publicQuoteAcceptRoutes.ts`** — public quote acceptance

**File: `server/clientPortalVerifyRoutes.ts`** — client portal email verification

**File: `server/portalChatRoutes.ts`** — portal-side chat:
| Method | Path | Description |
|---|---|---|
| GET | `/api/portal-chat/conversations` | Lists portal user's conversations |
| POST | `/api/portal-chat/conversations/:id/messages` | Sends message |

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/portal/:projectId` | Dynamic component in `App.tsx` | Client portal entry (public, token-gated) |
| `/sub-portal` | `client/src/pages/sub-portal.tsx` | Subcontractor portal entry |
| `/portal` | `client/src/pages/unified-portal.tsx` | Unified portal hub |
| `/portal-chat` | `client/src/pages/unified-messages.tsx` | Portal chat via messages alias |
| `/rfq-response/:token` | `client/src/pages/rfq-response.tsx` | Public RFQ response form |
| `/quotes/accept/:token` | `client/src/pages/quote-accept.tsx` | Public quote acceptance |
| `/leads/:orgSlug` | `client/src/pages/public-lead-form.tsx` | Public lead form |
| `/book/:slug` | `client/src/pages/public-booking.tsx` | Public booking page |

## Roles & Permissions

Portal users are entirely separate from org users. They authenticate via:
- **Token-based links** — for client portal (read-only or approve-only)
- **Email + password** — for sub/vendor portal accounts with full session

| Internal action | Gate |
|---|---|
| Create portal access | `canManagePortals` — ADMIN, MANAGER |
| Configure portal settings | `canManagePortals` — ADMIN |
| View portal activity log | `canManagePortals` — ADMIN, MANAGER |

## Integration Points

- **Separate auth** — portal sessions use different JWT secret scoped to portal; `server/portalAuth.ts` implements `requirePortalAuth` middleware
- **Portal activity log** — `portal_activity_log` captures every portal user action (page view, document download, approval); used for access auditing
- **Messaging** — portal chat shares the `conversations` table but is filtered by `portalUserId`; real-time delivery via WebSocket with portal-scoped rooms
- **COI compliance** — sub portal triggers COI document upload flow; verified certs update `coi_records` table used by `coiGating.ts` in pay app creation
- **RFQ** — `rfq_responses` submitted by vendors are surfaced in the bid detail page for the GC to compare quotes
- **Client branding** — `client_portal_settings` allows per-project logo, colors, and section visibility customization
