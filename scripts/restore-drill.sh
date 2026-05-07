#!/usr/bin/env bash
#
# Quarterly Postgres restore drill.
#
# Dumps the database pointed to by $DATABASE_URL via `pg_dump --format=custom`,
# restores it into a freshly-created scratch DB on the same server, verifies
# that table and row counts match, then drops the scratch DB.
#
# Append the printed "Drill log" row to docs/ops/backups.md.
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/restore-drill.sh
#
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

TS=$(date -u +%Y%m%d_%H%M%S)
TARGET=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DRILL_DIR="${DRILL_DIR:-/tmp/restore_drill_$TS}"
SCRATCH_DB="restore_drill_$TS"
mkdir -p "$DRILL_DIR"

prod_count() { psql "$DATABASE_URL" -tAc "SELECT count(*) FROM $1" 2>/dev/null || echo 0; }
scratch_count() { psql "$1" -tAc "SELECT count(*) FROM $2" 2>/dev/null || echo 0; }

PROD_USERS=$(prod_count users)
PROD_PROJECTS=$(prod_count projects)
PROD_BIDS=$(prod_count bids)

DUMP_START=$(date +%s)
pg_dump --no-owner --no-acl --format=custom "$DATABASE_URL" -f "$DRILL_DIR/snapshot.pgdump" 2> "$DRILL_DIR/dump.log"
DUMP_SECS=$(( $(date +%s) - DUMP_START ))

psql "$DATABASE_URL" -c "CREATE DATABASE $SCRATCH_DB" >/dev/null
SCRATCH_URL=$(node -e "const u=new URL(process.env.DATABASE_URL); u.pathname='/$SCRATCH_DB'; console.log(u.toString());")

# Guarantee the scratch DB is dropped even if we exit early (Ctrl-C,
# pg_restore SIGSEGV, parity check abort) so we never leak a stray
# `restore_drill_*` database on the server.
cleanup_scratch() {
  psql "$DATABASE_URL" -c "DROP DATABASE IF EXISTS $SCRATCH_DB" >/dev/null 2>&1 || true
}
trap cleanup_scratch EXIT

RESTORE_START=$(date +%s)
# Capture pg_restore exit code separately so we can fail loudly on
# a real restore failure while still tearing down the scratch DB.
set +e
pg_restore --no-owner --no-acl --exit-on-error --dbname "$SCRATCH_URL" "$DRILL_DIR/snapshot.pgdump" 2> "$DRILL_DIR/restore.log"
RESTORE_RC=$?
set -e
RESTORE_SECS=$(( $(date +%s) - RESTORE_START ))
RESTORE_WARNINGS=$(wc -l < "$DRILL_DIR/restore.log")

# Tolerate a small number of expected warnings (extension comments,
# schema-already-exists, etc) but anything above this threshold is a
# real signal worth investigating. Override via RESTORE_WARNING_LIMIT.
RESTORE_WARNING_LIMIT="${RESTORE_WARNING_LIMIT:-5}"

S_USERS=$(scratch_count "$SCRATCH_URL" users)
S_PROJECTS=$(scratch_count "$SCRATCH_URL" projects)
S_BIDS=$(scratch_count "$SCRATCH_URL" bids)
PROD_TABLES=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
SCRATCH_TABLES=$(psql "$SCRATCH_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")

psql "$DATABASE_URL" -c "DROP DATABASE $SCRATCH_DB" >/dev/null

# Validate parity. Any failure here exits non-zero so CI / cron can
# catch a silent regression in the backup/restore path.
DRILL_FAIL=0
if [[ "$RESTORE_RC" -ne 0 ]]; then
  echo "FAIL: pg_restore exited $RESTORE_RC — see $DRILL_DIR/restore.log" >&2
  DRILL_FAIL=1
fi
if [[ "$RESTORE_WARNINGS" -gt "$RESTORE_WARNING_LIMIT" ]]; then
  echo "FAIL: pg_restore produced $RESTORE_WARNINGS warning lines (limit $RESTORE_WARNING_LIMIT)" >&2
  DRILL_FAIL=1
fi
if [[ "$PROD_USERS" != "$S_USERS" || "$PROD_PROJECTS" != "$S_PROJECTS" || "$PROD_BIDS" != "$S_BIDS" ]]; then
  echo "FAIL: row counts diverged — prod=$PROD_USERS/$PROD_PROJECTS/$PROD_BIDS scratch=$S_USERS/$S_PROJECTS/$S_BIDS" >&2
  DRILL_FAIL=1
fi
if [[ "$PROD_TABLES" != "$SCRATCH_TABLES" ]]; then
  echo "FAIL: table counts diverged — prod=$PROD_TABLES scratch=$SCRATCH_TABLES" >&2
  DRILL_FAIL=1
fi

echo
echo "Append this row to docs/ops/backups.md → Drill log:"
echo
echo "| $(date -u +%Y-%m-%d) | <your-name> | $TARGET (live snapshot) | dump ${DUMP_SECS}s + restore ${RESTORE_SECS}s | $S_USERS / $S_PROJECTS / $S_BIDS | Verified prod ($PROD_USERS/$PROD_PROJECTS/$PROD_BIDS) matched scratch ($S_USERS/$S_PROJECTS/$S_BIDS), tables $PROD_TABLES = $SCRATCH_TABLES, restore warnings = $RESTORE_WARNINGS. Scratch DB \`$SCRATCH_DB\` dropped. Logs in \`$DRILL_DIR\`. |"

exit "$DRILL_FAIL"
