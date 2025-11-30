# Feature G: Mobile App / Offline Field Mode

## Overview
Provides backend API support and client scaffolding for mobile/field use with offline capabilities. The system enables field workers to access projects, clock in/out, log daily activities, and capture photos even without internet connectivity, with automatic sync when back online. Features are **trade-specific**, showing relevant tools and checklists for each trade.

## Trade-Specific Mobile Features

### Mobile Tools by Trade Type

| Trade Type | Primary Mobile Tools | Field Checklists | Photo Categories |
|------------|---------------------|------------------|------------------|
| **ROOFING** | Square calculator, Weather check, Material tracker | Pre-install, Quality, Safety | Deck condition, Install progress, Complete |
| **ELECTRICAL** | Circuit mapper, Wire pull calculator, Panel schedule | Rough-in, Trim-out, Final | Panel photos, Device locations, As-builts |
| **PLUMBING** | Fixture count, Pipe calculator, Test log | Pressure test, Drain test, Final | Test gauges, Rough-in, Fixtures |
| **HVAC** | CFM calculator, Duct sizer, Startup log | Duct leak test, Startup, Commissioning | Equipment, Duct runs, Controls |
| **CONCRETE** | Volume calculator, Slump log, Cure tracker | Pre-pour, Post-pour, Strength | Forms, Pour, Finish, Cure |
| **CARPENTRY** | Board foot calc, Cut list, Stud layout | Framing, Sheathing, Trim | Framing details, Blocking, Finish |
| **GENERAL_CONTRACTOR** | All trade tools | All checklists | All categories |

## Technical Architecture

### Offline-First Sync Model
```
┌─────────────────┐                    ┌─────────────────┐
│  Mobile Device  │                    │  Server         │
│                 │                    │                 │
│  ┌───────────┐  │                    │                 │
│  │ Local DB  │  │    ◀── Sync ──▶    │  ┌───────────┐  │
│  │ (SQLite)  │  │                    │  │ Postgres  │  │
│  └───────────┘  │                    │  └───────────┘  │
│        │        │                    │                 │
│        ▼        │                    │                 │
│  ┌───────────┐  │                    │                 │
│  │ Sync      │  │                    │                 │
│  │ Queue     │  │                    │                 │
│  └───────────┘  │                    │                 │
└─────────────────┘                    └─────────────────┘

Sync States:
- SYNCED: Data matches server
- PENDING: Local changes awaiting upload
- CONFLICT: Both local and server changed (requires resolution)
```

### Data Priority for Offline Access
**Must have offline (Priority 1):**
- Assigned projects (basic info)
- Time clock (clock in/out)
- Daily log templates
- Trade-specific checklists

**Should have offline (Priority 2):**
- Project photos (recent)
- SOW items for assigned projects
- Crew member info

**Nice to have offline (Priority 3):**
- Historical data
- Reports
- Messages (read-only cache)

## API Endpoints

### POST /api/mobile/register-device
Registers a mobile device for sync.

**Request:**
```typescript
{
  deviceId: string;               // Unique device identifier
  platform: 'IOS' | 'ANDROID';
  appVersion: string;
  pushToken?: string;             // For push notifications
  deviceModel?: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  registrationId: string;
  syncToken: string;              // For incremental sync
  syncEndpoint: string;
}
```

### GET /api/mobile/sync
Retrieves changes since last sync.

**Query Params:**
- `lastSyncAt`: ISO timestamp of last sync
- `deviceId`: Registered device ID
- `dataTypes`: Comma-separated (projects, timeclock, dailylog, photos)

