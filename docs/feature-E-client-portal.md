# Feature E: Customer/Client Portal

> **Status: IMPLEMENTED** — This doc was the original planning spec. Feature shipped; see live code at `server/clientPortalRoutes.ts` (authenticated token-based portal access) and `client/src/components/ClientPortal.tsx` + the client portal page(s).
>
> **Implementation notes vs. spec:**
> - Access via time-limited signed token link (not full user account). Portal users cannot log in via the main auth flow.
> - Rate-limited via `authLimiter` on the portal verify endpoint to prevent brute-force token guessing.
> - Portal displays: project status, milestone progress, change orders (approved/pending), uploaded documents, key contacts, and trade-specific terminology.
> - No internal financial data (labor costs, payroll, vendor pricing) is ever exposed — enforced at the API level.
> - Read-only; all portal requests are unauthenticated-equivalent (no org context write access).

---

## Overview
Provides a secure, read-only portal for clients/owners to view project status, schedules, photos, change orders, and key documents without access to internal contractor data. The portal adapts its display based on the **trade type** of the contractor, showing trade-relevant progress markers and terminology.

## Trade-Specific Portal Views

### Progress Terminology by Trade

| Trade Type | Progress Phases | Client-Visible Milestones | Hidden Internal Data |
|------------|----------------|--------------------------|---------------------|
| **ROOFING** | Tear-off, Dry-in, Install, Complete | "Roof dried-in", "Shingles 50% complete" | Labor costs, crew wages |
| **ELECTRICAL** | Rough, Trim, Final | "Rough wiring complete", "Fixtures installed" | Wire footage, labor hours |
| **PLUMBING** | Underground, Rough, Finish | "Plumbing roughed", "Fixtures set" | Material costs, subs |
| **HVAC** | Equipment, Duct, Startup | "Equipment set", "System operational" | Refrigerant costs, labor |
| **CONCRETE** | Forms, Pour, Finish | "Concrete poured", "Curing complete" | Mix design, labor rates |
| **CARPENTRY** | Frame, Sheathe, Trim | "Framing complete", "Trim installed" | Board footage, labor |
| **GENERAL_CONTRACTOR** | By phase/trade | "Phase 1 complete", per-trade progress | All internal costs |

### Document Categories by Trade
Each trade shows relevant document types:
- **Roofing**: Warranty, Manufacturer specs, Inspection reports
- **Electrical**: Permits, Inspection cards, As-builts
- **Concrete**: Mix designs (simplified), Strength reports, Photos
- **All Trades**: Change orders, Schedule, Progress photos

## Technical Architecture

### Secure Access Model
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Client Email   │────▶│  Magic Link /    │────▶│  JWT Token      │
│  + Project ID   │     │  Access Code     │     │  (Limited Scope)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Read-Only      │◀────│  Filtered Data   │◀────│  Client Portal  │
│  Views          │     │  (No Internal)   │     │  API Layer      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Data Filtering Rules
**VISIBLE to clients:**
- Project name, address, status
- Schedule (without cost data)
- Progress photos (approved only)
- Change orders (without internal markup)
- Inspection results (pass/fail)
- Key documents (approved for sharing)

**HIDDEN from clients:**
- Labor rates, hours, costs
- Internal notes
- Subcontractor details
- Profit margins, markups
- Crew assignments
- Material vendor pricing
- Internal messages

## API Endpoints (Client-Facing)

### POST /client/api/auth/request-access
Requests access to a project portal.

**Request:**
```typescript
{
  projectPublicId: string;        // Non-guessable public ID
  email: string;
  name?: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  message: string;                // "Access link sent to email"
}
```

### POST /client/api/auth/verify
Verifies magic link token.

**Request:**
```typescript
{
  token: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  accessToken: string;            // JWT for subsequent requests
  expiresAt: string;
  projectId: string;
  projectName: string;
}
```

### GET /client/api/projects/:publicId/summary
Returns project overview.

**Response:**
```typescript
{
  projectName: string;
  address: string;
  tradeType: string;
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETE';
  overallProgress: number;         // 0-100
  startDate: string;
  estimatedEndDate: string;
  actualEndDate?: string;
  contractorName: string;
  contractorLogo?: string;
  primaryContact: {
    name: string;
    phone: string;
    email: string;
  };
  recentUpdates: Array<{
    date: string;
    type: 'PROGRESS' | 'MILESTONE' | 'PHOTO' | 'DOCUMENT';
    summary: string;
  }>;
}
```

### GET /client/api/projects/:publicId/schedule
Returns project schedule (without cost data).

**Response:**
```typescript
{
  phases: Array<{
    name: string;
    tradeType?: string;
    startDate: string;
    endDate: string;
    percentComplete: number;
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'DELAYED';
    milestones: Array<{
      name: string;
      date: string;
      completed: boolean;
    }>;
  }>;
  upcomingMilestones: Array<{
    name: string;
    expectedDate: string;
  }>;
}
```

### GET /client/api/projects/:publicId/photos
Returns approved progress photos.

