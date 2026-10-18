#!/bin/sh
# Linux runtime check of MaydayRender's helicopter code (no GPU): every Sources/MaydayRender Swift file is
# compiled (macOS pass, like tools/applecheck/check-swift.sh) against the applecheck stub frameworks with
# render-check/main.swift, linked with MaydayCore, and run on the repository's real data: baked meshes
# through the manifest, HeliTransforms vs three's matrixWorld (vectors/heli_transforms.json, bitwise),
# HeliShaderTypes.h ⇄ HeliShaderLayout numbers, a real Core Helicopter → snapshot → uniform blocks.
#   . tools/applecheck/env.sh && tools/meshfmt/check-render.sh      (artefacts in $MAYDAY_CHECK_OUT/meshfmt)
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
ac=$repo/tools/applecheck
base=${MAYDAY_CHECK_OUT:-${TMPDIR:-/tmp}/mayday-applecheck}
out=$base/meshfmt
mkdir -p "$out"

swift build --package-path "$repo/Core" --scratch-path "$base/core" --target MaydayCore 2>&1 | grep -E "error|warning: " | tail -3 || true
core=$(dirname "$(find "$base/core" -path '*/debug/Modules/MaydayCore.swiftmodule' | head -1)")/..
core=$(cd "$core" && pwd)

st=$out/stubs-mac; mkdir -p "$st"
for m in simd CoreGraphics Metal QuartzCore; do   # what MaydayRender imports
  extra=""; [ "$m" = simd ] && extra=-import-underlying-module
  swiftc -swift-version 5 -parse-as-library -emit-library -static -emit-module -module-name "$m" -D MAC $extra \
    -I "$st" -I "$ac/stubs/cinclude" -o "$st/lib$m.a" -emit-module-path "$st/$m.swiftmodule" "$ac/stubs/src/$m.swift"
done

w=$out/render-src; rm -rf "$w"; mkdir -p "$w"
for f in $(find "$repo/Sources/MaydayRender" -name '*.swift' | sort); do
  rel=$(echo "${f#$repo/Sources/}" | sed 's#/#__#g')
  sed "s/os(iOS)/false/g; s/os(macOS)/true/g; s/targetEnvironment(simulator)/false/g" "$f" > "$w/$rel"
done
swiftc -swift-version 5 -O -module-name RenderCheck -I "$st" -I "$ac/stubs/cinclude" -I "$core/Modules" \
  -Xcc -fmodule-map-file="$core/CJSMath.build/module.modulemap" -Xcc -I"$repo/Core/Sources/CJSMath/include" \
  -I "$repo/Sources/MaydayRender/Shaders" -Xcc -I"$ac/stubs/cinclude" -D DEBUG \
  "$w"/*.swift "$here/render-check/main.swift" "$core"/MaydayCore.build/*.o "$core"/CJSMath.build/*.o \
  -L "$st" -lQuartzCore -lMetal -lCoreGraphics -lsimd -o "$out/render-check"
"$out/render-check" "$repo"
