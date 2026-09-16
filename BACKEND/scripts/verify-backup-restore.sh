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

postgres_client_url() {
  # Prisma accepts a `schema` query parameter, but libpq tools such as
  # pg_dump, pg_restore, and psql reject it. Remove only that Prisma-specific
  # parameter while preserving TLS and other libpq parameters.
  printf '%s' "$1" |
    sed -E 's/([?&])schema=[^&]*&/\1/; s/[?&]schema=[^&]*$//'
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

source_postgres_url="$(postgres_client_url "$source_url")"
restore_postgres_url="$(postgres_client_url "$restore_url")"

require_command pg_dump
require_command pg_restore
require_command psql

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/trustpay-restore.XXXXXX")"
backup_file="$tmp_dir/trustpay.sql.custom"
source_evidence="$tmp_dir/source-financial-evidence.txt"
restore_evidence="$tmp_dir/restore-financial-evidence.txt"
trap 'rm -rf "$tmp_dir"' EXIT

financial_evidence() {
  database_url="$1"

  # Keep this evidence query deterministic and free of customer identifiers.
  # Counts and Decimal aggregates prove that the restore contains the same
  # wallet, transaction, ledger, audit, provider, and VTU evidence as the
  # source. The CI caller seeds a synthetic row set before this script runs.
  psql "$database_url" -Atq <<'SQL' | LC_ALL=C sort
SELECT 'users.count=' || COUNT(*)::text FROM users
UNION ALL SELECT 'wallets.count=' || COUNT(*)::text FROM wallets
UNION ALL SELECT 'wallets.balance=' || COALESCE(SUM(balance), 0)::text FROM wallets
UNION ALL SELECT 'transactions.count=' || COUNT(*)::text FROM transactions
UNION ALL SELECT 'transactions.amount=' || COALESCE(SUM(amount), 0)::text FROM transactions
UNION ALL SELECT 'ledger_entries.count=' || COUNT(*)::text FROM ledger_entries
UNION ALL SELECT 'ledger_entries.amount=' || COALESCE(SUM(amount), 0)::text FROM ledger_entries
UNION ALL SELECT 'ledger_entries.net=' || COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0)::text FROM ledger_entries
UNION ALL SELECT 'audit_logs.count=' || COUNT(*)::text FROM audit_logs
UNION ALL SELECT 'provider_events.count=' || COUNT(*)::text FROM provider_events
UNION ALL SELECT 'payment_webhook_inbox.count=' || COUNT(*)::text FROM payment_webhook_inbox
UNION ALL SELECT 'vtu_orders.count=' || COUNT(*)::text FROM vtu_orders
ORDER BY 1
SQL
}

printf '%s\n' 'Creating disposable restore-drill backup...'
financial_evidence "$source_postgres_url" >"$source_evidence" ||
  fail 'source financial evidence query failed'

pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$backup_file" \
  "$source_postgres_url"

[ -s "$backup_file" ] || fail 'pg_dump produced an empty backup'
pg_restore --list "$backup_file" >/dev/null || fail 'backup archive is invalid'

printf '%s\n' 'Restoring into the disposable target...'
pg_restore \
  --exit-on-error \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="$restore_postgres_url" \
  "$backup_file"

psql "$restore_postgres_url" -Atqc 'SELECT 1' | grep -qx '1' ||
  fail 'restored database health query failed'

financial_evidence "$restore_postgres_url" >"$restore_evidence" ||
  fail 'restored financial evidence query failed'

if ! diff -u "$source_evidence" "$restore_evidence" >/dev/null; then
  fail 'restored financial table counts, wallet balances, or ledger evidence differ from source'
fi

printf '%s\n' 'backup restore verification passed (financial evidence matched)'
