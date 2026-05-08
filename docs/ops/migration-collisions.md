# Migration filename collisions

Drizzle and our runtime helpers in `server/utils/runStartupMigrations.ts`
apply migrations in **filename order**, and the per-file coverage manifest
(`server/utils/migrationStartupCoverage.ts`) keys on the **full filename**.
That means two migrations sharing the same 4-digit prefix is a latent bug:

- On a fresh dev DB, `drizzle-kit migrate` applies them in lexicographic
  order — usually fine, but it depends on the second-segment names.
- On a long-lived DB, `__drizzle_migrations` orders by insertion time, so
  the apply order can diverge between dev and prod for the same two files.
- Anything that reads the manifest by filename will silently miss either
  one of the two collisions until somebody notices.

The repo already lived through a 0085–0093 renumbering event for exactly
this reason, plus 20 historical duplicates that are tracked for renumber in
Task #2435. Task #2685 closed the **prevention** gap so the next collision
can't reach `main` unnoticed.

## What's in place

### 1. CI guard — `scripts/check-migration-collisions.mjs`

Wired into `scripts/ci.sh` next to the other `check-*.mjs` lints. Walks
`migrations/*.sql`, groups by 4-digit prefix, and exits non-zero whenever a
new collision appears. The 20 historical duplicates are tolerated via an
explicit `KNOWN_DUPLICATES` allowlist marked `TODO(#2435)`. The guard also
flags **stale allowlist entries** — i.e. when a renumbering happens but
nobody trims the allowlist — so the guard tightens automatically.

Run it locally:

```bash
node scripts/check-migration-collisions.mjs
```

### 2. Generator — `scripts/new-migration.mjs <slug>`

Hands out the next free 4-digit prefix so two devs on parallel branches
don't pick the same one. Refuses to run when an unresolved duplicate
already exists (forces collisions to be fixed first).

```bash
node scripts/new-migration.mjs add_widget_color
# -> migrations/0106_add_widget_color.sql
```

The generated file is an empty placeholder with a header comment that
reminds you to:

1. Write the SQL.
2. Register the filename in `server/utils/migrationStartupCoverage.ts`.
3. Add a startup helper in `server/utils/runStartupMigrations.ts` if the
   migration is more than a one-off baseline.

> Note: the generator is invoked directly via `node`. We did not add an
> `npm` script for it (that would touch `package.json`); if you'd like a
> shorter alias, ask a maintainer to add one.

## Resolution playbook — when the guard catches a collision

Suppose you pull `main` and your branch's
`migrations/0106_my_change.sql` now collides with another `0106_*.sql`
that landed first.

1. **Pick the higher number for the file that landed *later*** (yours).
   Rename `0106_my_change.sql` → `0107_my_change.sql` (or whatever the
   next free prefix is — the generator above will tell you).

2. **Update `server/utils/migrationStartupCoverage.ts`.** The manifest
   keys on the full filename. Find your old key and rename it. If it was
   `{ helper: "ensureXxx" }`, no other change is needed; if it was
   `{ skip: "..." }`, leave the reason as-is.

3. **Update `server/utils/runStartupMigrations.ts` if applicable.** This
   file references helper functions, not filenames, so it usually doesn't
   need a rename. But double-check that the ordering still satisfies any
   table dependencies (e.g. a helper that creates a child table must be
   registered after the helper that creates its parent).

4. **Update `migrations/meta/_journal.json`** *only if* the collision
   touches a file that's already in the journal. Drizzle writes journal
   entries when it generates a migration via `drizzle-kit generate`. The
   `tag` field is the bare filename (no `.sql`); rename it in lock-step
   with the file rename. Do **not** touch the `idx` numbers.

5. **Already-applied environments.** If the collided file was already
   applied to dev/staging/prod under the old name, the
   `__drizzle_migrations` row will reference the old filename. Two safe
   options:

   - **Recommended:** add a one-line comment in
     `migrationStartupCoverage.ts` noting the historical name, and leave
     the row alone — the runtime helper for that file is idempotent and
     will keep the schema in sync regardless of the journal name.
   - **Heavier:** issue an `UPDATE __drizzle_migrations SET hash = …`
     against each environment to rename the row. Only do this if you
     have a specific need (e.g. you're about to re-run the file via the
     admin one-shot jobs panel and the panel keys on the new name).

6. **Re-run the guard.**

   ```bash
   node scripts/check-migration-collisions.mjs
   ```

   It must print `OK` before you push.

## When the offending file is one of the 20 historical duplicates

Renumbering the historical duplicates is tracked in Task #2435 and is out
of scope for the prevention guard. When you renumber one as part of #2435:

1. Pick the higher next-free prefix by running `node scripts/new-migration.mjs <slug>`
   and reading the prefix from the generator's output.
2. Apply steps 2–5 above.
3. **Delete** the corresponding entry from `KNOWN_DUPLICATES` in
   `scripts/check-migration-collisions.mjs`. The guard's stale-allowlist
   check will fail otherwise.

## Recommended one-time follow-up (operational, not a code change)

The 0085–0093 renumbering event almost certainly left some `__drizzle_
migrations` rows in dev/staging/prod that don't match any file in
`migrations/`. That's harmless for runtime (the startup helpers are
idempotent and pin the schema regardless) but makes journal audits
confusing. A maintainer should periodically run, against each
environment:

```sql
SELECT hash, created_at
FROM __drizzle_migrations
WHERE hash NOT IN (
  -- list of current migration filenames (no .sql)
)
ORDER BY created_at;
```

…and either delete the orphan rows or document them in this file. This
is recommended, not required.

## Related files

- `migrations/`
- `migrations/meta/_journal.json`
- `server/utils/migrationStartupCoverage.ts`
- `server/utils/runStartupMigrations.ts`
- `scripts/check-migration-collisions.mjs`
- `scripts/new-migration.mjs`
- `scripts/ci.sh`
