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

reject_unsafe_url() {
  value="$(value_of "$1")"
  case "$value" in
    *localhost*|*127.0.0.1*|*turnpay.onrender.com*|*sandbox.monnify.com*|*sandbox.vtpass.com*)
      fail "$1 points at a sandbox, localhost, or known bad host"
      ;;
  esac
}

if [ "${NODE_ENV:-development}" = "production" ]; then
  require_https_url WEB_URL
  require_https_url ADMIN_URL

  if is_truthy "${BANKING_ENABLED:-false}" ||
    is_truthy "${VIRTUAL_ACCOUNTS_ENABLED:-false}" ||
    is_truthy "${WITHDRAWALS_ENABLED:-false}"; then
    require_env MONNIFY_API_KEY
    require_env MONNIFY_SECRET_KEY
    require_env MONNIFY_CONTRACT_CODE
    require_env MONNIFY_WEBHOOK_SECRET
    require_https_url MONNIFY_BASE_URL
    require_https_url MONNIFY_WEBHOOK_URL
    reject_unsafe_url MONNIFY_BASE_URL
    reject_unsafe_url MONNIFY_WEBHOOK_URL

    if is_truthy "${WITHDRAWALS_ENABLED:-false}"; then
      require_env MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER
    fi
  fi

  if [ "$(lower "${VTU_PROVIDER:-}")" = "vtpass" ]; then
    require_env VTPASS_API_KEY
    require_env VTPASS_PUBLIC_KEY
    require_env VTPASS_SECRET_KEY
    require_env VTPASS_WEBHOOK_SECRET
    require_https_url VTPASS_BASE_URL
    reject_unsafe_url VTPASS_BASE_URL
  fi
fi

exec "$@"
