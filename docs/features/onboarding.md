# onboarding — AI-Assisted Onboarding Wizard, Org Setup Flow

## Overview

When a new organization is created, users are guided through a multi-step onboarding wizard. The wizard collects org profile information (trade type, crew size, region), then an AI assistant helps populate the scope-of-work library, work types, and SOW items relevant to the trade. The flow uses Anthropic Claude via the governed AI layer. On completion, `organizations.onboardingStatus` is set to `COMPLETED` and the user is redirected to the dashboard.

## Data Models

**Key tables (`shared/schema/core.ts`, `shared/schema/features/org_catalog.ts`)**

| Table | Description |
|---|---|
| `organizations` | `onboardingStatus` enum: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`; `tradeType`, `typicalCrewSize`, `region`, `tradeName` |
| `organization_sow_items` | Scope-of-work items auto-populated during onboarding; `name`, `code`, `categoryName`, `unit`, `displayOrder` |
| `organization_work_types` | Work type codes + categories populated by AI suggestions |
| `master_sow_items` | Platform-level reference SOW catalog used as seeding source |
| `master_modifier_categories` | Reference modifier categories for trade-specific cost modifiers |

## Backend Routes

**File: `server/aiOnboardingRoutes.ts`**
| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/ai/onboarding/analyze-trade` | Sends trade info to Claude; returns suggested SOW items, work types, and cost modifiers | `requireAuth` |
| POST | `/api/ai/onboarding/apply-suggestions` | Inserts AI-suggested items into org tables | `requireAuth` + `requireRole('ADMIN', 'SUPER_ADMIN')` |
| GET | `/api/ai/onboarding/status` | Returns current `onboardingStatus` for the org | `requireAuth` |
| POST | `/api/ai/onboarding/complete` | Sets `onboardingStatus = COMPLETED` | `requireAuth` + `requireRole('ADMIN', 'SUPER_ADMIN')` |
| POST | `/api/ai/onboarding/skip` | Skips AI step, marks as completed with defaults | `requireAuth` + `requireRole('ADMIN', 'SUPER_ADMIN')` |

**File: `server/onboardingLibraryRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/onboarding/library/:tradeType` | Returns master SOW and work-type suggestions for a given trade |
| GET | `/api/onboarding/library/trades` | Returns list of supported trade types |

**Org profile updates (in `server/platformRoutes.ts` / `server/authProfileRoutes.ts`):**
| Method | Path | Description |
|---|---|---|
| PATCH | `/api/org/profile` | Updates org name, trade, crew size, region, logo |
| PATCH | `/api/org/onboarding-status` | Admin-only status override |

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/onboarding` | `client/src/pages/onboarding.tsx` | Multi-step wizard; `skipOnboardingCheck` bypasses redirect loop |

The wizard consists of steps managed by local component state:
1. **Org Profile** — trade type, company name, region, crew size
2. **AI Suggestions** — calls `POST /api/ai/onboarding/analyze-trade`; displays suggested SOW items with checkboxes
3. **Review & Confirm** — user refines selections; calls `POST /api/ai/onboarding/apply-suggestions`
4. **Complete** — calls `POST /api/ai/onboarding/complete`; redirects to `/dashboard`

## Roles & Permissions

| Action | Required Role |
|---|---|
| View onboarding wizard | Any authenticated user without a completed org |
| Apply AI suggestions | `ADMIN`, `SUPER_ADMIN` |
| Skip / complete onboarding | `ADMIN`, `SUPER_ADMIN` |
| Override onboarding status | `SUPER_ADMIN` |

`ProtectedRoute` wraps `/onboarding` with `skipOnboardingCheck=true` so users are not redirected away mid-flow.

## Integration Points

- **Anthropic Claude** — called via `routedChatCompletion()` in `server/ai/providers/`; governed by `governedAiCall()` (per-org spend caps, action limits)
- **Prompt injection guard** — all AI calls in this module are annotated with the `// prompt-injection-guard` annotation because the trade type is a controlled enum, not free-text user input
- **`org_catalog` seed data** — `master_sow_items` and `master_modifier_categories` are seeded by migration scripts and used as the source catalogue for suggestions
- **Event bus** — `eventBus.emit({ type: 'org.onboarding_completed' })` fires when onboarding completes, triggering optional welcome email via `server/email.ts`
- **Feature flags** — `AI_ONBOARDING_ENABLED` flag gates the AI-suggestion step; orgs can fall back to the manual library selection
