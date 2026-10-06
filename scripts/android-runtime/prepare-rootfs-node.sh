#!/usr/bin/env bash
set -euo pipefail
downloads="${1:?Provide the verified downloads directory}"
stage="${2:?Provide an empty Linux runtime stage directory}"
output="${3:?Provide the archive output directory}"
mkdir -p "$stage/rootfs" "$stage/node" "$output"
if find "$stage/rootfs" "$stage/node" -mindepth 1 -print -quit | grep -q .; then
  echo "Runtime rootfs/node stage must be empty: $stage" >&2
  exit 1
fi
(cd "$downloads"; grep ' node-v24.19.0-linux-arm64.tar.xz$' node-v24.19.0-SHASUMS256.txt | sha256sum -c -)
tar -xzf "$downloads/ubuntu-base-24.04.4-arm64.tar.gz" -C "$stage/rootfs"
mkdir -p "$stage/node/usr"
tar -xJf "$downloads/node-v24.19.0-linux-arm64.tar.xz" --strip-components=1 -C "$stage/node/usr"
test -x "$stage/node/usr/bin/node"
test -f "$stage/rootfs/usr/lib/aarch64-linux-gnu/libstdc++.so.6"
test -f "$stage/rootfs/usr/lib/aarch64-linux-gnu/libgcc_s.so.1"
# Android app-private storage can reject link(2), even for two files in the
# same directory. Materialize hardlinks while retaining symlinks and modes.
tar --hard-dereference -czf "$output/rootfs.tar.gz" -C "$stage/rootfs" .
tar --hard-dereference -czf "$output/node.tar.gz" -C "$stage/node" .
(cd "$output"; sha256sum rootfs.tar.gz node.tar.gz > runtime-base.sha256)
echo "Prepared ARM64 rootfs and Node24 ABI137 archives in $output"
