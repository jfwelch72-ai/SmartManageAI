# vendor-marketplace — Bid Network, Marketplace, Vendor Workspace, Vendor Scores, Vendor Pricing Catalog, Hustler (Multi-Org Oversight) Module

## Overview

The vendor marketplace module connects GC organizations with subcontractors and suppliers through a structured bid network. GCs send **bid invitations** to subs; subs respond through their vendor workspace. **Vendor scores** aggregate historical performance (quality, schedule, safety, payment timeliness) into a single score. The **vendor pricing catalog** lets orgs manage approved vendor price books for estimate line item population. The **Hustler module** is a separate overlay that allows a multi-org operator (HUSTLER role) to manage, monitor, and provide oversight across multiple client organizations.

## Data Models

**Key tables (`shared/schema/features/subcontractor.ts`, `shared/schema/features/vendor_pricing.ts`, `shared/schema/features/hustler.ts`)**

| Table | Description |
|---|---|
| `subcontractors` | Vendor/sub master: `name`, `trade`, `email`, `phone`, `address`, `website`, `licenseNumber`, `insuranceExpiry`, `bondingCapacity`, `organizationId` |
| `subcontractor_bid_invitations` | Bid invitations sent to subs: `bidId`, `subcontractorId`, `status` (INVITED/VIEWED/RESPONDED/DECLINED), `sentAt`, `responseDeadline` |
| `subcontractor_bid_responses` | Sub quote responses: `invitationId`, `bidAmount`, `coverLetter`, `submittedAt` |
| `subcontractor_contracts` | Executed contracts: `subcontractorId`, `projectId`, `contractValue`, `retainagePercent`, `status` |
| `subcontractor_payments` | Payments to subs |
| `subcontractor_billing_schedule` | Milestone billing dates |
| `subcontractor_scores` | Performance scores: `subcontractorId`, `qualityScore`, `safetyScore`, `scheduleScore`, `paymentScore`, `overallScore`, `reviewCount` |
| `subcontractor_score_reviews` | Individual review records linked to a project |
| `vendor_pricing_catalogs` | `name`, `vendorName`, `tradeCategory`, `effectiveDate`, `organizationId` |
| `vendor_pricing_pricebook_items` | Individual priced line items within a catalog |
| `vendor_pricing_enrollments` | Which orgs have access to which vendor catalogs |
| `marketplace_listings` | Marketplace listings from vendors: `title`, `tradeCategory`, `description`, `coverageArea`, `pricingModel` |
| `marketplace_inquiries` | GC inquiries to marketplace listings |
| `coi_records` | Certificates of insurance per sub per project: `subcontractorId`, `projectId`, `insurerName`, `policyNumber`, `expirationDate`, `coverageType`, `status` (VALID/EXPIRED/PENDING) |
| `coi_release_overrides` | Audited COI compliance hold overrides |
| `hustler_organizations` | HUSTLER membership: `hustlerUserId`, `clientOrganizationId`, `roleOverride`, `grantedById`, `grantedAt` |
| `hustler_link_requests` | Pending link requests: `hustlerUserId`, `clientOrganizationId`, `status`, `requestedAt` |
| `hustler_delegate_sessions` | Active sessions where HUSTLER is acting on behalf of a client org |
| `hustler_activity_log` | Audited record of every action taken by HUSTLER on a client org |

## Backend Routes

**File: `server/bidNetworkRoutes.ts`** — bid invitations:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/bid-network/invitations` | Lists invitations sent by org | `canAccessBidNetworkGC` |
| POST | `/api/bid-network/invitations` | Sends invitation to sub | `canAccessBidNetworkGC` |
| GET | `/api/bid-network/inbox` | Vendor: lists received invitations | `canAccessBidNetworkVendor` |
| POST | `/api/bid-network/invitations/:id/respond` | Vendor: submits quote response | `canAccessBidNetworkVendor` |
| POST | `/api/bid-network/invitations/:id/decline` | Vendor: declines invitation | `canAccessBidNetworkVendor` |
| GET | `/api/bid-network/subcontractors` | GC: lists approved sub directory | `canAccessBidNetworkGC` |

**File: `server/subcontractorScoreRoutes.ts`** — vendor scores:
| Method | Path | Description |
|---|---|---|
| GET | `/api/subs/:id/score` | Returns vendor score details |
| POST | `/api/subs/:id/reviews` | Submits a project review for a sub |

**File: `server/vendorPricingRoutes.ts`** — pricing catalogs:
| Method | Path | Description |
|---|---|---|
| GET | `/api/vendor-pricing/catalogs` | Lists accessible catalogs |
| POST | `/api/vendor-pricing/catalogs` | Creates catalog |
| POST | `/api/vendor-pricing/catalogs/:id/items/import` | CSV import of priced items |
| GET | `/api/vendor-pricing/catalogs/:id/match` | Fuzzy-matches catalog to estimate line item |

**File: `server/marketplaceRoutes.ts`** — marketplace listings:
| Method | Path | Description |
|---|---|---|
| GET | `/api/marketplace/listings` | Lists marketplace listings (filter: trade, area) |
| POST | `/api/marketplace/listings` | Creates listing (VENDOR/ADMIN) |
| POST | `/api/marketplace/inquiries` | Sends inquiry |

**File: `server/coiRoutes.ts`** — COI management:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/coi` | Lists COI records for org | `canManageSubcontracts` |
| POST | `/api/coi` | Creates COI record | `canManageSubcontracts` |
| PATCH | `/api/coi/:id/status` | Updates COI status | `canManageSubcontracts` |
| POST | `/api/coi/overrides` | Creates audited compliance hold override | `requireRole('ADMIN','SUPER_ADMIN')` |
| `hasActiveOverride()` | — | Internal: checks if override exists; called by AIA billing | — |

