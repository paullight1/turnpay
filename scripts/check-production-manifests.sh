#!/bin/sh
set -eu

check_absent() {
  needle="$1"
  path="$2"

  if rg -n --fixed-strings "$needle" "$path" >/dev/null; then
    printf '%s\n' "unsafe production default found in $path: $needle" >&2
    exit 1
  fi
}

check_present() {
  needle="$1"
  path="$2"

  if ! rg -n --fixed-strings "$needle" "$path" >/dev/null; then
    printf '%s\n' "required deployment safety value missing from $path: $needle" >&2
    exit 1
  fi
}

check_env_value() {
  key="$1"
  expected="$2"
  path="$3"
  pattern="(?m)^[[:space:]]*- key: ${key}[[:space:]]*$\n[[:space:]]+value: \\\"?${expected}\\\"?[[:space:]]*(?:#.*)?$"

  if ! rg --quiet --multiline --pcre2 "$pattern" "$path"; then
    printf '%s\n' "required deployment environment value missing from $path: $key=$expected" >&2
    exit 1
  fi
}

if rg --quiet --multiline --pcre2 \
  '(?m)^[[:space:]]*- key: NODE_ENV[[:space:]]*$\n[[:space:]]+value: "?staging"?[[:space:]]*$' \
  render.yaml; then
  check_present "https://sandbox.monnify.com" "render.yaml"
  check_present "https://vtpass.com/api" "render.yaml"
  check_present "https://api.sandbox.ninja.boucloud.io" "render.yaml"
  check_env_value "KYC_PROVIDER" "ninja" "render.yaml"
  check_env_value "BANKING_SANDBOX_MODE" "true" "render.yaml"
  check_env_value "WITHDRAWALS_ENABLED" "false" "render.yaml"
  check_env_value "INTERNAL_TRANSFERS_ENABLED" "false" "render.yaml"
else
  check_absent "https://sandbox.monnify.com" "render.yaml"
  check_absent "https://sandbox.vtpass.com/api" "render.yaml"
  check_absent "https://api.sandbox.ninja.boucloud.io" "render.yaml"
fi

check_absent "https://api-service.vtpass.com" "render.yaml"
check_env_value "VTU_ENABLED" "true" "render.yaml"
check_env_value "VTU_SIMULATION_ENABLED" "false" "render.yaml"

check_absent "https://turnpay.onrender.com/api/webhooks/monnify" "render.yaml"
