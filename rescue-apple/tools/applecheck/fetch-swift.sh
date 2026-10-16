#!/bin/sh
# Fetches a Linux Swift toolchain WITHOUT installing it: Ubuntu's swiftlang 6.0.3 packages (the Swift
# version of Xcode 16) + libxml2-16, from archive.ubuntu.com (download.swift.org is not reachable from
# the agent containers). Extracted under $MAYDAY_SWIFT_HOME (default ~/.cache/mayday-swift).
# Then:  . rescue-apple/tools/applecheck/env.sh
set -e
H=${MAYDAY_SWIFT_HOME:-$HOME/.cache/mayday-swift}
mkdir -p "$H/debs" "$H/root"
POOL=http://archive.ubuntu.com/ubuntu/pool
for u in universe/s/swiftlang/swiftlang_6.0.3-2build1_amd64.deb \
         universe/s/swiftlang/libswiftlang_6.0.3-2build1_amd64.deb \
         main/libx/libxml2/libxml2-16_2.14.5+dfsg-0.2ubuntu0.2_amd64.deb; do
  f="$H/debs/$(basename "$u")"
  [ -s "$f" ] || curl -sSf -m 900 -o "$f" "$POOL/$u"
  dpkg-deb -x "$f" "$H/root"
done
echo "toolchain in $H/root — now: . $(dirname "$0")/env.sh && swiftc -version"
