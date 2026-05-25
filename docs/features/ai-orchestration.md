# ai-orchestration — AI Provider Routing, Prompt Injection Guard, Document Analysis, AI Estimator Skills, AI Governance, Voice Logs, Takeoff AI, Onboarding AI

## Overview

The AI orchestration module provides a unified governed interface for all AI operations in the platform. All LLM calls flow through `routedChatCompletion()` which selects between OpenAI and Anthropic based on the task type (see `TASK_TYPE_PROVIDER_OVERRIDES`). Every call passes through: (1) the prompt injection guard (quarantine envelope + heuristic detector), (2) the governance gate (per-org spend caps and action counts), and (3) output schema validation. Audit records are written for every AI call. Takeoff AI, onboarding AI, document analysis, the AI estimator, and the AI CFO analytics engine are all governed AI features.

## Data Models

**Key tables (`shared/schema/features/ai.ts`, `shared/schema/features/ai_estimator.ts`)**

| Table | Description |
|---|---|
| `ai_runs` | All AI invocations: `orgId`, `userId`, `taskType`, `provider`, `model`, `inputTokens`, `outputTokens`, `costUsd`, `durationMs`, `status`, `correlationId` |
| `ai_tasks` | Higher-level task records linking multiple AI runs |
| `ai_insights` | AI-generated insight records stored for display in the UI |
| `ai_recommendations` | Actionable recommendations from AI analysis |
| `ai_document_analyses` | Document analysis results: `documentId`, `extractedScope`, `flags`, `qualityScore` |
| `ai_bid_document_analyses` | Bid-specific plan analysis: `bidId`, `documentId`, `suggestedLineItems` (JSON), `scopeSummary` |
| `ai_contract_analyses` | Contract risk analysis results |
| `ai_governance_rules` | Per-org AI usage caps: `maxMonthlySpendUsd`, `maxDailyActionsPerUser`, `allowedProviders` |
| `ai_governance_violations` | Recorded cap violations |
| `ai_estimator_workspaces` | AI Estimator sessions: `bidId`, `status`, `batchStatus` (JSON) |
| `ai_estimator_line_items` | AI-generated estimate line items pending user review |
| `ai_estimator_learned_rates` | Machine-learned unit costs per SOW category: `category`, `unit`, `unitCost`, `sampleCount`, `lastUpdated` |
| `ai_estimator_assemblies` | AI-suggested assembly packages |
| `ai_estimator_assembly_skills` | Skill metadata for assembly-building |
| `voice_logs` | Voice call transcripts: `callId`, `transcript`, `durationSeconds`, `aiSummary` |
| `ai_notes_scheduler_logs` | Scheduler run audit records |

## Backend Routes

**File: `server/aiOrchestrationRoutes.ts`** — central orchestration:
| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/ai/orchestrate` | Generic governed AI task dispatch | `requireAuth` + `sensitiveLimiter` |
| POST | `/api/ai/bids/:bidId/analyze-documents` | Analyzes plan PDFs for a bid | `canUseAiBidAnalysis` |
| POST | `/api/ai/contracts/:contractId/analyze` | Analyzes contract PDF | `canUseAiContractAnalysis` |
| POST | `/api/ai/governance/rules` | Upserts org governance rules | `requireRole('ADMIN','SUPER_ADMIN')` |
| GET | `/api/ai/governance/usage` | Returns monthly AI spend/action usage | `requireAuth` |
| GET | `/api/ai/governance/rules` | Returns org governance rules | `requireRole('ADMIN','SUPER_ADMIN')` |

**File: `server/aiEstimatorRoutes.ts`** — AI estimator:
| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/ai-estimator/workspaces/:bidId/run` | Triggers AI estimator batch run | `canUseAiEstimator` |
| GET | `/api/ai-estimator/workspaces/:bidId/status` | Poll batch status | `canUseAiEstimator` |
| GET | `/api/ai-estimator/workspaces/:bidId/line-items` | Returns AI-generated line items | `canUseAiEstimator` |
| POST | `/api/ai-estimator/workspaces/:bidId/line-items/:id/accept` | Accepts AI line item into estimate | `canUseAiEstimator` |
| POST | `/api/ai-estimator/workspaces/:bidId/line-items/:id/reject` | Rejects AI line item | `canUseAiEstimator` |
| POST | `/api/ai-estimator/workspaces/:bidId/line-items/bulk-accept` | Bulk accept | `canUseAiEstimator` |
| GET | `/api/ai-estimator/benchmark-rates` | Returns learned unit rates | `canUseAiEstimator` |
| POST | `/api/ai-estimator/benchmark-refresh` | Forces benchmark rate refresh | `canUseAiEstimator` |

**File: `server/aiEstimatorSkillsRoutes.ts`** — skill configuration for AI estimator

