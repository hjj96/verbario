#!/bin/sh
# Pre-flight for the Metal shaders without the Metal compiler: every .metal under
# Sources/MaydayRender/Shaders is compiled by the host clang++ (C++14, -fsyntax-only) against
# msl/include/metal_stdlib — a shim where address spaces and stage keywords vanish, vectors are clang
# ext_vector types with MSL sizes, constructors/builtins are declared overloads, and mixed
# scalar/vector builtin calls are deleted (MSL does not guarantee them). Catches typos, undeclared
# names, vector size/type mismatches, wrong builtin arities, unsuffixed double literals, shadowing.
# Also checks ShaderTypes.h layouts in C11 (the Swift importer's view): its static asserts must hold.
# NOT checked: Metal-only rules (attribute indices, address-space legality, function constants).
here=$(cd "$(dirname "$0")" && pwd)
shaders=$(cd "$here/../../Sources/MaydayRender/Shaders" && pwd)
rc=0
for f in $(find "$shaders" -name '*.metal' | sort); do
  out=$(clang++ -std=c++14 -fsyntax-only -fno-builtin -Wall -Wextra -Wno-unused-parameter -Wno-unknown-attributes \
        -Wno-unused-function -Wimplicit-float-conversion -Wdouble-promotion -Wshadow -I "$here/msl/include" -x c++ "$f" 2>&1)
  if [ -n "$out" ]; then echo "FAIL ${f#$shaders/}"; echo "$out" | grep -E "error|warning" | head -40; rc=1; else echo "ok   ${f#$shaders/}"; fi
done
tmp=$(mktemp -d)
printf '#include "ShaderTypes.h"\nint main(void) { return 0; }\n' > "$tmp/layout.c"
if clang -std=c11 -fsyntax-only -Wall -I "$here/stubs/cinclude" -I "$shaders" "$tmp/layout.c"; then echo "ok   ShaderTypes.h (C11 layouts)"; else rc=1; fi
rm -rf "$tmp"
exit $rc
