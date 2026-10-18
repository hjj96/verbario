#!/bin/sh
# Pre-flight for the Xcode-only Swift (MaydayRender + MaydayApp + AppIOS / AppMac + MaydayRenderTests)
# on Linux: builds MaydayCore with SwiftPM (package in Core/), builds stub modules for the Apple frameworks the app
# imports (stubs/src: Metal, MetalKit, QuartzCore, simd, CoreGraphics, Combine, CoreHaptics, GameController,
# UIKit | AppKit, SwiftUI — the API surface the code uses, with the Swift names and signatures of the
# Apple SDK), then type-checks the app module twice (iOS pass: os(iOS) = true; macOS pass) in Swift 5
# mode like Configs/Base.xcconfig, plus the render tests against it. Finally runs harness/main.swift:
# the app's GameSession (MaydayCore's real systems) on the real exported data, no GPU — the web session
# trace (Tests/Vectors/app), touch mapping, render snapshot packing, camera framing, DrawList ordering.
# A stub can only be as right as its author: a pass here means "consistent with the stubs", it does
# not replace an Xcode build. Actor isolation (@MainActor in the SDKs) is not modelled.
#   . tools/applecheck/env.sh && tools/applecheck/check-swift.sh [--no-harness]
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${MAYDAY_CHECK_OUT:-${TMPDIR:-/tmp}/mayday-applecheck}
mkdir -p "$out"
cd "$out"

echo "== MaydayCore (swift build)"
swift build --package-path "$repo/Core" --scratch-path "$out/core" --target MaydayCore 2>&1 | grep -E "error|warning: |Compiling|Build" | tail -3
core=$(dirname "$(find "$out/core" -path '*/debug/Modules/MaydayCore.swiftmodule' | head -1)")/..
core=$(cd "$core" && pwd)

stubs() { # pass
  p=$1; o=$out/stubs-$p; mkdir -p "$o"
  if [ "$p" = ios ]; then D=IOS; PLAT=UIKit; else D=MAC; PLAT=AppKit; fi
  for m in simd CoreGraphics Metal QuartzCore Combine CoreHaptics GameController $PLAT MetalKit SwiftUI; do
    extra=""; [ "$m" = simd ] && extra=-import-underlying-module
    swiftc -swift-version 5 -parse-as-library -emit-library -static -emit-module -module-name "$m" -D "$D" $extra \
      -I "$o" -I "$here/stubs/cinclude" -o "$o/lib$m.a" -emit-module-path "$o/$m.swiftmodule" "$here/stubs/src/$m.swift"
  done
}

common() { # stub dir
  echo "-swift-version 5 -I $1 -I $here/stubs/cinclude -I $core/Modules -Xcc -fmodule-map-file=$core/CJSMath.build/module.modulemap -Xcc -I$repo/Core/Sources/CJSMath/include -I $repo/Sources/MaydayRender/Shaders -Xcc -I$here/stubs/cinclude -D DEBUG"
}

for p in ios mac; do
  echo "== app type-check ($p)"
  stubs $p
  w=$out/work-$p; rm -rf "$w"; mkdir -p "$w/src" "$w/mod"
  if [ $p = ios ]; then IOS=true; MAC=false; ENTRY=AppIOS; else IOS=false; MAC=true; ENTRY=AppMac; fi
  for f in $(find "$repo/Sources/MaydayRender" "$repo/Sources/MaydayApp" "$repo/Sources/$ENTRY" -name '*.swift' | sort); do
    rel=$(echo "${f#$repo/Sources/}" | sed 's#/#__#g')
    sed "s/os(iOS)/$IOS/g; s/os(macOS)/$MAC/g; s/targetEnvironment(simulator)/false/g" "$f" > "$w/src/$rel"
  done
  swiftc $(common "$out/stubs-$p") -parse-as-library -emit-module -enable-testing -module-name MaydayApp \
    -o "$w/mod/MaydayApp.swiftmodule" "$w"/src/*.swift
  swiftc $(common "$out/stubs-$p") -typecheck -I "$w/mod" "$repo"/Tests/MaydayRenderTests/*.swift
  echo "ok   app + MaydayRenderTests ($p)"
done

[ "$1" = "--no-harness" ] && exit 0
echo "== runtime harness (macOS sources, Linux run)"
w=$out/work-mac
srcs=""
for f in "$w"/src/*.swift; do
  # platform UI / input / haptics files need frameworks the harness does not link
  case "$(basename "$f")" in AppMac__*|MaydayApp__GameHost.swift|MaydayApp__MetalView.swift|MaydayApp__RootView.swift|MaydayApp__DebugOverlay.swift|\
    MaydayApp__Input__GamepadAdapter.swift|MaydayApp__Input__HapticsDriver.swift|MaydayApp__Input__TouchControlsView.swift|\
    MaydayApp__Persistence__SettingsStore.swift) ;; *) srcs="$srcs $f";; esac
done
swiftc $(common "$out/stubs-mac") -O -module-name BootHarness $srcs "$here"/harness/*.swift \
  "$core"/MaydayCore.build/*.o "$core"/CJSMath.build/*.o -L "$out/stubs-mac" -lQuartzCore -lMetal -lCoreGraphics -lsimd -o "$out/bootharness"
# Linux Bundle(path:) treats a `Resources/` folder as the resource directory: mirror the app bundle
rm -rf "$out/bundle"; mkdir -p "$out/bundle/Resources"; ln -s "$repo/Resources" "$out/bundle/Resources/Resources"
"$out/bootharness" "$out/bundle" "$repo/Tests/Vectors"
