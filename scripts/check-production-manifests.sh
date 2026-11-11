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
      if (current_key) key_count++
      next
    }

    current_key && /^[[:space:]]*value:[[:space:]]*/ {
      value_count++
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

    END { exit(found && key_count == 1 && value_count == 1 ? 0 : 1) }
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

check_secret_slot() {
  # The approved NIN provider uses a server-managed secret, never an inline
  # value or a synchronised Blueprint value. Reject duplicate secret slots.
  key="$1"
  path="$2"
  if ! awk -v key="$key" '
    /^[[:space:]]*- key:[[:space:]]*/ {
      line = $0
      sub(/^[[:space:]]*- key:[[:space:]]*/, "", line)
      sub(/[[:space:]]*$/, "", line)
      active = (line == key)
      if (active) count++
      next
    }
    active && /^[[:space:]]*value:/ { unsafe = 1 }
    active && /^[[:space:]]*sync:/ {
      line = $0
      sub(/^[[:space:]]*sync:[[:space:]]*/, "", line)
      sub(/[[:space:]]*#.*/, "", line)
      sub(/[[:space:]]*$/, "", line)
      if (line == "false") protected_slot = 1
    }
    END { exit(count == 1 && protected_slot && !unsafe ? 0 : 1) }
  ' "$path"; then
    printf '%s\n' "$key in $path must use one server-only sync: false slot" >&2
    exit 1
  fi
}

if has_env_value "NODE_ENV" "staging" "render.yaml"; then
  check_present "PAYSTACK_SECRET_KEY" "render.yaml"
  check_present "https://sandbox.vtpass.com/api" "render.yaml"
  check_absent "https://vtpass.com/api" "render.yaml"
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
  check_absent "YOUVERIFY_" "render.yaml"
fi

# Ninja NIN was owner-approved; Paystack still handles Tier 1 BVN. Retain
# strict endpoint/secret checks instead of the obsolete blanket provider ban.
check_env_value "NINJA_BASE_URL" "https://api.ninja.boucloud.io" "render.yaml"
if ! has_env_value "NINJA_NIN_ENABLED" "true" "render.yaml" &&
   ! has_env_value "NINJA_NIN_ENABLED" "false" "render.yaml"; then
  printf '%s\n' 'NINJA_NIN_ENABLED must be an explicit boolean' >&2
  exit 1
fi
check_secret_slot NINJA_SECRET_KEY render.yaml
check_absent "NINJA_API_KEY" "render.yaml"

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

# The opt-in profile is a separate, reviewed proposal; never promote staging
# by weakening its safety checks or automatically enabling live financial flows.
production_profile=render.production.yaml
check_present '    plan: 0.5c-512mb' "$production_profile"
check_present '    plan: 256mb' "$production_profile"
check_absent 'plan: free' "$production_profile"
check_present '    persistenceMode: journal-snapshot' "$production_profile"
check_present '    maxmemoryPolicy: noeviction' "$production_profile"
check_present '    ipAllowList: []' "$production_profile"
check_present '    preDeployCommand: npx prisma migrate deploy' "$production_profile"
check_present '    autoDeployTrigger: "off"' "$production_profile"
check_env_value NODE_ENV production "$production_profile"
check_env_value RUN_MIGRATIONS_ON_STARTUP false "$production_profile"
check_env_value BANKING_SANDBOX_MODE false "$production_profile"
check_env_value REDIS_ALLOW_MEMORY_FALLBACK false "$production_profile"
check_env_value TRANSACTION_PIN_REQUIRED true "$production_profile"
check_env_value OTP_PROVIDER supabase_email "$production_profile"
check_env_value OTP_EXPIRES_IN 5m "$production_profile"
check_env_value OTP_LENGTH 6 "$production_profile"
check_env_value OTP_DEV_CODE '' "$production_profile"
check_env_value VTPASS_BASE_URL https://vtpass.com/api "$production_profile"
check_env_value VTU_SIMULATION_ENABLED false "$production_profile"
check_env_value KYC_PROVIDER paystack "$production_profile"
check_env_value BANKING_PROVIDER_PRIMARY paystack "$production_profile"
check_env_value NINJA_BASE_URL https://api.ninja.boucloud.io "$production_profile"
check_env_value SMTP_REQUIRE_TLS true "$production_profile"
for key in BANKING_ENABLED VIRTUAL_ACCOUNTS_ENABLED WITHDRAWALS_ENABLED INTERNAL_TRANSFERS_ENABLED PAYSTACK_CHECKOUT_ENABLED NINJA_NIN_ENABLED VTU_ENABLED KORA_GHS_ENABLED KORA_GHS_VIRTUAL_ACCOUNTS_ENABLED KORA_GHS_MOMO_COLLECTIONS_ENABLED KORA_GHS_MOMO_PAYOUTS_ENABLED KORA_EXCHANGE_USE_CASE_APPROVED PAYSTACK_EXCHANGE_USE_CASE_APPROVED; do
  check_env_value "$key" false "$production_profile"
done
for key in DATABASE_URL REDIS_URL SMTP_PASSWORD SMTP_USER RESEND_API_KEY PAYSTACK_SECRET_KEY NINJA_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY VTPASS_API_KEY VTPASS_PUBLIC_KEY VTPASS_SECRET_KEY VTPASS_WEBHOOK_SECRET MONNIFY_API_KEY MONNIFY_SECRET_KEY; do
  check_secret_slot "$key" "$production_profile"
done
for profile in render.yaml "$production_profile"; do
  check_env_value EMAIL_PROVIDER disabled "$profile"
  check_env_value SMTP_REQUIRE_TLS true "$profile"
  check_secret_slot SMTP_PASSWORD "$profile"
  check_secret_slot RESEND_API_KEY "$profile"
  for key in DATABASE_URL IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY SUPABASE_SERVICE_ROLE_KEY PAYSTACK_SECRET_KEY VTPASS_API_KEY VTPASS_PUBLIC_KEY VTPASS_SECRET_KEY VTPASS_WEBHOOK_SECRET; do
    check_secret_slot "$key" "$profile"
  done
done
check_compose_backend_env() {
  key="$1"
  expected="$2"
  if ! awk -v key="$key" -v expected="$expected" '
    /^  [^ ]/ { backend = ($1 == "backend:"); env = 0 }
    backend && /^    environment:/ { env = 1; next }
    env && /^    [^ ]/ { env = 0 }
    env && /^      [A-Za-z0-9_]+:/ {
      name = $1
      sub(/:$/, "", name)
      if (name != key) next
      count++
      value = $0
      sub(/^[^:]+:[[:space:]]*/, "", value)
      sub(/[[:space:]]*$/, "", value)
      first = substr(value, 1, 1)
      last = substr(value, length(value), 1)
      if (length(value) >= 2 && ((first == "\"" && last == "\"") || (first == "\047" && last == "\047"))) {
        value = substr(value, 2, length(value) - 2)
      }
      if (value == expected) matches++
    }
    END { exit(count == 1 && matches == 1 ? 0 : 1) }
  ' docker-compose.prod.yml; then
    printf '%s\n' "unsafe or duplicate backend Compose environment key: $key" >&2
    exit 1
  fi
}
check_compose_backend_env EMAIL_PROVIDER '${EMAIL_PROVIDER:-disabled}'
check_compose_backend_env SMTP_PASSWORD '${SMTP_PASSWORD:-}'
check_compose_backend_env SMTP_REQUIRE_TLS '${SMTP_REQUIRE_TLS:-true}'
for key in BANKING_ENABLED VIRTUAL_ACCOUNTS_ENABLED WITHDRAWALS_ENABLED PAYSTACK_CHECKOUT_ENABLED VTU_ENABLED; do
  check_compose_backend_env "$key" "\${$key:-false}"
done
check_compose_backend_env BANKING_SANDBOX_MODE false
check_compose_backend_env KORA_GHS_ENABLED false
