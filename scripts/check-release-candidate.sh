#!/bin/sh
set -eu

fail() {
  printf '%s\n' "release candidate manifest check failed: $1" >&2
  exit 1
}

repo_root=${RELEASE_MANIFEST_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
manifest_path=${RELEASE_MANIFEST_FILE:-$repo_root/DOCS/RELEASE-CANDIDATE-MANIFEST.txt}

[ -d "$repo_root/.git" ] || fail 'repository root is not a git checkout'
[ -r "$manifest_path" ] || fail 'release candidate manifest is missing or unreadable'

git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
  fail 'repository root is not a git worktree'

candidate_name=$(sed -n 's/^candidate_name=//p' "$manifest_path")
[ -n "$candidate_name" ] || fail 'candidate_name is missing'

required_paths=$(sed -n 's/^required_path=//p' "$manifest_path")
[ -n "$required_paths" ] || fail 'required_path entries are missing'

for required_path in $required_paths; do
  [ -f "$repo_root/$required_path" ] ||
    fail "required candidate file is missing: $required_path"
  git -C "$repo_root" ls-files --error-unmatch -- "$required_path" >/dev/null 2>&1 ||
    fail "required candidate file is not tracked: $required_path"
done

# A release candidate must be reproducible from the checkout. This catches a
# migration or source file that exists locally but was never added to the
# commit being built.
if [ -n "$(git -C "$repo_root" status --porcelain --untracked-files=all)" ]; then
  fail 'working tree contains uncommitted or untracked candidate files'
fi

printf '%s\n' "release candidate manifest is tracked and clean: $candidate_name"
