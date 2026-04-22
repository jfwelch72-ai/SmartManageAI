# Incident Response Policy

| Owner | CTO |
| ----- | --- |
| Approver | CEO |
| Review cadence | Annual; post-incident |

## 1. Purpose

Define how the Company detects, triages, contains, eradicates, recovers
from, and learns from security and availability incidents.

## 2. Definitions

- **Event**: any observable occurrence in a system. Most events are not
  incidents.
- **Incident**: an event (or series) that violates security policies,
  acceptable use, or service availability commitments, or that exposes
  customer data.
- **Breach**: an incident that results in unauthorized acquisition of, or
  access to, customer personal data. Triggers regulatory notification
  obligations.

## 3. Severity

| Sev | Examples | Initial response |
| --- | -------- | ---------------- |
| SEV-1 | Customer data exposure; production fully down; ransomware | Page on-call within 5 min; war room within 15 min |
| SEV-2 | Partial outage; suspected unauthorized access; degraded | Page on-call within 15 min; responder within 1 hr |
| SEV-3 | Single-tenant issue; minor data integrity bug | Ticket, response within next business day |
| SEV-4 | Cosmetic, no customer impact | Ticket, response within 5 business days |

## 4. Roles

- **Incident Commander (IC)**: drives the response, single decision-maker.
- **Communications Lead**: handles internal + customer + status page
  comms.
- **Scribe**: maintains the timeline in the incident ticket.
- **Subject-matter responders**: investigate and remediate.

## 5. Phases

1. **Detect** — alerts from monitoring, customer reports via
   support@, automated audit-log anomaly detection.
2. **Triage** — IC assigns severity, opens incident channel, starts
   timeline.
3. **Contain** — block attacker access (rotate credentials via
   `revokeUserTokens`, block IPs, take affected services out of rotation).
4. **Eradicate** — remove the cause (patch, kill malicious accounts,
   revoke tokens).
5. **Recover** — restore service, validate via health checks, lift any
   feature flags.
6. **Lessons learned** — blameless retrospective within 5 business days
   for SEV-1/2; published to the engineering team. Action items tracked
   to closure in the GRC platform.

## 6. Customer notification

- **Confirmed breach of customer data**: notify affected customers within
  the lesser of 72 hours and any contractual SLA. Include scope, what we
  know, what we're doing, and a contact.
- **Significant availability incident**: post to the public status page
  and update at least every 60 minutes until resolved.
- **Regulatory notification** (GDPR, state laws): handled by Legal in
  parallel with customer notification.

## 7. Evidence preservation

For SEV-1 and any suspected breach:
- Snapshot affected systems before remediation if feasible.
- Export relevant `auditLog` rows and centralized logs for the period.
- Maintain chain-of-custody notes in the incident ticket.

## 8. Drills

The IR plan is exercised at least annually via a tabletop drill (see
`runbooks/incident-response-tabletop.md`). Drill notes are filed in
`docs/compliance/evidence/`.
