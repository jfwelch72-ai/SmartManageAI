# Change Management Policy

| Owner | CTO |
| ----- | --- |
| Approver | CEO |
| Review cadence | Annual |

## 1. Purpose

Ensure that changes to the production application and its supporting
infrastructure are introduced in a controlled, reviewed, and reversible way
that preserves the integrity and availability of the Service.

## 2. Scope

- Application source code (this repository)
- Infrastructure-as-code (Terraform / cloud configuration)
- Database schema (`shared/schema.ts`, `migrations/`, `drizzle/`)
- Production configuration and feature flags
- CI/CD pipelines

## 3. Standard change process

1. Engineer opens a pull request from a feature branch into `main`.
2. The PR description identifies:
   - The change being made and why
   - Any data migration or breaking change
   - The rollback procedure
3. **Branch protection on `main`** requires:
   - At least one approving review from a different engineer
   - All required CI checks to pass:
     - Type check
     - Unit + integration tests
     - Lint
     - Dependency audit (`npm audit --audit-level=high`)
     - SAST scan
     - Secret scan
     - IaC scan (where applicable)
   - Linear history (squash or rebase)
4. Merging triggers the deployment pipeline, which:
   - Builds the artifact
   - Runs the migration
   - Deploys with health-check gating and automatic rollback on failure
5. Production-affecting changes are recorded:
   - Application changes: in git history (immutable)
   - Customer-data-affecting admin actions: in `auditLog`
     (`server/auditLogger.ts`)

## 4. Emergency change process

For production incidents:
1. The on-call engineer may merge a fix with a single approver from the
   responder pool, marking the PR `EMERGENCY`.
2. A retrospective PR review must happen within 5 business days,
   documenting any deviation from the standard process.
3. The change is recorded in the incident ticket.

## 5. Database migrations

1. Schema changes use Drizzle migrations and are applied as part of the
   deployment.
2. Destructive migrations (DROP, type narrowing, NOT NULL on populated
   columns) require:
   - A two-step deploy (deploy-then-cleanup).
   - Explicit sign-off from the CTO on the PR.

## 6. Separation of duties

The author of a PR may not be the sole approver. The deployer of a change
need not be the author, but the author must be available during the deploy.

## 7. Configuration & secrets

- Secrets live in the managed secret store (the Replit-managed environment
  variables vault), never in the repository.
- Configuration changes that affect security posture (e.g. CORS, CSP,
  cookie flags) follow the standard change process and require security
  team review.
