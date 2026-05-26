# SmartManageAI Field — Standalone Mobile App

Standalone Replit project for the SmartManageAI Field native mobile app
(iOS + Android, built with Expo + React Native). This is the same app that
previously lived under `mobile/` in the main SmartManageAI monorepo, lifted
out into its own project so it can grow its own dependencies, workflows, and
contributors without bloating the web app.

The mobile app talks to the **existing** SmartManageAI backend over HTTPS.
No backend code lives here.

## Quick start

```bash
npm install
npx expo start --tunnel
```

Then open the **Expo Go** app on a physical phone and scan the QR code. The
`--tunnel` flag means your phone does not need to be on the same Wi-Fi as
this machine, so it works from any network.

In Replit, the **Start mobile** workflow runs the same command for you.

## Where the app points

The mobile app reads `EXPO_PUBLIC_API_BASE_URL` from the environment at
build time (or falls back to the default baked into `app.config.ts`). The
default in this project points to the main SmartManageAI dev Replit so the
app works against a live backend out of the box.

To override it (for staging, production, or a different dev backend):

```bash
EXPO_PUBLIC_API_BASE_URL="https://app.smartmanageai.com" npx expo start --tunnel
```

For TestFlight / Play Internal builds, the URL is pinned per profile in
`eas.json` (`preview` → staging, `production` → production).

## Syncing shared types from the main repo

Schema types live in `shared/` here, as a **plain copy** of the matching
files from the main SmartManageAI repo. Today the mobile source tree has no
runtime `@shared/*` imports, so the folder only contains a README — but the
path alias is wired up so adding one is a one-step affair.

When you add a new `import … from "@shared/…"` in `src/`:

1. Locate the file in the main repo under its `shared/…` path.
2. Copy it (plus everything it transitively imports) into the matching
   location under this project's `shared/` folder.
3. Run `npx tsc --noEmit` to confirm the types resolve.
4. Commit the copied files and note the source commit SHA so future-you can
   tell how stale the copy is.

The full recipe lives in `shared/README.md`.

## Project layout

```
mobile-standalone/
  App.tsx                  # Root: providers + auth gate
  app.config.ts            # Expo config (iOS/Android entitlements, plugins)
  eas.json                 # EAS Build + Submit profiles
  index.ts                 # registerRootComponent
  package.json
  tsconfig.json            # @/* -> src/*, @shared/* -> shared/*
  assets/                  # icon, splash, adaptive icon
  shared/                  # copied schema types from the main repo
  src/
    api/                   # fetch wrapper + Expo extra reader
    auth/                  # AuthContext (JWT cookie via SecureStore)
    sync/                  # SQLite cache + outbox + sync coordinator
    push/                  # Expo push token registration
    navigation/            # Root navigator
    screens/               # Login, Home, DailyReports, TimeClock, …
    components/            # SyncStatusBar
    theme/                 # Design tokens
```

## Building & shipping (TestFlight / Play Internal)

This step must be run by a human with an Apple Developer account and a Play
Console — Replit cannot sign or upload builds itself.

```bash
npm install -g eas-cli
eas login
eas build:configure                       # one-time

eas build -p ios --profile preview        # internal TestFlight
eas build -p android --profile preview    # internal Play track

eas submit -p ios --profile production
eas submit -p android --profile production
```

## Back to the main repo

Backend changes (auth, sync endpoints, push fan-out, etc.) live in the
**main SmartManageAI repo**, not here. Anything that requires a server
change needs a PR over there; this project only consumes the API.
