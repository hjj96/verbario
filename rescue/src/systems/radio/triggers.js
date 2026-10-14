// What makes the radio talk (DESIGN §5 «когда» column): event hooks + light state polling.
//
// Events → lines: mission:start (d_start, d_datum, w_ready), weather:preset / weather:pressure (d_front,
// d_clear, k_sun), weather:gust (p_gust at the front's arrival), weather:lightning («вспышка — гром»
// count p_thunder), weather:charge (p_stelmo), hazard:warning (d_spout, p_spout_near, d_rogue),
// hazard:near-miss (p_near_miss), hazard:hit (p_emp), heli:* (bingo, damage, winch, capture, slip, snag,
// cabin full, raft, loudspeaker, land, crash), survivor:* (spotted, signal, shout, downwash, boarded,
// lost, pet), fx:gulls (w_gulls), mission:complete / mission:failed (d_success / d_fail).
// Polling (every frame, allocation-free): winch patter «вперёд три… вправо два… стоп» (≤ 1 per 1.2 s),
// basket in the water, swing, ship-deck approach, leaving the search area, nightfall, green sky,
// St. Elmo's fire, EMP, and idle chatter after 60 s of silence.
//
// Lines the mission director says itself (s_vhf, s_ferry, c_help, c_light, sh_cargo, d_cat, d_eye,
// d_clear, w_gulls, p_rocket, d_call-N) share ids with ours, so whichever comes first wins.
import {
  bearingDeg, clockWords, countWords, distWords, fromWords, toWords, sideWords, squareOf, metresGenitive,
  metresWords, degreesWords, numberWords, countSeconds, kmWords,
} from './words.js';

const SEV = { calm: 0, nightCalm: 0, overcast: 1, fog: 1, clearing: 1, squall: 2, storm: 3, nightStorm: 4 };
const GUST_MAX = { calm: 3, overcast: 14, squall: 25, storm: 36, nightStorm: 32, fog: 3, clearing: 9, nightCalm: 2 };
const GROUP_NOM = { hull: 'Лодка', container: 'на контейнере', deck: 'на палубе', wreck: 'на судне', plane: 'на самолёте', raft: 'Плот' };
const PATTER_EVERY = 1.2;
const IDLE_AFTER = 60;

export class RadioTriggers {
  constructor(radio) {
    this.radio = radio;
    this.ctx = radio.ctx;
    this.timers = []; // {t, fn} on the radio clock
    this._reset();
  }

  _reset() {
    this.timers.length = 0;
    this.f = {
      spout: false, damage: false, crit: false, night: 0, nightArmed: false, green: false,
      stelmo: false, emp: false, water: false, swing: 0, deckPad: null, outside: false, idleAt: 0,
      lastGust: -1e9, winchState: 'stowed', patterT: -1e9, patterText: '', started: -1e9, bingo: false,
    };
  }

  later(delay, fn) {
    this.timers.push({ t: this.radio.clock + delay, fn });
  }

