#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

# GitHub's Ubuntu runner does not guarantee ripgrep is installed. The safety
# gate must still validate a known-good manifest using the POSIX toolchain.
PATH=/usr/bin:/bin "$repo_root/scripts/check-production-manifests.sh"

printf '%s\n' "production manifest portability check passed"

# The approved NIN adapter is allowed only with the pinned live endpoint and
# server-only secret slot. Validate temporary fixtures without touching source.
fixture_root=$(mktemp -d)
trap 'rm -rf "$fixture_root"' EXIT HUP INT TERM
mkdir -p "$fixture_root/BACKEND"
cp "$repo_root/render.yaml" "$fixture_root/render.yaml"
cp "$repo_root/docker-compose.prod.yml" "$fixture_root/docker-compose.prod.yml"
cp "$repo_root/BACKEND/fly.toml" "$fixture_root/BACKEND/fly.toml"

expect_rejected() {
  if (cd "$fixture_root" && PATH=/usr/bin:/bin sh "$repo_root/scripts/check-production-manifests.sh") >/dev/null 2>&1; then
    printf '%s\n' "unsafe Ninja manifest fixture was accepted: $1" >&2
    exit 1
  fi
}

sed 's#https://api.ninja.boucloud.io#http://untrusted.invalid#' "$repo_root/render.yaml" > "$fixture_root/render.yaml"
expect_rejected 'unapproved endpoint'

awk '
  /- key: NINJA_SECRET_KEY/ { print; getline; print "        value: test-only-placeholder"; next }
  { print }
' "$repo_root/render.yaml" > "$fixture_root/render.yaml"
expect_rejected 'inline secret'

awk '
  /- key: NINJA_SECRET_KEY/ { print; getline; print "        sync: true"; next }
  { print }
' "$repo_root/render.yaml" > "$fixture_root/render.yaml"
expect_rejected 'unprotected secret slot'

printf '%s\n' 'approved Ninja manifest checks passed'
