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

check_absent "https://sandbox.monnify.com" "render.yaml"
check_absent "https://sandbox.vtpass.com/api" "render.yaml"
check_absent "https://turnpay.onrender.com/api/webhooks/monnify" "render.yaml"
