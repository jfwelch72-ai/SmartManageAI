# SmartManageAI Field — Native Mobile App

Cross-platform iOS + Android field app for superintendents, foremen, and field
crews. Built with Expo + React Native, written in TypeScript, sharing schema
types with the web app.

## Why this exists

Procore's biggest moat is its battle-tested native field app that works offline
on jobsites with poor signal. This is the SmartManageAI equivalent: a true
native experience for daily reports, time clock, photos, punch list, RFIs, and
inspections that works without connectivity and syncs cleanly when back online.

## Architecture

```
mobile/
  App.tsx                    # Root: providers + auth gate
  app.config.ts              # Expo config (iOS/Android entitlements, plugins)
  eas.json                   # EAS Build + Submit profiles (TestFlight / Play Internal)
  src/
    api/client.ts            # fetch() wrapper that auths with the same JWT cookie as web
    auth/AuthContext.tsx     # Login/logout, /api/auth/me, SecureStore-backed session
    sync/
      db.ts                  # SQLite schema (cache + outbox + meta), expo-sqlite
      types.ts               # SyncEntityType, OutboxRecord, etc.
      outbox.ts              # enqueue/list/markSynced/markFailed/markConflict
      coordinator.ts         # registerDevice + pull + push + attachment uploader
      SyncContext.tsx        # online/pending/syncing state, AppState + 15-min bg fetch
    push/registerForPush.ts  # Expo push token, permissions, Android channels
    navigation/RootNavigator.tsx
    screens/
      Login.tsx              # SmartManageAI SSO/credentials
      Home.tsx               # Tile launcher + cached project list
      DailyReports.tsx       # Notes + camera capture, queued offline
      TimeClock.tsx          # GPS punch in/out
      Photos.tsx             # Camera capture, project tagging
      PunchList.tsx          # Create / mark complete
      RFI.tsx                # Create + view
      Inspections.tsx        # Safety checklist
      Drawings.tsx           # Cached sheet viewing
      Conflicts.tsx          # Resolve "two people edited offline" conflicts
    components/SyncStatusBar.tsx   # Online/offline + queue indicator (always visible)
    theme/index.ts           # Tokens shared across screens
```

## Offline-first data flow

1. **Local SQLite** (`expo-sqlite`) stores both the read cache (`cache_entities`)
   and a write outbox (`outbox`). All UI reads from the cache, so the app is
   fully usable in airplane mode.
2. **Optimistic mutations** call `enqueue()` which writes to the outbox in a
   single transaction and immediately reflects in the UI.
3. **Sync coordinator** (`syncNow`) does a `pull` (delta from
   `GET /api/ai-features/mobile/sync?lastSyncAt=…`) followed by a `push`
   (batched `POST /api/ai-features/mobile/sync`). It runs:
   - on app launch
   - whenever AppState becomes `active`
   - every 15 minutes via `expo-background-fetch`
   - manually when the user taps the sync status bar
4. **Conflict detection** is server-side. The existing `mobileSyncRoutes.ts`
   compares `clientTimestamp` against `updatedAt` and returns
   `{ status: "CONFLICT", serverUpdatedAt }` items. The mobile app marks those
   outbox rows as `CONFLICT` and surfaces them in the **Conflicts** screen,
   where the user picks "Keep mine" (LOCAL_WINS) or "Use server" (SERVER_WINS).
5. **Photo pipeline.** Photos are captured via `expo-image-picker`, kept on disk
   via `FileSystem`, and uploaded by the coordinator before the parent record
   is sent. Background photo uploads continue thanks to the iOS `fetch` /
   `processing` background modes declared in `app.config.ts`.

## Push notifications

`registerForPushAsync` requests permissions and obtains an Expo push token
which is sent to the existing `POST /api/ai-features/mobile/register` endpoint
and stored on `mobileDevices.pushToken`. The new
`server/services/nativePushService.ts` reads those tokens and pushes through
Expo's gateway (which fans out to APNs/FCM transparently). It is invoked from
the existing `notificationDelivery.deliverPush` so any event that already
fires a web push also reaches the native app — no new event wiring required.

Stale-token cleanup (`DeviceNotRegistered`) automatically nulls out the token
on the next send.

## Auth

Uses the same JWT cookie the web app issues (`auth_token`). The login screen
captures the `Set-Cookie` from `POST /api/auth/login` and stores the token in
`expo-secure-store`. Subsequent requests via the `api()` helper attach it as
the `Cookie` header — same `requireAuth` middleware on the server, no fork.

## Local development

```bash
cd mobile
npm install
EXPO_PUBLIC_API_BASE_URL=http://<your-laptop-ip>:5000 npx expo start
```

Open in the Expo Go app on a real device (the simulator works for most flows
but APNs push tokens require a physical device).

## Building & shipping

This step **must be run by a human with an Apple Developer account and a Google
Play console set up** — Replit cannot sign or upload builds itself.

```bash
# One-time
npm install -g eas-cli
eas login
eas build:configure    # provisioning, certs, keystore

# Builds
eas build -p ios --profile preview      # Internal TestFlight
eas build -p android --profile preview  # Internal Play track

# Submit
eas submit -p ios --profile production
eas submit -p android --profile production
```

CI is configured in `.github/workflows/mobile-eas-build.yml` — pushes to `main`
trigger preview builds for both platforms via `EXPO_TOKEN`.

## QA checklist (airplane-mode)

- [ ] Log in online, then enable airplane mode.
- [ ] Create a daily report with photo + voice note → appears immediately,
  status `pending`, sync bar shows `1 pending`.
- [ ] Clock in, walk around, clock out → both events queued, GPS captured.
- [ ] Create 3 punch items, mark one complete.
- [ ] Disable airplane mode → sync bar transitions
  `Offline → Syncing… → Up to date`. Server records appear in the web app.
- [ ] Edit the same daily report on the web while the phone is still offline,
  then reconnect → conflict screen shows the report with Keep/Use Server.
- [ ] Background the app for 20 minutes, then reopen → sync should already
  have happened.
- [ ] Trigger a notification on the web (e.g. an RFI assignment) → push lands
  on the device with the deep link.

## What is intentionally not in this repo

- **Compiled iOS/Android binaries.** Those are produced by EAS Build in the
  cloud; nothing to commit.
- **Signing keys / provisioning profiles / Play service account JSON.** All in
  `.gitignore`; managed via `eas credentials` and CI secrets.
- **Estimating, BIM, full procurement workflows** — these stay web-first per
  the task scope.

## Field pilot plan

1. Pick one customer with at least 2 active jobsites and 5 field users.
2. Distribute via TestFlight (iOS) and Play Internal (Android).
3. 2-week pilot: daily reports, time clock, photos. Collect Sentry crash
   reports + a weekly check-in.
4. Promote to public stores once crash-free sessions ≥ 99.5% and the customer
   confirms the offline workflow holds up on their worst-signal site.