**Response:**
```typescript
{
  syncedAt: string;
  nextSyncToken: string;
  changes: {
    projects: {
      created: Project[];
      updated: Project[];
      deleted: string[];          // IDs of deleted projects
    };
    assignments: {
      created: Assignment[];
      updated: Assignment[];
      deleted: string[];
    };
    timeClock: {
      shifts: TimeClockShift[];
      events: TimeClockEvent[];
    };
    sowItems: {
      created: SowItem[];
      updated: SowItem[];
    };
    checklists: {
      templates: ChecklistTemplate[];
      responses: ChecklistResponse[];
    };
  };
  deletedRecords: Array<{
    type: string;
    id: string;
  }>;
}
```

### POST /api/mobile/sync
Uploads local changes to server.

**Request:**
```typescript
{
  deviceId: string;
  syncToken: string;
  changes: {
    timeClockEvents: Array<{
      localId: string;
      type: 'CLOCK_IN' | 'CLOCK_OUT' | 'BREAK_START' | 'BREAK_END';
      timestamp: string;
      projectId?: string;
      location?: {
        latitude: number;
        longitude: number;
        accuracy: number;
      };
      notes?: string;
    }>;
    dailyLogs: Array<{
      localId: string;
      projectId: string;
      date: string;
      weatherConditions?: string;
      crewCount?: number;
      workPerformed?: string;
      materialsUsed?: string;
      issues?: string;
    }>;
    photos: Array<{
      localId: string;
      projectId: string;
      category: string;
      caption?: string;
      capturedAt: string;
      location?: {lat, lng};
      // Actual file uploaded separately via /api/mobile/upload-photo
    }>;
    checklistResponses: Array<{
      localId: string;
      templateId: string;
      projectId: string;
      responses: Record<string, any>;
      completedAt: string;
    }>;
  };
}
```

**Response:**
```typescript
{
  success: boolean;
  processed: {
    timeClockEvents: Array<{localId: string; serverId: string; status: 'CREATED' | 'CONFLICT'}>;
    dailyLogs: Array<{localId: string; serverId: string; status: string}>;
    photos: Array<{localId: string; serverId: string; uploadUrl?: string}>;
    checklistResponses: Array<{localId: string; serverId: string; status: string}>;
  };
  conflicts: Array<{
    type: string;
    localId: string;
    serverId: string;
    serverVersion: any;
    resolution: 'SERVER_WINS' | 'CLIENT_WINS' | 'MERGE' | 'MANUAL';
  }>;
  serverTime: string;
}
```

### POST /api/mobile/upload-photo
Uploads a photo file (separate from sync for large files).

**Request (multipart):**
```typescript
{
  localId: string;
  projectId: string;
  // + file
}
```

### GET /api/mobile/offline-bundle
Downloads a complete offline data bundle for a project.

**Query Params:**
- `projectId`: Project to bundle
- `includePhotos`: boolean

**Response:**
Binary bundle or JSON with all required offline data.

## Database Schema

### New Table: mobile_devices
```sql
CREATE TABLE mobile_devices (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  device_id VARCHAR NOT NULL UNIQUE,
  platform VARCHAR NOT NULL,         -- IOS, ANDROID
  app_version VARCHAR,
  device_model VARCHAR,
  push_token VARCHAR,
  last_sync_at TIMESTAMP,
  sync_token VARCHAR,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_mobile_devices_user ON mobile_devices(user_id);
CREATE INDEX idx_mobile_devices_org ON mobile_devices(organization_id);
```

### New Table: mobile_sync_log
```sql
CREATE TABLE mobile_sync_log (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR NOT NULL REFERENCES mobile_devices(id),
  sync_type VARCHAR NOT NULL,        -- PULL, PUSH, FULL
  sync_started_at TIMESTAMP NOT NULL,
  sync_completed_at TIMESTAMP,
  records_downloaded INTEGER DEFAULT 0,
  records_uploaded INTEGER DEFAULT 0,
  conflicts INTEGER DEFAULT 0,
  status VARCHAR DEFAULT 'IN_PROGRESS',
  error_message TEXT,
  metadata_json JSONB
);
```

