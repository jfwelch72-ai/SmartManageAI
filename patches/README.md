# patches/

This directory holds upstream patches we want to ship into third-party
dependencies, along with notes about their submission status.

## pdfjs-dist worker / window guard

**File:** `pdfjs-dist-worker-window-guard.upstream.patch`
**Tracking task:** #2263
**Affected file in upstream:** `src/display/editor/tools.js`
   (specifically `ColorManager.convert`)
**Affected file in our build of pdfjs-dist@5.4.394:**
   `node_modules/pdfjs-dist/build/pdf.mjs` line ~2598

### Why this patch exists

`pdfjs-dist`'s `ColorManager.convert` reaches
`window.matchMedia("(forced-colors: active)")` with no `typeof window`
guard. Inside a dedicated module worker (`window` undefined) the call
throws `ReferenceError: window is not defined` on the very first
`page.render()`, surfacing in the takeoff workspace as the "Failed to
load PDF" toast and a permanently blank canvas.

We work around it today by installing a tiny `window` / `matchMedia`
shim on the worker global before pdfjs is loaded — see
`client/src/workers/pdfWorkerPolyfill.ts`. Every team running pdf.js
inside a worker carries the same shim. The patch in this directory
fixes the root cause so the shim becomes unnecessary.

### Status

| Step                                                        | Status |
|-------------------------------------------------------------|--------|
| Patch authored                                              | done (this directory) |
| Patch posted to https://github.com/mozilla/pdf.js (PR)      | **TODO — must be opened by a maintainer** |
| Upstream merged                                             | pending |
| `pdfjs-dist` published with the fix                         | pending |
| Bumped in `package.json` past the fix                       | pending |
| `client/src/workers/pdfWorkerPolyfill.ts` and its test removed | pending |
| `client/src/workers/pdfTileWorker.ts` imports pdfjs directly | pending |

The first step (authoring) is what we can do inside this isolated
coding environment; opening the upstream PR requires pushing to
GitHub from a human account, which has to happen outside of here.

### Cleanup checklist (do this once the upstream fix is published)

1. `npm install pdfjs-dist@<version-with-the-fix>`
2. Confirm `node_modules/pdfjs-dist/build/pdf.mjs` no longer contains
   the unguarded `window.matchMedia("(forced-colors: active)")` —
   the regression test
   `client/src/workers/__tests__/pdfWorkerPolyfill.test.ts`
   ("still reaches `window.matchMedia` unguarded in the shipped build")
   will fail at this point, which is the signal to proceed.
3. Delete:
   - `client/src/workers/pdfWorkerPolyfill.ts`
   - `client/src/workers/__tests__/pdfWorkerPolyfill.test.ts`
4. In `client/src/workers/pdfTileWorker.ts`:
   - Remove the `installPdfWorkerGlobals` import and its call.
   - Replace the dynamic `await import("pdfjs-dist")` IIFE-promise
     with a regular static `import * as pdfjsLib from "pdfjs-dist";`
     (the dynamic-import dance only existed so the polyfill could run
     first).
5. Delete this entry from `patches/README.md` and the patch file
   itself.

### Local fork option (only if upstream rejects the PR)

If the PR is rejected, the fallback is to pin to our own fork. Two
realistic shapes:

- Publish `@<our-org>/pdfjs-dist` to npm with the patch applied and
  point `package.json` at it.
- Add `patch-package` to the project (`npm install -D patch-package`,
  add `"postinstall": "patch-package"` to `package.json` scripts) and
  ship the diff as `patches/pdfjs-dist+<version>.patch`. The
  upstream-format patch in this directory is intentionally written as a
  unified diff so it can be repurposed for either path with minimal
  reformatting.

Either path requires editing `package.json`, which the agent harness
does not do unattended; whoever takes that route should open it as a
follow-up task with the proposal explicit so a human can sign off.
