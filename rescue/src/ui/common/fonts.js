// Canvas font strings for the in-flight canvases (overlay 60 Hz, radar 30 Hz, map). Built once per
// (weight, pixel size, family) and cached under a numeric key, so drawing a label never allocates a
// new font string per frame.
export const MONO = 0;
export const HEAD = 1;
const FAMILY = [
  '"JetBrains Mono", ui-monospace, "DejaVu Sans Mono", monospace',
  'Oswald, Impact, "Arial Narrow", "Roboto Condensed", sans-serif',
];
const cache = new Map();

export function font(weight, px, family = MONO) {
  const p = Math.max(1, Math.round(px));
  const key = (weight * 1000 + p) * 2 + family;
  let s = cache.get(key);
  if (s === undefined) {
    s = `${weight} ${p}px ${FAMILY[family]}`;
    cache.set(key, s);
  }
  return s;
}
