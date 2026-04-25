#!/usr/bin/env bash
# Task #1826 — Make Playwright's bundled Firefox launchable inside the
# Replit dev container so cross-engine specs (e.g.
# e2e/takeoff-markup-undo.spec.ts) can be exercised locally without
# pushing to CI.
#
# Why this script exists
# ----------------------
# Unlike WebKit, Playwright's Firefox doesn't need any patching on
# Replit — every system library it depends on at runtime
# (`libgtk-3.so.0`, `libxcb-shm.so.0`, `libgstreamer-1.0.so.0`, …) is
# pinned in `replit.nix` and exposed via `$REPLIT_LD_LIBRARY_PATH`. The
# only friction is that `npx playwright install firefox` runs a
# post-install host-requirements check (`validateDependenciesLinux`)
# that uses `ldd` against the binary with the *default* search path
# (`/usr/lib/x86_64-linux-gnu`), which doesn't exist in this container.
# That check fails with a misleading "Host system is missing
# dependencies" error even though the libs are reachable at runtime via
# the nix-store paths in `$REPLIT_LD_LIBRARY_PATH`.
#
# We sidestep the validator with `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`
# (which `playwright.config.ts` already sets at test time when
# `$REPLIT_LD_LIBRARY_PATH` is present, see Task #1866). On CI (Ubuntu)
# the libs live under `/usr/lib/x86_64-linux-gnu` so the validator
# passes there without the env override.
#
# This script is idempotent: if a `firefox-NNNN/` directory already
# exists under the cache root it exits immediately. Re-run it after a
# Playwright version bump to fetch the new revision.
set -euo pipefail

# Mirror Playwright's own browsers-path resolution
# (node_modules/playwright-core/lib/server/registry/index.js):
#   $PLAYWRIGHT_BROWSERS_PATH wins, else $XDG_CACHE_HOME/ms-playwright,
#   else $HOME/.cache/ms-playwright. On Replit, XDG_CACHE_HOME is set to
#   /home/runner/workspace/.cache so caches live with the workspace.
if [[ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
  cache_root="$PLAYWRIGHT_BROWSERS_PATH"
elif [[ -n "${XDG_CACHE_HOME:-}" ]]; then
  cache_root="$XDG_CACHE_HOME/ms-playwright"
else
  cache_root="$HOME/.cache/ms-playwright"
fi

firefox_dir="$(find "$cache_root" -maxdepth 1 -type d -name 'firefox-*' 2>/dev/null | sort -r | head -n 1 || true)"

# Determine the Firefox revision Playwright currently expects so we
# re-install when @playwright/test is bumped to a version that needs a
# newer firefox-NNNN.
expected_rev=""
if command -v node >/dev/null 2>&1; then
  expected_rev="$(node -e "
    try {
      const fs = require('fs');
      const path = require('path');
      const pkg = require.resolve('playwright-core/package.json');
      const j = JSON.parse(fs.readFileSync(path.join(path.dirname(pkg), 'browsers.json'), 'utf8'));
      const b = (j.browsers || []).find(x => x.name === 'firefox');
      if (b && b.revision) process.stdout.write(String(b.revision));
    } catch {}
  " 2>/dev/null || true)"
fi

if [[ -n "$firefox_dir" && -n "$expected_rev" ]]; then
  installed_rev="${firefox_dir##*-}"
  if [[ "$installed_rev" != "$expected_rev" ]]; then
    echo "[setup-playwright-firefox] Installed firefox-$installed_rev does not match expected firefox-$expected_rev — re-fetching."
    firefox_dir=""
  fi
fi

if [[ -z "$firefox_dir" ]]; then
  echo "[setup-playwright-firefox] Fetching Firefox via 'npx playwright install firefox' …"
  PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 npx --yes playwright install firefox
  firefox_dir="$(find "$cache_root" -maxdepth 1 -type d -name 'firefox-*' 2>/dev/null | sort -r | head -n 1)"
fi

if [[ -z "$firefox_dir" || ! -d "$firefox_dir" ]]; then
  echo "[setup-playwright-firefox] ERROR: could not locate a firefox-* directory under $cache_root" >&2
  exit 1
fi

echo "[setup-playwright-firefox] Ready: $firefox_dir"
