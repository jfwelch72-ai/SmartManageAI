#!/usr/bin/env bash
#
# CI Security Gate
#
# Runs the security checks required by the SDLC and Change Management
# policies on every pull request. Blocks merge on any Critical or High
# finding.
#
#   1. Dependency audit  (npm audit)
#   2. SAST              (semgrep, OWASP top-10 ruleset)
#   3. Secret scan       (gitleaks)
#   4. IaC scan          (checkov, optional, runs only if IaC files exist)
#   5. License audit     (license-checker-rseidelsohn, blocks GPL family
#                         in production dependencies)
#
# This script is the auditor-facing evidence for SOC 2 controls CC5.8 and
# CC7.1. See docs/compliance/CONTROLS_MATRIX.md and
# docs/compliance/policies/09-sdlc-policy.md.
#
# Exit status:
#   0  all gates passed
#   1  one or more gates failed at the configured severity threshold
#   2  a gate could not be run (tooling missing in CI)

set -u
set -o pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Optional gate selection.
#
# By default the script runs every gate (dependency audit, SAST, secret
# scan, IaC scan, license audit). Pass `--only <gate>` (or set
# CI_SECURITY_ONLY=<gate>) to run a single gate. This is used by the
# nightly license-audit workflow (`.github/workflows/license-audit-nightly.yml`)
# to re-run just the license check against `main`, so transitive
# dependency updates that change a package's license between PRs are
# caught on a schedule rather than waiting for the next PR. The
# nightly dependency-audit workflow
# (`.github/workflows/dependency-audit-nightly.yml`) uses the same
# mechanism with `--only deps` so newly disclosed npm advisories are
# caught on `main` between PRs.
#
# Supported values: deps | sast | secrets | iac | license | all
ONLY="${CI_SECURITY_ONLY:-all}"
while [ $# -gt 0 ]; do
  case "$1" in
    --only)
      ONLY="${2:-}"
      shift 2
      ;;
    --only=*)
      ONLY="${1#*=}"
      shift
      ;;
    *)
      printf "unknown argument: %s\n" "$1" >&2
      exit 2
      ;;
  esac
done

case "$ONLY" in
  deps|sast|secrets|iac|license|all) ;;
  *)
    printf "invalid --only value: %s (expected: deps|sast|secrets|iac|license|all)\n" "$ONLY" >&2
    # Fail closed: an unrecognized selector must not silently skip every
    # gate and exit 0.
    exit 2
    ;;
esac

run_gate() {
  # $1 = gate name; returns 0 if the gate should run.
  [ "$ONLY" = "all" ] || [ "$ONLY" = "$1" ]
}

PASS=0
FAIL=0
SKIP=0

color()   { printf "\033[%sm%s\033[0m" "$1" "$2"; }
heading() { printf "\n%s %s\n" "$(color '1;36' '==>')" "$1"; }
ok()      { printf "  %s %s\n" "$(color '1;32' 'OK   ')"   "$1"; PASS=$((PASS+1)); }
fail()    { printf "  %s %s\n" "$(color '1;31' 'FAIL ')"   "$1"; FAIL=$((FAIL+1)); }
skip()    { printf "  %s %s\n" "$(color '1;33' 'SKIP ')"   "$1"; SKIP=$((SKIP+1)); }

# ---------- 1. Dependency audit ----------
if run_gate deps; then
heading "Dependency audit (npm audit, threshold=high)"
if command -v npm >/dev/null 2>&1; then
  if npm audit --audit-level=high --omit=dev; then
    ok "no high or critical vulnerabilities in production dependencies"
  else
    fail "high/critical vulnerabilities found in production dependencies"
  fi
else
  skip "npm not available in this environment"
fi
fi

# ---------- 2. SAST ----------
if run_gate sast; then
heading "Static analysis (semgrep p/owasp-top-ten + p/javascript)"
if command -v semgrep >/dev/null 2>&1; then
  if semgrep --error \
       --severity ERROR \
       --config p/owasp-top-ten \
       --config p/javascript \
       --metrics=off \
       --quiet \
       .; then
    ok "no ERROR-level SAST findings"
  else
    fail "ERROR-level SAST findings"
  fi
else
  skip "semgrep not available; install in CI image"
fi
fi

# ---------- 3. Secret scan ----------
if run_gate secrets; then
heading "Secret scan (gitleaks)"
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks detect --no-banner --redact --exit-code 1; then
    ok "no secrets detected in working tree"
  else
    fail "secrets detected — rotate immediately and remove from history"
  fi
