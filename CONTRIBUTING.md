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

## Typecheck

`npm run check` exits at **zero errors** (restored in Task #2647).
All new code must keep it there.

* **Do not add new errors.** Run `npm run check` before and after your
  change and confirm the error count is still zero.
* **Never paper over errors with `// @ts-ignore`, `// @ts-expect-error`,
  or `as any`.** Fix them properly.
* When you touch a file, leave it with no more errors than you found.

Run `npm run check 2>&1 | grep -c "error TS"` before and after to confirm.

### JSX generic type arguments and the Replit metadata injector

Replit's development environment injects `data-replit-metadata` and
`data-component-name` attributes into JSX elements. This injection breaks
when a JSX element uses an explicit generic type argument, e.g.
`<MyComponent<Item> .../>`, because the injector inserts attributes
before the `<Item>` token, producing invalid syntax.

**Rule:** Never write explicit generic type arguments directly on a JSX
element. Instead, let TypeScript infer the type from the props, or
assign a typed alias before the JSX:

```tsx
// BAD — breaks the Replit metadata injector
<EntityCalendarView<TaskItem> items={...} />

// GOOD — TypeScript infers TaskItem from the items prop
<EntityCalendarView items={...} />

// GOOD — explicit alias if inference is not possible
const TypedView = EntityCalendarView as typeof EntityCalendarView<TaskItem>;
<TypedView items={...} />
```

## Where things live

See `replit.md` for the canonical map of the codebase, run commands,
and architecture decisions.
