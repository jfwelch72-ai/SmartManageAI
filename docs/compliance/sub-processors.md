# Sub-processors

This is the source-of-truth list for sub-processors that may process
customer personal data on the Company's behalf. The public
`/sub-processors` page is generated from this file.

The Company will notify customers at least **30 days before** a new
sub-processor begins processing their personal data, per the DPA.

| Sub-processor | Purpose | Data processed | Region | Last reviewed |
| ------------- | ------- | -------------- | ------ | ------------- |
| Replit, Inc. | Hosting platform for application compute, secrets, and deployment | All customer data in transit; environment-variable secrets | US | 2026-04-22 |
| Neon, Inc. | Managed Postgres database (primary application data) | All customer application data | US | 2026-04-22 |
| Google Cloud (Object Storage / GCS) | Customer file uploads (plans, photos, documents) | Customer-uploaded files and metadata | US | 2026-04-22 |
| OpenAI | AI features (bid analysis, contract analysis, suggestions) when enabled by the customer | Only data the customer submits to AI features | US | 2026-04-22 |
| SendGrid (Twilio) | Outbound transactional and notification email | Email addresses, message contents | US | 2026-04-22 |
| Stripe, Inc. | Subscription billing and payment processing | Billing contact and payment metadata (no card numbers — handled by Stripe directly) | US | 2026-04-22 |

## Notes

- All sub-processors above maintain a current SOC 2 Type II (or
  equivalent) attestation on file with us.
- **Card numbers** are never handled by the Service: the Stripe Elements
  iframe submits card data directly to Stripe.
- AI features are **opt-in** at the organization level; if disabled, no
  customer data is sent to OpenAI.
- A signed DPA is required for any new sub-processor before they begin
  processing customer data.

## Change history

| Date | Change | Notice sent |
| ---- | ------ | ----------- |
| 2026-04-22 | Initial public list published | Sent to all customer admins |
