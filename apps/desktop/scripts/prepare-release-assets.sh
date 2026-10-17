#!/usr/bin/env bash
# Validate the manifest's installer files and write user-facing checksums.
set -euo pipefail

manifest=${1:?release-assets.json path required}
asset_dir=${2:?downloaded artifacts directory required}
mapfile -t names < <(jq -er '.[][][]' "$manifest")
if (( ${#names[@]} == 0 )); then
  echo 'release asset manifest is empty' >&2
  exit 1
fi
for name in "${names[@]}"; do
  if [[ ! -f "$asset_dir/$name" ]]; then
    echo "release asset missing: $name" >&2
    exit 1
  fi
done
(
  cd "$asset_dir"
  sha256sum "${names[@]}" > SHA256SUMS
  sha256sum -c SHA256SUMS
)
