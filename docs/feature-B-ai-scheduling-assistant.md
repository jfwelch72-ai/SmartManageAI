# Feature B: AI Scheduling Assistant

## Overview
Automatically generates, updates, and optimizes project schedules (Gantt-style) based on SOW items, production rates, crew sizes, trade types, delays, and inspections. The scheduling logic is **trade-specific**, applying industry-standard task sequences and dependencies for each trade.

## Trade-Specific Scheduling Logic

### Task Templates by Trade Type

| Trade Type | Typical Task Sequence | Key Dependencies | Inspection Points |
|------------|----------------------|------------------|-------------------|
| **ROOFING** | Tear-off → Deck Repair → Underlayment → Shingles/Metal → Flashings → Gutters → Cleanup | Weather-dependent, sequential | Final roof inspection |
| **ELECTRICAL** | Rough-in → Inspection → Trim-out → Panel terminations → Final | Must follow framing, before drywall | Rough, final |
| **PLUMBING** | Underground → Rough-in → Inspection → Fixture install → Final | Before slab, coordinate with HVAC | Rough, final, gas |
| **HVAC** | Equipment set → Ductwork → Registers → Controls → Startup | After framing, before drywall | Mechanical, final |
| **CONCRETE** | Layout → Forms → Rebar → Pour → Cure → Strip → Finish | Weather, cure time critical | Pre-pour, final |
| **CARPENTRY** | Layout → Framing → Sheathing → Windows/Doors → Trim | Foundation complete | Framing inspection |
| **MASONRY** | Foundation → Block/Brick → Lintels → Grouting → Pointing | Weather-dependent | Masonry inspection |
| **PAINTING** | Prep → Prime → Paint 1 → Paint 2 → Touch-up | After drywall finish | None typically |
| **FLOORING** | Subfloor prep → Underlayment → Install → Transitions → Base | After paint (walls) | None typically |
| **DRYWALL** | Hang → Tape → Mud (3 coats) → Sand → Prime | After MEP rough-in | None typically |
| **GENERAL_CONTRACTOR** | Coordinates all trades with proper sequencing | All trade dependencies | All inspection types |

### Production Rate Integration
Uses existing `organization_work_types` and `master_sow_items` production rates:
- Calculates task duration = Quantity ÷ (Crew Size × Production Rate)
- Adjusts for weather, material lead times, inspection wait times

## Technical Architecture

### AI Schedule Generation Flow
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  SOW Items +    │────▶│  AI Analysis     │────▶│  Task           │
│  Production     │     │  (GPT-4)         │     │  Breakdown      │
│  Rates          │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Final          │◀────│  User Review     │◀────│  Dependency     │
│  Schedule       │     │  & Adjust        │     │  Graph          │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Integration Points
1. **SOW Items**: `organization_sow_items`, `scope_items`
2. **Production Rates**: `organization_work_types`, production benchmarks
3. **Crews**: `crews`, `crew_project_assignments`
4. **Delays**: `project_delays` - auto-adjust schedule on delay
5. **Inspections**: `project_inspections` - insert inspection milestones

## API Endpoints

### POST /api/schedule/ai-generate
Generates a new schedule using AI.

**Request:**
```typescript
{
  projectId: string;
  startDate: string;              // ISO date
  workingDays?: number[];         // 0=Sun, 1=Mon, etc. Default [1,2,3,4,5]
  crewIds?: string[];             // Assigned crews
  includeTrades?: string[];       // For GC: which trades to schedule
  options?: {
    bufferDays?: number;          // Buffer between tasks
    weatherContingency?: number;  // % buffer for weather
    inspectionWaitDays?: number;  // Expected inspection turnaround
  };
}
```

**Response:**
```typescript
{
  success: boolean;
  scheduleId: string;
  status: 'GENERATED';
  proposedSchedule: {
    startDate: string;
    endDate: string;
    totalDays: number;
    criticalPathDays: number;
    tasks: Array<{
      id: string;
      name: string;
      tradeType?: string;
      startDate: string;
      endDate: string;
      durationDays: number;
      dependencies: string[];      // Task IDs
      isCriticalPath: boolean;
      crewId?: string;
      sowItemIds?: string[];
      inspectionRequired?: boolean;
    }>;
  };
  aiNotes: string;
}
```

