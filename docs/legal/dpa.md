# Data Processing Addendum (DPA)

_Last updated: 2026-05-07_

This Data Processing Addendum ("**DPA**") forms part of the agreement between
SmartManageAI, Inc. ("**Processor**") and Customer ("**Controller**") for the
provision of the SmartManageAI platform (the "**Services**"). It applies to
the Processing of Personal Data on behalf of Controller.

A countersigned copy is available on request to `legal@smartmanage.ai`. The
HTML version of this DPA is published at `/dpa`.

## 1. Definitions

Capitalised terms not defined here have the meaning given in applicable Data
Protection Laws (including GDPR, UK GDPR, CCPA/CPRA). "**Personal Data**",
"**Processing**", "**Data Subject**", "**Controller**", and "**Processor**"
have the meanings set out in the GDPR.

## 2. Scope and roles

Controller appoints Processor to Process Personal Data on its behalf solely to
provide the Services and as further documented in the Agreement. Each party
will comply with its obligations under applicable Data Protection Laws.

## 3. Processing details

| Item | Description |
| ---- | ----------- |
| Subject matter | Provision of the SmartManageAI construction-management platform |
| Duration | Term of the Agreement plus the deletion period in § 9 |
| Nature & purpose | Hosting, transmitting, storing, securing and presenting Customer Data |
| Categories of Data Subjects | Customer's employees, contractors, vendors, and counterparties |
| Categories of Personal Data | Identity (name, work email, phone), employment data, project & bid data, time entries, photos and other Customer-uploaded content |
| Special categories | None expected; Customer is responsible for not uploading sensitive categories |

## 4. Processor obligations

Processor will:

1. Process Personal Data only on documented instructions from Controller (the
   Agreement, this DPA, and Controller's use of the Services).
2. Ensure persons authorised to Process Personal Data are bound by
   confidentiality.
3. Implement the technical and organisational measures described in
   Annex II (Security Measures).
4. Assist Controller, taking into account the nature of Processing, in
   responding to Data Subject Requests and in meeting Controller's
   obligations under Articles 32–36 GDPR.
5. Notify Controller without undue delay (and in any event within 72 hours)
   after becoming aware of a Personal Data Breach.
6. Make available to Controller all information necessary to demonstrate
   compliance and allow for audits as described in § 8.

## 5. Sub-processors

Controller authorises Processor to engage the sub-processors listed at
`/sub-processors`. Processor will:

- Impose data-protection terms on each sub-processor that are no less
  protective than this DPA;
- Remain liable for the acts and omissions of its sub-processors;
- Notify Controller at least 30 days before adding or replacing a
  sub-processor; Controller may object on reasonable data-protection grounds.

## 6. International transfers

Where Processor transfers Personal Data outside the UK / EEA to a country not
recognised as providing adequate protection, the parties incorporate the EU
Standard Contractual Clauses (Module 2 — controller to processor) and, where
applicable, the UK International Data Transfer Addendum, by reference. Annex
I and Annex II of the SCCs are completed by reference to § 3 and Annex II of
this DPA.

## 7. Data Subject Requests

Processor will, where legally permitted, promptly inform Controller of any
request received from a Data Subject and will not respond except on
Controller's documented instructions. The Services include self-service
controls for export and deletion of Customer Data; see § 9 and the Data
Handling Whitepaper.

## 8. Audit rights

Processor will make available to Controller, at Controller's reasonable
request and no more than once per twelve-month period, the most recent
third-party audit reports, security questionnaire responses, and a written
summary of penetration-test findings. Where the foregoing is insufficient to
demonstrate compliance, Controller may, on 30 days' written notice and at its
expense, conduct an audit subject to Processor's reasonable security and
confidentiality controls.

## 9. Return and deletion of Personal Data

On termination or at Controller's request, Controller may export Customer
Data through the Services for up to 30 days. Thereafter Processor will
soft-delete Customer Data immediately and hard-delete within 30 days, except
to the extent retention is required by law. Backups are cycled out within 30
days. The Services include self-service "Delete my organization" controls
that follow this schedule and write to the audit log.

## 10. Liability

Each party's liability arising under or in connection with this DPA is
subject to the limitations of liability in the Agreement.

## 11. Governing law

This DPA is governed by the law and jurisdiction set out in the Agreement,
except where mandated otherwise by applicable Data Protection Laws.

## 12. Order of precedence

In the event of a conflict, the order of precedence is: (1) the SCCs (where
applicable), (2) this DPA, (3) the Agreement.

---

## Annex I — Processing details

See § 3.

## Annex II — Security measures

See the [Data Handling Whitepaper](../security/data-handling-whitepaper.md)
for the full description. Highlights:

- TLS 1.2+ in transit; AES-256 at rest (database, object storage, backups).
- Postgres Row-Level Security with fail-closed `tenant_isolation` policy.
- Append-only audit log with runtime-validated `userId`.
- Postgres-backed rate limiting across all replicas.
- AV scan on every confirmed upload (`scanConfirmedUpload`).
- Prompt-injection quarantine envelope on all untrusted-document → LLM paths.
- 24/7 alerting; Personal Data Breach notification within 72 hours.
- Documented sub-processors at `/sub-processors`; 30-day change notice.
