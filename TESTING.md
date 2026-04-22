# Running the Test Suite Locally

The vitest suite (notably the lineage / backfill integration tests under
`server/__tests__/`) runs against a real PostgreSQL database. To protect
your dev data, `server/__tests__/globalSetup.ts` refuses to wipe and
re-apply the schema unless the connection string clearly identifies a test
database (the database name or hostname must contain the substring
`test`), or you've explicitly set `ALLOW_DESTRUCTIVE_TEST_DB_REBUILD=1`.

The default Replit dev database (`heliumdb`) doesn't satisfy either
condition, so out of the box `npm test` would fail with:

> Refusing to rebuild schema: DATABASE_URL does not look like a test database…

## One-shot setup

Run this once per workspace:

```bash
npm run test:setup
```

That command:

1. Creates a sibling test database next to your dev one (default name:
   `<your_db>_test`, e.g. `heliumdb_test`). Re-running is safe — it never
   touches an existing database's contents.
2. Writes `.env.test` at the repo root containing a `DATABASE_URL` pointed
   at that test DB. The file is gitignored.

After that, just run:

```bash
npm test
```

`server/__tests__/loadEnvTest.ts` (wired up as both a vitest `setupFiles`
entry and a `globalSetup` import) auto-loads `.env.test` before the safety
check. The first test run rebuilds the schema (~12s); subsequent runs
short-circuit via the `_test_schema_meta` hash table (~1.5s).

## Knobs

| Env var | Effect |
| --- | --- |
| `TEST_DATABASE_NAME` | Override the sibling DB name created by `test:setup` (must contain `test`). |
| `DATABASE_URL` | Set inline (e.g. `DATABASE_URL=… npm test`) to override `.env.test`. If it already looks like a test DB, the file is ignored entirely. |
| `SKIP_TEST_DB_PUSH=1` | Skip schema sync entirely (useful when reusing a freshly-built schema). |
| `FORCE_TEST_DB_REBUILD=1` | Force a schema rebuild even when the cached hash matches. |
| `ALLOW_DESTRUCTIVE_TEST_DB_REBUILD=1` | Bypass the "must contain test" safety check. Use with extreme care — this enables `DROP SCHEMA public CASCADE` against whatever `DATABASE_URL` currently points at. |

## Resetting

If your test DB ends up in a weird state, drop it from a `psql` shell and
re-run `npm run test:setup`:

```sql
DROP DATABASE heliumdb_test;
```
