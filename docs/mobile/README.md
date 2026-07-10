# Mobile App Architecture Blueprint

This directory is the comprehensive, production-ready documentation set for
SmartManageAI's native mobile app (Expo / React Native, iOS + Android). It
is a **planning blueprint** — no mobile app code exists yet, and this task
makes no changes to the web app, backend, or CI. It reuses and reconciles
against the mobile groundwork already shipped for the web/backend project
(`docs/architecture/mobile-sync.md`, `docs/api/mobile-auth.md`).

## Reading order

1. **[`00-overview.md`](./00-overview.md)** — purpose, personas, roles→mobile
   access matrix, core principles, scope boundaries, and reconciliation with
   the legacy Feature-G spec.
2. **[`01-architecture.md`](./01-architecture.md)** — folder structure, state
   management, DI, networking/repositories, offline/sync scheduling, push
   notifications, deep linking, analytics, security summary, feature flags,
   environments, CI/CD.
3. **[`features/`](./features)** — one doc per top-level product module,
   mirroring `docs/module-directory.md`:
   - [`home.md`](./features/home.md)
   - [`sales-win-work.md`](./features/sales-win-work.md)
   - [`projects.md`](./features/projects.md)
   - [`workforce.md`](./features/workforce.md)
   - [`finance.md`](./features/finance.md)
   - [`field-ops.md`](./features/field-ops.md)
   - [`safety-compliance.md`](./features/safety-compliance.md)
   - [`administration.md`](./features/administration.md)
   - [`reports.md`](./features/reports.md)
4. **[`workflows.md`](./workflows.md)** — Mermaid sequence/flow diagrams for
   login, offline capture→sync, conflict surfacing, time clock, money-path
   approvals, push→deep-link, and app launch.
5. **[`ui-ux.md`](./ui-ux.md)** — design philosophy, navigation shape, design
   system, desktop-density module treatment, camera/media pattern, offline
   indicators, accessibility.
6. **[`data-models.md`](./data-models.md)** — server schema
   (`mobile_devices`, `offline_sync_queue`, `mobile_sync_events`, etc.),
   client-side SQLite tables, DTO contract, `ENTITY_STRATEGY_MAP` reference.
7. **[`backend-integration.md`](./backend-integration.md)** — auth, RBAC/
   tenant isolation, uploads, pagination, rate limiting, AI routing,
   observability, and what mobile explicitly does not get.
8. **[`security.md`](./security.md)** — mobile-specific extension of
   `threat_model.md`: token storage, app-lock, local data at rest, transport,
   upload safety, push payload hygiene, audit coverage.
9. **[`performance.md`](./performance.md)** — performance targets, caching,
   virtualization, image handling, sync efficiency, battery/GPS, monitoring.
10. **[`testing.md`](./testing.md)** — test pyramid, risk-prioritized test
    scenarios, E2e environment, RBAC test boundary, sync conflict regression
    coverage, accessibility and performance testing.
11. **[`deployment.md`](./deployment.md)** — EAS build/submit/update
    pipeline, release channels, store review considerations, rollout
    strategy, versioning, CI gates, post-release monitoring.
12. **[`scalability.md`](./scalability.md)** — backend load from mobile,
    sync protocol scaling, multi-tenant growth, push scale, and the explicit
    future roadmap (items deliberately deferred past v1).

## Ground truth this blueprint reconciles with

- **`docs/architecture/mobile-sync.md`** — authoritative for offline
  conflict-resolution strategy, the Lamport logical clock, the Time Clock
  Risk Audit, and local storage posture. This blueprint references it
  rather than re-deriving its mechanics.
- **`docs/api/mobile-auth.md`** — authoritative for the OAuth
  mobile-exchange and passkey authentication contracts.
- **`docs/module-directory.md`** — authoritative for the 9 top-level
  product modules, their web pages/routes/roles; the `features/` docs here
  are the mobile-scoped overlay on top of it.
- **`docs/ACCOUNT_ROLES_RBAC.md`** — authoritative for the 18 roles and
  permission matrix; `00-overview.md` §4 is the mobile-specific access
  overlay, not a replacement.

## Legacy spec status

**`docs/feature-G-mobile-offline.md` is partially superseded legacy.** Its
device-registration/sync endpoint shapes were never implemented as
originally designed and were superseded by the shipped design in
`mobile-sync.md`. Its trade-specific mobile tool configuration concept has
never shipped in any form. See `00-overview.md` §7 for the full
reconciliation and `features/field-ops.md` §6 for where that unshipped idea
is called out. Treat Feature-G as historical context only — every concrete
schema, endpoint, and rule in this blueprint follows `mobile-sync.md` and
`mobile-auth.md`.

## Scope note

This is documentation only. No mobile app code, backend routes, database
migrations, or CI configuration were added or changed as part of producing
this blueprint. Endpoints and schema referenced as "proposed" or flagged in
a doc's "Gaps vs. today" section do not exist yet and are explicitly called
out as such rather than assumed shipped.
