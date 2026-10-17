#!/usr/bin/env bash
# Create the GitHub release for RELEASE_TAG with every file release-assets.json
# names, the manifest and SHA256SUMS. A prerelease is a GitHub prerelease
# unless MOVE_LATEST (npm's latest follows betas) is true; otherwise the release
# is latest, so releases/latest/download/<name> serves its assets.
# With --dry-run, print the command and download URLs instead of running it.
set -euo pipefail

dry_run=false
if [[ ${1-} == --dry-run ]]; then
  dry_run=true
  shift
fi
manifest=${1:?release-assets.json path required}
asset_dir=${2:?downloaded artifacts directory required}
: "${GITHUB_REPOSITORY:?}" "${RELEASE_TAG:?}" "${PRERELEASE:?}" "${MOVE_LATEST:?}"
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

bash "$script_dir/prepare-release-assets.sh" "$manifest" "$asset_dir"
assets=("$manifest" "$asset_dir/SHA256SUMS")
mapfile -t names < <(jq -er '.[][][]' "$manifest")
for name in "${names[@]}"; do
  assets+=("$asset_dir/$name")
done
if [[ $PRERELEASE == true && $MOVE_LATEST != true ]]; then
  channel=--prerelease
  base="https://github.com/$GITHUB_REPOSITORY/releases/download/$RELEASE_TAG"
else
  channel=--latest
  base="https://github.com/$GITHUB_REPOSITORY/releases/latest/download"
fi
command=(gh release create "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY"
  --verify-tag --generate-notes "$channel" "${assets[@]}")

if ! $dry_run; then
  exec "${command[@]}"
fi
printf '%s\n' "${command[*]}"
for asset in "${assets[@]}"; do
  echo "$base/$(basename "$asset")"
done
