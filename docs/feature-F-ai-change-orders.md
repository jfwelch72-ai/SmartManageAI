# Feature F: AI Change Order Generator

> **Status: IMPLEMENTED** — This doc was the original planning spec. Feature shipped; see live code at `server/changeOrderRoutes.ts` (AI generation endpoint), `server/ai/` (prompt logic), and `client/src/components/AiChangeOrderGenerator.tsx` (frontend).
>
> **Implementation notes vs. spec:**
> - AI provider is Anthropic Claude (primary) via `routedGeneralChatCompletion`. Original spec assumed OpenAI-only.
> - All delay descriptions, RFI text, and scope narrative inputs pass through `quarantineUntrustedText` / `detectPromptInjection` before being sent to the LLM.
> - Generated text is validated via `validateAiJsonOutput` (Zod schema) before populating the change order form.
> - Trade-specific terminology applied via system prompt parameterized by `organization.tradeType`.
> - Generated draft must still go through the human change order approval chain (PCO → SUBMITTED → APPROVED).

---

## Overview
Enhances the **existing change order system** with AI-powered generation that automatically drafts change order descriptions, justifications, and scope narratives based on linked delays, inspections, RFIs, and SOW changes. The AI adapts its language and formatting based on **trade-specific** terminology and industry standards.

## Trade-Specific CO Language

### Terminology and Justification Patterns by Trade

| Trade Type | Common CO Reasons | Industry Terms | Pricing References |
|------------|------------------|----------------|-------------------|
| **ROOFING** | Hidden damage, Code upgrades, Additional penetrations | Decking, Drip edge, Ice & water, Squares | Per square, LF of edge |
| **ELECTRICAL** | Code changes, Additional circuits, Panel upgrades | Home runs, Dedicated circuits, AIC rating | Per outlet, per circuit |
| **PLUMBING** | Unforeseen conditions, Reroutes, Fixture upgrades | DWV, Water service, Fixture units | Per fixture, LF of pipe |
| **HVAC** | Load changes, Duct mods, Equipment upgrades | CFM, Tonnage, SEER rating, Static pressure | Per ton, LF of duct |
| **CONCRETE** | Subgrade issues, Rebar upgrades, Weather delays | PSI, Slump, Air entrainment, Cure time | Per CY, SF of finish |
| **CARPENTRY** | Hidden rot, Design changes, Structural upgrades | LVL, Blocking, Headers, Sheathing | Per LF, per opening |
| **MASONRY** | Foundation issues, Pointing, Structural repairs | Bond pattern, Weep holes, Reinforcement | Per SF, per block |
| **GENERAL_CONTRACTOR** | Scope gaps, Design conflicts, Owner changes | All trade terms | Comprehensive |

## Technical Architecture

### AI CO Generation Flow
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Linked Items:  │────▶│  AI Analysis     │────▶│  Draft CO       │
│  - Delays       │     │  (GPT-4)         │     │  Document       │
│  - Inspections  │     │                  │     │                 │
│  - SOW Changes  │     │                  │     │                 │
│  - Photos       │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Finalized CO   │◀────│  User Review     │◀────│  Auto-Price     │
│  (Existing      │     │  & Edit          │     │  from           │
│  System)        │     │                  │     │  Calculators    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Integration with Existing CO System
Uses existing tables:
- `change_orders` - Main CO record
- `change_order_labor_entries` - Labor line items
- `change_order_equipment_entries` - Equipment line items
- `change_order_material_entries` - Material line items

## API Endpoints

### POST /api/ai/change-orders/generate
Generates AI-drafted change order.

**Request:**
```typescript
{
  projectId: string;
  tradeType?: string;              // Override for GC multi-trade
  linkedItems: {
    delayIds?: string[];           // From project_delays
    inspectionIds?: string[];      // From project_inspections
    sowItemIds?: string[];         // New/changed scope items
    photoIds?: string[];           // Supporting photos
    notes?: string;                // Additional context
  };
  pricingSource: 'MANUAL' | 'CALCULATOR' | 'VENDOR_PRICING';
  calculatorInputs?: Record<string, any>;
  includeBreakdown: boolean;
}
```

**Response:**
```typescript
{
  success: boolean;
  draftId: string;
  draft: {
    title: string;
    description: string;           // AI-generated narrative
    justification: string;         // Why CO is warranted
    scopeOfWork: string;           // Detailed scope text
    exclusions: string;            // What's NOT included
    terms: string;                 // Payment terms, conditions
    
    lineItems: {
      labor: Array<{
        description: string;
        hours: number;
        rate: number;
        amount: number;
      }>;
      materials: Array<{
        description: string;
        quantity: number;
        unit: string;
        unitPrice: number;
        amount: number;
      }>;
      equipment: Array<{
        description: string;
        days: number;
        dailyRate: number;
        amount: number;
      }>;
    };
    
    subtotals: {
      labor: number;
      materials: number;
      equipment: number;
      subtotal: number;
      overhead: number;             // Calculated %
      profit: number;               // Calculated %
      total: number;
    };
    
    linkedReferences: Array<{
      type: 'DELAY' | 'INSPECTION' | 'SOW_ITEM' | 'PHOTO';
      id: string;
      summary: string;
    }>;
  };
  aiConfidence: number;
  aiNotes: string;
}
```

### POST /api/ai/change-orders/save
Saves AI draft to existing CO system.

