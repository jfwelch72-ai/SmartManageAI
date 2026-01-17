# AI Capabilities

## Overview

SmartManageAI integrates multiple AI-powered features using OpenAI's GPT-4 and GPT-4o (Vision) models. This document details each AI capability, its data inputs, outputs, and implementation.

---

## AI Project Manager (AI PM)

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
- Prioritized task list
- Risk alerts
- Recommendations
- Insights with severity levels

### How it works
1. User clicks "Run Analysis Now"
2. System builds comprehensive data snapshot
3. Snapshot sent to OpenAI with system prompt
4. AI returns structured JSON response
5. Tasks and insights stored in database
6. UI displays results

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

### Status: ✅ Working end-to-end

---

## AI CFO

### What it does
Provides financial analysis, profitability insights, and cost recommendations.

### Data Inputs
- Project budgets and actuals
- Labor costs
- Material costs
- Change order impacts
- Cash flow data
- Revenue projections

### Outputs
- Profitability analysis by project
- Cost variance alerts
- Cash flow forecasts
- Financial recommendations

### Implementation

**Backend:** `server/ai/profitabilityEngine.ts`
**Frontend:** `client/src/pages/cfo-dashboard.tsx`

### Status: ✅ Working end-to-end

---

## AI Auto-Takeoff

### What it does
Uses computer vision to analyze construction plans and automatically extract quantities.

### Data Inputs
- PDF plan documents
- Drawing specifications
- Scale information
- Area of interest

### Outputs
- Extracted quantities (linear, area, count)
- Measurement annotations
- Confidence scores

### How it works
1. User uploads plan PDF
2. System renders page as image
3. Image sent to GPT-4o Vision API
4. AI identifies measurable elements
5. Quantities calculated based on scale
6. Results imported to estimate

### Implementation

**Backend:** `server/aiRoutes.ts` (takeoff endpoints)
**Frontend:** `client/src/components/AiTakeoffPanel.tsx`, `client/src/components/TakeoffWorkspace.tsx`

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/ai/takeoff/analyze | Analyze plan page |
| POST | /api/ai/takeoff/extract | Extract quantities |

### Status: ✅ Working end-to-end

---

## AI Bid Document Analysis

### What it does
Extracts project information from bid packages and documents.

### Data Inputs
- Bid invitation documents
- Project specifications
- Plan sets
- Contract documents

### Outputs
- Project name and location
- Key dates (bid date, start date)
- Scope requirements
- Special conditions
- Required certifications

### How it works
1. User uploads bid documents
2. Documents processed (OCR if needed)
3. Text sent to GPT-4o for analysis
4. Structured data extracted
5. Fields populated in bid form

### Implementation

**Backend:** `server/aiBidDocumentRoutes.ts`
**Frontend:** `client/src/pages/ai-bid-analysis.tsx`, `client/src/pages/bid-wizard.tsx`

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/ai/bid-analysis/analyze | Analyze bid docs |
| GET | /api/ai/bid-analysis/:id | Get analysis results |

### Status: ✅ Working end-to-end

---

## AI Contract Analysis

### What it does
Analyzes contract documents for risk identification and key terms extraction.

### Data Inputs
- Contract documents (PDF)
- Contract type
- Project context

### Outputs
- Key contract terms
- Risk flags and warnings
- Important dates
- Payment terms
- Liability clauses
- Recommended actions

### Implementation

**Backend:** `server/aiContractDocumentRoutes.ts`
**Frontend:** `client/src/pages/ai-contract-analysis.tsx`

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/ai/contract-analysis/analyze | Analyze contract |
| GET | /api/ai/contract-analysis/:id | Get analysis results |

### Status: ✅ Working end-to-end

---

## AI Email Classifier

### What it does
Classifies incoming emails and extracts actionable tasks.

### Data Inputs
- Email content (subject, body)
- Sender information
- Attachments metadata
- Thread context

### Outputs
- Category classification (15 categories)
  - BID_INVITATION
  - CHANGE_ORDER_REQUEST
  - DELAY_NOTICE
  - INSPECTION_NOTICE
  - PAYMENT_REQUEST
  - RFI
  - SUBMITTAL
  - GENERAL
  - etc.
- Extracted tasks
- Priority level
- Suggested actions

### Implementation

**Backend:** `server/ai/emailAi.ts`, `server/emailAiRoutes.ts`
**Frontend:** `client/src/pages/email-assistant.tsx`

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/email-ai/classify | Classify email |
| POST | /api/email-ai/extract-tasks | Extract tasks |

### Status: ✅ Working end-to-end

---

## AI Assistant Widget

### What it does
Conversational AI assistant for help and guidance throughout the platform.

### Data Inputs
- User question/message
- Current page context
- User role
- Organization data

### Outputs
- Conversational response
- Relevant guidance
- Links to features
- Action suggestions

### Implementation

**Backend:** `server/aiAssistantRoutes.ts`, `server/ai/assistantPrompt.ts`
**Frontend:** `client/src/components/AIAssistantWidget.tsx`

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/ai-assistant/chat | Send message |
| GET | /api/ai-assistant/context | Get context |

### Status: ✅ Working end-to-end

---

## AI Scheduling Assistant

