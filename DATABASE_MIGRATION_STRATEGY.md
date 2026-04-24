# TFR Construction Platform - Database Migration Strategy

**Last Updated**: November 19, 2025  
**Database**: PostgreSQL (Neon-hosted)  
**ORM**: Drizzle ORM  
**Strategy**: Schema-first with `db:push`

---

## Overview

The TFR Construction Platform uses Drizzle ORM with a **schema-first, push-based** migration strategy. This approach prioritizes rapid development and iteration while maintaining database consistency.

## Current State

- **23 Database Tables** fully defined in `shared/schema.ts`
- **1 Manual Migration File**: `server/migrations/001_backfill_token_version.sql`
- **Primary Strategy**: `npm run db:push` for schema synchronization
- **Database**: Neon PostgreSQL (cloud-hosted)

## Why db:push vs Manual Migrations?

### Our Approach: `db:push`

**Advantages**:
1. **Speed**: Instantly sync schema changes to database
2. **Simplicity**: No migration file management during active development
3. **Flexibility**: Easy to iterate on schema design
4. **Perfect for Small Teams**: Fewer moving parts, less coordination overhead

**When to Use**:
- ✅ Development and staging environments
- ✅ Adding new tables or columns
- ✅ Changing column types (non-destructive)
- ✅ Adding/removing indexes
- ✅ Initial schema setup

### Traditional Migrations (`drizzle-kit generate` + `migrate`)

**Advantages**:
1. **Version Control**: Explicit migration history
2. **Rollback Support**: Can revert to previous schema versions
3. **Audit Trail**: Clear record of all schema changes
4. **Production Safety**: Review changes before applying

**When Required**:
- ⚠️ Production deployments with existing data
- ⚠️ Complex data transformations
- ⚠️ Column renames that require data preservation
- ⚠️ Multi-step migrations with dependencies

---

## Our Workflow

### Development Cycle

```bash
# 1. Modify schema in shared/schema.ts
# 2. Sync to database
npm run db:push

# If conflicts detected:
npm run db:push --force  # CAREFUL: May drop columns with data
```

### Schema Change Example

```typescript
// Add new fields to projects table in shared/schema.ts
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  // ... existing fields ...
  
  // NEW FIELDS (Nov 19, 2025)
  budget: decimal("budget", { precision: 12, scale: 2 }),
  contractAmount: decimal("contract_amount", { precision: 12, scale: 2 }),
  estimatedCompletionDate: timestamp("estimated_completion_date"),
});
```

Then run:
```bash
npm run db:push
```

Drizzle automatically generates and executes:
```sql
ALTER TABLE "projects" ADD COLUMN "budget" numeric(12, 2);
ALTER TABLE "projects" ADD COLUMN "contract_amount" numeric(12, 2);
ALTER TABLE "projects" ADD COLUMN "estimated_completion_date" timestamp;
```

---

## Test Database Sync

The vitest suite ships its own schema-sync bootstrap so tests do not fail
in fresh environments. As of April 2026 it uses a **schema-export
rebuild** strategy that fully replaces the older two-step "idempotent
migrations + `drizzle-kit push --force`" path.

**File**: `server/__tests__/globalSetup.ts`

### Why we no longer use `drizzle-kit push --force` for tests

`drizzle-kit push` introspects the live database and diffs it against
`shared/schema/*`. Against this project's ~470-table schema that
introspection step takes well over two minutes per run and routinely
times out, which is why the previous bootstrap maintained a hand-curated
list of "idempotent migration" SQL files (`REQUIRED_IDEMPOTENT_MIGRATIONS`)
as a fallback whenever push didn't complete. Every schema change
invalidated the cached hash and triggered another slow push attempt.

### What it does now

On every vitest run, before any test file is loaded:

1. **Compute a hash of `shared/schema/*` and `drizzle.config.ts`.**
2. **Read `_test_schema_meta.schema_hash` from the test database.** This
   marker table is created/updated by the bootstrap itself, so the cache
   and the actual schema state always stay in lock-step (wiping the DB
   automatically forces a rebuild on the next run).
