#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
script="$repo_root/BACKEND/scripts/backup-db.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/trustpay-backup-script.XXXXXX")
bin_dir="$test_root/bin"
backup_dir="$test_root/backups"
capture_dir="$test_root/capture"
key_file="$test_root/backup-key"
mkdir -p "$bin_dir" "$backup_dir" "$capture_dir"
printf '%s\n' 'synthetic-backup-passphrase' >"$key_file"
chmod 600 "$key_file"

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf '%s\n' "backup script test failed: $1" >&2
  exit 1
}

write_command() {
  name="$1"
  body="$2"
  printf '%s\n' '#!/bin/sh' "$body" >"$bin_dir/$name"
  chmod 700 "$bin_dir/$name"
}

write_command pg_dump 'printf "%s\\n" "$@" >"$CAPTURE_DIR/pg_dump.args"; cp "$PGSERVICEFILE" "$CAPTURE_DIR/service.conf"; cp "$PGPASSFILE" "$CAPTURE_DIR/passfile"; printf "%s\\n" synthetic-custom-archive'
write_command gpg 'output=""; decrypt_file=""; capture_next=""; for argument in "$@"; do if [ "$capture_next" = output ]; then output="$argument"; capture_next=""; elif [ "$capture_next" = decrypt ]; then decrypt_file="$argument"; capture_next=""; else case "$argument" in --output) capture_next=output ;; --decrypt) capture_next=decrypt ;; esac; fi; done; if [ -n "$decrypt_file" ]; then cat "$decrypt_file"; else cat >"$output"; fi'
write_command pg_restore 'printf "%s\\n" "$@" >"$CAPTURE_DIR/pg_restore.args"; for arg in "$@"; do [ "$arg" != "-" ] || exit 1; done; cat >/dev/null'

run_backup() {
  DATABASE_URL="$1" \
  BACKUP_DIR="$backup_dir" \
  BACKUP_ENCRYPTION_KEY_FILE="$key_file" \
  BACKUP_ALLOW_EPHEMERAL_STORAGE=true \
  BACKUP_TEST_MODE=true \
  NODE_ENV=test \
  CAPTURE_DIR="$capture_dir" \
  PATH="$bin_dir:$PATH" \
  "$script"
}

run_backup 'postgresql://db-user:super-secret@db.example.com:5432/trustpay?sslmode=require&schema=public&connect_timeout=5' >/dev/null

backup_file=$(find "$backup_dir" -type f -name '*.sql.custom.gpg' -print)
[ -f "$backup_file" ] || fail 'encrypted backup file was not created'
[ "$(stat -c '%a' "$backup_file" 2>/dev/null || stat -f '%Lp' "$backup_file")" = 600 ] || fail 'backup file is not private'
[ ! -e "$backup_file.part" ] || fail 'partial backup file was left behind'

grep -F -- '--dbname' "$capture_dir/pg_dump.args" >/dev/null 2>&1 && fail 'pg_dump received a database URL in argv'
grep -F 'super-secret' "$capture_dir/pg_dump.args" >/dev/null 2>&1 && fail 'database password appeared in pg_dump argv'
grep -F 'sslmode=require' "$capture_dir/service.conf" >/dev/null || fail 'TLS mode was not preserved in the service configuration'
grep -F 'connect_timeout=5' "$capture_dir/service.conf" >/dev/null || fail 'connection options were not preserved'
grep -F 'schema=' "$capture_dir/service.conf" >/dev/null 2>&1 && fail 'Prisma schema parameter leaked into libpq service configuration'
grep -F 'super-secret' "$capture_dir/passfile" >/dev/null || fail 'private passfile was not generated for libpq'

if run_backup 'postgresql://db-user:super-secret@db.example.com:5432/trustpay?sslmode=disable' >/dev/null 2>&1; then
  fail 'a non-TLS database URL was accepted'
fi

if run_backup 'postgresql://db-user:super-secret@db.example.com:5432/trustpay?sslmode=requirefoo' >/dev/null 2>&1; then
  fail 'an invalid TLS mode was accepted'
fi

if run_backup 'postgresql://db-user:super-secret@db.example.com:5432/trustpay?sslmode=require&sslmode=disable' >/dev/null 2>&1; then
  fail 'duplicate TLS modes were accepted'
fi

if NODE_ENV=production DATABASE_URL='postgresql://db-user:super-secret@db.example.com:5432/trustpay?sslmode=require' BACKUP_DIR="$backup_dir" BACKUP_ENCRYPTION_KEY_FILE="$key_file" BACKUP_ALLOW_EPHEMERAL_STORAGE=true BACKUP_TEST_MODE=true PATH="$bin_dir:$PATH" "$script" >/dev/null 2>&1; then
  fail 'ephemeral storage override was accepted in production'
fi

printf '%s\n' 'backup script tests passed'
