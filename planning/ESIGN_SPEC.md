# E-Signature Integration Specification

## Overview

Provider-agnostic e-signature interface with DocuSign as the initial implementation. Supports sending Change Orders and Subcontracts for signature with status tracking.

## Provider Interface

```typescript
interface ESignProvider {
  createEnvelope(params: {
    templateId?: string;
    document: Buffer;
    documentName: string;
    recipients: ESignRecipient[];
    fields: ESignField[];
    subject: string;
    message: string;
  }): Promise<{ envelopeId: string; status: string }>;
  
  getEnvelopeStatus(envelopeId: string): Promise<ESignEnvelopeStatus>;
  downloadSignedDocument(envelopeId: string): Promise<Buffer>;
  cancelEnvelope(envelopeId: string): Promise<void>;
}
```

## Workflow

### Send for Signature
1. User selects CO or Subcontract to send
2. System generates PDF from existing PDF service
3. User reviews and confirms recipients + signature fields
4. Draft envelope created (status: DRAFT)
5. Admin approves sending (if APPROVALS_FRAMEWORK ON)
6. Envelope sent to e-sign provider
7. Status tracked: SENT → VIEWED → SIGNED | DECLINED

### Status Tracking
- Poll provider for status updates (background job, every 15 min)
- Update internal status on change
- Notify relevant users on completion/decline

### Document Storage
- On SIGNED status: download signed PDF
- Store in object storage
- Create document_revision entry (sourceType: 'esign')
- Link to original CO/Subcontract record

## Supported Documents

| Entity | Document Type | Template |
|--------|--------------|----------|
| Change Orders | CO PDF | Generated from CO data |
| Subcontracts | Subcontract PDF | Generated from subcontract data |

## DocuSign Implementation

### OAuth Flow
- Authorization Code Grant
- Scopes: `signature`, `impersonation`
- JWT auth for server-to-server (optional)

### API Integration
- Create envelope with embedded document
- Add signature/date tabs at specified positions
- Use DocuSign Connect webhooks for status updates (optional)
- Fallback to polling if webhooks not configured

## Environment Variables

- `DOCUSIGN_CLIENT_ID`
- `DOCUSIGN_CLIENT_SECRET`
- `DOCUSIGN_REDIRECT_URI`
- `DOCUSIGN_ACCOUNT_ID`
- `DOCUSIGN_BASE_URL` (demo vs production)
