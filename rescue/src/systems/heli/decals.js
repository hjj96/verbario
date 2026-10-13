// Livery decal atlas for «Чайка-07» (DESIGN §2.9): one canvas texture shared by every decal patch.
//
//   canvas 1024×512, texture space (s right, t up):
//   ┌──────────────┬──────────────┐
//   │  ROOF PLATE  │ ЧАЙКА-07     │  t 0.75..1   side lettering
//   │  orange, «07»├──────────────┤
//   │  + «СПАС»    │ (spare)      │
//   └──────────────┴──────────────┘
//   s 0..0.5        s 0.5..1
//
// The texture is redrawn once web fonts are ready (Oswald), so the first frame never waits on fonts.
export const DECAL_RECT = {
  roof: [0, 0, 0.5, 1],
  side: [0.5, 0.75, 1, 1],
};

const ORANGE = '#FF4F1A';
const INK = '#121416';
const FONT = '"Oswald", Impact, "Arial Narrow", "Roboto Condensed", sans-serif';

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function drawDecals(g, w, h) {
  g.clearRect(0, 0, w, h);

  // --- roof plate: orange rounded plate, huge black «07», «СПАС» underneath ---------------------
  const R = h; // square region on the left
  g.save();
  roundRect(g, 18, 18, R - 36, R - 36, 34);
  g.fillStyle = ORANGE;
  g.fill();
  // thin dark inner keyline keeps the plate readable on white storm foam
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(18,20,22,0.55)';
  roundRect(g, 34, 34, R - 68, R - 68, 24);
  g.stroke();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = `700 300px ${FONT}`;
  g.fillText('07', R / 2, R * 0.66);
  g.font = `700 92px ${FONT}`;
  // letter-spaced «СПАС»
  const word = 'СПАС';
  const spacing = 18;
  let total = 0;
  for (const ch of word) total += g.measureText(ch).width + spacing;
  total -= spacing;
  let x = R / 2 - total / 2;
  g.textAlign = 'left';
  for (const ch of word) {
    g.fillText(ch, x, R * 0.88);
    x += g.measureText(ch).width + spacing;
  }
  g.restore();

  // --- side lettering «ЧАЙКА-07» (dark on transparent, sits on the warm-white cabin side) -------
  g.save();
  const sx = w / 2;
  const sw = w / 2;
  const sh = h / 4;
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 92px ${FONT}`;
  // squeeze to fit the strip whatever the fallback font width is
  const label = 'ЧАЙКА-07';
  const mw = g.measureText(label).width;
  const scale = Math.min(1, (sw * 0.86) / mw);
  g.translate(sx + sw / 2, sh / 2 + 4);
  g.scale(scale, 1);
  g.fillText(label, 0, 0);
  g.restore();
  // a thin orange underline stripe on the side (the rescue band continues under the name)
  g.fillStyle = ORANGE;
  g.fillRect(sx + sw * 0.06, sh - 16, sw * 0.88, 9);
}
