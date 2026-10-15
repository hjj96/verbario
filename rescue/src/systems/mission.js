// Mission director (CONTRACT «mission», DESIGN §3.14–3.16, §7.1, §7.7): game flow & modes, campaign
// operations, «Смена», objectives, scripted beats, onboarding glyphs, scoring, medals, career persistence,
// crash/abort/complete logic and the debrief logbook payload.
//
// Flow: title (attract scene, weather cycle every 45 s) → briefing (mission:setup) → play (mission:start)
//       ⇄ paused → debrief (cinematic → logbook; mission:complete | mission:failed) → next / retry / menu.
// Only this system calls ctx.setMode(). Gameplay input is enabled in 'play' only.
//
// Helpers in ./mission/: campaign (content), prepare (raw → runtime def), ledger (stats, manifest,
// awards from gameplay events), scoring, progress (career storage), onboarding (hints), endless
// («Смена» calls), manifest (people), report (logbook), text (Russian formatting).
//
// Read-only state for HUD / audio / tests (beyond CONTRACT):
//   state ('title'|'briefing'|'play'|'crash'|'debrief'), index, endless, elapsed, timeLeft, score (running),
//   finalScore, stats, objectives [{id, text, kind:'main'|'bonus', progress, target, done, failed}],
//   task (current task line), hint (current onboarding glyph), chapter {n, text, title}, goldenHour (s|null),
//   calls («Смена»), result + debriefPhase ('cinematic'|'logbook'), manifest, marks, cards(), career, rank,
//   campaignCount, continueIndex, hasProgress, highscores, isUnlocked(i), square(x, z), resetProgress().
// Extra events: mission:chapter {n, text, title}, mission:task {text}, mission:call {call},
//   mission:logbook {report}, mission:locked {index, text}; mission:hint hide = {key, text: null, show: false}.
import * as THREE from 'three';
import * as Stubs from '../core/stubs.js';
import { CAMPAIGN, ENDLESS, TITLE, TITLE_CYCLE } from './mission/campaign.js';
import { prepareDef, cardLine, MUST_TYPES } from './mission/prepare.js';
import { Progress } from './mission/progress.js';
import { Scorer, DIFFICULTY } from './mission/scoring.js';
import { Ledger } from './mission/ledger.js';
import { Onboarding } from './mission/onboarding.js';
import { Shift } from './mission/endless.js';
import { buildReport } from './mission/report.js';
import { buildObjectives, updateObjectives, updateTask } from './mission/objectives.js';
import { windFromDeg, clockOf, clockWords, squareOf, PRESETS } from './mission/text.js';

const CINEMATIC_S = 6.5; // real seconds of debrief cinematic before the logbook
const TITLE_CYCLE_S = 45;
const CRASH_TO_DEBRIEF_S = 3.2; // ditching → slow-mo → rotor stops → camera rises → debrief

export class Mission {
  constructor(ctx) {
    this.ctx = ctx;
    this.progress = new Progress();
    // Campaign summaries for the operations screen (default seeds; start() re-prepares).
    this.list = CAMPAIGN.map((raw, i) => prepareDef(raw, { index: i }));
    this.def = null;
    this.index = -1; // campaign index, -1 for title/endless
    this.endless = false;
    this.state = 'idle'; // 'title' | 'briefing' | 'play' | 'crash' | 'debrief'
    this.elapsed = 0; // seconds of play
    this.timeLeft = null; // seconds or null (no time limit)
    this.scorer = new Scorer(ctx.events);
    this.ledger = new Ledger(this);
    this.objectives = [];
    this.onboarding = new Onboarding(this);
    this.shift = new Shift(this);
    this.result = null; // last debrief report
    this.debriefPhase = null; // 'cinematic' | 'logbook'
    this.task = ''; // current task line («Найдите плот к северу от маяка»)
    this.chapter = null; // { n, text, title }

    this._focusV = new THREE.Vector3();
    this._triggers = new Set();
    this._script = [];
    this._followers = [];
    this._slowT = 0;
    this._slowLeft = 0;
    this._slowValue = 1;
    this._pollRAF = 0;
    this._pausedFrame = -1;
    this._titleT = 0;
    this._titleIdx = 0;
    this._listen();
  }

