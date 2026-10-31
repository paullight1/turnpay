#!/bin/sh
set -eu

# This validator checks the shape and destination of the public values that
# are passed to Flutter. It does not implement certificate pinning or device
# integrity. Those controls require a separate, protected platform-security
# evidence gate before a production promotion can be approved.

usage() {
  cat <<'USAGE'
Usage: check-mobile-release-config.sh --environment production|staging --config FILE

Validate a transient Flutter dart-define JSON file without printing values.
USAGE
}

fail() {
  printf '%s\n' "mobile release config validation failed: $1" >&2
  exit 1
}

environment="${MOBILE_RELEASE_ENVIRONMENT:-${RELEASE_ENVIRONMENT:-}}"
config_path=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --environment|--target)
      [ "$#" -ge 2 ] || fail "$1 requires a value"
      environment="$2"
      shift 2
      ;;
    --config)
      [ "$#" -ge 2 ] || fail '--config requires a file path'
      config_path="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      fail 'unknown option'
      ;;
    *)
      [ -z "$config_path" ] || fail 'only one configuration file may be supplied'
      config_path="$1"
      shift
      ;;
  esac
done

[ -n "$environment" ] || fail '--environment is required'
case "$environment" in
  production|staging)
    ;;
  *)
    fail '--environment must be production or staging'
    ;;
esac

[ -n "$config_path" ] || fail '--config is required'
[ -r "$config_path" ] || fail 'configuration file is missing or unreadable'

command -v jq >/dev/null 2>&1 || fail 'jq is required to validate release configuration'

# Parse only a top-level object whose values are strings. Redirect jq errors
# so malformed input cannot cause a secret or raw document to be printed.
if ! jq -e 'type == "object" and all(.[]; type == "string")' \
  "$config_path" >/dev/null 2>&1; then
  fail 'configuration must be a JSON object containing string values only'
fi

allowed_fields='[
  "API_BASE_URL",
  "WEBSITE_BASE_URL",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SENTRY_DSN",
  "SENTRY_ENVIRONMENT",
  "API_CERTIFICATE_SHA256_PINS"
]'

# Reject credential-like names before validating values. The error identifies
# only the class of problem, never the value stored under the field.
private_field_present=$(jq -r --argjson allowed "$allowed_fields" '
  [keys[] as $key | select(
    ($key | test("(^|_)(SECRET|TOKEN|PASSWORD|PRIVATE|SERVICE_ROLE|PROVIDER|API_KEY)($|_)"; "i"))
    or ($key | test("^(MONNIFY|PAYSTACK|VTPASS)"; "i"))
    or (($allowed | index($key)) == null)
  )][0] // empty
' "$config_path" 2>/dev/null)

if [ -n "$private_field_present" ]; then
  # Use the field name only for a useful, non-sensitive diagnostic. Values
  # are never interpolated into any output.
  private_field_upper=$(printf '%s' "$private_field_present" | tr '[:lower:]' '[:upper:]')
  case "$private_field_upper" in
    *[!A-Za-z0-9_.-]*)
      fail 'private or provider credential fields are not allowed'
      ;;
    *)
      case "$private_field_upper" in
        *SECRET*|*TOKEN*|*PASSWORD*|*PRIVATE*|*SERVICE_ROLE*|*PROVIDER*|*API_KEY*|MONNIFY*|PAYSTACK*|VTPASS**)
          fail 'private or provider credential fields are not allowed'
          ;;
        *)
          fail 'unsupported release config field'
          ;;
      esac
      ;;
  esac
fi

# Allowed fields must not contain PEM material, service-role/secret key
# markers, or common provider secret prefixes. This check reports no value.
unsafe_value_present=$(jq -r '
  [to_entries[] | select(
    (.value | test("-----BEGIN|service_role|sb_secret_|(sk|pk)_(live|test)_|secret_key|private_key"; "i"))
  ) | .key][0] // empty
' "$config_path" 2>/dev/null)

[ -z "$unsafe_value_present" ] ||
  fail 'configuration contains a prohibited secret or private-key value'

value_of() {
  jq -r --arg key "$1" \
    'if (has($key) and (.[$key] | type == "string")) then .[$key] else empty end' \
    "$config_path" 2>/dev/null
}

require_value() {
  field="$1"
  value="$(value_of "$field")"
  [ -n "$value" ] || fail "$field is required"
}

require_https_url() {
  field="$1"
  value="$2"

  case "$value" in
    https://*)
      ;;
    *)
      fail "$field must use HTTPS"
      ;;
  esac

  # A public release URL cannot contain credentials, whitespace, query data or
  # a fragment. Production URLs are checked against exact allowlist entries
  # below; staging URLs still receive this structural check.
  printf '%s' "$value" | grep -Eq '^https://[^/@?#:[:space:]]+(\/[^?#[:space:]]*)?$' ||
    fail "$field must be a public HTTPS URL"
}

