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
   - **License audit** — `license-checker-rseidelsohn --production`,
     blocks any GPL-family license (GPL, AGPL, LGPL, including
     `-only` / `-or-later` / version-suffixed variants) from the
     production bundle. Dev-only dependencies are not scanned. The
     same gate is additionally re-run against `main` nightly by the
     `Nightly License Audit` workflow
     (`.github/workflows/license-audit-nightly.yml`), which invokes
     `scripts/ci-security.sh --only license`. Transitive dependency
     updates (semver-range bumps from existing direct deps) can change
     a package's reported license between PRs without re-triggering the
     PR-time gate; the nightly run catches that drift on `main`. The
     workflow uploads the scanner log as the
     `license-audit-nightly-report` artifact (90-day retention) and, on
     any finding, opens (or updates) a `security`-labelled tracking
     issue so the owner can either remove the offending package or add
     a reviewed entry to `.license-allowlist.txt`.

   Any Critical/High finding fails the job and blocks merge. The job
   posts a results summary as a PR comment and to the GitHub Actions job
   summary, and uploads the full scanner log as the
   `ci-security-report` artifact (90-day retention) for auditor
   evidence.

   **Allowlisting a package for the license audit.** If a package is
   flagged but legal has reviewed and approved its use (e.g. it is
   actually dual-licensed and the upstream metadata is wrong), add an
   entry to `.license-allowlist.txt` in the repository root using the
   `name@version` format that `license-checker` reports. Each entry
   must be preceded by a justification comment, and the PR must record
   sign-off from legal or the CTO. Entries are version-pinned on
   purpose: a new version of the same package re-triggers the gate.

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
