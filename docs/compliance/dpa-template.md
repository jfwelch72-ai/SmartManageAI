# Data Processing Agreement (DPA) — Template

> **This is a template.** It is the Company's standard DPA, used as the
> starting position for every customer that requires one. Customer-specific
> redlines are tracked separately. Sales: do not send a customer a Word
> version of this; pull the latest signed-as-PDF copy from Legal.

This Data Processing Addendum ("DPA") forms part of the Master Services
Agreement (the "Agreement") between **SmartManageAI, Inc.** ("Processor")
and the customer identified in the Order Form ("Controller").

## 1. Definitions

Capitalized terms not defined here have the meaning given in Article 4 of
the EU General Data Protection Regulation (GDPR), the UK GDPR, and the
California Consumer Privacy Act / CPRA, as applicable.

## 2. Scope and roles

2.1 The Processor processes Personal Data on behalf of the Controller
solely for the purpose of providing the Services described in the
Agreement.

2.2 The Controller is the controller of the Personal Data; the Processor
is the processor.

## 3. Processor obligations

The Processor will:

(a) process Personal Data only on documented instructions from the
Controller, including with regard to international transfers, unless
required to do so by law;

(b) ensure that personnel authorized to process Personal Data are bound
by appropriate confidentiality obligations;

(c) implement the technical and organizational measures described in
**Annex II**;

(d) assist the Controller, by appropriate technical and organizational
measures, in fulfilling Controller's obligation to respond to data
subject requests;

(e) assist the Controller in ensuring compliance with security, breach
notification, DPIA, and prior consultation obligations;

(f) at the Controller's choice, delete or return all Personal Data after
the end of the Services and delete existing copies, subject to legal
retention obligations;

(g) make available to the Controller information necessary to demonstrate
compliance with this DPA, and allow for and contribute to audits
conducted by the Controller or a Controller-mandated auditor (subject
to commercially reasonable scope, frequency, confidentiality, and
notice; the Processor's then-current SOC 2 Type II report will be
provided in lieu of an on-site audit where reasonable).

## 4. Sub-processors

4.1 The Controller provides general authorization for the Processor to
engage sub-processors, subject to this Section 4.

4.2 The current list of sub-processors is published at
**`/sub-processors`** and is incorporated by reference.

4.3 The Processor will give the Controller at least **30 days' advance
notice** of any new sub-processor. The Controller may object on
reasonable security or data-protection grounds within that period; the
parties will then work in good faith to resolve the objection, and if
not resolved the Controller may terminate the affected Services.

4.4 The Processor will impose on each sub-processor data-protection
obligations no less protective than those in this DPA, and will remain
liable for sub-processors' acts and omissions.

## 5. International transfers

5.1 The Processor is established in the United States; Personal Data is
processed in the United States.

5.2 For transfers from the EEA, the UK, or Switzerland, the Standard
Contractual Clauses (SCCs) and the UK Addendum (where applicable),
attached as **Annex III**, apply and are incorporated by reference.
The Processor is the "data importer" under the SCCs.

## 6. Security incidents

6.1 The Processor will notify the Controller without undue delay, and in
any event within **72 hours** of becoming aware, of a Personal Data
Breach affecting the Controller's Personal Data.

6.2 The notification will include, to the extent then known: the nature
of the breach, the categories and approximate number of data subjects
and records concerned, the likely consequences, and the measures taken
or proposed.

## 7. Audits

The Processor's annual SOC 2 Type II report and, if produced, ISO/IEC
27001 certificate, will be made available under NDA. On-site audits may
be requested at most once per twelve-month period, scheduled with
reasonable notice and confidentiality undertakings.

## 8. Data subject rights

The Processor will provide the Controller with the technical means to
respond to data subject access, rectification, erasure, restriction,
portability, and objection requests within **30 days** of the
Controller's request.

## 9. Term and termination

This DPA takes effect on the effective date of the Agreement and
continues for the term of the Agreement. Sections 3(f), 6, and 7 survive
termination.

## 10. Conflict

In the event of conflict between this DPA and the Agreement with respect
to the processing of Personal Data, this DPA controls.

---

## Annex I — Description of processing

| Item | Detail |
| ---- | ------ |
| Categories of data subjects | Controller's employees, contractors, customers, and project counterparties |
| Categories of Personal Data | Identification (name, email, phone), employment role, time-clock and payroll data (when used), uploaded project files, communications metadata |
| Special categories | None intended; Controller is responsible for not submitting special-category data unless agreed |
| Nature of processing | Hosting, storage, organization, retrieval, transmission, and (where opted-in) AI-assisted analysis |
| Purposes | Providing the Services |
| Duration | Term of the Agreement, plus retention windows in the Service's data classification policy |

## Annex II — Technical and organizational measures

The measures in `docs/compliance/policies/` apply, including in
particular:

- Encryption at rest (AES-256) and in transit (TLS 1.2+); see policy #10.
- Access control, MFA, and least privilege; see policy #02.
- Incident response within 72 hours; see policy #04.
- Logging and monitoring; see policy #11.
- Backup and recovery, RTO 4h / RPO 15m; see policy #07.
- Vendor and sub-processor management; see policy #05.
- Endpoint security on staff devices; see policy #12.
- SDLC controls including dependency, SAST, secret, and IaC scanning;
  see policy #09.

## Annex III — Standard Contractual Clauses

The Module Two (Controller-to-Processor) SCCs, Commission Implementing
Decision (EU) 2021/914 of 4 June 2021, are incorporated. Where the UK
GDPR applies, the UK International Data Transfer Addendum to the SCCs
issued by the Information Commissioner is also incorporated.

| SCC item | Election |
| -------- | -------- |
| Clause 7 (docking) | Not used |
| Clause 9 (sub-processor authorization) | Option 2: general authorization, 30-day notice |
| Clause 11(a) (independent dispute resolution) | Not selected |
| Clause 17 (governing law) | Ireland |
| Clause 18 (forum) | Ireland |

---

Signed for the Processor: __________________________  Date: __________

Signed for the Controller: __________________________  Date: __________
