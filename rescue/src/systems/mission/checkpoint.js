// Checkpoint snapshots of the live hazards (DESIGN §3.9 «каждая посадка — чекпоинт», §3.15 «повтор — с
// последнего чекпоинта»). Hazards have no snapshot API of their own: mission._takeCheckpoint stores each
// live one as plain data, and _restoreCheckpoint spawns it again through hazards.spawn() and sets it back to
// where it was — position, age and remaining life, stage clock, the tornado's curving track, a rogue crest's
// travel and telegraph flags — so a retry replays the same sky, not an approximation of it.

// Scalar fields (number | boolean | string) copied as they are, per hazard type.
const COMMON = ['age', 'life', 'stage', 'stageName', 'eta', 'strength', 'scripted', 'name', 'warned', 'radius'];
const SPOUT = [...COMMON, 'stageT', 'telegraph', 'wander', 'collarR', 'topY', 'scale', 'spin', 'spinRate', 'warned600', 'warned300', 'closePass', 'passDamaged'];
const SCALARS = {
  waterspout: SPOUT,
  tornado: [...SPOUT, 'pathAng', 'pathCurve', 'pathSpeed', 'satTimer', 'boltTimer', 'green'],
  whirlpool: [...COMMON, 'spin'],
  rogue: [...COMMON, 'speed', 'width', 'length', 'height', 'telegraph', 'lead', 'visual', 'threat', '_ue'],
  downburst: [...COMMON, 'telegraph'],
  hail: COMMON,
};
// THREE.Vector2 fields (set in place: the rogue's crest object shares `origin` and `dir`).
const VEC2 = ['lean', 'drift', 'dir', 'origin'];

const plain = (v) => typeof v === 'boolean' || typeof v === 'string' || Number.isFinite(v);

export function snapHazards(hz) {
  const out = [];
  for (const h of hz?.list || []) {
    const keys = h && h.alive !== false && h.position ? SCALARS[h.type] : null;
    if (!keys) continue;
    const o = { type: h.type, x: h.position.x, z: h.position.z };
    for (const k of keys) if (plain(h[k])) o[k] = h[k];
    for (const k of VEC2) if (h[k]?.isVector2) o[k] = [h[k].x, h[k].y];
    if (h.fixedDrift?.isVector2) o.fixedDrift = [h.fixedDrift.x, h.fixedDrift.y];
    if (Array.isArray(h.durations)) o.durations = h.durations.slice();
    if (h.flags) o.flags = { ...h.flags };
    out.push(o);
  }
  return out;
}

// Spawn one snapshot back (returns the live hazard or null). A rogue still in its telegraph re-arms the
// stage it had reached, so the retry hears its last warning again with the eta it has left.
export function restoreHazard(hz, o) {
  if (!hz?.spawn || !o || !SCALARS[o.type]) return null;
  const opts = { x: o.x, z: o.z, scripted: !!o.scripted, name: o.name || undefined, radius: o.radius, spin: o.spin, life: o.life };
  if (o.type === 'waterspout' || o.type === 'tornado') {
    opts.stage = o.stage;
    if (o.fixedDrift) [opts.vx, opts.vz] = o.fixedDrift;
  }
  if (o.type === 'rogue') {
    Object.assign(opts, { height: o.height, speed: o.speed, width: o.width, length: o.length, eta: Math.max(1, (o.telegraph || 12) - (o.lead || 0)) });
    if (o.dir) opts.dir = { x: o.dir[0], y: o.dir[1] };
  }
  const h = hz.spawn(o.type, opts);
  if (!h) return null;
  for (const k of SCALARS[o.type]) if (o[k] !== undefined) h[k] = o[k];
  for (const k of VEC2) if (o[k] && h[k]?.isVector2) h[k].set(o[k][0], o[k][1]);
  if (o.durations && Array.isArray(h.durations)) h.durations = o.durations.slice();
  if (o.flags && h.flags) {
    Object.assign(h.flags, o.flags);
    if (!o.flags.passed && o.stage in h.flags && o.stage !== 'passed') h.flags[o.stage] = false;
  }
  if (h.crest) h.crest.height = h.height;
  h.position.set(o.x, h.position.y || 0, o.z);
  return h;
}
