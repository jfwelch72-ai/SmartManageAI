# Feature A: AI Auto-Takeoff from Blueprints & Photos

## Overview
Enhances the existing takeoff engine (react-konva, pdfjs-dist) with AI-powered computer vision to automatically detect and measure quantities from uploaded blueprints and jobsite photos. The AI analysis is **trade-specific**, adapting its detection algorithms and measurement outputs based on the organization's trade type.

## Trade-Specific Detection Logic

### By Trade Type (22 Supported Trades)

| Trade Type | AI Detection Focus | Primary Measurements | Output UOMs |
|------------|-------------------|---------------------|-------------|
| **ROOFING** | Roof planes, ridges, valleys, penetrations, drip edge, gutters | Area (squares), linear (edges), counts (vents, skylights) | SQ, SF, LF, EA |
| **ELECTRICAL** | Panels, outlets, switches, light fixtures, conduit runs | Counts (devices), linear (wire runs), panel schedules | EA, LF, circuits |
| **PLUMBING** | Fixtures, pipe runs, drains, water heaters | Counts (fixtures), linear (pipe), fixture units | EA, LF, FU |
| **HVAC** | Ductwork, registers, equipment, returns | Area (duct surface), linear (runs), tonnage | SF, LF, TON, CFM |
| **CONCRETE** | Slabs, footings, walls, columns, rebar grids | Volume, area, linear (forms), weight (rebar) | CY, SF, LF, TON |
| **CARPENTRY** | Framing members, sheathing, trim, doors, windows | Linear (lumber), area (sheathing), counts | LF, BF, SF, EA |
| **MASONRY** | Block/brick walls, lintels, reinforcement | Area (wall face), counts (blocks), linear (rebar) | SF, EA, LF |
| **PAINTING** | Wall areas, ceiling areas, trim linear | Area (surfaces), linear (trim) | SF, LF |
| **FLOORING** | Floor areas, transitions, base linear | Area (floor), linear (base/transitions) | SF, SY, LF |
| **DRYWALL** | Wall/ceiling areas, corner bead, joint linear | Area (sheets), linear (corners) | SF, LF, EA |
| **INSULATION** | Cavity areas, pipe linear, duct wrap | Area, linear (pipe), R-value zones | SF, LF |
| **SIDING** | Wall areas, corners, trim, J-channels | Area (siding), linear (trim/corners) | SF, SQ, LF |
| **WINDOWS_DOORS** | Openings, frame sizes, hardware counts | Counts, sizes (rough openings) | EA, UI (united inches) |
| **TILE** | Floor/wall areas, linear (bullnose), corners | Area, linear (edges), counts (accents) | SF, LF, EA |
| **LANDSCAPING** | Areas (turf, beds), linear (edging), counts (plants) | Area, linear, counts, volume (mulch) | SF, LF, EA, CY |
| **EXCAVATION** | Cut/fill volumes, linear (trenches), areas | Volume, area, linear | CY, SF, LF |
| **STRUCTURAL_STEEL** | Beams, columns, connections, tonnage | Weight, counts, linear | TON, LF, EA |
| **WATERPROOFING** | Membrane areas, linear (joints), penetrations | Area, linear | SF, LF, EA |
| **DEMOLITION** | Removal areas, debris volumes, hazmat zones | Area, volume, counts | SF, CY, EA |
| **FIRE_PROTECTION** | Sprinkler heads, pipe runs, risers | Counts (heads), linear (pipe), zones | EA, LF |
| **SITEWORK** | Paving areas, curb linear, drainage | Area, linear, counts (structures) | SF, SY, LF, EA |
| **GENERAL_CONTRACTOR** | All of the above (GC mode receives all trade features) | Comprehensive multi-trade | All UOMs |

## Technical Architecture

### System Flow
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Upload PDF/    │────▶│  AI Vision API   │────▶│  Parse & Map    │
│  Image          │     │  (GPT-4 Vision)  │     │  to Trade SOW   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Existing       │◀────│  Review & Accept │◀────│  AI Takeoff     │
│  Takeoff Engine │     │  UI              │     │  Results        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Integration Points
1. **Existing Takeoff Tables**: `takeoff_sheets`, `takeoff_measurements`, `quantity_categories`
2. **SOW Items**: Maps AI detections to `organization_sow_items` and `master_sow_items`
3. **Calculators**: Feeds quantities into `organization_calculators` and `master_calculators`
4. **Trade Templates**: Uses `trade_templates.workTypesJson` for trade-specific mapping

