#!/usr/bin/env bash
# =============================================================================
# TRUSTPAY — encrypted PostgreSQL backup
# =============================================================================
# Creates a private, encrypted PostgreSQL custom-format archive. The backup
# destination must be a durable private volume or an encrypted filesystem; the
# default is deliberately outside /tmp. The passphrase is read from a file so
# it never appears in the process list or shell history.
#
# Required environment:
#   DATABASE_URL=postgresql://...?sslmode=require&schema=public
#   BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/trustpay-backup-key
#
# Optional environment:
#   BACKUP_DIR=/var/backups/trustpay
#   RETENTION_DAYS=30 (must be at least 30)
#   PG_DUMP_BIN=pg_dump, PG_RESTORE_BIN=pg_restore, GPG_BIN=gpg
#
# Usage:
#   DATABASE_URL="postgresql://...?...sslmode=require" \
#   BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/trustpay-backup-key \
#   ./BACKEND/scripts/backup-db.sh
# =============================================================================
set -euo pipefail
umask 077

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

fail() {
  printf '%s\n' "${RED}backup failed: $1${NC}" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

database_url="${DATABASE_URL:-}"
key_file="${BACKUP_ENCRYPTION_KEY_FILE:-}"
backup_dir="${BACKUP_DIR:-/var/backups/trustpay}"
retention_days="${RETENTION_DAYS:-30}"
pg_dump_bin="${PG_DUMP_BIN:-pg_dump}"
pg_restore_bin="${PG_RESTORE_BIN:-pg_restore}"
gpg_bin="${GPG_BIN:-gpg}"
allow_ephemeral_storage="${BACKUP_ALLOW_EPHEMERAL_STORAGE:-false}"

[ -n "$database_url" ] || fail 'DATABASE_URL is required'
[ -n "$key_file" ] || fail 'BACKUP_ENCRYPTION_KEY_FILE is required'
[ -r "$key_file" ] || fail 'BACKUP_ENCRYPTION_KEY_FILE is missing or unreadable'
[ -f "$key_file" ] || fail 'BACKUP_ENCRYPTION_KEY_FILE must be a regular file'

case "$retention_days" in
  ''|*[!0-9]*) fail 'RETENTION_DAYS must contain digits only' ;;
esac
[ "$retention_days" -ge 30 ] ||
  fail 'RETENTION_DAYS must be at least 30 days'

# A temporary directory cannot provide the durable recovery point required by
# the security policy. Synthetic tests may opt into a fixture directory with
# BACKUP_ALLOW_EPHEMERAL_STORAGE=true; production never sets that variable.
if [ "$allow_ephemeral_storage" = 'true' ]; then
  [ "${NODE_ENV:-}" != 'production' ] ||
    fail 'BACKUP_ALLOW_EPHEMERAL_STORAGE is forbidden in production'
  [ "${NODE_ENV:-}" = 'test' ] || [ "${BACKUP_TEST_MODE:-false}" = 'true' ] ||
    fail 'BACKUP_ALLOW_EPHEMERAL_STORAGE is reserved for synthetic tests'
