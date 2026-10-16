# source me (after fetch-swift.sh): puts the extracted Linux Swift toolchain on PATH.
H=${MAYDAY_SWIFT_HOME:-$HOME/.cache/mayday-swift}
export PATH="$H/root/usr/libexec/swift/bin:$PATH"
export LD_LIBRARY_PATH="$H/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
