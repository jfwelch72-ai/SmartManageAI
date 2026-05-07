# Contributing to SmartManageAI

Thanks for working on SmartManageAI. The notes below cover the **green
baseline** every change is expected to keep intact, plus the local
checks you should run before pushing.

## Green baseline

A change is considered "ready to merge" only when:

1. The `Start application` workflow boots cleanly and the app is
   reachable in the Replit preview.
2. The `artifacts/mockup-sandbox: Component Preview Server` workflow
   boots cleanly (preview path: `/__mockup/`).
3. `npm run check` (TypeScript) exits 0.  See the **Typecheck** section
   below — there is currently a backlog of pre-existing errors that
   are tracked as a follow-up cleanup task; new code MUST NOT add to
   that count.
4. `npm run build` exits 0.
5. The smoke test (`scripts/smoke-test.sh`) returns 200 from the
   booted server's `/healthz` (or `/`) endpoint.

## Local pre-commit checks

Run these before opening a PR:

```bash
# Static checks
npm run check          # TypeScript

# Build the production bundle
npm run build

# Boot the dev server in another terminal, then:
scripts/smoke-test.sh  # Hits the running server and asserts 200
```

If you only changed UI mockups under `artifacts/mockup-sandbox/`, also
run that artifact's typecheck:

```bash
cd artifacts/mockup-sandbox && npm run typecheck
```

## CI

`scripts/ci.sh` runs the full baseline (typecheck + build + smoke
test). It is what CI executes on every push; you can run it locally
the same way CI does:

```bash
scripts/ci.sh
```

## Typecheck backlog

`npm run check` currently reports a backlog of pre-existing TypeScript
errors (see Task #2477 drift notes and the follow-up cleanup task).
Until the backlog reaches zero, the rule is:

* **Do not add new errors.** Run `npm run check` before and after your
  change and confirm the error count did not increase.
* **Do not paper over errors with `// @ts-ignore` or `as any`.** Fix
  them properly or leave them for the cleanup task.
* When you touch a file that already has typecheck errors, prefer to
  fix the errors in that file as part of your change.

## Where things live

See `replit.md` for the canonical map of the codebase, run commands,
and architecture decisions.
