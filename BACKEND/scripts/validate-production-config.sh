#!/bin/sh
set -eu

lower() {
  printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]'
}

is_truthy() {
  case "$(lower "${1:-}")" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

value_of() {
  eval "printf '%s' \"\${$1-}\""
}

fail() {
  printf '%s\n' "production config validation failed: $1" >&2
  exit 1
}

require_env() {
  value="$(value_of "$1")"
  [ -n "$value" ] || fail "$1 is required"
}

require_min_length() {
  require_env "$1"
  value="$(value_of "$1")"
  min_length="$2"
  [ "${#value}" -ge "$min_length" ] ||
    fail "$1 must be at least $min_length characters"
}

require_boolean_env() {
  value="$(lower "$(value_of "$1")")"
  case "$value" in
    true|false)
      ;;
    *)
      fail "$1 must be explicitly true or false"
      ;;
  esac
}

require_https_url() {
  require_env "$1"
  value="$(value_of "$1")"
  case "$value" in
    https://*)
      ;;
    *)
      fail "$1 must use https"
      ;;
  esac
}

require_redis_url() {
  require_env REDIS_URL
  value="$(value_of REDIS_URL)"
  case "$value" in
    redis://*|rediss://*)
      ;;
    *)
      fail "REDIS_URL must use redis or rediss"
      ;;
  esac
}

require_base64_32_bytes() {
  require_env "$1"
  value="$(value_of "$1")"
  decoded_bytes="$(printf '%s' "$value" | base64 -d 2>/dev/null | wc -c | tr -d ' ')"
  [ "$decoded_bytes" = "32" ] || fail "$1 must decode to exactly 32 bytes"
}

require_supabase_database_url() {
  require_env DATABASE_URL
  value="$(value_of DATABASE_URL)"

  case "$value" in
    postgres://*@*.pooler.supabase.com:5432/*|postgresql://*@*.pooler.supabase.com:5432/*|postgres://*@db.*.supabase.co:5432/*|postgresql://*@db.*.supabase.co:5432/*)
      ;;
    *)
      fail "DATABASE_URL must use the Supabase direct or session-pooler endpoint on port 5432"
      ;;
  esac

  case "$value" in
    *sslmode=require*|*sslmode=verify-full*)
      ;;
    *)
      fail "DATABASE_URL must require TLS with sslmode=require or sslmode=verify-full"
      ;;
  esac
}

reject_unsafe_url() {
  value="$(value_of "$1")"
  case "$value" in
    *localhost*|*127.0.0.1*|*turnpay.onrender.com*|*sandbox.monnify.com*|*sandbox.vtpass.com*|*sandbox.youverify.co*|*api.sandbox.ninja.boucloud.io*)
      fail "$1 points at a sandbox, localhost, or known bad host"
      ;;
  esac
}

if [ "${NODE_ENV:-development}" = "production" ]; then
  require_supabase_database_url
  require_https_url WEB_URL
  require_https_url ADMIN_URL
  require_boolean_env INTERNAL_TRANSFERS_ENABLED
  require_boolean_env TRANSACTION_PIN_REQUIRED
  [ "$(lower "${TRANSACTION_PIN_REQUIRED:-}")" = "true" ] ||
    fail "TRANSACTION_PIN_REQUIRED must be true in production"
  require_env JWT_SECRET
  require_env JWT_REFRESH_SECRET
  require_redis_url
  require_boolean_env REDIS_ALLOW_MEMORY_FALLBACK
  [ "$(lower "${REDIS_ALLOW_MEMORY_FALLBACK:-}")" = "false" ] ||
    fail "REDIS_ALLOW_MEMORY_FALLBACK must be false in production"
  case "${TRUST_PROXY_HOPS:-}" in
    1|2)
      ;;
    *)
      fail "TRUST_PROXY_HOPS must be 1 or 2 in production"
      ;;
  esac
  require_base64_32_bytes IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY
  require_env IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY_ID

  if is_truthy "${BANKING_ENABLED:-false}" ||
    is_truthy "${VIRTUAL_ACCOUNTS_ENABLED:-false}" ||
    is_truthy "${WITHDRAWALS_ENABLED:-false}"; then
    require_env MONNIFY_API_KEY
    require_env MONNIFY_SECRET_KEY
    require_env MONNIFY_CONTRACT_CODE
    require_https_url MONNIFY_BASE_URL
    require_https_url MONNIFY_WEBHOOK_URL
    reject_unsafe_url MONNIFY_BASE_URL
    reject_unsafe_url MONNIFY_WEBHOOK_URL

    if is_truthy "${WITHDRAWALS_ENABLED:-false}"; then
      require_env MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER
    fi
  fi

  case "$(lower "${KYC_PROVIDER:-}")" in
    ninja)
      require_env NINJA_CLIENT_KEY
      require_env NINJA_CLIENT_SECRET
      require_https_url NINJA_BASE_URL
      reject_unsafe_url NINJA_BASE_URL
      [ "${NINJA_BASE_URL}" = "https://api.ninja.boucloud.io" ] ||
        fail "NINJA_BASE_URL must be https://api.ninja.boucloud.io"
      ;;
    youverify)
      require_min_length YOUVERIFY_API_KEY 16
      require_https_url YOUVERIFY_BASE_URL
      require_https_url YOUVERIFY_WEBHOOK_URL
      require_min_length YOUVERIFY_WEBHOOK_SECRET 16
      reject_unsafe_url YOUVERIFY_BASE_URL
      reject_unsafe_url YOUVERIFY_WEBHOOK_URL
      ;;
    *)
      fail "KYC_PROVIDER must be ninja or youverify"
      ;;
  esac

  require_min_length PII_ENCRYPTION_KEY 32

  vtu_enabled="$(lower "${VTU_ENABLED:-true}")"
  case "$vtu_enabled" in
    true|false) ;;
    *) fail "VTU_ENABLED must be explicitly true or false" ;;
  esac
  vtu_simulation_enabled="$(lower "${VTU_SIMULATION_ENABLED:-false}")"
  case "$vtu_simulation_enabled" in
    true|false) ;;
    *) fail "VTU_SIMULATION_ENABLED must be explicitly true or false" ;;
  esac
  [ "$vtu_simulation_enabled" = "false" ] ||
    fail "VTU_SIMULATION_ENABLED must be false in production"

  if [ "$vtu_enabled" = "true" ]; then
    if [ "$(lower "${VTU_PROVIDER:-}")" != "vtpass" ]; then
      fail "VTU_PROVIDER must be vtpass"
    fi

    require_env VTPASS_BASE_URL
    [ "${VTPASS_BASE_URL}" = "https://vtpass.com/api" ] ||
      fail "VTPASS_BASE_URL must be https://vtpass.com/api"
    require_env VTPASS_API_KEY
    require_env VTPASS_PUBLIC_KEY
    require_env VTPASS_SECRET_KEY
    require_min_length VTPASS_WEBHOOK_SECRET 16
  fi
fi

exec "$@"
