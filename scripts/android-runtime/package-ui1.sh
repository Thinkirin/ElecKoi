#!/usr/bin/env bash
set -euo pipefail

# Run only after the renderer/runtime batch has been frozen and rebuilt.
tag=${1:-ui1}
if [[ ! "$tag" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Invalid release tag: $tag" >&2
  exit 1
fi
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
runtime_cache=${ELECKOI_RUNTIME_CACHE:-$HOME/.cache/eleckoi-unified-runtime}
source=${ELECKOI_PRODUCTION_STAGE:-$runtime_cache/app-release-m3-m4-device4-20261005}
stage="$runtime_cache/app-release-m3-m4-$tag-20261005"
node=${ELECKOI_BUILD_NODE:-$HOME/.cache/eleckoi-unified-build/tooling/node/bin/node}
output="$repo/build/android-runtime"
assets="$output/runtime-assets-m3-m4-$tag"
archive="$output/app-release-m3-m4-$tag-20261005.tar.gz"

if [[ -e "$stage" || -e "$stage.tar.gz" || -e "$assets" || -e "$archive" ]]; then
  echo "$tag stage/archive/assets already exist; preserve the prior release." >&2
  exit 1
fi

# Preserve device4 and reuse its installed production closure; do not resolve/install packages.
cp -a --reflink=auto "$source" "$stage"
cd "$repo"
"$node" scripts/android-runtime/build-host-package.mjs \
  --output "$stage" --reuse-production "$stage" \
  --native-downloads "$output/downloads"

cp "$stage.tar.gz" "$archive"
cp "$stage.tar.gz.sha256" "$archive.sha256"
"$node" scripts/android-runtime/assemble-assets.mjs \
  --rootfs "$output/rootfs-device1-20261005.tar.gz" \
  --node "$output/node.tar.gz" \
  --app "$stage.tar.gz" \
  --version "m3-m4-unified-20261005-$tag" \
  --output "$assets"
