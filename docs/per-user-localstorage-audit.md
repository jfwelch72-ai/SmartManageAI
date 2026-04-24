# Per-user-id `localStorage` audit (Task #1720)

This is a short audit of the per-user-id `localStorage` keys still in
use in `client/src` and what we did with them. The reference pattern
for "promote to a server-side `users.*` column so the preference syncs
across devices" is Task #1695 (`users.plansToolbarLabeled` and
`users.plansTourCompleted`).

The discovery query for this audit is, roughly:

```bash
rg -n "localStorage" client/src -g '*.ts' -g '*.tsx' -B5 -A1 \
  | rg -B5 -A1 "user[?]?\.id|userId"
```

## Inventory

| Key | File | Recommendation | Status |
| --- | --- | --- | --- |
| `plan-toolbar-labeled-<uid>` | `client/src/components/project-tabs/PlansTab.tsx` | **SYNC** | ✅ Migrated by Task #1695 → `users.plansToolbarLabeled`. Legacy key one-shot lifted on next sign-in then cleared. |
| `plans-tour-completed-<uid>` | `client/src/components/TourProvider.tsx` | **SYNC** | ✅ Migrated by Task #1695 → `users.plansTourCompleted`. Legacy key one-shot lifted on next sign-in then cleared. |
| `crm:contactOwnerFilter:<uid>` | `client/src/pages/crm.tsx` | **SYNC** | ✅ Migrated by Task #1720 → `users.crmContactOwnerFilter`. Legacy key (and the pre-auth anonymous fallback `crm:contactOwnerFilter`) one-shot lifted then cleared. |
| `crm:orgOwnerFilter:<uid>` | `client/src/pages/crm.tsx` | **SYNC** | ✅ Migrated by Task #1720 → `users.crmOrgOwnerFilter`. Legacy key (and `crm:orgOwnerFilter` anon fallback) one-shot lifted then cleared. |
| `smartmanage-cmdk-recents:<uid>` | `client/src/components/CommandPalette.tsx` | **LEAVE LOCAL** *(intentionally deferred — see below)* | ⏸ Not migrated by Task #1720. There is a separate planned task ("Remember which results each user opens most often") that covers a richer server-backed recents/history model than a single `users.*` column. Migrating it as a column now would be wasted work. |
| `dot-pay-item-picker:facets:<uid>:<specBookId>` | `client/src/components/dot/PayItemPicker.tsx` | **SYNC** | ✅ Migrated by Task #1743 → dedicated `dot_pay_item_picker_facets(user_id, spec_book_id, categories[], spec_sections[])` table backed by `GET`/`PUT /api/dot/pay-item-picker/facets/:specBookId`. The picker hydrates from the server, optimistic-updates locally, and one-shot lifts the legacy localStorage values up to the server then clears the keys. |

## Non-per-user-id keys also seen during the audit

These keys came up in the same ripgrep but are **not** keyed by user
id — they are global to the device or the browser tab. They are
called out here so the next reader doesn't have to re-derive that
none of them are in scope for this task.

- `theme` — `client/src/hooks/use-theme.ts`. Already mirrored to a
  user setting (`themePreference` is read on mount); the localStorage
  copy is the synchronous boot-time hint to avoid a flash of wrong
  theme. Leave as-is.
- `bids-view`, `tasks-view`, `projects-view`, `my-work-view`,
  `my-work-grouping*` — table-vs-card view selections per route.
  Per-device by intent: an estimator on a tablet often wants the card
  view while their desktop session stays on the table.
- `takeoff-*` (sidebar-collapsed, snap-enabled, ortho-lock,
  hide-ai-measurements, show-ai-overlays, grid-enabled,
  show-labels, show-structural-gridlines, label-hidden-categories,
  typicals, gridlines, gesture-guide-dismissed) —
  `client/src/components/TakeoffWorkspace.tsx` and
  `client/src/hooks/use-takeoff-interactions.ts`. Workspace-tool
  toggles that depend on the local input device (mouse vs touch,
  monitor size). Leave per-device.
- `smartmanage-ask-ai-enabled` — `client/src/components/TopHeader.tsx`.
  Global on/off for the Ask-AI affordance; not per-user-id.
- Project-detail nav rail (`NAV_COLLAPSED_KEY`, `NAV_GROUPS_KEY`) —
  per-device sidebar collapse state. Leave per-device.
- Offline queues (`offline-queue.ts`, `use-offline-queue.ts`) — by
  definition device-local because they buffer writes that haven't
  reached the server yet.

## Migration pattern (for the next preference)

Every "promote to a `users.*` column" migration follows the same six
moving parts. Do them in this order so the column exists before any
read or write touches it:

1. **`shared/schema/core.ts`** — add the column to the `users` table
   with a sensible default (`null` for free-form text, `false` for
   boolean toggles).
2. **`server/utils/ensureUsers<Name>Columns.ts`** — `ALTER TABLE users
   ADD COLUMN IF NOT EXISTS …` so fresh dev DBs and prod alike pick
   it up on startup. Idempotent.
3. **`server/utils/runStartupMigrations.ts`** — register the new
   ensure-helper in the manifest with a category and a comment
   pointing at the task number.
4. **`server/auth.ts`** — surface the column on the `SanitizedUser`
   literal returned by the auth middleware so the client sees it on
   every `/api/auth/me`.
5. **`server/authProfileRoutes.ts`** — extend the PATCH
   `/api/auth/profile` Zod schema and the `updateData` map. Allow
   `null` if "clear the preference" is a meaningful state.
6. **Client** — replace the `localStorage.getItem`/`setItem` calls
   with: hydrate from `user.<column>`, optimistic local-set, PATCH
   `/api/auth/profile`, invalidate `/api/auth/me`. Keep a ref-guarded
   one-shot effect that lifts the legacy `localStorage` value up to
   the server and clears it (including any pre-auth anonymous
   fallback key) so existing devices don't lose state.
