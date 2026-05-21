# AI Capabilities

> **Last updated:** May 2026. Reflects Task #2684 (AI provider router), Task #2851 (Anthropic as primary), Task #2683 (prompt-injection CI enforcement).

## Overview

SmartManageAI uses a multi-provider AI infrastructure with **Anthropic Claude as the primary provider** and **OpenAI GPT-4o as the automatic fallback**. All LLM calls go through a provider abstraction layer (`server/ai/providers/`) that handles routing, fallback, billing quota enforcement, and per-call telemetry. Vision pipelines (image_url content) continue to use OpenAI directly with an annotated bypass.

---

## AI Provider Architecture

### Provider Families

| Family | Router Entrypoint | Default Primary | Fallback | When to Use |
|--------|------------------|-----------------|---------|-------------|
| **Takeoff** | `routedChatCompletion` | Anthropic Claude (flag `AI_PROVIDER_TAKEOFF=true`) | OpenAI GPT-4o | Takeoff / Estimator / Heavy-Civil features |
| **General** | `routedGeneralChatCompletion` | Anthropic Claude (flag `AI_PROVIDER_GENERAL=true`) | OpenAI GPT-4o | All other chat-completion call sites |
| **Embeddings** | `routedEmbedding` | OpenAI `text-embedding-3-large` | (none wired yet) | Semantic search / similarity |

As of Task #2851, both `AI_PROVIDER_TAKEOFF` and `AI_PROVIDER_GENERAL` flags are **ON by default** for all new orgs. Existing orgs that explicitly stored `false` continue to route to OpenAI-primary for that family. Per-org flag overrides via Super Admin → Feature Flags.

### Governance Gate

Every AI call should be wrapped in `governedAiCall(...)` which:
1. Runs `checkBillingQuota` before the provider call (HTTP 402 if quota exceeded)
2. Calls the provider via the router
3. Runs `consumeBillingUsage` to meter `ai_tokens` + `ai_jobs`
4. Records `provider`, `model`, `tokensIn/out`, `cost`, `fallbackUsed`, `latencyMs` to `ai_action_audit`

### Prompt-Injection Guard

**File:** `server/ai/promptInjectionGuard.ts`

All untrusted text (user uploads, documents, form fields) must pass through the quarantine system before being sent to an LLM:

- `quarantineUntrustedText(label, text)` — wraps document text in `<UNTRUSTED_DOCUMENT>` envelope with a leading refusal instruction
- `quarantineUserText(label, text)` — wraps short tenant DB strings (filenames, RFI bodies) in `<<USER:label>>...<</USER:label>>` sentinels
- `detectPromptInjection(text)` — heuristic detector covering 10+ patterns (delimiter escape, role override, jailbreak markers, encoded payloads, zero-width character evasion)
- `validateAiJsonOutput(schema, content)` — Zod schema validation of all LLM JSON responses before DB write

A CI guard (`scripts/check-prompt-injection-guard.mjs`) fails the build if any new AI call site lacks the prompt-injection import or an explicit bypass annotation.

### CI Enforcement

```
// ai-router-bypass: vision (image_url) pipeline depends on OpenAI-typed
// mixed-content message shape; migration tracked as a follow-up.
```

Bypass annotations must appear at the top of the file or within 5 lines of the call. Every annotation is reviewable in PR.

---

## AI PM (Project Manager)

### What it does
Automatically analyzes project data and generates actionable tasks and recommendations.

### Data Inputs
- Active projects with status, budget, schedule
- Labor hours and costs by project
- Material budgets and usage
- Delay records
- Equipment utilization
- Financial metrics

### Outputs
- Prioritized task list with severity levels (LOW, MEDIUM, HIGH, CRITICAL)
- Risk alerts
- Recommendations and insights

### How it works
1. User clicks "Run Analysis Now"
2. System builds comprehensive data snapshot (`server/ai/snapshotBuilder.ts`)
3. Module analyzers run (`server/ai/moduleAnalyzers.ts`)
4. `routedGeneralChatCompletion` sends to Claude (or OpenAI fallback)
5. `validateAiJsonOutput` schema-checks the response
6. Tasks and insights stored in database
7. UI displays results

### Implementation
**Backend:** `server/ai/orchestrator.ts`, `server/aiRoutes.ts`
**Data Builder:** `server/ai/snapshotBuilder.ts`
**Analyzers:** `server/ai/moduleAnalyzers.ts`
**Frontend:** `client/src/pages/ai-pm-dashboard.tsx`