reject_local_host() {
  field="$1"
  value="$2"

  case "$value" in
    *localhost*|*127.0.0.1*|*0.0.0.0*|*::1*|*10.*|*192.168.*|*172.1[6-9].*|*172.2[0-9].*|*172.3[0-1].*)
      fail "$field must not point to a local or private host"
      ;;
  esac
}

require_supabase_url() {
  field='SUPABASE_URL'
  value="$1"

  require_https_url "$field" "$value"
  reject_local_host "$field" "$value"
  printf '%s' "$value" | grep -Eq '^https://[a-z0-9][a-z0-9-]*\.supabase\.co$' ||
    fail "$field must target an allowlisted Supabase project host"
}

require_sentry_dsn() {
  value="$1"

  case "$value" in
    https://*@*)
      ;;
    *)
      fail 'SENTRY_DSN must be an HTTPS Sentry DSN'
      ;;
  esac

  # Sentry DSNs contain a public project key in the user-info portion. The
  # destination is still constrained to Sentry-owned hosts.
  sentry_host=$(printf '%s' "$value" | sed -n 's#^https://[^@/]*@\([^/:?#]*\).*#\1#p')
  case "$sentry_host" in
    sentry.io|*.sentry.io)
      ;;
    *)
      fail 'SENTRY_DSN must target an allowlisted Sentry host'
      ;;
  esac

  printf '%s' "$value" | grep -Eq '^https://[^@/[:space:]]+@[^/?#[:space:]]+/[^/?#[:space:]]+/?$' ||
    fail 'SENTRY_DSN has an invalid format'
}

require_pins() {
  pins="$1"
  [ -n "$pins" ] || fail 'API_CERTIFICATE_SHA256_PINS is required'

  old_ifs=$IFS
  IFS=,
  # Pins are restricted to lowercase hex below, so word splitting cannot
  # invoke pathname expansion or alter a valid value. Disable pathname
  # expansion while splitting untrusted input as an extra guard.
  set -f
  set -- $pins
  set +f
  IFS=$old_ifs

  [ "$#" -ge 2 ] ||
    fail 'API_CERTIFICATE_SHA256_PINS must contain at least two pins'

  seen='|'
  for pin in "$@"; do
    printf '%s' "$pin" | grep -Eq '^[0-9a-f]{64}$' ||
      fail 'API_CERTIFICATE_SHA256_PINS entries must be lowercase SHA-256 hex'

    case "$seen" in
      *"|$pin|"*)
        fail 'API_CERTIFICATE_SHA256_PINS entries must be distinct'
        ;;
    esac
    seen="${seen}${pin}|"
  done
}

api_base_url="$(value_of API_BASE_URL)"
website_base_url="$(value_of WEBSITE_BASE_URL)"
supabase_url="$(value_of SUPABASE_URL)"
sentry_dsn="$(value_of SENTRY_DSN)"
sentry_environment="$(value_of SENTRY_ENVIRONMENT)"
certificate_pins="$(value_of API_CERTIFICATE_SHA256_PINS)"

require_value API_BASE_URL
require_value WEBSITE_BASE_URL
require_value SUPABASE_URL
require_value SUPABASE_PUBLISHABLE_KEY
require_value API_CERTIFICATE_SHA256_PINS

require_https_url API_BASE_URL "$api_base_url"
require_https_url WEBSITE_BASE_URL "$website_base_url"
require_supabase_url "$supabase_url"
if [ -n "$sentry_dsn" ]; then
  require_value SENTRY_ENVIRONMENT
  require_sentry_dsn "$sentry_dsn"
fi
require_pins "$certificate_pins"

case "$environment" in
  production)
    [ "$api_base_url" = 'https://api.trustpayhq.com' ] ||
      fail 'API_BASE_URL is not an allowlisted production host'
    [ "$website_base_url" = 'https://trustpay.xyz' ] ||
      fail 'WEBSITE_BASE_URL is not an allowlisted production host'
    [ -z "$sentry_dsn" ] || [ "$sentry_environment" = 'production' ] ||
      fail 'SENTRY_ENVIRONMENT must be production for a production build'

    # Exact production allowlists above reject staging/sandbox/local hosts.
    # Keep this explicit check close to the policy so future URL changes do
    # not accidentally weaken the production branch.
    reject_local_host API_BASE_URL "$api_base_url"
    reject_local_host WEBSITE_BASE_URL "$website_base_url"
    ;;
  staging)
    [ -z "$sentry_dsn" ] || [ "$sentry_environment" = 'staging' ] ||
      fail 'SENTRY_ENVIRONMENT must be staging for a staging build'
    [ "$api_base_url" != 'https://api.trustpayhq.com' ] ||
      fail 'API_BASE_URL must target the staging environment'
    [ "$website_base_url" != 'https://trustpay.xyz' ] ||
      fail 'WEBSITE_BASE_URL must target the staging environment'
    reject_local_host API_BASE_URL "$api_base_url"
    reject_local_host WEBSITE_BASE_URL "$website_base_url"
    ;;
esac

printf '%s\n' "mobile release configuration is valid for $environment (values withheld)"
