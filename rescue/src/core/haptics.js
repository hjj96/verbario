// Gamepad rumble driven by game events (DESIGN §7.6 «Вибрация»). Scaled by settings.vibration and
// silent unless a pad is the active device, so keyboard players never get stray vibration calls.
const RULES = {
  // event: (payload, ctx) => [strength 0..1, duration ms] | null
  'heli:damage': (p) => [Math.min(1, 0.35 + (p.amount || 0) * 3), 220],
  'heli:water-strike': () => [0.45, 160],
  'heli:touchdown': () => [0.25, 90],
  'heli:land': (p) => [p.autorotation ? 0.7 : 0.2, 120],
  'heli:crash': () => [1, 700],
  'heli:capture': () => [0.2, 80],
  'heli:pickup': () => [0.3, 110],
  'heli:slip': () => [0.5, 200],
  'heli:snag': () => [0.6, 260],
  'hazard:hit': (p) => [Math.min(1, 0.5 + (p.damage || 0) * 2), 320],
  'weather:gust': (p) => (p.harmless ? null : [Math.min(0.5, (p.strength || 8) / 30), 260]),
  'weather:lightning': (p) => (p.cloudOnly || (p.distance ?? 1e9) > 600 ? null : [Math.max(0.15, 0.7 - p.distance / 900), 240]),
};

export class Haptics {
  constructor(ctx) {
    this.ctx = ctx;
    this.cool = 0;
    for (const [name, rule] of Object.entries(RULES)) {
      ctx.events.on(name, (p) => this._fire(rule(p || {}, ctx)));
    }
  }

  _fire(spec) {
    const { ctx } = this;
    if (!spec || ctx.mode !== 'play' || ctx.input.lastDevice !== 'gamepad') return;
    const scale = ctx.settings.get('vibration') ?? 1;
    if (scale <= 0) return;
    ctx.input.rumble(Math.min(1, spec[0] * scale), spec[1]);
  }
}
