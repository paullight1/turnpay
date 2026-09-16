#!/bin/sh
set -eu

PATH=/usr/bin:/bin
export PATH

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
script="$repo_root/scripts/check-release-candidate.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/trustpay-release-manifest.XXXXXX")

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf '%s\n' "release candidate manifest test failed: $1" >&2
  exit 1
}

mkdir -p "$test_root/.git" "$test_root/DOCS" \
  "$test_root/BACKEND/prisma/migrations/039_exchange_quote_execution_guard" \
  "$test_root/BACKEND/src/exchange"
git -C "$test_root" init -q
git -C "$test_root" config user.email test@example.invalid
git -C "$test_root" config user.name 'TrustPay test'

printf '%s\n' '-- synthetic migration --' \
  >"$test_root/BACKEND/prisma/migrations/039_exchange_quote_execution_guard/migration.sql"
printf '%s\n' '// synthetic schema' >"$test_root/BACKEND/prisma/schema.prisma"
printf '%s\n' '// synthetic service' >"$test_root/BACKEND/src/exchange/exchange.service.ts"
printf '%s\n' '// synthetic controller' >"$test_root/BACKEND/src/exchange/exchange.controller.ts"
printf '%s\n' '# synthetic evidence' >"$test_root/DOCS/EXCHANGE-READINESS-2026-09-06.md"
printf '%s\n' \
  'candidate_name=039_exchange_quote_execution_guard' \
  'required_path=BACKEND/prisma/migrations/039_exchange_quote_execution_guard/migration.sql' \
  'required_path=BACKEND/prisma/schema.prisma' \
  'required_path=BACKEND/src/exchange/exchange.service.ts' \
  'required_path=BACKEND/src/exchange/exchange.controller.ts' \
  'required_path=DOCS/EXCHANGE-READINESS-2026-09-06.md' \
  >"$test_root/DOCS/RELEASE-CANDIDATE-MANIFEST.txt"

git -C "$test_root" add .
git -C "$test_root" commit -q -m 'synthetic tracked release candidate'

RELEASE_MANIFEST_ROOT="$test_root" "$script" >/dev/null ||
  fail 'tracked clean candidate should pass'

printf '%s\n' 'change' >>"$test_root/BACKEND/src/exchange/exchange.service.ts"
if RELEASE_MANIFEST_ROOT="$test_root" "$script" >/dev/null 2>&1; then
  fail 'dirty candidate should fail'
fi

printf '%s\n' 'release candidate manifest tests passed'
