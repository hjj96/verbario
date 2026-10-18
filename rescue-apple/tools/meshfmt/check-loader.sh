#!/bin/sh
# Linux check of the Swift .mmesh parser: verify.mjs writes a per-file summary from the JS decoder
# (tools/meshfmt/read.mjs), then Sources/MaydayRender/Mesh/MMeshFile.swift (Foundation only) is compiled
# with loader-check/main.swift and must parse every Resources/Meshes/*.mmesh to the same fields.
#   . tools/applecheck/env.sh && tools/meshfmt/check-loader.sh        (artefacts in $MAYDAY_CHECK_OUT/meshfmt)
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${MAYDAY_CHECK_OUT:-${TMPDIR:-/tmp}/mayday-applecheck}/meshfmt
mkdir -p "$out"
node "$here/verify.mjs" --summary "$out/summary.json"
swiftc -O -swift-version 5 -module-name LoaderCheck "$repo/Sources/MaydayRender/Mesh/MMeshFile.swift" "$here/loader-check/main.swift" -o "$out/loader-check"
"$out/loader-check" "$repo/Resources/Meshes" "$out/summary.json"