else
  case "$backup_dir" in
    /tmp|/tmp/*|/var/tmp|/var/tmp/*)
      fail 'BACKUP_DIR must be durable; /tmp and /var/tmp are not allowed'
      ;;
  esac
fi

require_command "$pg_dump_bin"
require_command "$pg_restore_bin"
require_command "$gpg_bin"
require_command node

mkdir -p "$backup_dir"
[ -d "$backup_dir" ] || fail 'BACKUP_DIR is not a directory'
chmod 700 "$backup_dir"

timestamp=$(date -u +'%Y-%m-%dT%H-%M-%SZ')
backup_file="${backup_dir}/trustpay_db_${timestamp}.sql.custom.gpg"
partial_file="${backup_file}.part"
pg_service_file="$(mktemp "${TMPDIR:-/tmp}/trustpay-pg-service.XXXXXX")"
pg_pass_file="$(mktemp "${TMPDIR:-/tmp}/trustpay-pg-pass.XXXXXX")"
chmod 600 "$pg_service_file" "$pg_pass_file"

cleanup() {
  rm -f -- "$partial_file"
  rm -f -- "$pg_service_file" "$pg_pass_file"
  unset PGSERVICE PGSERVICEFILE PGPASSFILE TRUSTPAY_DATABASE_URL
}
trap cleanup EXIT HUP INT TERM

# Keep the password out of pg_dump's argv. The URL is already supplied as an
# environment variable by the operator; this short parser writes a private
# libpq service plus a private passfile, preserving TLS and supported URI
# parameters while removing Prisma's schema hint.
export TRUSTPAY_DATABASE_URL="$database_url"
export TRUSTPAY_PG_SERVICE_FILE="$pg_service_file"
export TRUSTPAY_PG_PASS_FILE="$pg_pass_file"
node <<'NODE'
const fs = require('node:fs');

const raw = process.env.TRUSTPAY_DATABASE_URL || '';
const servicePath = process.env.TRUSTPAY_PG_SERVICE_FILE;
const passPath = process.env.TRUSTPAY_PG_PASS_FILE;
let url;
try {
  url = new URL(raw);
} catch {
  throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
}
if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
  throw new Error('DATABASE_URL must use the PostgreSQL scheme');
}

const sslModes = url.searchParams.getAll('sslmode');
if (
  sslModes.length !== 1 ||
  !['require', 'verify-ca', 'verify-full'].includes(sslModes[0])
) {
  throw new Error(
    'DATABASE_URL must contain exactly one sslmode=require, verify-ca, or verify-full',
  );
}

const decode = (value) => decodeURIComponent(value);
const database = decode(url.pathname.replace(/^\//, ''));
const user = decode(url.username);
const password = decode(url.password);
if (!database || !user || /[\r\n]/.test(password)) {
  throw new Error('DATABASE_URL is missing a valid database credential');
}

// These are libpq connection options supported in a service definition. Keep
// all connection controls that are meaningful to pg_dump and drop only the
// Prisma-only schema parameter.
const supportedOptions = new Set([
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslcrl',
  'ssl_min_protocol_version',
  'ssl_max_protocol_version',
  'connect_timeout',
  'application_name',
  'target_session_attrs',
  'gssencmode',
  'channel_binding',
]);
const options = new Map();
for (const [key, value] of url.searchParams.entries()) {
  if (key === 'schema') continue;
  if (supportedOptions.has(key)) {
    if (options.has(key)) throw new Error(`DATABASE_URL contains duplicate ${key}`);
    options.set(key, value);
  }
}

const serviceLines = [
  '[trustpay-backup]',
  `host=${url.hostname}`,
  `port=${url.port || '5432'}`,
  `user=${user}`,
  `dbname=${database}`,
  `passfile=${passPath}`,
  ...[...options.entries()].map(([key, value]) => `${key}=${value}`),
  '',
];
fs.writeFileSync(servicePath, serviceLines.join('\n'), { mode: 0o600 });

// A wildcard host/port entry is safe here because the passfile is mode 0600,
// temporary, and removed by the EXIT trap. Escape the two delimiters defined
// by the .pgpass format.
const escapedPassword = password.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
fs.writeFileSync(passPath, `*:*:${database}:${user}:${escapedPassword}\n`, {
  mode: 0o600,
});
NODE

export PGSERVICE='trustpay-backup'
export PGSERVICEFILE="$pg_service_file"
export PGPASSFILE="$pg_pass_file"

printf '%s\n' "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
printf '%s\n' "${YELLOW}  TRUSTPAY — Encrypted Database Backup${NC}"
printf '%s\n' "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
printf '\n'
printf '  Timestamp: %s\n' "$timestamp"
printf '  Output:    %s\n' "$backup_file"
printf '  Retention: %s days\n' "$retention_days"
printf '\n'

printf '%s\n' "${YELLOW}Running pg_dump over the TLS connection...${NC}"

# Keep the custom archive encrypted from the first byte written. No plaintext
# dump is ever stored on disk.
if "$pg_dump_bin" \
  --no-owner \
  --no-acl \
  --format=custom \
  --compress=9 |
  "$gpg_bin" \
    --batch \
    --yes \
    --pinentry-mode loopback \
    --symmetric \
    --cipher-algo AES256 \
    --passphrase-file "$key_file" \
    --output "$partial_file"; then
  :
else
  fail 'pg_dump or archive encryption failed'
fi

[ -s "$partial_file" ] || fail 'encrypted backup is empty'
mv -- "$partial_file" "$backup_file"
chmod 600 "$backup_file"

printf '%s\n' "${YELLOW}Verifying encrypted archive...${NC}"
if "$gpg_bin" \
  --batch \
  --yes \
  --pinentry-mode loopback \
  --passphrase-file "$key_file" \
  --decrypt "$backup_file" 2>/dev/null |
  "$pg_restore_bin" --list - >/dev/null; then
  printf '%s\n' "${GREEN}✓ Encrypted backup verified (pg_restore list succeeded)${NC}"
else
  fail 'encrypted backup verification failed'
fi

printf '%s\n' "${YELLOW}Cleaning up backups older than ${retention_days} days...${NC}"
deleted_count=$(find "$backup_dir" -type f \
  -name 'trustpay_db_*.sql.custom.gpg' \
  -mtime "+$retention_days" \
  -print -delete | wc -l | tr -d ' ')
printf '  Deleted: %s old backup(s)\n' "$deleted_count"

backup_size=$(wc -c <"$backup_file" | tr -d ' ')
total_backups=$(find "$backup_dir" -type f -name 'trustpay_db_*.sql.custom.gpg' | wc -l | tr -d ' ')
printf '\n'
printf '%s\n' "${GREEN}✓ Backup completed successfully${NC}"
printf '  File:          %s\n' "$backup_file"
printf '  Size:          %s bytes\n' "$backup_size"
printf '  Total backups: %s\n' "$total_backups"

printf '%s\n' "${YELLOW}To restore this encrypted backup into a disposable database:${NC}"
printf '%s\n' '  gpg --batch --pinentry-mode loopback --passphrase-file "$BACKUP_ENCRYPTION_KEY_FILE" --decrypt "$backup_file" | pg_restore --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" -'
