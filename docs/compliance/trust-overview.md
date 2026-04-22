# Trust at SmartManageAI

This is the source content rendered on the public `/trust` page.

## Our security commitment

SmartManageAI is the system of record for construction businesses. We
treat customer data with the seriousness it deserves: bid prices,
financial performance, payroll, contracts, and field documentation.

We are in active observation for our **first SOC 2 Type II audit** and
operate to its requirements today.

## Highlights

- **Authentication**: WebAuthn passkeys for phishing-resistant login.
  SAML 2.0 SSO available for enterprise. MFA required for all staff.
- **Encryption**: TLS 1.2+ in transit. AES-256 at rest for the database
  and all customer files.
- **Access control**: role-based access enforced server-side.
  Tenant isolation by organization on every query. Per-object ACLs for
  uploaded files.
- **Audit log**: every change that affects customer data or security
  state is recorded. Customer admins can search and export.
- **Backups**: Postgres point-in-time recovery (7 days) plus daily
  off-account dumps with 30-day object-locked retention.
- **Resilience**: tier-1 systems target RTO 4h / RPO 15m. Restore drills
  quarterly.
- **Sub-processors**: published list at `/sub-processors`. 30-day notice
  on any addition.
- **Vulnerability program**: dependency audit, SAST, secret scan, and
  IaC scan in CI on every PR. Annual penetration test.
- **Incident response**: documented IR plan; tabletop exercised
  annually; 72-hour customer notification on confirmed data breach.

## Documents

- Sub-processor list: `/sub-processors`
- System status: `/status`
- Privacy policy
- Data Processing Agreement (DPA): available on request
- SOC 2 Type I report and bridge letter: available under NDA via
  security@smartmanage.ai
- Security questionnaire (CAIQ-Lite / SIG-Lite responses): available
  on request

## Reporting a security issue

We welcome reports from security researchers. Email
**security@smartmanage.ai** with details and a way to reach you.

We commit to:

- Acknowledging receipt within 2 business days.
- Working with you in good faith to triage and fix.
- Not pursuing legal action against research that is conducted in good
  faith, against your own test account, and that does not exfiltrate
  customer data, disrupt the service, or social-engineer staff.

## Contact

- Security: security@smartmanage.ai
- Privacy / data protection: privacy@smartmanage.ai
- General: support@smartmanage.ai