**Request:**
```typescript
{
  draftId: string;
  edits?: {
    title?: string;
    description?: string;
    justification?: string;
    scopeOfWork?: string;
    lineItemOverrides?: Array<{
      index: number;
      type: 'labor' | 'material' | 'equipment';
      changes: Record<string, any>;
    }>;
  };
  status: 'DRAFT' | 'PENDING_APPROVAL';
}
```

### POST /api/ai/change-orders/suggest-pricing
AI suggests pricing based on scope description.

**Request:**
```typescript
{
  projectId: string;
  scopeDescription: string;
  tradeType: string;
}
```

**Response:**
```typescript
{
  suggestions: {
    estimatedLabor: {
      hours: number;
      reasoning: string;
    };
    estimatedMaterials: Array<{
      item: string;
      quantity: number;
      unit: string;
      estimatedCost: number;
      calculatorId?: string;        // If matching calculator exists
    }>;
    estimatedTotal: {
      low: number;
      mid: number;
      high: number;
    };
    comparableProjects?: string;    // Reference to similar past COs
  };
}
```

## Database Schema Changes

### Extended: change_orders table
```sql
ALTER TABLE change_orders ADD COLUMN ai_generated BOOLEAN DEFAULT false;
ALTER TABLE change_orders ADD COLUMN ai_draft_json JSONB;
ALTER TABLE change_orders ADD COLUMN linked_delay_ids VARCHAR[];
ALTER TABLE change_orders ADD COLUMN linked_inspection_ids VARCHAR[];
ALTER TABLE change_orders ADD COLUMN linked_photo_ids VARCHAR[];
ALTER TABLE change_orders ADD COLUMN ai_confidence INTEGER;
ALTER TABLE change_orders ADD COLUMN ai_notes TEXT;
```

### New Table: ai_co_drafts (for draft preservation)
```sql
CREATE TABLE ai_co_drafts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id),
  project_id VARCHAR NOT NULL REFERENCES projects(id),
  trade_type VARCHAR,
  linked_items_json JSONB,
  draft_content_json JSONB NOT NULL,
  pricing_json JSONB,
  ai_confidence INTEGER,
  ai_notes TEXT,
  status VARCHAR DEFAULT 'DRAFT',   -- DRAFT, CONVERTED, DISCARDED
  converted_to_co_id VARCHAR REFERENCES change_orders(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_user_id VARCHAR REFERENCES users(id)
);
```

## AI Prompt Engineering

### Trade-Specific Prompt Templates
The AI uses trade-specific prompts to generate appropriate language:

**Roofing Example:**
```
You are drafting a change order for a roofing project. Use industry-standard 
roofing terminology: squares (100 SF), drip edge, ice & water shield, 
underlayment, step flashing, counter flashing, ridge vent, etc.

Justify the change order using:
- Hidden damage discovered during tear-off
- Code-required upgrades
- Owner-requested additions
- Weather-related delays requiring additional protection

Format pricing per roofing industry standards (per square, per LF).
```

**Electrical Example:**
```
You are drafting a change order for an electrical project. Use NEC-compliant 
terminology: circuits, home runs, dedicated circuits, AFCI/GFCI, panel capacity,
wire gauge, conduit runs, device counts, etc.

Justify the change order using:
- Code changes or inspector requirements
- Additional circuits needed
- Panel upgrade requirements
- Unforeseen existing conditions

Format pricing per electrical industry standards (per outlet, per circuit, per LF).
```

## Frontend Components

### AI Generate CO Button (in existing CO module)
- Placed in project financials / change orders section
- Opens AI CO wizard

### AI CO Wizard
**Step 1: Link Related Items**
- Multi-select delays (with summary)
- Multi-select inspections (with results)
- Multi-select SOW items (new/changed)
- Add supporting photos
- Optional notes field

**Step 2: Review AI Draft**
- Editable title
- Rich text editor for description
- Justification section
- Scope of work (editable)
- Exclusions (editable)

**Step 3: Review Pricing**
- Line item table (labor, materials, equipment)
- Editable quantities and rates
- Auto-calculate totals
- Overhead/profit adjustment sliders

**Step 4: Preview & Save**
- Full CO preview (print-ready format)
- Save as Draft or Submit for Approval

### CO Preview Component
- Professional formatting
- Trade-specific terminology
- Linked item references with hyperlinks
- Print/PDF export ready

## RBAC Access
- **ADMIN, MANAGER**: Full access to AI CO generation
- **ESTIMATOR**: Generate drafts, submit for approval
- **SUPERINTENDENT**: Generate drafts only
- **FOREMAN, OFFICE_MANAGER**: View COs only
- **FIELD_WORKER, HOURLY**: No CO access

## Integration Points

### Delay System
- Auto-link delays with financial impact
- Pull delay documentation into justification
- Reference delay dates and durations

### Inspection System
- Link failed inspections requiring rework
- Reference inspection notes
- Document code-required changes

### Calculator System
- Use calculators for material pricing
- Apply organization labor rates
- Include equipment rates from profiles

### Audit Log
- Log all AI-generated content
- Track edits from AI draft to final
- Maintain edit history

## Development Phases
1. **Phase 1**: Schema updates + basic AI generation endpoint
2. **Phase 2**: Trade-specific prompt templates
3. **Phase 3**: Frontend wizard + preview
4. **Phase 4**: Calculator integration + pricing suggestions