### Key Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/ai-pm/run | Trigger analysis |
| GET | /api/ai-pm/latest-run | Get latest results |
| GET | /api/ai-pm/tasks | Get AI-generated tasks |

**Status: ✅ Working end-to-end**

---

## AI CFO

### What it does
Provides financial analysis, profitability insights, and cost recommendations.

### Implementation
**Backend:** `server/ai/profitabilityEngine.ts`
**Frontend:** `client/src/pages/cfo-dashboard.tsx`

**Status: ✅ Working end-to-end**

---

## AI Auto-Takeoff (Takeoff Family)

### What it does
Uses AI vision to analyze construction plans and automatically extract quantities. Part of the **Takeoff AI family** (`routedChatCompletion` with `AI_PROVIDER_TAKEOFF` flag).

### How it works
1. User uploads plan PDF
2. System renders page as image (pdfjs-dist + react-konva)
3. Image sent to OpenAI Vision API (annotated bypass — vision pipeline)
4. AI identifies measurable elements per trade type (22 supported trades)
5. Quantities calculated based on calibrated scale
6. Results imported to estimate line items
7. Analysis queued as a pg-boss background job for large documents

### Implementation
**Backend:** `server/aiRoutes.ts`, `server/jobQueue/handlers/ai_takeoff_analyze.ts`
**Frontend:** `client/src/components/AiTakeoffPanel.tsx`, `client/src/components/TakeoffWorkspace.tsx`

### Key Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/ai/takeoff/analyze | Analyze plan page (enqueues job) |
| POST | /api/ai/takeoff/extract | Extract quantities |
| GET | /api/ai/auto-takeoff/results/:analysisId | Poll job result |

**Status: ✅ Working end-to-end**

---

## AI Bid Document Analysis

### What it does
Extracts project information from bid packages and documents.

### How it works
1. User uploads bid documents
2. Documents processed (text extraction + SSRF-guarded URL fetch)
3. Text quarantined through `quarantineUntrustedText` envelope
4. `routedGeneralChatCompletion` sends to Claude
5. `validateAiJsonOutput` schema-checks structured response
6. Fields populated in bid form

### Implementation
**Backend:** `server/aiBidDocumentRoutes.ts`, `server/aiDocumentRoutes.ts`
**Frontend:** `client/src/pages/ai-bid-analysis.tsx`, `client/src/pages/bid-wizard.tsx`

**Status: ✅ Working end-to-end**

---

## AI Contract Analysis

### What it does
Analyzes contract documents for risk identification and key terms extraction.

### Implementation
**Backend:** `server/aiContractDocumentRoutes.ts`
**Frontend:** `client/src/pages/ai-contract-analysis.tsx`

**Status: ✅ Working end-to-end**

---

## AI Email Classifier

### What it does
Classifies incoming emails and extracts actionable tasks.

### Outputs
- 15 category classifications (BID_INVITATION, CHANGE_ORDER_REQUEST, DELAY_NOTICE, INSPECTION_NOTICE, PAYMENT_REQUEST, RFI, SUBMITTAL, GENERAL, etc.)
- Extracted tasks with priority levels

### Implementation
**Backend:** `server/ai/emailAi.ts`, `server/emailAiRoutes.ts`
**Frontend:** `client/src/pages/email-assistant.tsx`

**Status: ✅ Working end-to-end**

---

## AI Assistant Widget

### What it does
Conversational AI assistant for help and guidance throughout the platform.

### Implementation
**Backend:** `server/aiAssistantRoutes.ts`, `server/ai/assistantPrompt.ts`
**Frontend:** `client/src/components/AIAssistantWidget.tsx`

**Status: ✅ Working end-to-end**

---

## AI Scheduling Assistant

### What it does
Provides schedule optimization recommendations using trade-specific task templates and production rates.

### Implementation
**Backend:** `server/ai/scheduler.ts`
**Frontend:** `client/src/components/AiSchedulingPanel.tsx`

**Status: ✅ Working end-to-end**

---

## AI Change Order Generator

### What it does
Drafts change order documents from descriptions using trade-specific terminology and pricing.

### Implementation
**Backend:** `server/changeOrderRoutes.ts` (AI endpoints)
**Frontend:** `client/src/components/AiChangeOrderGenerator.tsx`

**Status: ✅ Working end-to-end**

---

## AI Jobsite Camera Analysis

### What it does
Analyzes jobsite photos to identify issues, progress, and safety concerns. Uses OpenAI Vision (annotated bypass — image_url content).

### Implementation
**Backend:** `server/aiRoutes.ts`
**Frontend:** `client/src/components/AiJobsiteAnalysis.tsx`