**File: `server/hustlerRoutes.ts`** — Hustler module:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/hustler/organizations` | Lists client orgs for HUSTLER | `HUSTLER` |
| GET | `/api/hustler/inbox` | Lists link requests | `HUSTLER` |
| POST | `/api/hustler/link-requests/respond` | Accept/deny link request (logs `ROLE_GRANTED`/`ROLE_REVOKED`) | `HUSTLER` |
| POST | `/api/hustler/accept-invite` | Accepts org invite | `HUSTLER` |
| DELETE | `/api/hustler/unlink-organization/:id` | Unlinks from org (logs `ROLE_REVOKED`) | `HUSTLER` |
| POST | `/api/hustler/delegate` | Creates delegate session for a client org | `HUSTLER` |
| DELETE | `/api/hustler/delegate` | Ends delegate session | `HUSTLER` |
| GET | `/api/hustler/org/:orgId/dashboard` | Client org dashboard accessed by HUSTLER | `HUSTLER` |

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/bids` | `client/src/pages/bids.tsx` | Includes bid invitation panel |
| `/marketplace` | `client/src/pages/marketplace.tsx` | Vendor marketplace browse |
| `/hustler` | `client/src/pages/hustler.tsx` | HUSTLER multi-org dashboard |
| `/hustler/inbox` | `client/src/pages/hustler-inbox.tsx` | Link request inbox |
| `/hustler/org/:orgId` | `client/src/pages/hustler-org.tsx` | Client org view for HUSTLER |

## Roles & Permissions

| Action | Gate |
|---|---|
| Access bid network (GC) | `canAccessBidNetworkGC` — ADMIN, MANAGER, ESTIMATOR |
| Access bid network (Vendor) | `canAccessBidNetworkVendor` — VENDOR role |
| Access marketplace | `canAccessMarketplace` |
| Manage subcontractors | `canManageSubcontracts` — ADMIN, MANAGER |
| Score vendors | `canScoreVendors` — ADMIN, MANAGER, SUPERINTENDENT |
| Manage COI records | `canManageSubcontracts` |
| Create COI override | `requireRole('ADMIN','SUPER_ADMIN')` |
| HUSTLER module | `role = 'HUSTLER'`; `effectiveRole` from `hustler_organizations` governs per-org capabilities |

## Integration Points

- **COI gating** — `isReleaseBlocked()` in `server/services/coiGating.ts` checks `coi_records` table for expired or pending COI on project subs before allowing pay app creation
- **Vendor scoring** — scores are computed as weighted average of project reviews; `overallScore` stored in `subcontractor_scores`; displayed on sub directory and bid invitation form
- **Vendor pricing match** — `vendorPricingRoutes.ts` `fuzzyMatch()` uses token-overlap + Levenshtein distance to match vendor catalog items to estimate line items; score threshold configurable per org
- **HUSTLER audit** — all HUSTLER actions on client org data are tagged with `hustlerUserId` in `hustler_activity_log`; `ROLE_GRANTED` / `ROLE_REVOKED` written to `audit_log`
- **Hustler `effectiveRole`** — `server/auth.ts` `getEffectivePermissions()` reads `hustler_organizations.roleOverride` to determine HUSTLER's role within each client org; roles scope down (HUSTLER cannot exceed CLIENT's ADMIN)
- **Invite flow** — HUSTLER sends link requests; client org ADMIN approves via `respond` endpoint; on approval, `hustler_organizations` row is inserted and `ROLE_GRANTED` audit event is written
