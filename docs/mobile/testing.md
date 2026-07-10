# Mobile Testing Strategy

> Part of the [Mobile App Architecture Blueprint](./README.md).

## 1. Test pyramid

| Layer | Tool | Scope |
| --- | --- | --- |
| Unit | Jest | Domain use-cases (pure functions: conflict-resolution helpers, Lamport clock increment, validation), repository logic with a mocked API client and an in-memory SQLite. |
| Component | Jest + React Native Testing Library | Individual screens/components in isolation — form validation, empty/error states, role-based conditional rendering. |
| Integration | Jest, real local SQLite (in-memory), mocked network layer (MSW or a hand-rolled fetch mock) | Full repository → sync coordinator → outbox round trip, asserting on `ENTITY_STRATEGY_MAP` behavior per entity type. |
| End-to-end | Detox (preferred for CI reliability on simulators/emulators) or Maestro (faster to author, good for smoke suites) | Real app on simulator/emulator against a seeded staging/dev backend — see §3. |
| Manual/field | QA + pilot-user dogfooding | True offline/poor-connectivity conditions (airplane mode toggling, throttled network) that are hard to simulate deterministically in CI. |

## 2. What to test at each layer, by risk

**Highest priority — payroll & compliance-sensitive (time clock, safety
incidents):**
- Unit: dedupe-window logic, gap detection never auto-closes a shift,
  Lamport clock monotonicity across app restarts.
- Integration: clock-in while offline → app restart → clock-out while
  offline → reconnect → verify both events sync and dedupe correctly, and
  that a simulated missed clock-out produces the gap-detection prompt
  rather than a silent fix.
- E2e: full clock-in/out flow on a real simulator including a simulated
  offline→online transition (Detox/Maestro can toggle network conditions).

**High priority — data-loss risk (any offline-create entity):**
- Integration: kill the app (simulate process death) mid-outbox-write and
  verify the pending item survives and syncs on next launch — this is the
  core promise of the offline-first architecture and the single most
  important thing to regression-test.
- Integration: two simulated devices submitting conflicting data for the
  same entity within the dedupe/merge window — assert the correct
  `ENTITY_STRATEGY_MAP` outcome fires (this is where a strategy-map typo
  would otherwise silently ship).

**Medium priority — RBAC/nav correctness:**
- Component: for each of the 8 in-scope personas (`00-overview.md` §3),
  snapshot/assert the correct tab bar and screen-level actions are
  shown/hidden per the role→module matrix (`00-overview.md` §4). This is a
  UX-layer test, not a security test — see §4 below for why the real
  enforcement test lives server-side.
- E2e smoke: log in as one representative role per tier (FIELD_WORKER,
  SUPERINTENDENT, MANAGER/ADMIN, HUSTLER) and verify the expected tabs
  render.

**Lower priority — online-only/read-only modules (Finance, Reports):**
- Component: verify the "requires connection" state renders correctly when
  offline, and that no stale financial figure renders without its
  staleness label.

## 3. E2e environment

- E2e runs against a seeded **staging** backend (same DB schema as
  production, isolated data), never against production, and never with
  live AI provider calls if avoidable — the AI governance gate
  (`governedAiCall`) should be mocked or run against a very low spend cap
  in the E2e environment.
- Test accounts exist for each of the 8 in-scope personas, seeded with a
  representative project/org so RBAC-per-role E2e assertions have real
  data to check against.
- CI runs the E2e smoke suite on merge to the release branch (not on every
  PR, to keep PR turnaround fast); full E2e regression runs nightly or
  pre-release.

## 4. Where the "real" RBAC test lives

Mobile-side RBAC tests (§2 "Medium priority") verify **UX correctness**
(the right tab is hidden), not security — the actual security boundary is
the server's `requireRole`/RLS stack, already covered by the existing
backend test suite. A mobile PR that adds a new role-gated screen should
also confirm (via a quick integration test hitting the real API, or by
reading the existing route's tests) that the underlying endpoint enforces
the same restriction — this blueprint does not introduce a new,
mobile-only RBAC test surface that could drift from server truth.

## 5. Regression coverage for sync conflicts

A dedicated integration suite (`sync/__tests__/conflictScenarios.test.ts`
or equivalent) should enumerate one scenario per `ENTITY_STRATEGY_MAP`
entry (`data-models.md` §1) — this is the mobile-side counterpart to the
existing server-side `mobile-sync.md` PM playbook and prevents a future
entity-type addition from shipping without an explicit, reviewed conflict
test.

## 6. Accessibility testing

Automated `accessibilityLabel` presence checks in component tests (fails
CI if an interactive element ships without one, mirroring the `data-testid`
discipline on web) plus a periodic manual VoiceOver/TalkBack pass before
each store release.

## 7. Performance testing

Cold-start and time-to-clock-in budgets (`performance.md` §1) are checked
via Detox's performance APIs or a lightweight custom timer logged to
Sentry performance tracing in a pre-release build — regressions beyond a
set threshold (e.g., +20% cold start) block a release the same way a
failing typecheck blocks the web app's green baseline (`replit.md`).
