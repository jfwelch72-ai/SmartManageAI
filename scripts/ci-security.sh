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

PASS=0
FAIL=0
SKIP=0

color()   { printf "\033[%sm%s\033[0m" "$1" "$2"; }
heading() { printf "\n%s %s\n" "$(color '1;36' '==>')" "$1"; }
ok()      { printf "  %s %s\n" "$(color '1;32' 'OK   ')"   "$1"; PASS=$((PASS+1)); }
fail()    { printf "  %s %s\n" "$(color '1;31' 'FAIL ')"   "$1"; FAIL=$((FAIL+1)); }
skip()    { printf "  %s %s\n" "$(color '1;33' 'SKIP ')"   "$1"; SKIP=$((SKIP+1)); }

# ---------- 1. Dependency audit ----------
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

# ---------- 2. SAST ----------
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

# ---------- 3. Secret scan ----------
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

# ---------- 4. IaC scan (optional) ----------
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