3. **If the hashes match, skip everything** (~1.5s warm path).
4. **Otherwise rebuild the schema** by:
   - Running `npx drizzle-kit export --sql` to dump the full schema as
     SQL straight from `shared/schema/*` (~3s, no DB introspection).
   - `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` on the test DB.
   - Applying the exported SQL as a single multi-statement `pg.Client`
     query.
   - Stamping the new hash into `_test_schema_meta`.

End-to-end this completes in **~12s on a cold DB** and **~1.5s when the
schema hasn't changed**, replacing what used to be a 2+ minute push.

### Environment variables

- `SKIP_TEST_DB_PUSH=1` — skip the bootstrap entirely.
- `FORCE_TEST_DB_REBUILD=1` (alias `FORCE_TEST_DB_PUSH=1`) — force a
  rebuild even when the cached hash matches.
- `ALLOW_DESTRUCTIVE_TEST_DB_REBUILD=1` — opt in to the destructive
  rebuild against a `DATABASE_URL` whose database name/host doesn't
  contain the substring "test". Only set this when you are certain the
  target DB is dedicated to testing.

### Destructive-rebuild safety gate

Because the bootstrap runs `DROP SCHEMA public CASCADE` it refuses to
proceed unless **either**:

1. The connection string clearly identifies a test database — the
   substring `"test"` appears in the database name or in the host (e.g.
   `postgresql://.../my_app_test` or `postgresql://test-db.../...`), **or**
2. The operator has explicitly opted in via
   `ALLOW_DESTRUCTIVE_TEST_DB_REBUILD=1`.

`NODE_ENV=test` is intentionally **not** sufficient on its own — vitest
sets it automatically on every run, so it would not protect against a
mispointed `DATABASE_URL`. If you keep your test DB on a name like
`heliumdb` (no `"test"` substring), export
`ALLOW_DESTRUCTIVE_TEST_DB_REBUILD=1` in your local shell / CI config.

### When you change `shared/schema/*`

Just commit the schema change. The next vitest run will detect the hash
mismatch, regenerate the export SQL on the fly, and rebuild the test DB
in seconds. **No more hand-written idempotent SQL files are needed for
test-DB sync.** The populated dev DB uses an analogous hash-based
fast-path described in **Dev Database Sync (post-merge)** below.

### Safety

`globalSetup` is destructive: it drops the `public` schema on the
database pointed to by `DATABASE_URL`. This matches the prior behaviour
of `drizzle-kit push --force` and is only safe because the test
`DATABASE_URL` is expected to point at a dedicated test database.
**Never point `DATABASE_URL` at a database with data you care about
when running vitest.**

---

## Dev Database Sync (post-merge)

`scripts/post-merge.sh` runs after every upstream merge against the
**populated** dev database. Unlike the test DB, this database holds real
seed/working data, so we can never `DROP SCHEMA public CASCADE` here.

As of April 2026 the post-merge schema-sync step uses the same
hash-based fast path the test DB does, implemented by
`scripts/dev-schema-sync.ts`:

1. **Compute a SHA-256 of `shared/schema/*` + `drizzle.config.ts`.**
   (Identical hashing function as the vitest globalSetup — same files,
   same byte order, same separators.)
2. **Read `_dev_schema_meta.schema_hash` from the dev DB.** This marker
   table is created/updated by the script itself, so the cache and the
   actual schema state always stay in lock-step.
3. **If the hashes match, skip everything** (~1-2s warm path). This is
   the common case: most merges don't touch `shared/schema/*`.
4. **Pre-introspect the live DB and exclude any "orphan" tables — i.e.
   tables present in Postgres but not declared in `shared/schema/*` —
   from drizzle-kit's view via a generated `tablesFilter` config**.
   This is the critical step that keeps the push non-interactive; see
   "Why we hide orphan tables from drizzle-kit" below.
