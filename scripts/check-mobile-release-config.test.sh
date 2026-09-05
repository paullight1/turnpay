#!/bin/sh
set -eu

PATH=/usr/bin:/bin
export PATH

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
validator="$repo_root/scripts/check-mobile-release-config.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/trustpay-mobile-release-config.XXXXXX")

cleanup() {
  rm -rf "$test_root"
}

trap cleanup EXIT HUP INT TERM

fail() {
  printf '%s\n' "mobile release config test failed: $1" >&2
  exit 1
}

pin_a=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
pin_b=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

write_valid_config() {
  output_path="$1"

  jq -n \
    --arg api 'https://api.trustpayhq.com' \
    --arg website 'https://trustpay.xyz' \
    --arg supabase 'https://trustpay-prod.supabase.co' \
    --arg publishable 'sb_publishable_public_test_value' \
    --arg sentry 'https://public@sentry.io/123456' \
    --arg environment 'production' \
    --arg pins "$pin_a,$pin_b" \
    '{
      API_BASE_URL: $api,
      WEBSITE_BASE_URL: $website,
      SUPABASE_URL: $supabase,
      SUPABASE_PUBLISHABLE_KEY: $publishable,
      SENTRY_DSN: $sentry,
      SENTRY_ENVIRONMENT: $environment,
      API_CERTIFICATE_SHA256_PINS: $pins
    }' >"$output_path"
}

expect_success() {
  config_path="$1"
  output_path="$test_root/output.txt"

  if ! "$validator" --environment production --config "$config_path" \
    >"$output_path" 2>&1; then
    fail "expected valid configuration to pass"
  fi
}

expect_failure_without_secret_echo() {
  config_path="$1"
  expected_message="$2"
  secret_value="$3"
  output_path="$test_root/output.txt"

  if "$validator" --environment production --config "$config_path" \
    >"$output_path" 2>&1; then
    fail "expected configuration to fail: $expected_message"
  fi

  grep -F "$expected_message" "$output_path" >/dev/null ||
    fail "failure did not identify the expected problem: $expected_message"

  if grep -F "$secret_value" "$output_path" >/dev/null; then
    fail 'validator echoed a configuration value'
  fi
}

valid_config="$test_root/valid.json"
write_valid_config "$valid_config"
expect_success "$valid_config"

missing_sentry_config="$test_root/missing-sentry.json"
jq 'del(.SENTRY_DSN)' "$valid_config" >"$missing_sentry_config"
expect_failure_without_secret_echo \
  "$missing_sentry_config" \
  'SENTRY_DSN is required' \
  'sb_publishable_public_test_value'

missing_pins_config="$test_root/missing-pins.json"
jq 'del(.API_CERTIFICATE_SHA256_PINS)' "$valid_config" >"$missing_pins_config"
expect_failure_without_secret_echo \
  "$missing_pins_config" \
  'API_CERTIFICATE_SHA256_PINS is required' \
  'sb_publishable_public_test_value'

http_config="$test_root/http.json"
jq '.API_BASE_URL = "http://api.trustpayhq.com"' \
  "$valid_config" >"$http_config"
expect_failure_without_secret_echo \
  "$http_config" \
  'API_BASE_URL must use HTTPS' \
  'http://api.trustpayhq.com'

wrong_host_config="$test_root/wrong-host.json"
jq '.API_BASE_URL = "https://staging.trustpayhq.com"' \
  "$valid_config" >"$wrong_host_config"
expect_failure_without_secret_echo \
  "$wrong_host_config" \
  'API_BASE_URL is not an allowlisted production host' \
  'https://staging.trustpayhq.com'

secret_value='provider-secret-that-must-not-appear'
private_field_config="$test_root/private-field.json"
jq --arg secret "$secret_value" \
  '. + {MONNIFY_SECRET_KEY: $secret}' \
  "$valid_config" >"$private_field_config"
expect_failure_without_secret_echo \
  "$private_field_config" \
  'private or provider credential fields are not allowed' \
  "$secret_value"

unsafe_value_config="$test_root/unsafe-value.json"
jq --arg secret "$secret_value" \
  '.SUPABASE_PUBLISHABLE_KEY = ("service_role:" + $secret)' \
  "$valid_config" >"$unsafe_value_config"
expect_failure_without_secret_echo \
  "$unsafe_value_config" \
  'configuration contains a prohibited secret or private-key value' \
  "$secret_value"

malformed_config="$test_root/malformed.json"
printf '%s\n' "{\"SUPABASE_PUBLISHABLE_KEY\":\"$secret_value\"," >"$malformed_config"
expect_failure_without_secret_echo \
  "$malformed_config" \
  'configuration must be a JSON object containing string values only' \
  "$secret_value"

printf '%s\n' 'mobile release config validator tests passed'
