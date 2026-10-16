// FullscreenTypes.h — varyings shared by fullscreen_vs (Fullscreen.metal) and the post fragments.
#ifndef MAYDAY_FULLSCREEN_TYPES_H
#define MAYDAY_FULLSCREEN_TYPES_H

#include <metal_stdlib>
using namespace metal;

struct FSVaryings {
  float4 position [[position]];
  float2 vUv;   // GL-style uv over the viewport (0,0 bottom-left)
};

#endif // MAYDAY_FULLSCREEN_TYPES_H