**Response:**
```typescript
{
  albums: Array<{
    date: string;
    title: string;
    photos: Array<{
      id: string;
      thumbnailUrl: string;
      fullUrl: string;
      caption?: string;
      takenAt: string;
    }>;
  }>;
  totalPhotos: number;
}
```

### GET /client/api/projects/:publicId/change-orders
Returns change orders (client-facing view).

**Response:**
```typescript
{
  changeOrders: Array<{
    id: string;
    number: string;
    title: string;
    description: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    submittedDate: string;
    amount: number;                // Total only, no breakdown
    clientApprovalRequired: boolean;
    approvedDate?: string;
    attachments: Array<{
      name: string;
      url: string;
    }>;
  }>;
}
```

### POST /client/api/projects/:publicId/change-orders/:id/respond
Allows client to approve/reject change order.

**Request:**
```typescript
{
  response: 'APPROVED' | 'REJECTED';
  comments?: string;
  signature?: string;              // Base64 signature image
}
```

### GET /client/api/projects/:publicId/documents
Returns approved documents for sharing.

**Response:**
```typescript
{
  documents: Array<{
    id: string;
    name: string;
    category: string;             // 'CONTRACT', 'PERMIT', 'WARRANTY', 'INSPECTION', 'OTHER'
    uploadedDate: string;
    fileUrl: string;
    fileSize: number;
  }>;
}
```

## Database Schema Changes

### Extended: projects table
```sql
ALTER TABLE projects ADD COLUMN client_portal_enabled BOOLEAN DEFAULT false;
ALTER TABLE projects ADD COLUMN client_portal_public_id VARCHAR UNIQUE;
ALTER TABLE projects ADD COLUMN client_portal_settings_json JSONB;
```

### New Table: client_portal_access
```sql
CREATE TABLE client_portal_access (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id),
  project_id VARCHAR NOT NULL REFERENCES projects(id),
  email VARCHAR NOT NULL,
  name VARCHAR,
  access_token_hash VARCHAR,
  token_expires_at TIMESTAMP,
  last_accessed_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by_user_id VARCHAR REFERENCES users(id)
);

CREATE INDEX idx_portal_access_project ON client_portal_access(project_id);
CREATE INDEX idx_portal_access_email ON client_portal_access(email);
```

### New Table: client_portal_activity
```sql
CREATE TABLE client_portal_activity (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id VARCHAR NOT NULL REFERENCES client_portal_access(id),
  project_id VARCHAR NOT NULL REFERENCES projects(id),
  action VARCHAR NOT NULL,         -- 'VIEW_SUMMARY', 'VIEW_PHOTOS', 'APPROVE_CO', etc.
  details_json JSONB,
  ip_address VARCHAR,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Extended: media table
```sql
ALTER TABLE media ADD COLUMN client_portal_visible BOOLEAN DEFAULT false;
ALTER TABLE media ADD COLUMN client_portal_approved_by VARCHAR REFERENCES users(id);
ALTER TABLE media ADD COLUMN client_portal_approved_at TIMESTAMP;
```

## Frontend Components

### Client Portal Layout (Separate from Main App)
- **Minimalist Header**: Contractor logo + project name
- **Navigation**: Summary | Schedule | Photos | Documents | Change Orders
- **Footer**: Contact information + powered by branding

### Summary Dashboard
- **Progress Ring**: Overall completion percentage
- **Phase Cards**: Visual progress per phase
- **Recent Activity**: Timeline of updates
- **Quick Stats**: Days remaining, upcoming milestones

### Photo Gallery
- **Album View**: Grouped by date
- **Lightbox**: Full-screen photo viewing
- **Before/After Slider**: When applicable

### Change Order Response
- **CO Details**: Full description and amount
- **Signature Pad**: Electronic signature capture
- **Comments Field**: Optional feedback
- **Confirmation**: Receipt of approval/rejection

### Admin Panel (Contractor Side)
- **Enable/Disable Portal**: Per-project toggle
- **Manage Access**: Add/revoke client emails
- **Content Approval**: Mark photos/documents as visible
- **Activity Log**: View client portal usage

## RBAC Access (Contractor Side)
- **ADMIN, MANAGER**: Full portal management
- **SUPERINTENDENT**: View activity, approve photos
- **OFFICE_MANAGER**: Manage access, view activity
- **ESTIMATOR, FOREMAN**: No portal management access

## Security Measures
1. **Non-guessable IDs**: UUID-based public project IDs
2. **Magic Links**: Time-limited access tokens (24h)
3. **Rate Limiting**: Prevent brute-force attempts
4. **Activity Logging**: Track all portal access
5. **Data Filtering**: Server-side filtering of sensitive data
6. **HTTPS Only**: Enforce secure connections

## Development Phases
1. **Phase 1**: Database schema + access management APIs
2. **Phase 2**: Client-facing read APIs + basic portal UI
3. **Phase 3**: Change order approval workflow
4. **Phase 4**: Photo approval + document sharing + activity tracking
