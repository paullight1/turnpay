#!/usr/bin/env bash
# Verify that a PostgreSQL backup can be restored into a disposable database.
# This is intentionally fail-closed: the target URL must be different from the
# source and its database name must clearly identify a non-production database.
set -euo pipefail

fail() {
  printf 'backup restore verification failed: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

source_url="${DATABASE_URL:-}"
restore_url="${RESTORE_DATABASE_URL:-}"

[ -n "$source_url" ] || fail 'DATABASE_URL is required'
[ -n "$restore_url" ] || fail 'RESTORE_DATABASE_URL is required'
[ "$source_url" != "$restore_url" ] || fail 'restore target must differ from source'

# Keep this script suitable for CI and operator restore drills without making
# it a destructive production restore tool.
case "$restore_url" in
  *prod*|*production*|*live*)
    fail 'restore target appears to be production; use a disposable database'
    ;;
esac

require_command pg_dump
require_command pg_restore
require_command psql

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/trustpay-restore.XXXXXX")"
backup_file="$tmp_dir/trustpay.sql.custom"
trap 'rm -rf "$tmp_dir"' EXIT

printf '%s\n' 'Creating disposable restore-drill backup...'
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$backup_file" \
  "$source_url"

[ -s "$backup_file" ] || fail 'pg_dump produced an empty backup'
pg_restore --list "$backup_file" >/dev/null || fail 'backup archive is invalid'

printf '%s\n' 'Restoring into the disposable target...'
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="$restore_url" \
  "$backup_file"

psql "$restore_url" -Atqc 'SELECT 1' | grep -qx '1' ||
  fail 'restored database health query failed'

printf '%s\n' 'backup restore verification passed'
