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

Chromium ships with the workspace and works as soon as `replit.nix` is
applied. **Firefox** and **WebKit** are not downloaded by default — both
need a one-time install to land their binaries under
`$XDG_CACHE_HOME/ms-playwright` (which on Replit is
`/home/runner/workspace/.cache/ms-playwright`):

```bash
# One-time per workspace (also re-run after a Playwright version bump):
bash scripts/setup-playwright-firefox.sh  # installs Firefox (no patch needed)
bash scripts/setup-playwright-webkit.sh   # installs *and* patches WebKit
```

Both helpers are also wired into `scripts/post-merge.sh`, so a fresh
clone or a `@playwright/test` version bump auto-provisions the missing
binaries on the next merge — manual invocation is only needed if you've
just run `npm install` and want to use the firefox/webkit projects
before the next merge cycle.

Both helper scripts internally set
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` while running `npx
playwright install`. That's because Playwright's post-install
host-requirements validator runs `ldd` against the bundled binary using
its default search path and bails since Replit's container has no
`/usr/lib/x86_64-linux-gnu`. The libraries Firefox/WebKit actually need
at runtime (`libgtk-3.so.0`, `libxcb-shm.so.0`, `libgstreamer-1.0.so.0`,
…) are pinned in `replit.nix` and exposed via
`$REPLIT_LD_LIBRARY_PATH`, so the binaries launch fine once installed.
`playwright.config.ts` sets the same skip flag automatically when
`$REPLIT_LD_LIBRARY_PATH` is present, so `npx playwright test
--project=firefox` and `--project=webkit` work without any extra env
override at test time.

Once the binaries are installed, run a single spec across all three
engines (Konva/Radix-heavy specs are good cross-engine canaries):

```bash
npx playwright test e2e/takeoff-markup-undo.spec.ts                  # all 3 projects
npx playwright test --project=firefox e2e/takeoff-markup-undo.spec.ts
npx playwright test --project=webkit  e2e/takeoff-markup-undo.spec.ts
```

The remainder of this section covers the WebKit-specific shell-wrapper
fix; Firefox needs no patching beyond the install step above.

The bundled WebKit needs a one-time fix for two reasons:

1. Playwright's WebKit zip ships a `MiniBrowser` shell wrapper that
   exports `LD_LIBRARY_PATH="${MYDIR}/lib:${MYDIR}/sys/lib"` at launch,
   which clobbers the nix-store paths in `$REPLIT_LD_LIBRARY_PATH` where
   `libjpeg.so.8`, `libpsl.so.5`, and `libnghttp2.so.14` live (see the
   `libjpeg8`, `libpsl`, and `nghttp2` entries near the top of
   `replit.nix` — last verified still required on webkit-2272 /
   Playwright 1.59.1, see Task #1908).
2. Playwright's pre-launch `validateDependenciesLinux` runs `ldd` against
   the binary *before* the wrapper executes, so it bails with a misleading
   "Host system is missing dependencies" error even though the libs are
   reachable at runtime.

### Re-checking after a Playwright bump (Task #1908)

After `@playwright/test` is upgraded and a new `webkit-NNNN` is laid down
under `$XDG_CACHE_HOME/ms-playwright`, run this to see which (if any) of
the three libs are still missing from the bundled WebKit:

```bash
for d in minibrowser-gtk minibrowser-wpe; do
  W="$XDG_CACHE_HOME/ms-playwright/$(ls "$XDG_CACHE_HOME/ms-playwright" \
    | grep ^webkit- | sort -r | head -n1)/$d"
  echo "=== $d ==="
  LD_LIBRARY_PATH="$W/lib:$W/sys/lib" \
    env -u REPLIT_LD_LIBRARY_PATH ldd "$W/bin/MiniBrowser" \
    | grep -E 'libjpeg\.so\.8|libpsl\.so\.5|libnghttp2\.so\.14' || echo '(none)'
done
```

If any of the three libs no longer appear as "not found" — Playwright
has either bundled them inside the WebKit zip or switched to a
statically-linked MiniBrowser — drop the corresponding `replit.nix`
entry, then run `bash scripts/setup-playwright-webkit.sh` and
`npx playwright test --project=webkit e2e/takeoff-markup-undo.spec.ts`
to confirm the WebKit project still launches end-to-end.

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