5. **Otherwise run `drizzle-kit push --force`** with the generated
   filter config to apply an additive diff against the live DB, then
   stamp the new hash on success. This is the rare path; we cap it at
   `DEV_SCHEMA_PUSH_TIMEOUT_MS` (default 180s) to keep a runaway
   introspection from hanging the merge. `stdin` is wired to
   `/dev/null` rather than the parent TTY, so any unexpected
   interactive prompt hangs until the timeout instead of silently
   accepting a destructive default.

### Why we hide orphan tables from drizzle-kit

Several tables in the dev DB are owned by raw-SQL `ensure*Tables.ts`
helpers that run from `server/utils/runStartupMigrations.ts` rather
than being declared as Drizzle `pgTable`s. The biggest groups are:

- The 12 `status_*` tables created by `ensureStatusPageTables` for the
  internal status page (components, incidents, subscribers, probes,
  ...).
- `one_shot_jobs`, created by `oneShotJobRegistry.ts` and the various
  one-shot scripts it serves.
- A handful of historic project/report scratch tables
  (`project_report_settings`, `project_spec_index`,
  `mobile_exchange_codes`).
- `_dev_schema_meta` itself, owned by `dev-schema-sync.ts`.

To drizzle-kit, these look like tables that are *missing* from the
declared schema. When the merge that triggered the sync also adds a
brand-new pgTable on the schema side, `drizzle-kit push` interprets
the (new schema table, missing DB table) pairing as a possible
**rename** and pops up an interactive
`Is <new_table> created or renamed from <orphan>?` select prompt.
The post-merge runner has no TTY to answer it, so the push hangs
until the wrapping `timeout 200` kills it.

`scripts/dev-schema-sync.ts` defuses this by:

1. Importing every `pgTable` exported from `shared/schema/*` via the
   `PgTable` instanceof check + `getTableName` (same approach as
   `server/utils/schemaDriftDetector.ts`).
2. Querying `information_schema.tables` for every public table.
3. Splitting tables that are present in the DB but missing from the
   schema into two buckets, using the curated
   `KNOWN_RAW_SQL_TABLE_ALLOWLIST` constant in the script:
   - **Allowlisted orphans** (e.g. `status_*`, `one_shot_jobs`,
     `_dev_schema_meta`) — added to the filter and ignored by push.
   - **Unknown schema-missing tables** — treated as suspected drift.
