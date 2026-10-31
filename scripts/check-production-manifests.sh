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
  check_present "PAYSTACK_SECRET_KEY" "render.yaml"
  check_present "https://sandbox.vtpass.com/api" "render.yaml"
  check_absent "https://vtpass.com/api" "render.yaml"
  check_absent "NINJA_" "render.yaml"
  check_absent "YOUVERIFY_" "render.yaml"
  check_env_value "KYC_PROVIDER" "paystack" "render.yaml"
  check_env_value "BANKING_SANDBOX_MODE" "true" "render.yaml"
  check_env_value "WITHDRAWALS_ENABLED" "false" "render.yaml"
  check_env_value "INTERNAL_TRANSFERS_ENABLED" "false" "render.yaml"
  check_env_value "OTP_PROVIDER" "supabase_email" "render.yaml"
  check_env_value "OTP_EXPIRES_IN" "5m" "render.yaml"
  check_env_value "OTP_LENGTH" "6" "render.yaml"
  check_env_value "OTP_DEV_CODE" "" "render.yaml"
else
  check_absent "https://sandbox.monnify.com" "render.yaml"
  check_absent "https://sandbox.vtpass.com/api" "render.yaml"
  check_absent "NINJA_" "render.yaml"
  check_absent "YOUVERIFY_" "render.yaml"
fi

# Keep an explicit non-Render fallback. On Render, the platform-provided RENDER
# variable selects Render's normalized first-address trust policy instead.
check_env_value "TRUST_PROXY_HOPS" "2" "render.yaml"

check_absent "https://api-service.vtpass.com" "render.yaml"
check_env_value "VTU_ENABLED" "true" "render.yaml"
check_env_value "VTU_SIMULATION_ENABLED" "false" "render.yaml"

check_absent "https://turnpay.onrender.com/api/webhooks/monnify" "render.yaml"

# Fly must apply migrations on a release machine before serving traffic. The
# serving command keeps startup migrations disabled so two serving machines do
# not race over the same migration lock.
check_present 'RUN_MIGRATIONS_ON_STARTUP = "false"' "BACKEND/fly.toml"
check_present 'release_command = "npx prisma migrate deploy"' "BACKEND/fly.toml"

# A self-managed Compose host must expose only its TLS proxy. Direct HTTP
# bindings would bypass the proxy's HTTPS, WAF, and access-control boundary.
check_present "'127.0.0.1:3000:3000'" "docker-compose.prod.yml"
check_present "'127.0.0.1:3001:3001'" "docker-compose.prod.yml"
check_absent "      - '3000:3000'" "docker-compose.prod.yml"
check_absent "      - '3001:3001'" "docker-compose.prod.yml"

# Customer OTP is email-only, and optional monitoring cannot block startup.
check_present 'OTP_PROVIDER = "supabase_email"' "BACKEND/fly.toml"
check_present 'OTP_PROVIDER: supabase_email' "docker-compose.prod.yml"
check_present 'SENTRY_DSN: ${SENTRY_DSN:-}' "docker-compose.prod.yml"
check_absent 'TWILIO_' "render.yaml"
check_absent 'TWILIO_' "docker-compose.prod.yml"
check_absent 'SMS_PROVIDER' "BACKEND/fly.toml"