  init() {
    const ctx = this.ctx;
    const on = (n, fn) =>
      ctx.events.on(n, (p) => {
        try {
          fn(p || {});
        } catch (err) {
          console.error(`[radio] ${n} handler failed`, err);
        }
      });
    const R = this.radio;
    const playing = () => ctx.mode === 'play';
    const heli = () => ctx.heli;

    on('mission:setup', () => {
      this._reset();
      R.clear();
    });
    on('game:mode', ({ to }) => {
      if (to === 'title') R.clear();
    });

    on('mission:start', ({ def }) => {
      this.f.started = R.clock;
      this.f.idleAt = R.clock;
      const ws = ctx.weather?.state;
      this.f.nightArmed = (ws?.night ?? 0) < 0.45;
      if (!def || def.attract) return;
      const d = def.dispatch;
      if (d && !def.endless) {
        R.line('d_start', { square: d.square || squareOf(d.x || 0, d.z || 0), count: d.countWords || countWords(d.count || 1) });
        R.line('d_datum', { dir: d.dir || 'к северу', dist: d.distWords || distWords(d.dist || 400) });
      }
      R.line('w_ready');
    });

    // ---- weather ----------------------------------------------------------------------------------
    on('weather:preset', (p) => {
      if (!playing() || !(p.over > 0)) return;
      const ws = ctx.weather?.state;
      if (p.worse || SEV[p.to] > SEV[p.from]) {
        const from = p.windFrom ?? ws?.windFrom ?? 300;
        R.line('d_front', { dir: fromWords(from), gust: metresGenitive(p.gust ?? GUST_MAX[p.to] ?? 20) });
      }
      if (p.to === 'clearing' && p.from !== 'clearing') {
        R.line('d_clear');
        this.later(7, () => R.line('k_sun'));
      }
    });
    on('weather:pressure', ({ trend }) => {
      if (!playing() || !(trend < 0)) return;
      const w = ctx.weather;
      let fc = null;
      try {
        fc = w?.forecast?.()?.[0];
      } catch {
        fc = null;
      }
      const cur = w?.state?.preset;
      if (fc && fc.in <= 20 && SEV[fc.preset] > (SEV[cur] ?? 0)) {
        R.line('d_front', { dir: fromWords(w.state.windFrom ?? 300), gust: metresGenitive(GUST_MAX[fc.preset] || 20) });
      }
    });
    on('weather:gust', (p) => {
      if (!playing()) return;
      this.f.lastGust = R.clock + (p.eta || 6);
      if (!p.harmless && (p.strength || 0) >= 7) this.later(Math.max(0, (p.eta || 6) - 0.3), () => R.line('p_gust'));
    });
    on('weather:lightning', (p) => {
      if (!playing() || p.cloudOnly) return;
      const d = p.distance || 0;
      if (d > 15 && d < 40) R.line('p_near_miss');
      else if (d > 700 && d < 3200) R.line('p_thunder', { count: countSeconds(Math.min(9, d / 343)), km: capital(kmWords(d)) });
    });
    on('weather:charge', (p) => {
      if (playing() && p.heli) R.line('p_stelmo');
    });

    // ---- hazards ----------------------------------------------------------------------------------
    on('hazard:warning', (p) => {
      if (!playing()) return;
      const h = heli();
      if (p.type === 'waterspout' || p.type === 'tornado') {
        if (!this.f.spout) {
          this.f.spout = true;
          R.line('d_spout');
        }
        if (p.stage === 'near' && h && p.position) {
          R.line('p_spout_near', { side: sideWords(h.heading, p.position.x - h.position.x, p.position.z - h.position.z) });
        }
      } else if (p.type === 'rogue' && p.stage === 'radio') {
        let dir = typeof p.from === 'string' && p.from.startsWith('с') ? p.from : null;
        if (!dir && p.dir) dir = fromWords(bearingDeg(-p.dir.x, -(p.dir.y ?? p.dir.z ?? 0)));
        R.line('d_rogue', { dir: dir || 'с запада' });
      }
    });
    on('hazard:near-miss', (p) => {
      if (playing() && p.type === 'lightning') R.line('p_near_miss');
    });
    on('hazard:hit', (p) => {
      if (playing() && (p.type === 'lightning' || p.source === 'lightning')) R.line('p_emp');
    });

    // ---- helicopter -------------------------------------------------------------------------------
    on('heli:fuel-low', (p) => {
      if (p.level === 'bingo' && !this.f.bingo) {
        this.f.bingo = true;
        R.line('p_bingo');
        R.line('d_bingo');
      }
    });
    on('heli:refuel', (p) => {
      if (p.state === 'done') this.f.bingo = false;
    });
    on('heli:damage', (p) => {
      const hull = p.hull ?? heli()?.hull ?? 1;
      if (hull < 0.25 && !this.f.crit) {
        this.f.crit = true;
        this.f.damage = true;
        R.line('p_hull_crit');
      } else if (hull < 0.5 && !this.f.damage) {
        this.f.damage = true;
        R.line('p_damage');
      }
    });
    on('heli:crash', () => {
      R.clear();
      this.later(4.2, () => R.line('d_crash'));
    });
    on('heli:winch', (p) => {
      const prev = this.f.winchState;
      this.f.winchState = p.state;
      if (p.state === 'lowering' && prev === 'stowed') {
        this.f.water = false;
        R.line('w_hover');
      }
      if (p.state === 'stowed') this.f.water = false;
    });
    on('heli:capture', ({ survivor: s }) => {
      R.line('w_in');
      if (s && (s.type === 'injured' || s.priority)) R.line('k_injured');
      else if (s && s.panic) R.line('k_calm');
    });
    on('heli:slip', () => R.line('w_slip'));
    on('heli:snag', () => R.line('w_snag'));
    on('heli:cabin-full', () => R.line('w_full'));
    on('heli:raft-throw', () => R.line('w_raft'));
    on('heli:raft-drop', () => R.line('w_raft'));
    on('heli:loudspeaker', () => R.line('w_horn', {}, { immediate: true }));
    on('heli:land', ({ pad }) => {
      if (!playing() || !pad) return;
      if (pad.refuel !== false && (pad.services?.fuel ?? 1) > 0) this.later(1.4, () => R.line('d_refuel'));
      if (R.clock - this.f.lastGust < 90) this.later(3.5, () => R.line('w_land'));
    });

    // ---- survivors --------------------------------------------------------------------------------
    on('survivor:spotted', ({ s }) => {
      const h = heli();
      if (!playing() || !s?.position || !h) return;
      const dx = s.position.x - h.position.x;
      const dz = s.position.z - h.position.z;
      const vars = { clock: clockWords(h.heading, dx, dz), dist: distWords(Math.hypot(dx, dz)), count: countWords(s.remaining ?? s.count ?? 1) };
      if (s.type === 'raft') R.line('p_spot_raft', vars);
      else if (s.type === 'swimmer' || s.type === 'injured') R.line('p_spot', vars);
      else if (s.type === 'hull') R.line('p_spot_hull', vars);
      else R.line('p_spot_group', { ...vars, what: capital(GROUP_NOM[s.type] || 'в воде') });
    });
    on('survivor:signal', (p) => {
      const h = heli();
      if (!playing() || !h) return;
      const x = p.x ?? p.s?.position?.x;
      const z = p.z ?? p.s?.position?.z;
      if (x === undefined) return;
      const dx = x - h.position.x;
      const dz = z - h.position.z;
      if (p.kind === 'rocket') R.line('p_rocket', { clock: clockWords(h.heading, dx, dz) });
      // «первый свист»: the line's own 600 s cooldown keeps it rare; a stale (dropped) one may come back
      else if (p.kind === 'whistle') R.line('p_whistle', { dir: toWords(bearingDeg(dx, dz)) });
    });
    on('survivor:shout', (p) => {
      if (playing() && p.reason !== 'loudspeaker') R.line('s_shout', {}, { pos: p.s?.position });
    });
    on('survivor:downwash', () => playing() && R.line('w_low'));
    on('survivor:boarded', ({ person }) => {
      if (!playing()) return;
      R.line('w_aboard');
      if (!person) return;
      if (person.child) this.later(2.5, () => R.line('s_child'));
      else if (person.gender === 'f' && !person.injured) this.later(2.5, () => R.line('s_thanks'));
    });
    on('survivor:pet', (p) => {
      if (playing() && p.pet === 'dog' && p.action === 'bark') R.line('s_dog', {}, { pos: p.s?.position });
    });
    on('survivor:lost', ({ s }) => {
      if (!playing()) return;
      const pos = s?.position;
      R.line('d_lost', { square: pos ? this._square(pos.x, pos.z) : 'Анна-один' });
    });
    on('fx:gulls', (p) => {
      if (playing() && p.state === 'leave') R.line('w_gulls');
    });

    // ---- mission end -------------------------------------------------------------------------------
    on('mission:complete', () => R.line('d_success'));
    on('mission:failed', (p) => {
      if (p.reason === 'abort' || p.reason === 'time' || p.reason === 'lost') R.line('d_fail');
    });
  }

