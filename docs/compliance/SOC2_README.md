# SOC 2 Type II Readiness

This directory contains the documentation, policies, runbooks, and evidence
required to take SmartManageAI (the "Service") through a SOC 2 Type II audit
covering the five Trust Services Criteria: Security, Availability, Processing
Integrity, Confidentiality, and Privacy.

It is organized so that:

- An incoming auditor (or the auditor's prep firm — Vanta, Drata, Secureframe)
  can read this folder top-to-bottom and understand the control environment.
- An engineer can map a control back to the code that implements it via
  `CONTROLS_MATRIX.md`.
- A customer's InfoSec reviewer can fill out their security questionnaire from
  `security-questionnaire.md` and the public Trust page at `/trust`.

## Contents

```
docs/compliance/
├── SOC2_README.md                  ← you are here
├── CONTROLS_MATRIX.md              Control → code mapping (the spine)
├── sub-processors.md               Public list of sub-processors
├── security-questionnaire.md       CAIQ / SIG-Lite responses
├── dpa-template.md                 Data Processing Agreement template
├── trust-overview.md               Source for the public /trust page
├── policies/
│   ├── 01-information-security-policy.md
│   ├── 02-access-control-policy.md
│   ├── 03-change-management-policy.md
│   ├── 04-incident-response-policy.md
│   ├── 05-vendor-management-policy.md
│   ├── 06-data-classification-policy.md
│   ├── 07-business-continuity-and-dr-policy.md
│   ├── 08-acceptable-use-policy.md
│   ├── 09-sdlc-policy.md
│   ├── 10-encryption-policy.md
│   ├── 11-logging-and-monitoring-policy.md
│   └── 12-endpoint-management-policy.md
├── runbooks/
│   ├── disaster-recovery-runbook.md
│   ├── incident-response-tabletop.md
│   └── backup-restore-drill.md
└── evidence/
    └── README.md                   Index of evidence collected per control
```

## Trust Services Criteria coverage

| Criterion              | Primary policies                              | Primary controls                                                  |
| ---------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| Security (CC)          | 01, 02, 03, 04, 09, 10, 11, 12                | Auth, RBAC, audit log, CSRF, rate limit, dep audit, SAST          |
| Availability (A)       | 07                                            | Backups, DR runbook, status page, uptime monitoring               |
| Processing Integrity (PI) | 03, 09                                     | Change management, PR review, CI checks, input validation         |
| Confidentiality (C)    | 06, 10                                        | Encryption at rest + in transit, ACLs, least privilege            |
| Privacy (P)            | 06, dpa-template.md, sub-processors.md        | DPA, sub-processor list, data export/delete, retention policy     |

## Engagement model

We use **Vanta** as our GRC platform (recommendation; can be swapped for Drata
or Secureframe). Vanta is connected to:

- GitHub (code review evidence, branch protection, dependency audit results)
- The cloud provider (infra inventory, encryption flags, IAM)
- The identity provider (MFA enforcement, user lifecycle)
- The HRIS (acknowledgement-on-hire workflow for policies)

This gives us automated evidence collection on ~95% of the in-scope controls.
Manual evidence (tabletop drill notes, restore drill notes, vendor reviews) is
filed under `evidence/` and dated.

## Observation window

The Type II observation window opens on the date stamped at the top of
`evidence/README.md` and runs for 6 months. The auditor is engaged at the
start of that window so they can request evidence on a rolling basis instead
of in one final dump.

## Out of scope

- The audit itself and the auditor's fieldwork (engaged separately)
- HIPAA / FedRAMP / PCI-DSS scope (future)
- ISO 27001 certification (this folder is the foundation; the gap analysis
  to ISO 27001 Annex A lives separately when we begin that work)
