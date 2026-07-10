# Mobile Deployment

> Part of the [Mobile App Architecture Blueprint](./README.md).

## 1. Build & release pipeline

- **EAS Build** produces native iOS/Android binaries from the three
  environment flavors defined in `01-architecture.md` §12
  (`development`/`staging`/`production`), each with its own
  `EXPO_PUBLIC_API_URL`, push credentials, and bundle identifier suffix
  (e.g., `com.smartmanageai.app.dev` vs. `com.smartmanageai.app`) so all
  three can be installed side-by-side on a test device.
- **EAS Submit** delivers `production`-flavor builds to the Apple App
  Store and Google Play Console.
- **EAS Update** ships JS-only OTA patches to already-installed builds for
  bug fixes and non-native-code feature changes, without a store review
  cycle — reserved for low-risk patches; any change touching native
  modules, permissions, or `app.json` config requires a full binary
  release.

## 2. Release channels / tracks

| Channel | Audience | Trigger |
| --- | --- | --- |
| `development` | Internal engineering, Expo Go / dev client | Every merge to main dev branch |
| `staging` (TestFlight internal / Play Internal Track) | QA, pilot customers | Manual promote after CI E2e smoke passes |
| `production` (App Store / Play Production) | All customers | Manual promote after staging soak + store review |

## 3. Store review considerations

- **Permissions justification**: camera (photo capture), location
  (clock-in GPS, location-tagged captures), notifications (push) — each
  needs a clear, honest usage-description string for App Store/Play Store
  review; no permission is requested that isn't tied to a concrete feature
  in this blueprint.
- **Background modes**: only background fetch/task for sync (§6 of
  `01-architecture.md`) — no background audio/location that would trigger
  extra review scrutiny.
- **Account deletion / data export**: if required by store policy for an
  app handling employee data, this is a policy/legal question for the
  product owner to confirm before submission — flagged here, not assumed
  resolved by this blueprint.

## 4. Rollout strategy

- **Phased/staged rollout** on both stores (percentage-based rollout) for
  every production release, not a 100%-at-once push — lets a bad release
  be caught on a small percentage of devices before full exposure, given
  the payroll/compliance sensitivity of the app's core flows.
- **OTA rollback**: EAS Update supports republishing the previous update
  bundle immediately if a JS-only regression ships — this is the fast
  rollback path; a native-code regression requires an expedited store
  review or store-side "remove from sale" as a last resort.
- **Kill switch**: a server-side feature flag (reusing the existing
  `FEATURE_FLAG_KEYS` mechanism, `01-architecture.md` §11) can disable a
  specific mobile feature app-wide without a release, for cases where a
  feature (not the whole app) needs to be pulled quickly.

## 5. Versioning

- Semantic app version (`X.Y.Z`) tracks user-visible releases; a separate
  native build number increments per store submission per platform
  convention (iOS `CFBundleVersion`, Android `versionCode`).
- The API base URL and any breaking backend contract change must be
  versioned defensively — since store review can take days, the backend
  cannot assume every installed client is on the latest version at any
  given time. Any backend change to a route mobile depends on should stay
  backward-compatible for at least one release cycle, or be gated behind a
  feature flag the old client version simply doesn't call.

## 6. CI gates before promotion

Mirrors the "Green Baseline" discipline in `replit.md`:

1. Unit + component tests pass (`testing.md` §1).
2. Typecheck passes (RN/TS project, analogous to the web app's
   `tsc --build`).
3. E2e smoke suite passes against staging (`testing.md` §3).
4. No new Sentry crash-free-rate regression on the previous staging build
   before promoting further.

## 7. Monitoring post-release

- Sentry crash-free session rate and performance traces (`performance.md`
  §8) are the primary release-health signal, watched closely for the first
  24–48 hours after any store promotion.
- `mobile_sync_log` / `mobile_sync_events` server-side tables
  (`data-models.md` §1) give an independent, server-truth view of sync
  health per app version if the client tags its version on each sync
  request — recommended as a lightweight addition to the sync payload so a
  bad release's sync failure rate is visible without waiting on client
  telemetry.
