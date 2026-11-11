#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

# GitHub's Ubuntu runner does not guarantee ripgrep is installed. The safety
# gate must still validate a known-good manifest using the POSIX toolchain.
PATH=/usr/bin:/bin "$repo_root/scripts/check-production-manifests.sh"

printf '%s\n' "production manifest portability check passed"

# The approved NIN adapter is allowed only with the pinned live endpoint and
# server-only secret slot. Validate temporary fixtures without touching source.
fixture_root=$(mktemp -d)
trap 'rm -rf "$fixture_root"' EXIT HUP INT TERM
mkdir -p "$fixture_root/BACKEND"
cp "$repo_root/render.yaml" "$fixture_root/render.yaml"
cp "$repo_root/render.production.yaml" "$fixture_root/render.production.yaml"
cp "$repo_root/docker-compose.prod.yml" "$fixture_root/docker-compose.prod.yml"
cp "$repo_root/BACKEND/fly.toml" "$fixture_root/BACKEND/fly.toml"

expect_rejected() {
  if (cd "$fixture_root" && PATH=/usr/bin:/bin sh "$repo_root/scripts/check-production-manifests.sh") >/dev/null 2>&1; then
    printf '%s\n' "unsafe deployment manifest fixture was accepted: $1" >&2
    exit 1
  fi
}

sed 's#https://api.ninja.boucloud.io#http://untrusted.invalid#' "$repo_root/render.yaml" > "$fixture_root/render.yaml"
expect_rejected 'unapproved endpoint'

awk '
  /- key: NINJA_SECRET_KEY/ { print; getline; print "        value: test-only-placeholder"; next }
  { print }
' "$repo_root/render.yaml" > "$fixture_root/render.yaml"
expect_rejected 'inline secret'

awk '
  /- key: NINJA_SECRET_KEY/ { print; getline; print "        sync: true"; next }
  { print }
' "$repo_root/render.yaml" > "$fixture_root/render.yaml"
expect_rejected 'unprotected secret slot'

printf '%s\n' 'approved Ninja manifest checks passed'

cp "$repo_root/render.yaml" "$fixture_root/render.yaml"
printf '%s\n' 'services: []' > "$fixture_root/render.production.yaml"
expect_rejected 'missing production services'

cp "$repo_root/render.production.yaml" "$fixture_root/render.production.yaml"
(cd "$fixture_root" && PATH=/usr/bin:/bin sh "$repo_root/scripts/check-production-manifests.sh")

for mutation in free-compute sandbox-vtu startup-migrations transfers inline-smtp duplicate-environment email-enabled ninja-endpoint; do
  cp "$repo_root/render.production.yaml" "$fixture_root/render.production.yaml"
  case "$mutation" in
    free-compute)
      sed 's/plan: 0.5c-512mb/plan: free/' "$repo_root/render.production.yaml" > "$fixture_root/render.production.yaml"
      ;;
    sandbox-vtu)
      sed 's#https://vtpass.com/api#https://sandbox.vtpass.com/api#' "$repo_root/render.production.yaml" > "$fixture_root/render.production.yaml"
      ;;
    startup-migrations|transfers)
      key=RUN_MIGRATIONS_ON_STARTUP
      [ "$mutation" != transfers ] || key=INTERNAL_TRANSFERS_ENABLED
      awk -v key="$key" '
        $0 ~ "- key: " key "$" { print; getline; print "        value: \"true\""; next }
        { print }
      ' "$repo_root/render.production.yaml" > "$fixture_root/render.production.yaml"
      ;;
    inline-smtp)
      awk '
        /- key: SMTP_PASSWORD/ { print; getline; print "        value: test-only-placeholder"; next }
        { print }
      ' "$repo_root/render.production.yaml" > "$fixture_root/render.production.yaml"
      ;;
    duplicate-environment)
      awk '
        /- key: NODE_ENV/ { print "      - key: NODE_ENV\n        value: \"development\"" }
        { print }
      ' "$repo_root/render.production.yaml" > "$fixture_root/render.production.yaml"
      ;;
    email-enabled)
      sed 's/value: "disabled"/value: "resend"/' "$repo_root/render.production.yaml" > "$fixture_root/render.production.yaml"
      ;;
    ninja-endpoint)
      sed 's#https://api.ninja.boucloud.io#http://untrusted.invalid#' "$repo_root/render.production.yaml" > "$fixture_root/render.production.yaml"
      ;;
  esac
  expect_rejected "$mutation"
done

printf '%s\n' 'production profile safety checks passed'

cp "$repo_root/render.production.yaml" "$fixture_root/render.production.yaml"
sed 's/BANKING_ENABLED:-false/BANKING_ENABLED:-true/' "$repo_root/docker-compose.prod.yml" > "$fixture_root/docker-compose.prod.yml"
expect_rejected 'Compose banking enabled before acceptance'

awk '
  /BANKING_ENABLED:/ { print "      BANKING_ENABLED: true" }
  { print }
' "$repo_root/docker-compose.prod.yml" > "$fixture_root/docker-compose.prod.yml"
expect_rejected 'duplicate Compose banking key'

sed 's/SMTP_REQUIRE_TLS:-true/SMTP_REQUIRE_TLS:-false/' "$repo_root/docker-compose.prod.yml" > "$fixture_root/docker-compose.prod.yml"
expect_rejected 'Compose email TLS disabled'
cp "$repo_root/docker-compose.prod.yml" "$fixture_root/docker-compose.prod.yml"

for key in IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY VTPASS_API_KEY VTPASS_PUBLIC_KEY VTPASS_SECRET_KEY VTPASS_WEBHOOK_SECRET MONNIFY_API_KEY MONNIFY_SECRET_KEY; do
  awk -v key="$key" '
    $0 ~ "- key: " key "$" { print; getline; print "        value: test-only-placeholder"; next }
    { print }
  ' "$repo_root/render.production.yaml" > "$fixture_root/render.production.yaml"
  expect_rejected "inline $key"
done

printf '%s\n' 'Compose duplicate/TLS and provider secret checks passed'

cp "$repo_root/render.production.yaml" "$fixture_root/render.production.yaml"
for key in DATABASE_URL IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY SUPABASE_SERVICE_ROLE_KEY PAYSTACK_SECRET_KEY VTPASS_API_KEY VTPASS_PUBLIC_KEY VTPASS_SECRET_KEY VTPASS_WEBHOOK_SECRET; do
  awk -v key="$key" '
    $0 ~ "- key: " key "$" { print; getline; print "        value: test-only-placeholder"; next }
    { print }
  ' "$repo_root/render.yaml" > "$fixture_root/render.yaml"
  expect_rejected "inline staging $key"
done
printf '%s\n' 'staging provider secret checks passed'