**Status: ✅ Working end-to-end**

---

## AI Note Insights

### What it does
Analyzes daily notes to extract insights and identify issues.

### Outputs
- Categories: SUPPLY_NEED, EQUIPMENT_REPAIR, WEATHER_DELAY, CHANGE_ORDER, SAFETY, CLIENT_COMMUNICATION
- Severity levels and recommended actions

### Implementation
**Backend:** `server/aiNotesService.ts`, `server/aiNotesRoutes.ts`
**Scheduler:** `server/aiNotesScheduler.ts` (runs every few hours via `withSchedulerLock`)

**Status: ✅ Working end-to-end**

---

## AI Onboarding Wizard

### What it does
Guides new organizations through trade-specific setup using AI-generated recommendations.

### Implementation
**Backend:** `server/ai/tradeDiscoveryService.ts`, `server/ai/walkthroughContent.ts`, `server/aiOnboardingRoutes.ts`
**Frontend:** `client/src/pages/onboarding.tsx`

**Status: ✅ Working end-to-end**

---

## AI Scope Prediction

### What it does
Predicts relevant scope items based on project characteristics and historical data.

### Implementation
**Backend:** `server/ai/scopePredictionEngine.ts`
**Frontend:** `client/src/components/StandardizedScopeSelector.tsx`

**Status: ✅ Working end-to-end**

---

## AI Vendor Price Extraction

### What it does
Extracts pricing information from vendor price lists and catalogs using AI-assisted column mapping.

### Implementation
**Backend:** `server/ai/vendorPriceListExtractor.ts`
**Frontend:** `client/src/pages/pricebook-import.tsx`

**Status: ✅ Working end-to-end**

---

## AI DOT Pay Item Matching (Heavy Civil)

### What it does
Matches free-text scope descriptions to standardized DOT pay items using semantic similarity and AI classification. Supports feedback-based learning to improve future matches.

### Implementation
**Backend:** `server/dot/` route files, embedding-based search via `routedEmbedding`
**Frontend:** DOT pay item picker component

**Status: ✅ Working end-to-end**

---

## Technical Implementation

### Provider Router Usage

```typescript
import { routedGeneralChatCompletion } from "./ai/providers";
import { governedAiCall } from "./services/aiGovernance";

const governed = await governedAiCall({
  orgId,
  userId: req.user.id,
  actionType: "bid_document_analyze",
  inputRefs: { bidId },
  fn: async () => {
    const completion = await routedGeneralChatCompletion({
      orgId,
      featureKey: "general.bid.document_analyze",
      request: {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: quarantineUntrustedText("bid-document", documentText)
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 2048,
      },
    });
    const parsed = validateAiJsonOutput(BidAnalysisSchema,
      completion.choices[0]?.message?.content);
    return { result: parsed, completion };
  },
});
```

### Data Snapshot Builder

**File:** `server/ai/snapshotBuilder.ts`

Builds comprehensive data snapshot for AI PM analysis including:
- Projects (active, completed, at risk)
- Labor metrics (hours, costs, productivity)
- Material budgets and usage
- Equipment utilization
- Delay records
- Financial summaries

### AI Guardrails

#### Input Validation
- All untrusted text wrapped in quarantine envelopes
- SSRF protection: `extractDocumentContent` only accepts internal `/objects/...` paths or `storage.googleapis.com` URLs — arbitrary HTTP(S) URLs rejected
- Size limits on documents and text; MIME type allowlist for uploads
- AV scan on every confirmed upload (EICAR head-check + optional Cloudmersive ClamAV)

#### Output Validation
- `validateAiJsonOutput` runs Zod schema check on every LLM JSON response before any DB write
- `response_format: { type: 'json_object' }` constrains OpenAI output
- Fallback handling for malformed responses (logged + user-friendly error)
- Retry with exponential backoff for transient provider errors

#### Data Privacy
- Organization data isolated via RLS — no cross-tenant data in prompts
- `redactForLog` strips PII from structured log lines
- Every call attributed to an org via `ai_action_audit` (provider, model, tokens, cost, latency)

#### Rate Limiting
- `sensitiveLimiter` (100/15min) on AI document analyze endpoints
- `aiLimiter` (30/15min) reserved for high-cost AI routes
- Per-org billing quota via `checkBillingQuota` (HTTP 402 on exhaustion)

#### Prompt-Injection Observability
- Every detection (flagged or refused) recorded via `recordPromptInjectionDetection`
- Exported on `/metrics` as `ai_prompt_injection_detections_total{route,pattern_id,action}`
- Triage runbook: `docs/runbooks/observability.md`
