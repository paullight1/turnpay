#!/bin/sh
set -eu

check_absent() {
  needle="$1"
  path="$2"

  if grep -nF "$needle" "$path" >/dev/null; then
    printf '%s\n' "unsafe production default found in $path: $needle" >&2
    exit 1
  fi
}

check_present() {
  needle="$1"
  path="$2"

  if ! grep -nF "$needle" "$path" >/dev/null; then
    printf '%s\n' "required deployment safety value missing from $path: $needle" >&2
    exit 1
  fi
}

has_env_value() {
  key="$1"
  expected="$2"
  path="$3"

  awk -v key="$key" -v expected="$expected" '
    /^[[:space:]]*- key:[[:space:]]*/ {
      line = $0
      sub(/^[[:space:]]*- key:[[:space:]]*/, "", line)
      sub(/[[:space:]]*$/, "", line)
      current_key = (line == key)
      next
    }

    current_key && /^[[:space:]]*value:[[:space:]]*/ {
      line = $0
      sub(/^[[:space:]]*value:[[:space:]]*/, "", line)
      sub(/[[:space:]]*#.*/, "", line)
      sub(/[[:space:]]*$/, "", line)

      first = substr(line, 1, 1)
      last = substr(line, length(line), 1)
      if (length(line) >= 2 && ((first == "\"" && last == "\"") || (first == "\047" && last == "\047"))) {
        line = substr(line, 2, length(line) - 2)
      }

      if (line == expected) {
        found = 1
      }
      current_key = 0
    }

    END { exit(found ? 0 : 1) }
  ' "$path"
}

check_env_value() {
  key="$1"
  expected="$2"
  path="$3"

  if ! has_env_value "$key" "$expected" "$path"; then
    printf '%s\n' "required deployment environment value missing from $path: $key=$expected" >&2
    exit 1
  fi
}

if has_env_value "NODE_ENV" "staging" "render.yaml"; then
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

# Render's public ingress contributes two trusted entries to the forwarded-for
# chain. A lower value rejects legitimate traffic before it reaches Nest; a
# higher value would accept a caller-supplied address beyond the platform edge.
check_env_value "TRUST_PROXY_HOPS" "2" "render.yaml"

check_absent "https://api-service.vtpass.com" "render.yaml"
check_env_value "VTU_ENABLED" "true" "render.yaml"
check_env_value "VTU_SIMULATION_ENABLED" "false" "render.yaml"

check_absent "https://turnpay.onrender.com/api/webhooks/monnify" "render.yaml"
