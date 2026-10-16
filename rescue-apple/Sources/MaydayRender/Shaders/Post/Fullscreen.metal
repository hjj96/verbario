// Fullscreen.metal — one oversized triangle per full-screen pass (three's FullScreenQuad equivalent).
// vUv follows the GL convention (0,0 = bottom-left of the VIEWPORT, 1,1 = top-right) so ported
// GLSL keeps its vUv maths; render-target reads go through rtUV()/rtUVScaled() (Common/GL.h).
#include "FullscreenTypes.h"

vertex FSVaryings fullscreen_vs(uint vid [[vertex_id]]) {
  // vid 0, 1, 2 → (0,0), (2,0), (0,2) → clip (−1,−1), (3,−1), (−1,3)
  float x = float((vid << 1) & 2u);
  float y = float(vid & 2u);
  FSVaryings o;
  o.position = float4(x * 2.0f - 1.0f, y * 2.0f - 1.0f, 0.0f, 1.0f);
  o.vUv = float2(x, y);   // clip y up = top of the viewport = GL v 1
  return o;
}