### POST /api/schedule/ai-update
Recalculates schedule based on changes (delays, scope additions, etc.)

**Request:**
```typescript
{
  scheduleId: string;
  triggerType: 'DELAY' | 'SCOPE_CHANGE' | 'CREW_CHANGE' | 'INSPECTION_RESULT';
  triggerId?: string;              // Delay ID, scope item ID, etc.
  options?: {
    preserveCompletedTasks: boolean;
    cascadeDelay: boolean;
  };
}
```

### GET /api/schedule/:projectId
Returns current schedule for a project.

### PATCH /api/schedule/tasks/:taskId
Updates a specific task (manual adjustment).

## Database Schema

### New Table: project_schedules
```sql
CREATE TABLE project_schedules (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id),
  project_id VARCHAR NOT NULL REFERENCES projects(id),
  name VARCHAR DEFAULT 'Master Schedule',
  generated_by VARCHAR NOT NULL DEFAULT 'MANUAL',  -- 'AI' | 'MANUAL'
  baseline_start_date DATE,
  baseline_end_date DATE,
  actual_start_date DATE,
  actual_end_date DATE,
  working_days INTEGER[] DEFAULT '{1,2,3,4,5}',
  options_json JSONB,
  ai_notes TEXT,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_user_id VARCHAR REFERENCES users(id)
);
```

### New Table: project_schedule_tasks
```sql
CREATE TABLE project_schedule_tasks (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id VARCHAR NOT NULL REFERENCES project_schedules(id) ON DELETE CASCADE,
  parent_task_id VARCHAR REFERENCES project_schedule_tasks(id),
  name VARCHAR NOT NULL,
  description TEXT,
  trade_type VARCHAR,
  planned_start_date DATE,
  planned_end_date DATE,
  actual_start_date DATE,
  actual_end_date DATE,
  duration_days INTEGER,
  dependencies VARCHAR[],           -- Array of task IDs
  percent_complete INTEGER DEFAULT 0,
  is_critical_path BOOLEAN DEFAULT false,
  is_milestone BOOLEAN DEFAULT false,
  crew_id VARCHAR REFERENCES crews(id),
  sow_item_ids VARCHAR[],
  inspection_id VARCHAR REFERENCES project_inspections(id),
  delay_ids VARCHAR[],              -- Linked delays affecting this task
  status VARCHAR DEFAULT 'NOT_STARTED',  -- NOT_STARTED, IN_PROGRESS, COMPLETE, DELAYED
  sort_order INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Frontend Components

### Schedule Tab (within Project View)
- **Gantt Table View**: Task list with timeline bars
- **AI Generate Button**: "Generate AI Schedule" opens wizard
- **Task Detail Panel**: Click task to see/edit details
- **Delay Indicators**: Visual markers for delayed tasks
- **Inspection Milestones**: Diamond markers for inspections

### AI Schedule Wizard
1. **Step 1**: Select start date and working days
2. **Step 2**: Review detected SOW items and quantities
3. **Step 3**: Assign crews (optional)
4. **Step 4**: Review AI-proposed schedule with diff view
5. **Step 5**: Accept or adjust before saving

## RBAC Access
- **ADMIN, MANAGER, SUPERINTENDENT**: Full access (generate, edit, delete)
- **ESTIMATOR**: View and generate (no edit after approval)
- **FOREMAN**: View only
- **FIELD_WORKER, HOURLY**: No access

## Critical Path Calculation
AI identifies critical path by:
1. Finding longest dependency chain
2. Marking tasks with zero float
3. Highlighting in UI with distinct color

## Integration with Delays
When a delay is logged:
1. System identifies affected tasks
2. AI suggests schedule adjustments
3. Calculates new end date
4. Notifies relevant parties

## Development Phases
1. **Phase 1**: Database schema + basic CRUD endpoints
2. **Phase 2**: AI schedule generation with trade-specific templates
3. **Phase 3**: Gantt UI with task editing
4. **Phase 4**: Delay/inspection integration + auto-updates