else
  skip "gitleaks not available; install in CI image"
fi
fi

# ---------- 4. IaC scan (optional) ----------
if run_gate iac; then
heading "Infrastructure-as-code scan (checkov)"
if find . -type f \
     \( -name '*.tf' -o -name 'Dockerfile*' -o -name 'kustomization.yaml' \) \
     -not -path './node_modules/*' -not -path './dist/*' \
     | grep -q .; then
  if command -v checkov >/dev/null 2>&1; then
    if checkov -d . --quiet --compact --framework all; then
      ok "no IaC findings at default severity"
    else
      fail "IaC misconfigurations detected"
    fi
  else
    skip "checkov not available; install in CI image"
  fi
else
  skip "no IaC files found in repository"
fi
fi

# ---------- 5. License audit ----------
if run_gate license; then
heading "License audit (production deps, blocks GPL/AGPL/LGPL)"
ALLOWLIST_FILE="$ROOT/.license-allowlist.txt"
if command -v npx >/dev/null 2>&1; then
  ALLOWLIST_PACKAGES=""
  if [ -f "$ALLOWLIST_FILE" ]; then
    ALLOWLIST_PACKAGES=$(grep -v '^[[:space:]]*#' "$ALLOWLIST_FILE" \
      | grep -v '^[[:space:]]*$' \
      | tr '\n' ';' \
      | sed 's/;$//')
  fi

  LC_ARGS=(--yes license-checker-rseidelsohn@4 --production --json)
  if [ -n "$ALLOWLIST_PACKAGES" ]; then
    LC_ARGS+=(--excludePackages "$ALLOWLIST_PACKAGES")
  fi

  # Capture both stdout and stderr so we can show why the tool failed.
  LICENSE_OUT=$(npx "${LC_ARGS[@]}" 2>&1)
  LC_TOOL_STATUS=$?
  if [ "$LC_TOOL_STATUS" -ne 0 ] || [ -z "$LICENSE_OUT" ]; then
    printf "%s\n" "$LICENSE_OUT" | tail -n 20
    fail "license-checker-rseidelsohn failed to run (exit $LC_TOOL_STATUS) — gate is fail-closed"
  else
    VIOLATIONS=$(printf '%s' "$LICENSE_OUT" | node -e '
      let buf = "";
      process.stdin.on("data", c => buf += c);
      process.stdin.on("end", () => {
        let data;
        try { data = JSON.parse(buf); } catch (e) {
          console.error("license-checker output was not valid JSON");
          process.exit(2);
        }
        if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
          console.error("license-checker returned no packages");
          process.exit(2);
        }
        // Match GPL, AGPL, LGPL and their -only / -or-later / version
        // suffixes. Negative-look style done manually so we do not also
        // match unrelated tokens that happen to contain "GPL".
        const re = /\b(?:A|L)?GPL(?:-[0-9.]+)?(?:-only|-or-later|\+)?\b/i;
        const violations = [];
        for (const [pkg, info] of Object.entries(data)) {
          const lic = Array.isArray(info.licenses)
            ? info.licenses.join(" ")
            : String(info.licenses || "");
          if (re.test(lic)) {
            violations.push(pkg + "  =>  " + lic);
          }
        }
        if (violations.length) {
          for (const v of violations) console.log(v);
          process.exit(1);
        }
      });
    ' 2>&1)
    LC_STATUS=$?
    if [ "$LC_STATUS" -eq 0 ]; then
      ok "no GPL-family licenses in production dependencies"
    elif [ "$LC_STATUS" -eq 2 ]; then
      printf "%s\n" "$VIOLATIONS"
      fail "could not parse license-checker output — gate is fail-closed"
    else
      printf "%s\n" "$VIOLATIONS"
      printf "  %s\n" "see .license-allowlist.txt to exempt a specific package after legal/CTO review"
      fail "GPL-family licenses found in production dependencies"
    fi
  fi
else
  fail "npx not available; cannot run license audit — gate is fail-closed"
fi
fi

# ---------- Summary ----------
printf "\n%s\n" "$(color '1' 'Summary')"
printf "  passed:  %d\n" "$PASS"
printf "  failed:  %d\n" "$FAIL"
printf "  skipped: %d\n" "$SKIP"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
if [ "$PASS" -eq 0 ] && [ "$SKIP" -gt 0 ]; then
  printf "\nAll gates were skipped — install the security tools in the CI image.\n"
  exit 2
fi
exit 0
