# shared/

This folder mirrors the subset of `shared/` from the main SmartManageAI repo
that the mobile app needs at build time. It is resolved by the `@shared/*`
TypeScript path alias defined in the project's `tsconfig.json`.

## Current contents

The mobile app currently has **no runtime imports** from `@shared/*` — every
network payload is shaped on the wire by the existing backend routes, and the
mobile screens type those responses locally. This folder exists so that the
path alias resolves and so that future schema sharing has an obvious home.

## How to sync types from the main repo

When you add a new `import … from "@shared/…"` in `src/`, copy the
corresponding file(s) from the main SmartManageAI repo into this folder,
preserving the same relative path. For example:

```
# In the main repo
shared/schema/features/dailyReports.ts

# Copy to
mobile-standalone/shared/schema/features/dailyReports.ts
```

Only copy what is actually imported (and what those files transitively
import). Do not vendor the entire `shared/` tree — it pulls in server-only
helpers that will not compile under React Native.

### Manual sync recipe

1. In the main repo, run `rg "from ['\"]@shared/" src/` from `mobile/` to
   list every shared import the mobile app uses.
2. For each unique path, `cp` the file (and its transitive imports) into the
   matching location under this folder.
3. Run `npx tsc --noEmit` from the standalone project root to confirm the
   types still resolve.
4. Commit the copied files. Note the date and the source commit SHA in the
   commit message so future-you can tell how stale the copy is.

If the type surface grows large enough that manual sync becomes painful, the
next step is to publish a `@smartmanageai/shared` package and consume it via
npm — that is intentionally deferred until the friction is real.