**File: `server/aiEstimatorAssemblyRoutes.ts`** — AI-suggested assemblies

**File: `server/aiDocumentRoutes.ts`** — document analysis (SSRF-safe):
| Method | Path | Description |
|---|---|---|
| POST | `/api/ai/documents/analyze` | Analyzes a document from GCS or `/objects/` path |
| POST | `/api/ai/documents/reanalyze/:id` | Re-runs analysis on cached document |

**File: `server/aiTakeoffFeatureRoutes.ts`** — takeoff AI auto-detect

**File: `server/aiSchedulingRoutes.ts`** — AI schedule optimization

**File: `server/aiHeavyCivilFeatureRoutes.ts`** — DOT-specific AI features

**File: `server/aiCfoAnalyticsRoutes.ts`** — CFO dashboard AI analytics

**File: `server/aiOnboardingRoutes.ts`** — onboarding AI

**File: `server/aiNotesService.ts`** + `server/aiNotesScheduler.ts` — AI-generated daily project notes

## Key Services

**`server/ai/providers/index.ts`** — `routedChatCompletion(taskType, messages, options)`:
- Consults `TASK_TYPE_PROVIDER_OVERRIDES` map to pick provider
- Calls provider-specific adapter (OpenAI or Anthropic)
- Retries with exponential backoff on rate-limit errors (429)
- Writes to `ai_runs` and fires `ai.call_completed` event

**`server/ai/promptInjectionGuard.ts`** — injection defense:
- `quarantineDocumentText(text)` — wraps in `<UNTRUSTED_DOCUMENT>` envelope
- `quarantineUserText(label, text)` — wraps stored strings in `<<USER:label>>` sentinels
- `detectPromptInjection(text)` — heuristic pattern scanner (role override, exfiltration, jailbreak, delimiter escape, encoded payloads, im_start/im_end spoof)
- `shouldRefusePromptInjection(flags)` — policy: refuse if role-override + exfiltration patterns co-occur
- `validateAiJsonOutput(schema, data)` — Zod schema validation on LLM output
- `recordPromptInjectionDetection({ route, patternId, action })` — metrics counter

**`server/services/aiEstimator/mapReduceDraft.ts`** — map-reduce for large takeoffs:
- Splits sheets into batches; fan-out calls to AI; reduce to line item candidates
- `quarantineUserText()` used for every `sheetNumber` / `sheetName` inline template splice

**`server/services/aiGovernance.ts`** — `governedAiCall(orgId, taskType, fn)`:
- Checks monthly spend cap against `ai_governance_rules.maxMonthlySpendUsd`
- Checks daily action count against `ai_governance_rules.maxDailyActionsPerUser`
- Records violations in `ai_governance_violations`

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/ai-estimator/admin` | `client/src/pages/ai-estimator-admin.tsx` | Admin configuration for AI estimator (ADMIN + `canManageAiEstimator`) |
| `/company-settings?tab=ai-governance` | `client/src/pages/company-settings.tsx` | Governance cap configuration |
| `/company-settings?tab=ai-settings` | same | AI provider and model settings |

## Roles & Permissions

| Action | Gate |
|---|---|
| Use AI estimator | `canUseAiEstimator` |
| Manage AI estimator | `canManageAiEstimator` — ADMIN, SUPER_ADMIN |
| Use AI bid analysis | `canUseAiBidAnalysis` |
| Use AI contract analysis | `canUseAiContractAnalysis` |
| Configure AI governance | `requireRole('ADMIN','SUPER_ADMIN')` |
| View AI usage | `requireAuth` (own org usage only) |

## Integration Points

- **CI guard** — `scripts/check-prompt-injection-guard.mjs` enforces that every server `.ts` file calling `openai.chat.completions.create`, `routedChatCompletion`, or `callOpenAIForAnalysis` either imports `promptInjectionGuard` or carries `// prompt-injection-guard: <reason>` annotation
- **Metrics** — `ai_prompt_injection_detections_total{route,pattern_id,action}` counter exported at `/metrics` (Prometheus format)
- **SSRF protection** — `extractDocumentContent()` only accepts `/objects/...` paths or `storage.googleapis.com` URLs; arbitrary HTTP URLs are rejected
- **Anthropic vs. OpenAI routing** — `TASK_TYPE_PROVIDER_OVERRIDES` in `server/ai/providers/routing.ts`; `ANTHROPIC_API_KEY` required env var; falls back to OpenAI if Anthropic unavailable
- **Token budget** — `ai_runs.inputTokens + outputTokens` accumulated per org/month against `ai_governance_rules.maxMonthlySpendUsd` using provider-specific cost-per-token tables
- **Regression suite** — `server/__tests__/promptInjectionGuard.test.ts` tests all pattern IDs with real-world payloads
