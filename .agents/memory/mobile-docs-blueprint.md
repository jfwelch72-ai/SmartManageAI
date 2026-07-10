---
name: Mobile docs blueprint conventions
description: How docs/mobile/ (native Expo/React Native app blueprint) relates to existing mobile-sync/mobile-auth docs and the legacy Feature-G spec.
---

`docs/mobile/` is a docs-only planning blueprint for a native mobile app —
no app code exists yet. When touching anything mobile-related, treat
`docs/architecture/mobile-sync.md` (offline conflict strategy, Lamport
clock, Time Clock Risk Audit) and `docs/api/mobile-auth.md` (OAuth
mobile-exchange, passkeys) as the **ground truth** for what's actually
shipped server-side; `docs/mobile/*` builds on top of them rather than
re-deriving their mechanics.

`docs/feature-G-mobile-offline.md` is a partially superseded legacy spec:
its original device-registration/sync endpoint shapes were never
implemented as designed (superseded by the shipped `mobile-sync.md`
design), and its trade-specific mobile tool configuration idea has never
shipped in any form. Don't treat Feature-G as authoritative — check
`mobile-sync.md` first.

**Why:** avoids re-litigating already-decided offline/sync/auth design
when writing or updating mobile-related documentation, and prevents
accidentally treating an unshipped legacy spec as current behavior.

**How to apply:** before writing or editing any mobile app doc, read
`mobile-sync.md` and `mobile-auth.md` first; cross-reference rather than
duplicate their content. Flag anything not yet implemented server-side
(e.g., push-token registration endpoint) explicitly as "proposed, not
shipped" rather than assuming it exists.
