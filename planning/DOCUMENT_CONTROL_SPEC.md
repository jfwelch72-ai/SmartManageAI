# Document Control & Revisioning Specification

## Overview

Document versioning and revision tracking system. Ensures documents have clear revision history with active/superseded status enforcement.

## Data Model

```
document_revisions:
  id, orgId, docId
  revisionNumber (sequential per docId)
  sourceType: upload | email | import | esign
  supersedesRevisionId (nullable)
  status: active | superseded
  fileRef/storageKey, checksum
  metadata (jsonb): { originalFilename, contentType, sizeBytes }
  createdByUserId, createdAt
```

## Revision Lifecycle

1. **Upload**: New file uploaded → create revision with next number
2. **Import**: File imported from email/integration → create revision
3. **E-sign**: Signed PDF returned → create revision (sourceType: esign)
4. **Supersede**: When new revision created, previous active revision marked superseded

## Superseded Enforcement

When DOCUMENT_CONTROL flag is ON:
- Default views show only `status: active` revisions
- Superseded documents have visual badge/warning
- "View old revision" link available with "This revision has been superseded" warning
- Addenda can reference which revision they supersede

When DOCUMENT_CONTROL flag is OFF:
- No enforcement; documents shown as uploaded (current behavior)

## Addenda Tracking

- Addenda are special revisions attached to bids/projects
- Track which original document the addendum modifies
- Addendum notification sent to relevant parties
- Addendum acknowledgment tracking (per sub/recipient)

## Revision Compare (Phase 2 Stub)

- Show metadata diff between revisions (filename, date, size, uploader)
- Visual document compare deferred to Phase 2
- Compare stub shows: "Full document comparison coming soon"

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/documents/:docId/revisions | MANAGER+ | List revisions |
| POST | /api/documents/:docId/revisions | MANAGER+ | Create revision |
| GET | /api/documents/revisions/:id | Auth'd | Get revision detail |
| POST | /api/documents/revisions/:id/supersede | ADMIN | Supersede revision |
| GET | /api/documents/:docId/compare | MANAGER+ | Compare revisions (stub) |