### What it does
Provides schedule optimization recommendations.

### Data Inputs
- Project milestones
- Task dependencies
- Resource availability
- Crew capacity
- Weather forecasts

### Outputs
- Schedule recommendations
- Resource allocation suggestions
- Conflict identification
- Optimization opportunities

### Implementation

**Backend:** `server/ai/scheduler.ts`
**Frontend:** `client/src/components/AiSchedulingPanel.tsx`

### Status: ✅ Working end-to-end

---

## AI Change Order Generator

### What it does
Drafts change order documents from descriptions.

### Data Inputs
- Change description
- Scope impact
- Labor estimates
- Material costs
- Project context

### Outputs
- Draft change order document
- Cost breakdown
- Justification text
- Supporting details

### Implementation

**Backend:** `server/changeOrderRoutes.ts` (AI endpoints)
**Frontend:** `client/src/components/AiChangeOrderGenerator.tsx`

### Status: ✅ Working end-to-end

---

## AI Jobsite Camera Analysis

### What it does
Analyzes jobsite photos to identify issues, progress, and safety concerns.

### Data Inputs
- Jobsite photos
- Project context
- Previous photos (for comparison)

### Outputs
- Progress assessment
- Issue identification
- Safety observations
- Quality notes
- Comparison with previous state

### Implementation

**Backend:** `server/aiRoutes.ts`
**Frontend:** `client/src/components/AiJobsiteAnalysis.tsx`

### Status: ✅ Working end-to-end

---

## AI Note Insights

### What it does
Analyzes daily notes to extract insights and identify issues.

### Data Inputs
- Project notes
- Company notes
- Historical patterns

### Outputs
- Categorized insights
  - SUPPLY_NEED
  - EQUIPMENT_REPAIR
  - WEATHER_DELAY
  - CHANGE_ORDER
  - SAFETY
  - CLIENT_COMMUNICATION
- Severity levels
- Recommended actions

### Implementation

**Backend:** `server/aiNotesService.ts`, `server/aiNotesRoutes.ts`
**Frontend:** Displayed in project detail and dashboard

### Status: ✅ Working end-to-end

---

## AI Onboarding Wizard

### What it does
Guides new organizations through trade-specific setup.

### Data Inputs
- Trade type selection
- Company information
- Initial preferences

### Outputs
- Trade-specific configuration
- Recommended settings
- Sample scope items
- Suggested workflows

### Implementation

**Backend:** `server/ai/tradeDiscoveryService.ts`, `server/ai/walkthroughContent.ts`
**Frontend:** `client/src/pages/onboarding.tsx`

### Status: ✅ Working end-to-end

---

## AI Scope Prediction

### What it does
Predicts relevant scope items based on project characteristics.

### Data Inputs
- Trade type
- Project type
- Historical scope data
- Industry standards

### Outputs
- Suggested scope items
- Relevance scores
- Quantity estimates

### Implementation

**Backend:** `server/ai/scopePredictionEngine.ts`
**Frontend:** `client/src/components/StandardizedScopeSelector.tsx`

### Status: ✅ Working end-to-end

---

## AI Vendor Price Extraction

### What it does
Extracts pricing information from vendor price lists and catalogs.

### Data Inputs
- Price list documents (PDF, Excel)
- Vendor information
- Product categories

### Outputs
- Structured price items
- SKU/product codes
- Unit prices
- Category mappings

### Implementation

**Backend:** `server/ai/vendorPriceListExtractor.ts`
**Frontend:** `client/src/pages/pricebook-import.tsx`

### Status: ✅ Working end-to-end

---

## Technical Implementation

### OpenAI Client

**File:** `server/ai/openaiClient.ts`

```typescript
import OpenAI from 'openai';

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function callGPT4(messages: any[], options?: any) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    ...options
  });
  return response.choices[0].message.content;
}
```

### System Prompts

**File:** `server/ai/systemPrompt.ts`

Contains role-specific prompts for AI analysis, defining:
- AI persona (Senior PM + CFO)
- Output format (JSON structure)
- Analysis guidelines
- Response constraints

### Data Snapshot Builder

**File:** `server/ai/snapshotBuilder.ts`

Builds comprehensive data snapshot including:
- Projects (active, completed, at risk)
- Labor metrics (hours, costs, productivity)
- Material budgets and usage
- Equipment utilization
- Delay records
- Financial summaries

### Module Analyzers

**File:** `server/ai/moduleAnalyzers.ts`

Specialized analyzers for:
- Labor analysis
- Material analysis
- Budget analysis
- Schedule analysis
- Equipment analysis
- Delay analysis

---

## AI Guardrails

### Input Validation
- All inputs sanitized before AI processing
- Size limits on documents and text
- Content type verification

### Output Validation
- JSON schema validation for structured outputs
- Fallback handling for malformed responses
- Retry logic for API failures

### Data Privacy
- Organization data isolated
- No cross-tenant data exposure
- Sensitive data excluded from prompts

### Rate Limiting
- Per-user rate limits on AI endpoints
- Cost tracking per organization
- Usage quotas per subscription tier

### Error Handling
- Graceful degradation when AI unavailable
- User-friendly error messages
- Automatic retry with backoff