  _square(x, z) {
    try {
      return this.ctx.mission?.square?.(x, z) || squareOf(x, z);
    } catch {
      return squareOf(x, z);
    }
  }

  // DESIGN §6.4: interference = clamp(.15 + .6·intensity + dist/6000, 0, 1); the intercom is clean.
  interferenceFor(item) {
    if (item.channel === 'ics' || item.fx === 'megaphone') return 0;
    const ctx = this.ctx;
    const I = ctx.weather?.state?.intensity ?? 0;
    const h = ctx.heli?.position;
    let dist = 2500;
    if (h) {
      const pads = ctx.world?.pads || [];
      let ref = null;
      if (item.speaker === 'ship') ref = pads.find((p) => p.type === 'ship');
      else if (item.speaker === 'coastguard') ref = pads.find((p) => p.type === 'lighthouse');
      else if (item.speaker === 'dispatch') ref = pads[0];
      if (item.pos) dist = Math.hypot(item.pos.x - h.x, item.pos.z - h.z);
      else if (ref?.position) dist = Math.hypot(ref.position.x - h.x, ref.position.z - h.z) + (item.speaker === 'dispatch' ? 1500 : 0);
      else if (item.speaker === 'survivor') dist = 800;
    }
    const extra = item.channel === 'handheld' ? 0.3 : 0;
    return Math.max(0, Math.min(1, 0.15 + 0.6 * I + dist / 6000 + extra));
  }