## API Endpoints

### POST /api/ai/auto-takeoff/analyze
Triggers AI analysis on an uploaded plan sheet.

**Request:**
```typescript
{
  projectId: string;
  takeoffSheetId: string;  // Existing sheet from takeoff_sheets table
  tradeType?: string;      // Override org trade (for GC multi-trade)
  analysisMode: 'QUICK' | 'DETAILED';
  focusAreas?: string[];   // Optional: specific areas to analyze
}
```

**Response:**
```typescript
{
  success: boolean;
  analysisId: string;
  status: 'QUEUED' | 'PROCESSING';
  estimatedTime: number;   // seconds
}
```

### GET /api/ai/auto-takeoff/results/:analysisId
Retrieves AI analysis results.

**Response:**
```typescript
{
  analysisId: string;
  status: 'PROCESSING' | 'COMPLETE' | 'FAILED';
  tradeType: string;
  detectedItems: Array<{
    id: string;
    itemType: string;           // e.g., "roof_plane", "outlet", "slab"
    description: string;
    quantity: number;
    unit: string;               // From master_uom
    confidence: number;         // 0-100
    boundingBox?: {x, y, width, height};  // Location on drawing
    suggestedSowItem?: {
      id: string;
      name: string;
      code: string;
    };
    suggestedCalculator?: {
      id: string;
      name: string;
    };
  }>;
  metadata: {
    drawingScale?: string;
    titleBlock?: string;
    pageSize?: string;
    legendItems?: string[];
  };
  aiNotes: string;
}
```

### POST /api/ai/auto-takeoff/import
Imports accepted AI detections into existing takeoff measurements.

**Request:**
```typescript
{
  analysisId: string;
  acceptedItems: Array<{
    detectedItemId: string;
    sowItemId?: string;        // Map to specific SOW item
    calculatorId?: string;     // Feed into calculator
    adjustedQuantity?: number; // User override
  }>;
}
```

## Database Schema

### New Table: ai_takeoff_analyses
```sql
CREATE TABLE ai_takeoff_analyses (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id),
  project_id VARCHAR NOT NULL REFERENCES projects(id),
  takeoff_sheet_id VARCHAR NOT NULL REFERENCES takeoff_sheets(id),
  trade_type VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'PENDING',  -- PENDING, PROCESSING, COMPLETE, FAILED
  analysis_mode VARCHAR NOT NULL DEFAULT 'QUICK',
  detected_items_json JSONB,
  metadata_json JSONB,
  ai_notes TEXT,
  error_message TEXT,
  processing_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_user_id VARCHAR REFERENCES users(id)
);
```

### Extended: takeoff_measurements
Add column to track AI-generated measurements:
```sql
ALTER TABLE takeoff_measurements ADD COLUMN ai_analysis_id VARCHAR REFERENCES ai_takeoff_analyses(id);
ALTER TABLE takeoff_measurements ADD COLUMN ai_confidence INTEGER;
ALTER TABLE takeoff_measurements ADD COLUMN ai_detected_type VARCHAR;
```

## Security Considerations
- File size limits: Max 50MB per file
- Supported formats: PDF, PNG, JPG, TIFF
- SSRF protection: Validate file sources
- Rate limiting: Max 10 analyses per hour per organization
- Org scoping: All queries filtered by organizationId

## RBAC Access
- **ADMIN, MANAGER, ESTIMATOR, SUPERINTENDENT**: Full access to AI takeoff
- **FOREMAN**: View results only
- **FIELD_WORKER, HOURLY**: No access

## Error Handling & Fallback
- If AI analysis fails, existing manual takeoff remains fully functional
- Low-confidence detections (< 50%) flagged for review
- Unsupported drawing types gracefully handled with user notification

## Development Phases
1. **Phase 1**: API endpoints + database tables + mock AI responses
2. **Phase 2**: GPT-4 Vision integration with trade-specific prompts
3. **Phase 3**: UI integration with existing takeoff engine
4. **Phase 4**: Learning feedback loop (user corrections improve future analyses)
