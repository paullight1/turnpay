#!/bin/sh
set -eu

fail() {
  printf '%s\n' "secret safety check failed: $1" >&2
  exit 1
}

if git ls-files | rg '(^|/)\.env($|\.local$)' >/dev/null; then
  fail 'tracked runtime environment file detected; commit only .env.example templates'
fi

if rg -n --hidden \
  --glob '!.git/**' \
  --glob '!**/node_modules/**' \
  --glob '!**/.next/**' \
  --glob '!DOCS/**' \
  --glob '!**/package-lock.json' \
  '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|sk_(live|test)_[A-Za-z0-9]{16,}' \
  . >/dev/null; then
  fail 'private key or known provider/token pattern detected'
fi

printf '%s\n' 'secret safety check passed'
