# Feature C: AI Jobsite Camera Analysis

> **Status: IMPLEMENTED** — This doc was the original planning spec. Feature shipped; see live code at `server/aiRoutes.ts` (AI jobsite analysis endpoints) and `client/src/components/AiJobsiteAnalysis.tsx` (frontend).
>
> **Implementation notes vs. spec:**
> - Uses OpenAI Vision API (annotated bypass: `// ai-router-bypass: vision pipeline`) since analysis requires `image_url` content type — a known Anthropic/OpenAI routing split.
> - All untrusted image metadata and description text passes through `quarantineUntrustedText` before being sent to the LLM.
> - Results are `validateAiJsonOutput` schema-checked before any DB write.
> - Supports 5 output categories: SAFETY_ISSUE, PROGRESS, MATERIAL_USAGE, CREW_PRESENCE, SITE_CONDITIONS — same as spec.

---

## Overview
Enables users to upload jobsite photos for AI-powered analysis detecting safety issues, work progress, material usage, crew presence, and site conditions. Analysis is **trade-specific**, recognizing trade-relevant PPE, hazards, work quality, and completion markers.

## Trade-Specific Detection Categories

### Safety Analysis by Trade

| Trade Type | PPE Requirements | Common Hazards | Safety Checkpoints |
|------------|-----------------|----------------|-------------------|
| **ROOFING** | Hard hat, harness, non-slip boots | Fall hazards, ladder safety, open edges | Tie-offs visible, guardrails, ladder angle |
| **ELECTRICAL** | Hard hat, safety glasses, insulated gloves | Arc flash, energized panels, ladder use | Lockout/tagout, panel covers, grounding |
| **PLUMBING** | Hard hat, safety glasses, gloves | Trenching, hot work, confined space | Trench shoring, fire watch, ventilation |
| **HVAC** | Hard hat, safety glasses, gloves | Refrigerants, heights, lifting | Crane setup, rigging, refrigerant handling |
| **CONCRETE** | Hard hat, safety glasses, boots, gloves | Silica dust, rebar impalement, formwork collapse | Dust control, rebar caps, form bracing |
| **CARPENTRY** | Hard hat, safety glasses, hearing protection | Saw injuries, nail guns, falls | Guard usage, tool condition, scaffolding |
| **MASONRY** | Hard hat, safety glasses, dust mask | Falling debris, scaffold collapse, silica | Scaffold ties, debris nets, dust control |
| **PAINTING** | Respirator, safety glasses, gloves | VOC exposure, falls, spray hazards | Ventilation, respirator fit, containment |
| **GENERAL_CONTRACTOR** | All of above | All of above | Comprehensive site safety |

### Progress Analysis by Trade

| Trade Type | Completion Markers | Quality Indicators | Deficiency Flags |
|------------|-------------------|-------------------|------------------|
| **ROOFING** | Shingles installed, flashings complete, ridge cap | Straight courses, proper overlap, sealed penetrations | Exposed nails, lifted shingles, ponding |
| **ELECTRICAL** | Devices installed, covers on, labels applied | Neat wire runs, proper fill, code compliance | Open boxes, missing covers, overloaded conduit |
| **PLUMBING** | Fixtures set, trim complete, water on | No leaks, proper slope, venting visible | Water stains, missing caps, improper support |
| **CONCRETE** | Forms stripped, finish complete, cured | Smooth finish, no cracks, proper joints | Honeycombing, spalling, cold joints |
| **CARPENTRY** | Framing complete, sheathing on, trim installed | Plumb/level, proper nailing, no gaps | Wavy walls, missing blocking, rot |

## Technical Architecture

### Analysis Pipeline
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Photo Upload   │────▶│  GPT-4 Vision    │────▶│  Structured     │
│  (Uppy)         │     │  Analysis        │     │  Findings       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
         ┌────────────────────────────────────────────────┼────────────────┐
         │                        │                       │                │
         ▼                        ▼                       ▼                ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐ ┌────────────┐
