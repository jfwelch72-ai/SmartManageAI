# Secure Software Development Lifecycle (SDLC) Policy

| Owner | CTO |
| ----- | --- |
| Approver | CEO |
| Review cadence | Annual |

## 1. Purpose

Build and ship software in a way that catches security defects early,
reduces risk to customer data, and produces evidence the auditor can rely
on for both the Security and Processing Integrity criteria.

## 2. Phases

### Design
- Significant features go through a written design doc.
- Threat-model any feature that handles auth, authorization, payments,
  PII, or new external integrations.
- Privacy by design: minimize data collection; default to least access.

### Implement
- All code is written in the repository under version control.
- Input validation: every external boundary uses Zod schemas (see
  `shared/schema.ts`) and the helpers in `server/sanitization.ts`.
- Output encoding: React JSX auto-escapes; do not use
  `dangerouslySetInnerHTML` without security review.
- Authentication and authorization checks live in `server/auth.ts`. New
  routes must use `requireAuth` and the appropriate `requireRole` /
  `requireFeaturePermission`.
- Object-level access goes through `server/objectAcl.ts`.
- Secrets are read from environment variables, never committed.

### Build / CI
The CI pipeline (`.github/workflows/ci.yml`) runs on every PR and blocks
merge on:
1. Type check (`tsc --noEmit`)
2. Lint
3. Unit + integration tests
4. End-to-end tests (Playwright)
5. **Security Gate** — `scripts/ci-security.sh`, executed by the
   `Security Gate (SOC 2 CC8.1 / CC7.1)` job. The script runs:
   - **Dependency audit** — `npm audit --audit-level=high` blocks merge
   - **SAST** — Semgrep `p/owasp-top-ten` + `p/javascript`
   - **Secret scan** — gitleaks against the working tree; `main` is also
     scanned weekly for any historical leak by the
     `Weekly Secret History Scan` workflow
     (`.github/workflows/security-history-scan.yml`), which runs
     `gitleaks detect --log-opts=--all` over the full git history of
     `main`. The workflow uploads the redacted SARIF + log as the
     `gitleaks-history-report` artifact (90-day retention) and, on any
     finding, opens (or updates) a `security`-labelled tracking issue
     for the security owner to triage so the credential is rotated and
     removed from history per the policy #11 SLAs. The artifact is the auditor-facing
     evidence for the weekly history-scan commitment.
   - **IaC scan** — checkov, where IaC files exist

   Any Critical/High finding fails the job and blocks merge. The job
   posts a results summary as a PR comment and to the GitHub Actions job
   summary, and uploads the full scanner log as the
   `ci-security-report` artifact (90-day retention) for auditor
   evidence.
6. **License audit** — block GPL-family in dependencies of the production
   bundle

### Review
- Two-eyes rule: every PR requires at least one approving review from a
  different engineer.
- Security-sensitive changes (auth, RBAC, ACL, crypto, payments, anything
  changing the audit log) additionally require a reviewer from the
  security reviewer pool.

### Deploy
- Deploys go through the change management process (#03).
- Health checks gate the rollout; failed health checks roll back
  automatically.

### Operate
- Vulnerabilities discovered in production are tracked in the GRC
  platform with the SLAs in policy #11.
- Penetration test annually by a qualified third party; findings
  remediated per severity SLA; results filed in `evidence/`.

## 3. Triage SLAs

| Severity | Triage | Fix in production |
| -------- | ------ | ----------------- |
| Critical | 1 business day | 7 days |
| High | 3 business days | 30 days |
| Medium | 10 business days | 90 days |
| Low | 30 business days | next planned release |

## 4. Branch protection (configuration of record)

`main` requires:
- 1 approving review from a non-author
- All required CI checks (above) passing
- No force-pushes; linear history (squash or rebase merge)
- Conversation resolution required

This configuration is the auditor-facing evidence for change management
control CC8.1.