  init() {
    const ctx = this.ctx;
    if (ctx.input) ctx.input.enabled = false;
    // Auto-pause when the tab is hidden mid-flight.
    this._onVisibility = () => {
      if (document.hidden && ctx.mode === 'play' && this.state === 'play') this.pause();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  // ===============================================================================================
  // Public API (CONTRACT + extras for HUD/audio/tests)
  // ===============================================================================================
  get stats() {
    return this.ledger.stats;
  }
  get manifest() {
    return this.ledger.manifest;
  }
  get marks() {
    return this.ledger.marks;
  }
  get goldenHour() {
    return this.ledger.goldenHour;
  }
  get score() {
    return this.scorer.score; // running, before the difficulty multiplier
  }
  get finalScore() {
    return this.scorer.final;
  }
  get hint() {
    return this.onboarding.current;
  }
  get calls() {
    return this.shift.calls;
  }
  get career() {
    return this.progress.career();
  }
  get rank() {
    return this.progress.rank();
  }
  get hasProgress() {
    return this.progress.hasProgress;
  }
  get highscores() {
    return this.progress.highscores();
  }
  get difficulty() {
    return DIFFICULTY[this.scorer.difficulty];
  }

  // «ОПЕРАЦИЯ 03 / 08»: the bonus ★ operation is not counted.
  get campaignCount() {
    let n = 0;
    for (const d of this.list) if (!d.star) n++;
    return n;
  }

  isUnlocked(i) {
    return this.progress.isUnlocked(this.list, i);
  }

  // Settings «Сбросить прогресс»: medals, career, hints and the «Смена» table.
  resetProgress() {
    this.progress.reset();
  }

  // First unlocked operation not yet passed (title «ПРОДОЛЖИТЬ»).
  get continueIndex() {
    for (let i = 0; i < this.list.length; i++) if (this.isUnlocked(i) && !this.progress.op(this.list[i].id)?.passed) return i;
    return Math.min(this.list.length - 1, this.progress.data.last || 0);
  }

  // Operation cards for the ОПЕРАЦИИ screen (DESIGN §7.2).
  cards() {
    return this.list.map((d, i) => {
      const rec = this.progress.op(d.id);
      const locked = !this.isUnlocked(i);
      return {
        index: i,
        id: d.id,
        number: d.number,
        title: d.title,
        subtitle: d.subtitle,
        codename: d.codename,
        star: !!d.star,
        date: d.date,
        clock: d.clock,
        presets: d.presets,
        difficulty: d.difficulty || 1,
        people: d.total,
        par: d.par,
        medals: rec ? { ...rec.medals } : { bronze: false, silver: false, gold: false, cross: false },
        best: rec ? rec.best : 0,
        bestTime: rec ? rec.bestTime : 0,
        passed: !!rec?.passed,
        locked,
        lockText: locked ? `Пройдите операцию ${String(i).padStart(2, '0')}` : '',
      };
    });
  }

  /**
   * Prepare an operation and show its briefing; emits mission:setup (every system resets from def).
   * @param sel  index (0-based) | id string | 'endless'
   */
  start(sel = 0) {
    const ctx = this.ctx;
    const endless = sel === 'endless' || sel === -1;
    let index = -1;
    let raw = ENDLESS;
    if (!endless) {
      index = typeof sel === 'string' ? this.list.findIndex((d) => d.id === sel) : Math.floor(Number(sel) || 0);
      index = Math.max(0, Math.min(this.list.length - 1, index < 0 ? 0 : index));
      raw = CAMPAIGN[index];
    }
    const sp = ctx.params?.get('seed');
    const seed = sp != null && sp !== '' && Number.isFinite(Number(sp)) ? Number(sp) : undefined;
    const def = prepareDef(raw, { index: endless ? -1 : index, seed, survivorTypes: this._survivorTypes() });
    this.def = def;
    this.index = index;
    this.endless = endless;
    this._stopPausePoll();
    this._clearSlowmo();
    this._resetRun(def);
    this.state = 'briefing';
    ctx.events.emit('mission:setup', { def });
    this._refreshCard();
    this._setMode('briefing');
    return def;
  }

  // briefing → play
  launch() {
    const ctx = this.ctx;
    if (!this.def || this.def.attract) this.start(this.continueIndex);
    if (this.state !== 'briefing') return;
    this.scorer.reset(ctx.settings?.get('difficulty') || 'pilot');
    this.elapsed = 0;
    this.ledger.baseline();
    this.state = 'play';
    ctx.events.emit('mission:start', { def: this.def });
    this._setMode('play');
    if (this.endless) {
      this.shift.reset(this.def);
      try {
        ctx.weather?.runEndless?.();
      } catch (err) {
        console.error('[mission] weather.runEndless failed', err);
      }
    }
  }

  pause() {
    const ctx = this.ctx;
    if (ctx.mode !== 'play' || this.state !== 'play') return;
    this._pausedFrame = ctx.time.frame;
    this._setMode('paused');
    this._startPausePoll();
  }

  resume() {
    const ctx = this.ctx;
    if (ctx.mode !== 'paused') return;
    if (ctx.time.frame === this._pausedFrame) return; // same key press that paused (ESC is also 'back')
    this._stopPausePoll();
    this._setMode('play');
  }

  retry() {
    this.start(this.endless ? 'endless' : Math.max(0, this.index));
    this.launch();
  }

  next() {
    if (this.endless || this.index < 0) return this.menu();
    const n = this.index + 1;
    if (n < this.list.length && (this.isUnlocked(n) || this.ctx.debug)) this.start(n);
    else this.menu();
  }

  menu() {
    // Leaving a shift early still files it in the top-10 and the career.
    if (this.endless && (this.state === 'play' || this.state === 'crash') && this.elapsed > 30) this._recordEndless('quit', null);
    this.enterTitle();
  }

  // Title screen: attract camera, the world under a weather cycle every 45 s (DESIGN §7.2).
  enterTitle() {
    const ctx = this.ctx;
    this._stopPausePoll();
    this._clearSlowmo();
    this.onboarding.hideAll();
    const def = prepareDef(TITLE, { index: -1 });
    this.def = def;
    this.index = -1;
    this.endless = false;
    this._resetRun(def);
    this.state = 'title';
    ctx.events.emit('mission:setup', { def });
    this._setMode('title');
    this._titleT = 0;
    this._titleIdx = 0;
  }

  // Force an ending (tests, debug console).
  complete() {
    if (this.state === 'play') this._finish(true, 'complete');
  }

  fail(reason = 'abort') {
    if (this.state === 'play' || this.state === 'crash') this._finish(false, reason);
  }

  // Square name for a world point («Анна-три») — same grid as the dispatcher uses.
  square(x, z) {
    return squareOf(x, z);
  }

  trackPoints() {
    return this.ledger.trackPoints();
  }

  // ===============================================================================================
  // Frame update
  // ===============================================================================================
  update(dt) {
    const ctx = this.ctx;
    const realDt = ctx.time.realDt || 0;
    this._tickSlowmo(realDt);
    if (ctx.mode === 'title') this._updateTitle(realDt);
    else if (ctx.mode === 'play') {
      if (this.state === 'play') this._updatePlay(dt);
      else if (this.state === 'crash') this._updateCrash(realDt);
    } else if (ctx.mode === 'debrief') this._updateDebrief(realDt);

    // Gameplay input only while actually flying.
    const want = ctx.mode === 'play' && this.state === 'play';
    if (ctx.input && ctx.input.enabled !== want) ctx.input.enabled = want;
  }

  _updateTitle(realDt) {
    const ctx = this.ctx;
    // weather runs its own attract cycle when it has one; otherwise we drive it
    if (ctx.params?.get('weather') || ctx.weather?.attract) {
      this._titleT = 0;
      return;
    }
    this._titleT += realDt;
    if (this._titleT < TITLE_CYCLE_S) return;
    this._titleT = 0;
    this._titleIdx = (this._titleIdx + 1) % TITLE_CYCLE.length;
    ctx.weather?.setPreset?.(TITLE_CYCLE[this._titleIdx], 12);
  }

  _updatePlay(dt) {
    const ctx = this.ctx;
    if (ctx.input?.rawPressed('pause')) {
      this.pause();
      return;
    }
    if (!(dt > 0)) return;
    this.elapsed += dt;
    this.ledger.stats.time = this.elapsed;
    if (this.def.objectives.timeLimit) this.timeLeft = Math.max(0, this.def.objectives.timeLimit - this.elapsed);

    this.ledger.poll(dt);
    this._followCraft();
    this._runScript();
    this._checkRocketFallback();
    this._updateChapters();
    this.onboarding.update(dt);
    if (this.endless) {
      this.shift.update(dt, this.elapsed);
      this.ledger.stats.calls = this.shift.calls.length;
      this.ledger.stats.closed = this.shift.closed;
    }
    if (this.state !== 'play') return;
    this._slowT -= dt;
    if (this._slowT <= 0) {
      this._slowT = 0.5;
      this.ledger.weatherTick();
      updateObjectives(this);
      updateTask(this);
      this._checkEnd();
    }
  }

  _updateCrash(realDt) {
    this._crashT += realDt;
    if (this._crashT >= CRASH_TO_DEBRIEF_S) this._finish(false, this._crashReason);
  }

  _updateDebrief(realDt) {
    const ctx = this.ctx;
    this._debT += realDt;
    if (this.debriefPhase !== 'cinematic') return;
    const skip = this._debT > 1.5 && (ctx.input?.rawPressed('confirm') || ctx.input?.rawPressed('winch'));
    if (this._debT >= CINEMATIC_S || skip) {
      this.debriefPhase = 'logbook';
      this._clearSlowmo();
      ctx.events.emit('mission:logbook', { report: this.result });
    }
  }

  // Slow motion: delegated to the camera rig when it offers slowMo() (it owns the other slow-mo moments),
  // otherwise set here and restored after `real` seconds unless someone else changed it meanwhile.
  _slowmo(value, real) {
    const ctx = this.ctx;
    const rig = ctx.cameraRig;
    if (rig && typeof rig.slowMo === 'function' && !(rig instanceof Stubs.CameraRig)) {
      rig.slowMo(value, real, null);
      return;
    }
    if (ctx.timeScale !== 1 && ctx.timeScale !== this._slowValue) return;
    ctx.timeScale = value;
    this._slowValue = value;
    this._slowLeft = real;
  }

  _tickSlowmo(realDt) {
    if (this._slowLeft <= 0) return;
    this._slowLeft -= realDt;
    if (this._slowLeft <= 0) this._clearSlowmo();
  }

  _clearSlowmo() {
    if (this._slowLeft > 0 || this.ctx.timeScale === this._slowValue) this.ctx.timeScale = 1;
    this._slowLeft = 0;
    this._slowValue = 1;
  }

  // ===============================================================================================
  // Run state
  // ===============================================================================================
  _resetRun(def) {
    this.elapsed = 0;
    this.timeLeft = def.objectives?.timeLimit ? def.objectives.timeLimit : null;
    this.scorer.reset(this.ctx.settings?.get('difficulty') || 'pilot');
    this.ledger.reset(def);
    this._triggers.clear();
    this.result = null;
    this.debriefPhase = null;
    this.task = '';
    this.chapter = null;
    this._chapterNext = 0;
    this._lastChapterPreset = def.weather?.start || null;
    this._slowT = 0;
    this._abortT = 0;
    this._doneT = 0;
    this._crashT = 0;
    this._crashReason = 'crash';
    this._debT = 0;
    this._rocketCheck = null;
    this._endlessRecorded = null;
    this._script = [];
    for (const e of def.script || []) this._script.push({ ...e, fired: false, armedAt: null });
    for (const e of def.radio || []) this._script.push({ ...e, do: 'radio', fired: false, armedAt: null });
    // Late entries with `from: <tag>` surface beside that group's craft at their authored offset.
    this._followers = [];
    for (const e of def.survivors || []) {
      const src = e.from && e.at > 0 ? def.survivors.find((o) => o.tag === e.from) : null;
      if (src) this._followers.push({ e, carrier: null, dx: e.x - src.x, dz: e.z - src.z });
    }
    this.objectives = buildObjectives(this, def);
    this.onboarding.reset(def);
    if (!def.endless) this.shift.calls.length = 0;
  }

  // Endless: a call group spawned by Shift.
  _registerCallGroup(entry, s) {
    this.ledger.addGroup(entry, s);
  }

  // The typed card's wind direction follows the real weather if the def did not pin it.
  _refreshCard() {
    const ctx = this.ctx;
    const def = this.def;
    const preset = ctx.params?.get('weather') || def.weather.start;
    let from = def.windFrom;
    const ws = ctx.weather?.state;
    if (def.weather.windFrom == null && ws && !(ctx.weather instanceof Stubs.Weather)) {
      if (Number.isFinite(ws.windFrom)) from = ws.windFrom;
      else if (ws.windDir) from = windFromDeg(ws.windDir.x, ws.windDir.y);
    }
    if (!def.attract) def.card = cardLine(def, preset, from);
  }

  _survivorTypes() {
    const S = this.ctx.survivors;
    if (!S || S instanceof Stubs.Survivors) return MUST_TYPES;
    if (Array.isArray(S.types)) return S.types;
    if (Array.isArray(S.supportedTypes)) return S.supportedTypes;
    return MUST_TYPES;
  }

  _setMode(mode) {
    const ctx = this.ctx;
    ctx.setMode(mode);
    if (ctx.input) ctx.input.enabled = mode === 'play' && this.state === 'play';
    const cam = mode === 'play' ? 'follow' : mode === 'debrief' ? 'cinematic' : mode === 'paused' ? null : 'attract';
    const rig = ctx.cameraRig;
    if (cam && rig && rig.mode !== cam) {
      if (typeof rig.setMode === 'function') rig.setMode(cam);
      else rig.mode = cam;
    }
  }

  // While paused main.js does not call update(): poll the pause key from our own rAF tick
  // (input.rawPressed works while input.enabled is false). HUD sub-menus may set hud.capturingBack.
  _startPausePoll() {
    if (this._pollRAF) return;
    const tick = () => {
      this._pollRAF = 0;
      const ctx = this.ctx;
      if (ctx.mode !== 'paused') return;
      if (ctx.input?.rawPressed('pause') && !ctx.hud?.capturingBack) this.resume();
      if (ctx.mode === 'paused') this._pollRAF = requestAnimationFrame(tick);
    };
    this._pollRAF = requestAnimationFrame(tick);
  }

  _stopPausePoll() {
    if (this._pollRAF) cancelAnimationFrame(this._pollRAF);
    this._pollRAF = 0;
  }

  // ===============================================================================================
  // Scripted beats & radio cues (def.script / def.radio)
  // ===============================================================================================
  _trigger(name) {
    this._triggers.add(name);
  }

  // A pending entry with `from` (the injured under «Гидролог-2», the trawlerman washed off «Вайгач»)
  // follows its craft while that drifts, so survivors.spawn() puts it beside the craft, not where the
  // craft was at the start. The craft is remembered: it keeps drifting after its own people are gone.
  _followCraft() {
    const list = this.ctx.survivors?.list;
    if (!list || !this._followers.length) return;
    for (const f of this._followers) {
      const e = f.e;
      if (this.elapsed > e.at) continue;
      const src = list.find((s) => s && s.tag === e.from);
      if (src?.carrier) f.carrier = src.carrier;
      const p = f.carrier || src?.position;
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      const x = p.x + f.dx;
      const z = p.z + f.dz;
      if (e.datum) {
        e.datum.x += x - e.x;
        e.datum.z += z - e.z;
      }
      e.x = x;
      e.z = z;
    }
  }

  _runScript() {
    for (const e of this._script) {
      if (e.fired) continue;
      let due = false;
      if (e.after) {
        if (e.armedAt == null && this._triggers.has(e.after)) e.armedAt = this.elapsed;
        if (e.armedAt != null && this.elapsed >= e.armedAt + (e.delay || 0)) due = true;
        else if (e.latest != null && this.elapsed >= e.latest) due = true;
      } else if (this.elapsed >= (e.at || 0)) due = true;
      if (!due) continue;
      e.fired = true;
      try {
        this._exec(e);
      } catch (err) {
        console.error('[mission] script step failed', e, err);
      }
    }
  }

  _exec(e) {
    const ctx = this.ctx;
    switch (e.do) {
      case 'rocket': {
        // DESIGN §3.16: a scripted rocket (survivors fire it if they can) + the camera leans to it.
        const s = this.ledger.findGroup(e.tag);
        const entry = this.def.survivors.find((x) => x.tag === e.tag);
        const p = s?.position || entry;
        if (!p) break;
        const S = ctx.survivors;
        const fire = s && S && (S.fireSignal || S.signal || S.forceSignal);
        if (typeof fire === 'function') fire.call(S, s, 'rocket');
        this._rocketCheck = { tag: e.tag, t: this.elapsed + 0.8, x: p.x, z: p.z, seen: false };
        this._trigger(`rocket:${e.tag}`); // dependent beats run even if survivors cannot fire it
        if (e.focus) ctx.cameraRig?.focus?.(this._focusV.set(p.x, 0, p.z), e.focus);
        break;
      }
      case 'gust':
        ctx.weather?.spawnGust?.({ strength: e.strength || 8, harmless: !!e.harmless, eta: e.eta || 6 });
        break;
      case 'focus':
        ctx.cameraRig?.focus?.(this._focusV.set(e.x, 0, e.z), e.duration || 3);
        break;
      case 'radio':
        ctx.radio?.say?.(e.speaker || 'dispatch', e.text, { priority: e.priority || 1, name: e.name, channel: e.channel, id: e.id, duration: e.duration });
        break;
      default: // 'chapter' entries run from def.chapters
    }
  }

  // If survivors could not fire the scripted rocket, the co-pilot still calls it out (p_rocket).
  _checkRocketFallback() {
    const rc = this._rocketCheck;
    if (!rc || this.elapsed < rc.t) return;
    this._rocketCheck = null;
    const h = this.ctx.heli;
    if (rc.seen || !h?.position) return;
    const c = clockOf(h.heading || 0, rc.x - h.position.x, rc.z - h.position.z);
    this.ctx.radio?.say?.('pilot', `Ракета! Красная, на ${clockWords(c)}!`, { priority: 2, name: 'ВТОРОЙ ПИЛОТ', channel: 'ics', id: 'p_rocket' });
  }

  _updateChapters() {
    const ch = this.def.chapters;
    if (!ch) return;
    const forced = !!this.ctx.params?.get('weather');
    while (this._chapterNext < ch.length && this.elapsed >= ch[this._chapterNext].at) {
      const c = ch[this._chapterNext++];
      if (forced && c.at > 0 && !c.script) continue; // the weather script is disabled by ?weather=
      this.chapter = { n: c.n, text: c.text, title: `ГЛАВА ${c.n} · ${c.text}` };
      this.ctx.events.emit('mission:chapter', this.chapter);
    }
  }

  // Style bonus (ledger and hazard events call this).
  style(id, pos) {
    if (this.state !== 'play') return 0;
    return this.scorer.style(id, this.elapsed, pos || this.ctx.heli?.position || null);
  }

  // ===============================================================================================
  // Events
  // ===============================================================================================
  _listen() {
    const ev = this.ctx.events;
    const L = this.ledger;
    const on = (name, fn) => ev.on(name, (p) => fn(p || {}));
    const playing = () => this.state === 'play';

    // Flow, driven by the HUD
    on('game:ready', () => this._boot());
    on('ui:start', (p) => {
      if (p.endless || p.mode === 'endless') this.start('endless');
      else this.start(Number.isFinite(p.index) ? p.index : this.continueIndex);
    });
    on('ui:select-mission', (p) => {
      const i = Number.isFinite(p.index) ? p.index : 0;
      if (!this.isUnlocked(i) && !this.ctx.debug) {
        ev.emit('mission:locked', { index: i, text: `Пройдите операцию ${String(i).padStart(2, '0')}` });
        return;
      }
      this.start(i);
    });
    on('ui:endless', () => this.start('endless'));
    on('ui:launch', () => this.launch());
    on('ui:pause', () => this.pause());
    on('ui:resume', () => this.resume());
    on('ui:retry', () => this.retry());
    on('ui:next', () => this.next());
    on('ui:menu', () => this.menu());

    // Gameplay → ledger (counting & awards), triggers for scripted beats, onboarding.
    on('heli:crash', (p) => playing() && this._onCrash(p));
    on('heli:capture', (p) => playing() && L.onCapture(p.survivor));
    on('heli:pickup', (p) => {
      if (!playing()) return;
      const tag = L.onPickup(p.survivor, p.person);
      this._trigger('boarded');
      if (tag) this._trigger(`boarded:${tag}`);
      this.onboarding.onEvent('heli:pickup', p);
    });
    on('survivor:boarded', (p) => playing() && L.onBoarded(p.s, p.person));
    // Map groups to def entries while they are still at their spawn point (tags survive drift).
    on('survivor:spawn', (p) => this.state !== 'title' && L.tag(p.s));
    on('survivor:rescued', (p) => {
      if (!playing()) return;
      const tag = L.onGroupRescued(p.s);
      if (tag) this._trigger(`rescued:${tag}`);
    });
    on('survivor:lost', (p) => {
      if (!playing()) return;
      const tag = L.onLost(p.s);
      if (tag) this._trigger(`lost:${tag}`);
    });
    on('survivor:spotted', (p) => {
      if (!playing()) return;
      L.stats.spotted++;
      const tag = L.tag(p.s);
      this._trigger('spotted');
      if (tag) this._trigger(`spotted:${tag}`);
    });
    on('survivor:signal', (p) => {
      if (!playing()) return;
      const tag = L.onSignal(p.s, p.kind);
      if (!tag) return;
      this._trigger(`rocket:${tag}`);
      if (this._rocketCheck && this._rocketCheck.tag === tag) this._rocketCheck.seen = true;
    });
    on('heli:unload', (p) => {
      if (!playing()) return;
      L.onUnload(p);
      updateObjectives(this);
    });
    on('heli:land', (p) => {
      if (!playing()) return;
      L.onLand(p);
      this.onboarding.onEvent('heli:land', p);
    });
    on('heli:takeoff', (p) => {
      if (!playing()) return;
      L.breakOneGo();
      this.onboarding.onEvent('heli:takeoff', p);
    });
    on('heli:refuel', (p) => playing() && (!p.state || p.state === 'start') && L.stats.refuels++);
    on('heli:damage', (p) => {
      if (!playing()) return;
      L.lastDamageT = this.elapsed;
      L.stats.lastDamageSource = p.source || null;
    });
    on('heli:flare', (p) => {
      if (!playing()) return;
      L.stats.flares++;
      this.onboarding.onEvent('heli:flare', p);
    });
    for (const name of ['heli:raft-drop', 'heli:loudspeaker', 'heli:searchlight']) on(name, (p) => playing() && this.onboarding.onEvent(name, p));
    on('hazard:near-miss', (p) => {
      if (!playing()) return;
      if (p.type === 'lightning') this.style('lightning');
      else if (p.type === 'waterspout' || p.type === 'tornado' || p.type === 'vortex') this.style('eye');
      L.stats.nearMisses++;
    });
    on('hazard:spawn', (p) => playing() && L.onHazardSpawn(p.hazard));
    // «Смена» has no script: every weather change the escalation picks opens a new chapter.
    on('weather:preset', (p) => {
      if (!playing() || !this.endless || !p.to || p.to === this._lastChapterPreset) return;
      this._lastChapterPreset = p.to;
      const n = (this.chapter?.n || 0) + 1;
      const text = PRESETS[p.to]?.chapter || String(p.to).toUpperCase();
      this.chapter = { n, text, title: `ГЛАВА ${n} · ${text}` };
      this.ctx.events.emit('mission:chapter', this.chapter);
    });
    on('hazard:warning', (p) => {
      if (!playing()) return;
      if (p.type) this._trigger(`warning:${p.type}`);
      this.onboarding.onEvent('hazard:warning', p);
    });
  }

  _boot() {
    const p = this.ctx.params;
    const m = p?.get('mission');
    let sel = null;
    if (m === 'endless') sel = 'endless';
    else if (m != null && m !== '' && Number.isFinite(Number(m))) sel = Math.max(0, Math.min(this.list.length - 1, Math.floor(Number(m))));
    if (p?.has('autostart')) {
      this.start(sel ?? 0);
      this.launch();
    } else if (sel != null) this.start(sel);
    else this.enterTitle();
  }

  // heli emits heli:crash at the moment of ditching (after its 3 s of autorotation).
  _onCrash(p) {
    if (this.state !== 'play') return;
    this.state = 'crash';
    this._crashT = 0;
    this._crashReason = /fuel|ditch|empty/i.test(String(p.reason || '')) ? 'ditch' : 'crash';
    // DESIGN §3.15: timeScale 0.3 for 1.2 s at the splash — a camera rig with slowMo() does it on heli:crash
    if (typeof this.ctx.cameraRig?.slowMo !== 'function') this._slowmo(0.3, 1.2);
    this.onboarding.hideAll();
    if (this.ctx.input) this.ctx.input.enabled = false;
  }

  // ===============================================================================================
  // Objectives, task line, end conditions (2 Hz)
  // ===============================================================================================
  _checkEnd() {
    if (this.state !== 'play') return;
    const st = this.ledger.stats;
    const def = this.def;
    if (this.endless) {
      if (st.lost >= 10) this._finish(false, 'lost');
      return;
    }
    if (def.objectives.timeLimit && this.elapsed >= def.objectives.timeLimit) {
      this._finish(false, 'time');
      return;
    }
    const min = def.objectives.rescue;
    // «Отбой операции»: the minimum can no longer be reached
    if (st.total - st.lost < min) {
      this._abortT += 0.5;
      if (this._abortT >= 2.5) this._finish(false, 'abort');
      return;
    }
    this._abortT = 0;
    // Complete: every group rescued or lost, and the cabin unloaded at a pad
    const h = this.ctx.heli;
    const cabin = h?.cabin ? h.cabin.length : 0;
    const load = h?.winch?.load;
    const peopleResolved = st.total > 0 && st.rescued + st.lost >= st.total;
    const list = this.ctx.survivors?.list || [];
    let groupsResolved = list.length > 0 && this.elapsed > (def.lastSpawnAt || 0) + 3;
    if (groupsResolved) for (const s of list) if (s && s.state !== 'rescued' && s.state !== 'lost') groupsResolved = false;
    if ((peopleResolved || groupsResolved) && cabin === 0 && !load) {
      this._doneT += 0.5;
      if (this._doneT >= 1) {
        const ok = st.rescued >= min;
        this._finish(ok, ok ? 'complete' : 'abort');
      }
    } else this._doneT = 0;
  }

  // ===============================================================================================
  // Ending: cinematic → logbook (DESIGN §7.7)
  // ===============================================================================================
  _finish(success, reason) {
    if (this.state !== 'play' && this.state !== 'crash') return;
    const ctx = this.ctx;
    this.ledger.finalize();
    updateObjectives(this);
    for (const o of this.objectives) if ((o.id === 'hull' || o.id === 'par') && !o.failed) o.done = !!success;

    const report = buildReport(this, success, reason);
    const st = this.ledger.stats;
    if (this.endless) report.endlessResult = this._recordEndless(reason, report);
    else {
      report.progress = this.progress.recordMission(this.list, this.def, {
        success,
        total: report.score.total,
        time: st.time,
        medals: report.medals,
        rescued: st.rescued,
        lost: st.lost,
        distance: st.distance,
      });
    }
    report.career = this.progress.career();
    this.result = report;

    this.state = 'debrief';
    this.debriefPhase = 'cinematic';
    this._debT = 0;
    this._stopPausePoll();
    this.onboarding.hideAll();
    this._clearSlowmo();
    this._slowmo(0.5, 2); // DESIGN §7.7: timeScale 0.5 for 2 s
    this._setMode('debrief');
    if (success) ctx.weather?.setPreset?.('clearing', 8);
    const payload = { stats: { ...st }, score: report.score.total, medals: report.medals, report, reason, cinematic: CINEMATIC_S };
    ctx.events.emit(success ? 'mission:complete' : 'mission:failed', payload);
  }

  _recordEndless(reason, report) {
    if (this._endlessRecorded) return this._endlessRecorded;
    const st = this.ledger.stats;
    const d = new Date();
    const entry = {
      score: report ? report.score.total : this.scorer.final,
      rescued: st.rescued,
      lost: st.lost,
      time: Math.round(this.elapsed),
      calls: this.shift.calls.length,
      date: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`,
      seed: this.def.seed,
      reason,
    };
    const place = this.progress.recordEndless(entry, { rescued: st.rescued, lost: st.lost, time: this.elapsed, distance: st.distance });
    this._endlessRecorded = { place, entry, highscores: this.progress.highscores() };
    return this._endlessRecorded;
  }
}
