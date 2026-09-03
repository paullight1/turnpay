#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

# GitHub's Ubuntu runner does not guarantee ripgrep is installed. The safety
# gate must still validate a known-good manifest using the POSIX toolchain.
PATH=/usr/bin:/bin "$repo_root/scripts/check-production-manifests.sh"

printf '%s\n' "production manifest portability check passed"
