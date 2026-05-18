# Gotchas

Known pitfalls, rules, and non-obvious constraints that every contributor must be aware of.

## Migration Filename Collisions

Drizzle + `server/utils/runStartupMigrations.ts` apply migrations in filename order, and `server/utils/migrationStartupCoverage.ts` keys on the full filename — so duplicate 4-digit prefixes are a latent bug. Historical collisions were renumbered (0085-0093) and 20 remaining historical duplicates are tracked for renumber in Task #2435. **Prevention (Task #2685)**: `scripts/check-migration-collisions.mjs` (wired into `scripts/ci.sh`) fails the build on any *new* duplicate prefix and on stale allowlist entries; `scripts/new-migration.mjs <slug>` hands out the next free prefix and refuses to run while duplicates are unresolved. Full playbook + journal/`migrationStartupCoverage.ts` reconciliation steps: `docs/ops/migration-collisions.md`.

## Legacy `drizzle/` directory

Removed; its content superseded and auto-applied by `reconcileSchemaDrift`.

## AI Provider Routing

Three independent flags now drive provider selection — `AI_PROVIDER_TAKEOFF` (Takeoff family), `AI_PROVIDER_GENERAL` (every other chat call site), `AI_PROVIDER_EMBEDDINGS` (embeddings; reserved — OpenAI-only today). All three default OFF = byte-identical to legacy OpenAI; flip ON per-org for Anthropic primary with OpenAI fallback. **New chat-completion call sites must use `routedGeneralChatCompletion` from `server/ai/providers` — `scripts/check-ai-router-bypass.mjs` (in `scripts/ci.sh`) fails the build on direct `openai.chat.completions.create` calls without a `// ai-router-bypass: <reason>` annotation.** New embedding call sites must use `routedEmbedding`. Full playbook: `docs/architecture/ai-provider-routing.md`.

## `server/storage.ts` (retired Task #2672)

The legacy monolith has been deleted. Its remaining exports were split into per-domain seams: `server/crm/transcriptBackfillStorage.ts` (CRM transcript backfill jobs, alert-failure pipeline, org-admin alert helpers), `server/executiveDigest/storage.ts` (executive digest snapshots), and `server/dot/payItemPickerFacetsStorage.ts` (DOT pay-item picker facets). A CI freeze guard (`scripts/check-legacy-storage.mjs`, wired into `scripts/ci.sh`) fails the build if `server/storage.ts` is recreated or any `server/*.ts` file imports `./storage` / `../storage` (the `server/bids/` seam is allowlisted because it is its own domain).

## SLA Tier Values (Task #2680)

Edit `shared/sla/policy.ts` only. After any change, run `npx tsx scripts/generate-sla-doc.ts` to rewrite `docs/sla.md` and commit the regenerated file — `scripts/check-sla-doc.mjs` (in `scripts/ci.sh`) fails the build on drift, and the public `/sla` page + the server enforcement both import directly from the canonical module.

## Typecheck Baseline (Task #2647)

`npm run check` is now at **zero errors** and the `typecheck` workflow is part of the green baseline. The remaining backlog from Task #2490 was actually a single broken file (`client/src/pages/ai-estimator-admin.tsx`) where the `AssemblyEditorDialog` JSX body had been spliced into the middle of the `SettingsTab` region-factors form — restoring the original ordering closed all 222 reported errors. `tsconfig.json` runs with `incremental: true` and a `tsBuildInfoFile` under `node_modules/.cache/typecheck/` so subsequent runs reuse build info and don't OOM. **Rule for all new work**: keep the count at zero and do not mask with `// @ts-ignore` / `// @ts-expect-error` / `as any`. Run `npm run check 2>&1 | grep -c "error TS"` before/after your change to confirm.

## TypeScript Project References (Task #2865)

`tsconfig.json` is now a solution file (`files: []`, `references: [{path: "./tsconfig.client.json"}, {path: "./tsconfig.server.json"}]`). Both sub-configs gain `"composite": true` and `"declaration": true` (required by composite mode) while keeping `"noEmit": true` — so no `.d.ts` files are written to disk. `npm run check` now runs `tsc --build`, which parallelises the two passes and only re-checks sub-projects whose inputs changed.

**Project boundary rules**: composite mode enforces strict project boundaries (TS6307). The server project includes `server/**/*`, `shared/**/*`, `scripts/fetch-dot-pay-items.ts` (imported by `server/jobs/dotPayItemsRefresh.ts`), and `vite.config.ts` (imported by `server/vite.ts`). Four server test files that import across project boundaries are excluded from `tsconfig.server.json` and cannot be part of the server composite project without pulling in `expo-*` or all client code: `server/__tests__/mobile-outbox.test.ts`, `server/__tests__/notification-destination.test.ts`, `server/__tests__/reassignment-email-render.test.ts`, `server/__tests__/plan-document-markups-undo-roundtrip.test.ts`.

**Typecheck CI caching (Task #2864)**: The `build` job in `.github/workflows/ci.yml` caches `node_modules/.cache/typecheck/` (the two `.tsbuildinfo` files at `client.tsbuildinfo` / `server.tsbuildinfo`) using `actions/cache@v4`. Cache key = `typecheck-<os>-<tsconfig-hash>-<sha>`; restore-keys fall back to same-tsconfig-hash then OS-only. The restore step is placed **after** `npm ci` (which wipes `node_modules/`) so the `.tsbuildinfo` files are re-injected before `tsc --build` runs. On a warm cache a typical PR only re-checks changed sub-project(s), not all 2,100+ sources.

## JSX Generic Type Arguments + Replit Metadata Injector

Replit's dev environment injects `data-replit-metadata` and `data-component-name` attributes into JSX elements. If a JSX element has an explicit generic type argument (e.g. `<EntityCalendarView<TaskItem> .../>`) the injector inserts the attributes before the `<TaskItem>` token, producing a parse crash. **Rule**: never write explicit generic type args on a JSX element — let TypeScript infer from props, or create a typed alias (`const TypedView = Comp as typeof Comp<T>`) before the JSX. See `CONTRIBUTING.md` for the full example.