4. **If the unknown bucket is non-empty, the script ABORTS the push
   with a non-zero exit, prints each unknown table, and explains the
   two ways to remediate** (re-run from a TTY to answer the rename
   prompt, or extend the allowlist if it's a new raw-SQL helper).
   The schema hash is *not* stamped, so the next post-merge retries
   automatically once the underlying issue is resolved. This is the
   safety valve that keeps a real Drizzle rename from being silently
   masked by the orphan filter.
5. Otherwise it writes a transient `drizzle.config.mjs` (under
   `node_modules/.cache/dev-schema-sync-*`) that mirrors the real
   `drizzle.config.ts` but adds
   `tablesFilter: ["!status_components", "!one_shot_jobs", ...]`.
6. Invokes `drizzle-kit push --force --config=<temp>` against that
   config. drizzle-kit applies the `tablesFilter` to **both** the
   schema-side tables and the introspected DB-side tables, so the
   orphans never enter the diff and no rename prompt fires.

The transient config is scoped to this single push run — `npm run
db:push`, `npm run db:studio`, and any direct drizzle-kit invocation
still use the unfiltered `drizzle.config.ts` and see every table.

### Adding a new raw-SQL helper

If you add a new `ensure*Tables.ts` helper (or anything else that
creates a public table outside of `shared/schema/*`), you must extend
`KNOWN_RAW_SQL_TABLE_ALLOWLIST` in `scripts/dev-schema-sync.ts` with
the table name (or a `prefix_*` glob for groups) and a `reason` that
points at the helper. The post-merge run will fail loudly until you
do, which is the intended behavior — anything missing from the
allowlist could otherwise be a real schema rename in disguise.

### Why this replaces the old approach

The previous post-merge script ran `drizzle-kit push --force` with a
hard 60-second `timeout`, which on this ~470-table schema routinely
timed out before push could finish introspecting the live DB. To
compensate, the script also applied a hand-curated whitelist of
`migrations/add_*.sql` "idempotent fixup" files that captured columns
push had been failing to add. The whitelist had to be edited by hand
every time a schema change introduced a NOT NULL column the dev DB
didn't have.

With the hash-based skip:

- Merges that don't change `shared/schema/*` finish the schema-sync
  step in well under a minute (typically 1-2s).
- Merges that do change the schema run a single full push instead of
  push + a whitelist of fixups.
- The `migrations/add_*.sql` whitelist in `post-merge.sh` is gone. The
  files themselves are kept in the repo for historical reference, but
  the post-merge step no longer depends on them.

### Environment variables

- `SKIP_DEV_SCHEMA_SYNC=1` — skip the script entirely.
- `FORCE_DEV_SCHEMA_SYNC=1` — run `drizzle-kit push` even when the
  cached hash matches.
- `DEV_SCHEMA_PUSH_TIMEOUT_MS` — override the push timeout (default
  180000 ms).

### Failure mode

The script is intentionally non-blocking: if push fails or times out it
logs the output and exits 0 **without** stamping the hash, so the next
post-merge run will try again. The merge itself is never blocked by a
schema-sync hiccup; startup migrations and runtime guards in the app
are the ultimate safety net.

---

## Manual Migrations (When Needed)

### Existing Manual Migration

**File**: `server/migrations/001_backfill_token_version.sql`

**Purpose**: Backfill `tokenVersion` column for existing users

**Why Manual?**:
- Requires data transformation (setting existing users to `tokenVersion = 0`)
- Cannot be automated by schema diff alone
- Needs to run ONCE after schema change

### When to Create Manual Migrations

1. **Data Backfilling**
   - Populating new required columns with calculated values
   - Example: Setting default values for non-null columns

2. **Complex Transformations**
   - Splitting one column into multiple
   - Combining multiple columns into one
   - JSON data structure changes

3. **Column Renames**
   - Drizzle sees rename as DROP + ADD (data loss!)
   - Manual migration preserves data:
     ```sql
     ALTER TABLE "projects" RENAME COLUMN "old_name" TO "new_name";
     ```

4. **Custom Constraints**
   - Check constraints
   - Custom triggers
   - Stored procedures

### How to Create Manual Migration

```bash
# 1. Create migration file manually
touch server/migrations/002_your_migration_name.sql

# 2. Write SQL
cat > server/migrations/002_your_migration_name.sql << 'EOF'
-- Description: What this migration does
-- Date: YYYY-MM-DD
-- Author: Your Name

BEGIN;

-- Your SQL here
UPDATE projects SET budget = contract_amount WHERE budget IS NULL;

COMMIT;
EOF

# 3. Run manually via psql or database tool
# (No automatic migration runner configured)
```

---

## Production Deployment Strategy

### Recommended Approach

1. **Development**: Use `db:push` freely

2. **Staging**: 
   - Test `db:push` on staging environment
   - Verify no data loss
   - Check application functionality

3. **Production**:
   - **Option A (Current)**: `db:push --force` directly
     - Fast, but risky if misaligned
     - Requires database backup first
   
   - **Option B (Recommended)**: Generate explicit migrations
     ```bash
     npm run db:generate  # Creates migration SQL
     npm run db:migrate   # Applies migrations
     ```
     - Safer for production
     - Allows review before apply
     - Creates audit trail

### Migration Safety Checklist

Before running migrations in production:

- [ ] Database backup created
- [ ] Schema changes tested in staging
- [ ] Data transformation scripts tested
- [ ] Rollback plan documented
- [ ] Downtime window scheduled (if needed)
- [ ] Application code updated to match new schema
- [ ] Integration tests passing

---

## Current Schema (23 Tables)

1. `users` - User accounts and authentication
2. `projects` - Active construction projects
3. `bids` - Bid tracking and proposals
4. `estimates` - Project cost estimates
5. `procurement_items` - Material and equipment tracking
6. `plan_documents` - Blueprint and plan storage
7. `time_entries` - Employee time tracking
8. `tm_daily_sheets` - T&M daily reporting
9. `receipts` - Expense receipts
10. `project_notes` - Field notes and updates
11. `scope_items` - Scope of work items
12. `media` - Photos and videos
13. `change_orders` - Change order management
14. `calendar_events` - Events and time-off
15. `notifications` - In-app notifications
16. `file_permissions` - File access control
17. `audit_log` - Compliance audit trail
18. `billing_events` - Financial milestones
19. `time_clock_shifts` - GPS time-clock data
20. `time_clock_events` - Clock in/out events
21. `ai_settings` - AI system configuration
22. `ai_runs` - AI analysis execution history
23. `ai_tasks` - AI-generated tasks

---

## Schema Changes Log (Nov 19, 2025)

### Added to `projects` table:
- `budget` (decimal) - Project budget for profitability tracking
- `contractAmount` (decimal) - Awarded contract value
- `estimatedCompletionDate` (timestamp) - Project completion target

**Reason**: CFO dashboard profitability engine requires budget comparison

**Applied via**: `npm run db:push`

**Migration**: Automatic (new columns, nullable)

---

## Best Practices

### DO ✅

1. **Always Backup** before production schema changes
2. **Test in Staging** first
3. **Document** significant schema changes in this file
4. **Add Indexes** for frequently queried columns
5. **Use Nullable** for new columns on existing tables
6. **Validate** application works after schema change

### DON'T ❌

1. **Never** change primary key column types (`serial` ↔ `varchar`)
2. **Never** use `db:push --force` in production without backup
3. **Never** rename columns via `db:push` (use manual migration)
4. **Never** drop tables via `db:push` without data export
5. **Never** change column types that lose precision (e.g., `text` → `varchar(50)`)

---

## Future Improvements

### Short-Term
- [ ] Add `npm run db:migrate` workflow
- [ ] Create production migration SOP
- [ ] Set up automated database backups

### Long-Term
- [ ] Implement blue-green deployments for zero-downtime schema changes
- [ ] Add database migration testing in CI/CD
- [ ] Create schema documentation generator

---

## Troubleshooting

### "Migration conflict detected"

**Cause**: Local schema doesn't match database

**Solution**:
```bash
# Option 1: Accept database schema (discard local changes)
npm run db:pull

# Option 2: Force local schema (DANGEROUS - may drop data)
npm run db:push --force
```

### "Column does not exist"

**Cause**: Application code references column not yet in database

**Solution**:
1. Check `shared/schema.ts` has the column defined
2. Run `npm run db:push`
3. Restart application server

### "Cannot drop column, data exists"

**Cause**: Trying to remove column with data

**Solution**:
1. Export data if needed
2. Remove column from schema
3. Run `npm run db:push --force` (after backup!)

---

## Emergency Rollback Procedure

If a migration breaks production:

1. **Stop Application** (prevent further writes)
2. **Restore Database Backup**
   ```bash
   # Via Neon dashboard or pg_restore
   ```
3. **Revert Code** to previous version
4. **Restart Application**
5. **Investigate** migration issue in staging

---

## Contact & Resources

**Database Admin**: TFR Construction Tech Lead  
**Backup Location**: Neon automated backups (7-day retention)  
**Drizzle Docs**: https://orm.drizzle.team/docs/overview  
**Neon Docs**: https://neon.tech/docs/introduction

---

**Document Owner**: Replit Agent  
**Review Frequency**: After major schema changes  
**Last Schema Change**: November 19, 2025 (added project budget fields)
