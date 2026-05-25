# crm — Contacts, Organisations, Deal Pipeline, Calls, Quotes, Email Threads, Sequences, Automations, Lead Forms, Quote Acceptance Portal

## Overview

The CRM module is a construction-focused customer relationship management system. It tracks prospect and client organisations, contacts, a kanban deal pipeline, call logs (with AI transcript), email threads (synced from connected org email accounts), automated drip sequences, CRM quotes (separate from bid estimates), public lead capture forms, and a self-serve quote acceptance portal for clients.

## Data Models

**Key tables (`shared/schema/features/crm.ts`, `shared/schema/features/email.ts`)**

| Table | Description |
|---|---|
| `crm_organisations` | Prospect / client company: `name`, `industry`, `website`, `phone`, `address`, `status`, `ownerId`, `leadScore`, `organizationId` |
| `crm_contacts` | Individual contacts: `firstName`, `lastName`, `email`, `phone`, `role`, `crmOrganisationId`, `ownerId` |
| `crm_deals` | Pipeline deals: `name`, `value`, `stageId`, `crmOrganisationId`, `closeDate`, `probability`, `status` |
| `crm_pipeline_stages` | Configurable kanban stages: `name`, `order`, `pipelineId`, `defaultProbability` |
| `crm_calls` | Call records: `contactId`, `dealId`, `duration`, `direction`, `outcome`, `transcript`, `recordingUrl`, `aiSummary` |
| `crm_activities` | Activity log: `type` (email/call/note/meeting/task), `entityType`, `entityId`, `description`, `completedAt` |
| `crm_quotes` | Sales quotes (pre-bid): `dealId`, `contactId`, `status`, `totalAmount`, `expiresAt`, `acceptedAt`, `acceptedByName` |
| `crm_quote_items` | Quote line items |
| `email_threads` | Synced email threads: `orgEmailAccountId`, `subject`, `fromAddress`, `participants`, `lastMessageAt` |
| `email_messages` | Individual emails within a thread |
| `email_tasks` | Tasks auto-generated from emails |
| `email_attachments` | Attachments on email messages |
| `crm_sequences` | Email drip sequences: `name`, `steps` (JSON), `triggerEvent`, `isActive` |
| `crm_sequence_enrollments` | Contact enrollments in a sequence |
| `crm_lead_forms` | Public lead capture forms: `slug`, `fields` (JSON), `destinationStageId`, `organizationId` |
| `crm_lead_form_submissions` | Submissions from lead forms |
| `crm_automations` | Trigger-based automations: `triggerType`, `conditions` (JSON), `actions` (JSON) |
| `crm_custom_fields` | Custom field definitions per entity type |
| `crm_duplicate_groups` | Detected duplicate records for admin review |
| `crm_sla_rules` | SLA response time rules by deal stage |
| `crm_meeting_bookings` | Public booking page appointments |
| `crm_custom_reports` | Saved custom report configurations |

## Backend Routes

**File: `server/crmRoutes.ts`** — org and contact CRUD:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/crm/organisations` | Lists CRM organisations | `canAccessCRM` |
| POST | `/api/crm/organisations` | Creates organisation | `canCreateCRMContacts` |
| GET/PATCH/DELETE | `/api/crm/organisations/:id` | Detail, update, delete | same |
| GET | `/api/crm/contacts` | Lists contacts | `canAccessCRM` |
| POST | `/api/crm/contacts` | Creates contact | `canCreateCRMContacts` |
| GET | `/api/crm/deals` | Lists deals (pipeline view) | `canAccessCRM` |
| POST | `/api/crm/deals` | Creates deal | `canCreateCRMContacts` |
| PATCH | `/api/crm/deals/:id/stage` | Moves deal to new stage | `canAccessCRM` |

**File: `server/crmCallsRoutes.ts`** — call logging + AI transcripts

**File: `server/crmQuotesRoutes.ts`** — CRM quote lifecycle:
| Method | Path | Description |
|---|---|---|
| POST | `/api/crm/quotes/:id/send` | Sends quote link to contact |
| POST | `/api/crm/quotes/:id/accept` | Records acceptance (via public portal) |

**File: `server/publicQuoteAcceptRoutes.ts`** — unauthenticated quote acceptance:
| Method | Path | Description |
|---|---|---|
| GET | `/quotes/accept/:token` | Public quote view |
| POST | `/quotes/accept/:token/accept` | Records client acceptance |

**File: `server/sequenceRoutes.ts`** — email sequences

**File: `server/crmLeadFormsRoutes.ts`** — lead form builder + submissions

**File: `server/publicLeadsRoutes.ts`** — public `/leads/:orgSlug` form endpoint

**File: `server/crmAutomationsRoutes.ts`** — automation engine

**File: `server/crmEmailLoggingRoutes.ts`** — email-to-CRM logging

**File: `server/crmAnalyticsRoutes.ts`** — pipeline analytics, conversion rates

**File: `server/crmLeadScoringRoutes.ts`** — AI lead scoring

**File: `server/crmDuplicatesRoutes.ts`** — duplicate detection

**File: `server/crmSlaRoutes.ts`** — SLA tracking

**File: `server/crmMeetingRoutes.ts`** — public booking pages

**File: `server/emailRoutes.ts`** + `server/emailWebhookRoutes.ts`** — org email account sync and inbound webhook

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/crm` | `client/src/pages/crm.tsx` | CRM hub — contacts, orgs, deals pipeline |
| `/crm/deals/:id` | `client/src/pages/crm-deal.tsx` | Deal detail with activities, calls, emails |
| `/sequences` | `client/src/pages/sequences.tsx` | Email sequence builder |
| `/quotes/accept/:token` | `client/src/pages/quote-accept.tsx` | Public quote acceptance portal |
| `/leads/:orgSlug` | `client/src/pages/public-lead-form.tsx` | Public lead capture form |
| `/forms/:slug` | `client/src/pages/public-form.tsx` | Generic public form |
| `/book/:slug` | `client/src/pages/public-booking.tsx` | Public meeting booking |

## Roles & Permissions

| Action | Gate |
|---|---|
| Access CRM | `canAccessCRM` — ADMIN, MANAGER, ESTIMATOR, SUPERINTENDENT |
| Create contacts | `canCreateCRMContacts` |
| View CRM emails | `canViewCrmEmails` |
| Log CRM calls | `canLogCrmCalls` |
| Manage hiring (ATS overlap) | `canManageHiring` |

## Integration Points

- **Email sync** — org email accounts (Gmail/Outlook OAuth) are connected via `integrationRoutes.ts`; inbound emails received via webhook and stored in `email_threads` / `email_messages`
- **AI call summaries** — `crmCallsRoutes.ts` calls AI to summarize call transcripts; transcript stored in `crm_calls.transcript`
- **AI lead scoring** — `crmLeadScoringRoutes.ts` scores leads using deal attributes + activity history via governed AI call
- **Sequences** — `sequenceRoutes.ts` engine processes enrollments on a job queue, sending emails via SendGrid
- **Automations** — `crmAutomationsRoutes.ts` evaluates triggers (deal stage change, form submission, date-based) and executes action chains
- **Zapier** — `integrationRoutes.ts` + Zapier provider registers inbound Zap webhooks; CRM deals and contacts are emittable events
- **Bid network crossover** — when a bid is awarded, the linked CRM deal is auto-transitioned to CLOSED_WON