  // ---------------------------------------------------------------------------------------------
  update(dt) {
    const R = this.radio;
    const now = R.clock;
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      if (now >= tm.t) {
        this.timers.splice(i, 1);
        try {
          tm.fn();
        } catch (err) {
          console.error('[radio] timer failed', err);
        }
      }
    }
    const ctx = this.ctx;
    const h = ctx.heli;
    if (!h || !h.position) return;
    const ws = ctx.weather?.state;
    if (R.speaking) this.f.idleAt = now;

    this._winch(h, now, dt);
    if (h.alive === false) return;

    // ship deck approach: «Арктур» gives the deck, Гордеев warns about the swell
    const pads = ctx.world?.pads;
    if (pads && !h.landed) {
      for (const pad of pads) {
        if (pad.type !== 'ship' || !pad.position) continue;
        const d = Math.hypot(pad.position.x - h.position.x, pad.position.z - h.position.z);
        if (this.f.deckPad === pad) {
          if (d > 600) this.f.deckPad = null;
        } else if (d < 220 && (h.altitude ?? 50) < 80 && ((h.cabin?.length || 0) > 0 || (h.fuel ?? 1) < 0.6)) {
          this.f.deckPad = pad;
          const wv = this._wind(pad.position.x, pad.position.z);
          const tilt = Math.abs(pad.tilt || 0) * 57.3;
          R.line('sh_deck', { wind: metresWords(Math.max(1, Math.round(wv))), pitch: degreesWords(Math.max(1, Math.round(tilt))) });
          R.line('p_deck');
        }
      }
    }

    // outside the search area
    const area = ctx.mission?.def?.area?.radius;
    if (area) {
      const r = Math.hypot(h.position.x, h.position.z);
      if (!this.f.outside && r > area + 30) {
        this.f.outside = true;
        R.line('d_outside');
      } else if (this.f.outside && r < area - 60) this.f.outside = false;
    }

    if (ws) {
      // nightfall (transition into a night preset during the flight)
      const night = ws.night || 0;
      if (night < 0.45) this.f.nightArmed = true;
      if (this.f.nightArmed && night > 0.6 && now - this.f.started > 5) {
        this.f.nightArmed = false;
        R.line('d_night');
      }
      if ((ws.greenTint || 0) > 0.5 && !this.f.green) {
        this.f.green = true;
        R.line('p_green');
      }
      const elmo = (ws.stElmo || 0) > 0.35;
      if (elmo && !this.f.stelmo) R.line('p_stelmo');
      this.f.stelmo = elmo;
    }
    const emp = (h.emp || 0) > 0;
    if (emp && !this.f.emp) R.line('p_emp');
    this.f.emp = emp;