### New Table: mobile_pending_uploads
```sql
CREATE TABLE mobile_pending_uploads (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR NOT NULL REFERENCES mobile_devices(id),
  local_id VARCHAR NOT NULL,
  record_type VARCHAR NOT NULL,
  record_data_json JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  status VARCHAR DEFAULT 'PENDING',
  error_message TEXT
);
```

## Mobile Client Scaffold Structure

```
/mobile
├── README.md                      # Setup instructions
├── app.json                       # Expo config
├── package.json
├── src/
│   ├── App.tsx                    # Main entry
│   ├── navigation/
│   │   └── AppNavigator.tsx       # Tab + Stack navigation
│   ├── screens/
│   │   ├── HomeScreen.tsx         # Dashboard
│   │   ├── ProjectsScreen.tsx     # Project list
│   │   ├── ProjectDetailScreen.tsx
│   │   ├── TimeClockScreen.tsx    # Clock in/out
│   │   ├── DailyLogScreen.tsx     # Log entry
│   │   ├── PhotoCaptureScreen.tsx # Camera
│   │   ├── ChecklistScreen.tsx    # Trade checklists
│   │   └── SyncStatusScreen.tsx   # Sync management
│   ├── services/
│   │   ├── api.ts                 # API client
│   │   ├── sync.ts                # Sync logic
│   │   ├── storage.ts             # SQLite wrapper
│   │   └── auth.ts                # Authentication
│   ├── hooks/
│   │   ├── useSync.ts
│   │   ├── useOfflineData.ts
│   │   └── useLocation.ts
│   ├── components/
│   │   ├── SyncIndicator.tsx
│   │   ├── OfflineBanner.tsx
│   │   └── TradeTools.tsx
│   └── utils/
│       ├── tradeConfig.ts         # Trade-specific configs
│       └── conflictResolution.ts
└── docs/
    └── OFFLINE_SYNC_STRATEGY.md   # Detailed sync documentation
```

## Trade-Specific Mobile Configuration

```typescript
// tradeConfig.ts
export const TRADE_MOBILE_CONFIG = {
  ROOFING: {
    tools: ['squareCalculator', 'weatherCheck', 'materialTracker'],
    checklists: ['preInstall', 'qualityCheck', 'safetyCheck'],
    photoCategories: ['deckCondition', 'installProgress', 'complete', 'damage'],
    dailyLogFields: ['squaresInstalled', 'weatherConditions', 'materialDeliveries'],
  },
  ELECTRICAL: {
    tools: ['circuitMapper', 'wirePullCalc', 'panelSchedule'],
    checklists: ['roughIn', 'trimOut', 'final'],
    photoCategories: ['panel', 'deviceLocations', 'asBuilts', 'inspections'],
    dailyLogFields: ['circuitsRoughed', 'devicesTrimmed', 'inspectionResults'],
  },
  // ... other trades
};
```

## RBAC Access
- **All authenticated users**: Can register device, sync own data
- **ADMIN, MANAGER, SUPERINTENDENT**: View all device registrations
- **Device owner**: Manages own device registration

## Offline Conflict Resolution

### Resolution Strategies
1. **Last Write Wins**: Timestamp comparison
2. **Server Wins**: Server data always preferred
3. **Client Wins**: Local data always preferred (user choice)
4. **Merge**: Combine non-conflicting fields
5. **Manual**: Present both versions to user

### Conflict-Prone Data Types
- Time clock (same shift edited on multiple devices)
- Daily logs (same date edited)
- Photos (duplicate uploads)

## Push Notifications
When online, send push for:
- New project assignments
- Schedule changes
- Urgent messages
- Sync reminders (if pending > 24h)

## Development Phases
1. **Phase 1**: Device registration + basic sync endpoints
2. **Phase 2**: Time clock + daily log sync
3. **Phase 3**: Photo upload + offline storage
4. **Phase 4**: Trade-specific tools + checklists
5. **Phase 5**: React Native scaffold with basic screens
