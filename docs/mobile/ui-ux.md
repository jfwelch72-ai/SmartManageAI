# Mobile UI/UX

> Part of the [Mobile App Architecture Blueprint](./README.md).

## 1. Design philosophy

The mobile app is a **field companion**, not a phone-sized port of the web
app. Screens are re-scoped per module (see `features/*.md` "Screens &
navigation" tables) rather than shrinking every web tab onto a phone. Three
rules drive every screen decision:

1. **Thumb-reachable primary actions.** Clock in/out, capture photo, submit
   report — the highest-frequency actions sit in the bottom third of the
   screen, reachable one-handed.
2. **Camera-first where the web app is form-first.** Daily reports, punch
   items, safety observations, and haul tickets lead with "take a photo,"
   with structured fields as secondary/optional detail — this matches how
   field users actually work (photograph first, describe second).
3. **Never lie about data freshness.** Any cached/stale value is visibly
   labeled ("as of 2:14 PM" / offline badge); this is a hard rule, not a
   style preference, established in `00-overview.md` principle 5 and
   applied strictly to Finance/Reports (`features/finance.md` §3,
   `features/reports.md` §3).

## 2. Navigation shape

- **Bottom tab bar**, 4–5 tabs max, role-dependent. Tabs are drawn from the
  role→module matrix in `00-overview.md` §4; a role never sees a tab for a
  module marked "—" in that matrix.
- Representative tab sets:
  - **FIELD_WORKER**: Home, Time Clock, Projects, Field Ops (haul
    tickets/calculators), Safety.
  - **SUPERINTENDENT**: Home, Projects, Workforce (time approval/crews),
    Field Ops, Safety.
  - **MANAGER/ADMIN**: Home, Projects, Workforce, Finance, More (Reports +
    Admin + Sales).
  - **HUSTLER**: Home (portfolio), Projects, Finance, Reports, More.
- A **"More" tab** collects lower-frequency modules for management roles
  rather than exceeding 5 tabs — avoids the anti-pattern of a cramped
  7-icon tab bar.
- Each module's screens are a **stack** pushed from its tab root (list →
  detail → sub-screen), matching standard iOS/Android navigation
  conventions (`@react-navigation/native-stack`).

## 3. Design system

- Component primitives live in `src/shared/ui/` (buttons, cards, list
  rows, form fields, empty states, offline/staleness badges) — a small,
  purpose-built kit, not a port of the web app's shadcn/ui components
  (which are DOM/CSS-based and don't translate to React Native).
- **Visual language** takes cues from the web app's existing brand
  (typography scale, color tokens) but is implemented natively — see
  `docs/architecture/decisions.md` for the web design-system precedent to
  stay consistent with (same palette, not same component library).
- Dark mode follows the same light/dark token approach as web
  (`fullstack-js` skill "Dark Mode" guidance) — token values shared
  conceptually, not literally imported (RN doesn't consume the web
  Tailwind config).

## 4. Desktop-density module treatment

Modules whose *web* UI depends on a mouse, a large canvas, or multi-pane
layouts get a **reduced or read-only mobile treatment**, not a literal port:

| Web pattern | Mobile treatment |
| --- | --- |
| Kanban / Map / Calendar project views | List/card view only |
| Takeoff workspace, plan markup canvas | Not on mobile — "open on web" card |
| LiDAR point cloud viewer, BIM diff | Not on mobile |
| CFO dashboard multi-widget grid | Single-column KPI card stack |
| Gantt/CPM schedule editor | Read-only simplified timeline (v1.1 candidate, not v1) |

This mirrors the exclusions already declared in `00-overview.md` §6; this
doc adds the *why* from a UX lens — these are input patterns (drag targets,
hover states, dense multi-column tables) that don't translate to a phone
screen without a real redesign effort, not a quick port.

## 5. Camera & media capture pattern

Shared across Daily Reports, Punch List, Safety Observations, Haul Tickets,
Material Certifications:

1. Tap capture action → native camera opens directly (no intermediate
   "choose source" screen for the primary action; a secondary "choose from
   library" affordance is available but not default).
2. Photo attaches to the in-progress form immediately, shown as a thumbnail
   with a retake/remove affordance.
3. On submit, the entity + photo save to local cache/outbox together
   (§2 of `workflows.md`) — the user never waits for an upload to finish
   before moving to the next task.
4. Upload progress for the photo itself is shown passively in a "syncing"
   indicator (see `useSyncStatus()`, `01-architecture.md` §3), not as a
   blocking spinner.

## 6. Offline & staleness indicators

- **Global offline banner** at the top of the screen when the device has
  no connectivity, persistent but non-blocking.
- **Per-screen staleness label** ("as of HH:MM") on any screen serving
  cached data, per the rule in §1.
- **Per-item sync badges** on list rows for entities with pending outbox
  writes (small dot/icon), so a user can see at a glance which of their
  submissions haven't reached the server yet.
- **Outbox count** surfaced in a settings/sync-status screen for
  troubleshooting ("3 items waiting to sync").

## 7. Accessibility

- Minimum 44×44pt touch targets throughout (matches platform HIG/Material
  guidance) — non-negotiable given gloved/field-use conditions.
- Full VoiceOver/TalkBack label coverage on every interactive element,
  mirroring the web app's `data-testid` interactive-element coverage
  discipline (`fullstack-js` skill) adapted to `accessibilityLabel`.
- High-contrast mode support for outdoor/bright-sunlight readability —
  treated as a field-use accessibility requirement, not just a compliance
  checkbox.

## 8. Empty & error states

- Every list screen has a designed empty state (not a blank white screen),
  and every offline-disabled action shows a specific reason ("Change order
  approval requires a connection") rather than a generic disabled button.