    // idle chatter after 60 s of silence (night: Костя, day: Семёныч)
    if (now - this.f.idleAt > IDLE_AFTER && now - this.f.started > IDLE_AFTER && h.winch?.state === 'stowed') {
      this.f.idleAt = now;
      R.line((ws?.night || 0) > 0.5 ? 'k_idle' : 'w_borsch');
    }
  }

  _wind(x, z) {
    const w = this.ctx.weather;
    if (!w?.windAt) return w?.state?.windSpeed || 0;
    if (!this._wv) this._wv = new (this.ctx.THREE.Vector2)();
    try {
      w.windAt(x, z, this._wv);
      return this._wv.length();
    } catch {
      return w.state?.windSpeed || 0;
    }
  }

  // Winch: basket in the water, swing warning, and the patter «вперёд три… вправо два… стоп… держать».
  _winch(h, now, dt) {
    const w = h.winch;
    const R = this.radio;
    if (!w || !w.state || w.state === 'stowed' || h.landed) {
      this.f.swing = 0;
      return;
    }
    // swing (> 15°) or a long unsteady spell while working
    if ((w.length || 0) > 3) {
      const bad = Math.abs(w.swing || 0) > 0.26 || (w.steadiness ?? 1) < 0.25;
      this.f.swing = bad ? this.f.swing + dt : Math.min(0, this.f.swing + dt);
      if (this.f.swing > 0.8) {
        this.f.swing = -4;
        R.line('w_swing');
      }
    }
    if (w.load) return;
    if (!this.f.water && (w.state === 'lowering' || w.state === 'down') && (w.length || 0) > 2 && (w.height ?? 9) < 0.6) {
      this.f.water = true;
      R.line('w_water');
      return;
    }
    if (now - this.f.patterT < PATTER_EVERY) return;
    let tgt = w.target;
    if (!tgt?.position) {
      try {
        tgt = this.ctx.survivors?.nearestFor?.(w.basket.x, w.basket.z, 25) || null;
      } catch {
        tgt = null;
      }
    }
    if (!tgt?.position || !w.basket) return;
    const dx = tgt.position.x - w.basket.x;
    const dz = tgt.position.z - w.basket.z;
    const d = Math.hypot(dx, dz);
    if (d > 30) return;
    const r = w.radius || 3;
    let text;
    if ((w.capture || 0) > 0.45) text = 'Хорошо держишь.';
    else if (d <= r) text = (w.steadiness ?? 1) < 0.45 ? 'Стоп, стоп… держать…' : 'Держать… держать…';
    else {
      const hd = h.heading || 0;
      const fwd = dx * Math.sin(hd) - dz * Math.cos(hd);
      const right = dx * Math.cos(hd) + dz * Math.sin(hd);
      const a = Math.abs(fwd) >= Math.abs(right) ? [fwd, right, 'Вперёд', 'Назад', 'вправо', 'влево'] : [right, fwd, 'Вправо', 'Влево', 'вперёд', 'назад'];
      text = `${a[0] > 0 ? a[2] : a[3]} ${numberWords(Math.min(30, Math.max(1, Math.round(Math.abs(a[0])))))}…`;
      if (Math.abs(a[1]) > 1.2) text += ` ${a[1] > 0 ? a[4] : a[5]} ${numberWords(Math.min(30, Math.round(Math.abs(a[1]))))}…`;
    }
    if (text === this.f.patterText && now - this.f.patterT < 2 * PATTER_EVERY) return;
    if (R.say('winchman', text, { id: 'w_patter', priority: 2, transient: true, cooldown: 0, name: 'БОРТОПЕРАТОР', channel: 'ics' })) {
      this.f.patterT = now;
      this.f.patterText = text;
    }
  }
}

const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
