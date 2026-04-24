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

# Running Playwright (`npm run test:e2e`) on Replit

Chromium and Firefox work out of the box on the Replit dev container.
The bundled WebKit needs a one-time fix for two reasons:

1. Playwright's WebKit zip ships a `MiniBrowser` shell wrapper that
   exports `LD_LIBRARY_PATH="${MYDIR}/lib:${MYDIR}/sys/lib"` at launch,
   which clobbers the nix-store paths in `$REPLIT_LD_LIBRARY_PATH` where
   `libjpeg.so.8`, `libpsl.so.5`, and `libnghttp2.so.14` live (see the
   `libjpeg8`, `libpsl`, and `nghttp2` entries near the top of
   `replit.nix`).
2. Playwright's pre-launch `validateDependenciesLinux` runs `ldd` against
   the binary *before* the wrapper executes, so it bails with a misleading
   "Host system is missing dependencies" error even though the libs are
   reachable at runtime.

## One-shot setup (per workspace)

```bash
bash scripts/setup-playwright-webkit.sh
```

That script:

- Runs `npx playwright install webkit` if the WebKit folder is missing
  under `$XDG_CACHE_HOME/ms-playwright` (which on Replit is
  `/home/runner/workspace/.cache/ms-playwright`).
- Idempotently patches both `minibrowser-gtk/MiniBrowser` and
  `minibrowser-wpe/MiniBrowser` so the `LD_LIBRARY_PATH` export *appends*
  the previous `LD_LIBRARY_PATH` and `REPLIT_LD_LIBRARY_PATH` instead of
  clobbering them. Re-running is safe — patched wrappers are detected via
  a sentinel comment.

## Self-healing on every test run (Task #1890)

`playwright.global-setup.ts` re-invokes the same patcher (with
`PLAYWRIGHT_WEBKIT_PATCH_ONLY=1` so it never auto-downloads WebKit) at
the start of every `npx playwright test` invocation. That means:

- A fresh `npm install` no longer requires a manual setup step — the
  first `npx playwright test --project=webkit` self-heals.
- Bumping `@playwright/test` to a version that needs a newer WebKit
  revision is also self-healing: after `npx playwright install webkit`
  lays down the new (unpatched) `webkit-NNNN` directory, the next test
  run re-applies the patch automatically.
- Chromium / Firefox-only test runs pay only the cost of an idempotent
  shell exec (~50ms when wrappers are already patched, an early exit
  when WebKit isn't installed at all).

The hook is gated on `REPLIT_LD_LIBRARY_PATH` being set, so CI on
Ubuntu is unaffected.

`playwright.config.ts` already sets
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` automatically when
`REPLIT_LD_LIBRARY_PATH` is present, so once the wrappers are patched the
WebKit project just works:

```bash
npx playwright test --project=webkit e2e/takeoff-markup-undo.spec.ts \
  e2e/takeoff-markup-history-wiring.spec.ts
```

CI (Ubuntu) is unaffected — `npx playwright install --with-deps` puts
every required lib under `/usr/lib/x86_64-linux-gnu`, so the wrapper's
default `LD_LIBRARY_PATH` resolves them and host-requirements validation
passes without the env override.