│  Safety         │     │  Progress        │     │  Daily Log      │ │ Compliance │
│  Alerts         │     │  Tracking        │     │  Auto-Entry     │ │ Report     │
└─────────────────┘     └──────────────────┘     └─────────────────┘ └────────────┘
```

## API Endpoints

### POST /api/ai/jobsite-analysis/upload
Uploads photos for batch analysis.

**Request (multipart/form-data):**
```typescript
{
  projectId: string;
  date: string;                   // Analysis date (ISO)
  analysisTypes: string[];        // ['SAFETY', 'PROGRESS', 'MATERIALS', 'CREW', 'WEATHER']
  tradeType?: string;             // Override for specific trade focus
  notes?: string;                 // Context for AI
}
// + files[] in multipart
```

**Response:**
```typescript
{
  success: boolean;
  batchId: string;
  status: 'QUEUED';
  photoCount: number;
  estimatedTime: number;
}
```

### GET /api/ai/jobsite-analysis/results/:batchId
Retrieves analysis results.

**Response:**
```typescript
{
  batchId: string;
  status: 'PROCESSING' | 'COMPLETE' | 'PARTIAL' | 'FAILED';
  projectId: string;
  date: string;
  tradeType: string;
  summary: {
    overallSafetyScore: number;      // 0-100
    estimatedCompletion: number;     // % complete
    crewCountEstimate: number;
    weatherConditions: string;
    primaryConcerns: string[];
  };
  safetyFindings: Array<{
    id: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    category: string;                 // 'PPE', 'FALL_HAZARD', 'HOUSEKEEPING', etc.
    description: string;
    photoId: string;
    boundingBox?: {x, y, width, height};
    recommendation: string;
  }>;
  progressFindings: Array<{
    id: string;
    workArea: string;
    tradeType: string;
    estimatedComplete: number;
    observations: string;
    photoId: string;
  }>;
  materialFindings: Array<{
    id: string;
    materialType: string;
    quantity?: string;
    condition: string;               // 'STORED_PROPERLY', 'EXPOSED', 'DAMAGED'
    photoId: string;
  }>;
  crewFindings: {
    estimatedCount: number;
    ppeCompliance: number;           // % wearing proper PPE
    activeWorkAreas: string[];
  };
  photos: Array<{
    id: string;
    fileUrl: string;
    thumbnailUrl: string;
    aiAnnotationsJson?: object;
  }>;
}
```

### POST /api/ai/jobsite-analysis/create-safety-report
Generates a formal safety report from analysis.

**Request:**
```typescript
{
  batchId: string;
  includePhotos: boolean;
  recipientEmails?: string[];
}
```

## Database Schema

### New Table: jobsite_analysis_batches
```sql
CREATE TABLE jobsite_analysis_batches (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id),
  project_id VARCHAR NOT NULL REFERENCES projects(id),
  analysis_date DATE NOT NULL,
  trade_type VARCHAR,
  status VARCHAR NOT NULL DEFAULT 'PENDING',
  analysis_types VARCHAR[] DEFAULT '{SAFETY,PROGRESS}',
  summary_json JSONB,
  safety_findings_json JSONB,
  progress_findings_json JSONB,
  material_findings_json JSONB,
  crew_findings_json JSONB,
  ai_notes TEXT,
  error_message TEXT,
  processing_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_user_id VARCHAR REFERENCES users(id)
);
```

### New Table: jobsite_analysis_photos
```sql
CREATE TABLE jobsite_analysis_photos (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id VARCHAR NOT NULL REFERENCES jobsite_analysis_batches(id) ON DELETE CASCADE,
  file_key VARCHAR NOT NULL,
  file_url VARCHAR NOT NULL,
  thumbnail_url VARCHAR,
  original_filename VARCHAR,
  captured_at TIMESTAMP,
  gps_latitude DECIMAL(10, 8),
  gps_longitude DECIMAL(11, 8),
  ai_annotations_json JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Frontend Components

### Jobsite AI Tab (Project View)
- **Upload Section**: Drag-and-drop photo upload (reuses Uppy)
- **Analysis History**: List of past analyses with date/status
- **Results Dashboard**:
  - Safety score gauge
  - Progress percentage
  - Crew count
  - Weather conditions
- **Findings List**: Expandable cards for each finding
- **Photo Gallery**: Grid with AI annotations overlay

### Safety Report Generator
- One-click PDF generation
- Email distribution option
- Integration with existing handoff packets

## RBAC Access
- **ADMIN, MANAGER, SUPERINTENDENT, SAFETY_MANAGER**: Full access
- **FOREMAN**: Upload photos, view results
- **FIELD_WORKER**: Upload photos only
- **HOURLY**: No access

## Integration Points

### Daily Log Auto-Entry
Analysis findings can auto-populate:
- Weather conditions
- Crew count
- Safety observations
- Work completed notes

### Safety/Compliance Module
- Critical findings create safety alerts
- Track resolution status
- Compliance reporting integration

### Delay Tracking
- Weather conditions can trigger delay documentation
- Safety stops documented with photo evidence

## Development Phases
1. **Phase 1**: Database schema + upload infrastructure
2. **Phase 2**: GPT-4 Vision integration with trade-specific prompts
3. **Phase 3**: Results UI with photo gallery
4. **Phase 4**: Safety report generation + integrations
