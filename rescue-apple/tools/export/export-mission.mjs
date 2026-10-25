// export-mission: parity vectors of the REAL web mission director, radio and Russian text helpers
// (rescue/src/systems/mission.js + mission/*, radio.js + radio/*, ui/common/{fmt,typewriter,keys}.js,
// ui/flight/subtitles.js) run in Node 22 -> Tests/Vectors/{text,radio,mission}/*.json.
//
//   text/ru_format.json     the Intl ru-RU parts (mission/text.js fmtNum/fmtTime/fmtPar/fmtPct/fmtKm/windLine/
//                           conditionsLine…, ui/common/fmt.js num0/num1/num1o/mmss/mss/timecode/clockOf/distU/distL/
//                           visU/deg3/ballsU/guillemets, raw Intl.NumberFormat with 0/1 digits) over edge inputs; Node's
//                           ICU 77 is the ICU of Chromium 141, so these are the browser's strings
//   text/typewriter.json    Typewriter timing (shown count, typed indices, done) over scripted update steps
//   text/keys.json          ui/common/keys.js keyLabel over every code the bindings and the hints can show
//   radio/queue.json        Radio (radio.js) on a stub ctx: scripted say()/line()/cancel()/clear() and update(dt)
//                           in every mode → the emitted radio:line payloads, history, dropped, cooldowns
//   radio/triggers.json     RadioTriggers on a stub ctx: scripted game events + polled heli / winch / weather /
//                           world states → the lines (ids, texts, interference) and the dropped ones
//   radio/subtitles.json    ui/flight/subtitles.js line timing (typewriter 22 ms, hold, two lines max, the log)
//   mission/onboarding.json Onboarding on a stub mission/heli/input/survivors/world: the timeline of
//                           mission:hint shows / hides for op1-like and later-op hint sets, per device
//   mission/report.json     buildReport over scripted ledgers (success, crash, abort, endless, pet, fog…)
//   mission/replay_op1.json op1 «Первый вылет» played through by a closed-loop pilot on the REAL systems (Weather,
//                           Ocean, World, Helicopter, Survivors, Effects, CameraRig, Radio, Mission, Input, Settings;
//                           hazards = stubs.js Hazards, inert in op1; no audio / hud / post): per frame the virtual
//                           input the pilot set (RawInputFrame), every event (frame, name, compact payload), the
//                           mission state at 2 Hz, the checkpoint snapshot, the final report.
//
// Same wrapper / number / determinism rules as export-vectors.mjs (tools/README.md).
// Usage: node rescue-apple/tools/export/export-mission.mjs [--only text,radio,onboarding,report,replay] [--out <dir>]
import { gameImport } from './shims/loader.mjs';
import path from 'node:path';
import { APPLE, num, writeWrapped, writeSidecar, relSrc, serialize } from './lib/common.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Tests/Vectors'));
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);
const PRODUCER = 'tools/export/export-mission.mjs';
const results = [];
console.warn = () => {};

const BYTES = { class: 'bytes', note: 'UTF-8 byte-exact (NBSP U+00A0 escaped as \\u00a0 in JSON); numbers bitwise' };
const BITWISE = { class: 'bitwise', note: 'numbers Double.bitPattern-equal, strings byte-exact, event order identical' };

function out(domain, name, { files, tolerance, data }) {
  const r = writeWrapped(path.join(OUT, domain, `${name}.json`), {
    schema: `mayday.vectors.${domain}.${name}`, version: 1, files, producer: PRODUCER, extra: { tolerance }, data,
  });
  if (r.bytes > 1024 * 1024) throw new Error(`${r.path} is ${r.bytes} bytes (> 1 MB budget)`);
  results.push(r);
}
const safe = (f) => {
  try {
    const v = f();
    return v === undefined ? null : typeof v === 'number' ? num(v) : v;
  } catch (e) {
    return { error: String(e.message || e) };
  }
};

// ==================================================================================================== text
async function text() {
  const Tx = await gameImport('systems/mission/text.js');
  const F = await gameImport('ui/common/fmt.js');
  const { Typewriter } = await gameImport('ui/common/typewriter.js');
  const { keyLabel } = await gameImport('ui/common/keys.js');

  // numbers around every rounding / grouping / sign edge of Intl ru-RU
  const nums = [0, -0, 1, -1, 0.04, -0.04, 0.05, -0.05, 0.15, 0.25, 0.35, 0.45, 0.5, -0.5, 1.45, 1.5, 2.5, -2.5, 9.95, 9.94999, 99.95, 999, 999.4,
    999.5, 999.95, 1000, 1000.04, 1000.05, 1234.5, 9999, 9999.5, 10000, 12345.678, -1234.5, -9999.96, 99999, 100000, 123456789, 1e15, 2 ** 53 + 2,
    1e21, 1.5e21, 1e-7, 3e-5, 0.000123, 1 / 3, 2 / 3, 0.1 + 0.2, 1.005, 2.675, 8.05, 12.25, 17.85, 0.95, 0.949999, NaN, Infinity, -Infinity, 5e-324,
    1.7976931348623157e308];
  for (let i = 0; i < 160; i++) nums.push(Math.round(((i * 7919) % 100003) * 1.37) / (i % 3 === 0 ? 100 : i % 3 === 1 ? 10 : 1) * (i % 5 === 0 ? -1 : 1));
  const NF = (min, max) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: min, maximumFractionDigits: max });
  const nf00 = NF(0, 0), nf01 = NF(0, 1), nf11 = NF(1, 1);
  const secs = [0, -5, 0.4, 0.5, 0.6, 59.4, 59.5, 59.99, 60, 61.7, 599.5, 754, 3599.4, 3599.5, 3600, 3725.25, 86399, 360 * 1.3, 468, NaN, 1e6];
  const days = [0, 0.25, 0.3194444, 0.5, 0.75, 0.9999, 1, 1.25, -0.25, 0.99965, NaN];
  const dists = [0, 4, 5, 6, 14.9, 15, 994, 995, 999, 1000, 1049, 1050, 1051, 1449, 1450, 9950, 9999, 12345, -3, NaN, Infinity];
  const degs = [0, 0.4, 0.5, -0.4, -0.5, 1, 22.5, 45, 359.4, 359.5, 360, 361, -1, -359.5, 720.2];
  const pads = [null, { type: 'lighthouse', name: 'Скалистый' }, { type: 'lighthouse' }, { type: 'rig', name: '«Северная-7»' }, { type: 'rig' },
    { type: 'ship', name: 'Арктур' }, { type: 'ship' }, { type: 'ship', name: '«Полярный ветер»' }, { type: 'pad', name: 'Площадка' }, { type: 'pad' },
    { type: 'deck', name: '"Вайгач"' }];
  out('text', 'ru_format', {
    files: ['systems/mission/text.js', 'ui/common/fmt.js'].map(relSrc),
    tolerance: BYTES,
    data: {
      note: 'Intl.NumberFormat ru-RU of Node 22 (ICU 77 = Chromium 141); intl rows: [x, maxFrac 0, min 0 / max 1, min 1 / max 1]',
      intl: nums.map((x) => [num(x), nf00.format(x), nf01.format(x), nf11.format(x)]),
      fmt: {
        num0: nums.map((x) => [num(x), F.num0(x)]),
        num1: nums.map((x) => [num(x), F.num1(x)]),
        num1o: nums.map((x) => [num(x), F.num1o(x)]),
        mmss: secs.map((s) => [num(s), F.mmss(s)]),
        mss: secs.map((s) => [num(s), F.mss(s)]),
        timecode: secs.map((s) => [num(s), F.timecode(s)]),
        clockOf: days.map((d) => [num(d), F.clockOf(d)]),
        distU: dists.map((m) => [num(m), F.distU(m)]),
        distL: dists.map((m) => [num(m), F.distL(m)]),
        visU: dists.map((m) => [num(m), F.visU(m)]),
        deg3: degs.map((d) => [num(d), F.deg3(d)]),
        compass8: degs.map((d) => [num(d), F.compass8(d)]),
        beaufortOf: [0, 0.3, 5.4, 5.5, 24, 33, 40].map((v) => [v, F.beaufortOf(v)]),
        douglasOf: [0, 0.1, 0.11, 2.5, 6.5, 20].map((v) => [v, F.douglasOf(v)]),
        ballsU: [0, 1, 2, 4, 5, 11, 12, 21].map((n) => [n, F.ballsU(n)]),
        guillemets: ['"Арктур"', 'буровая "Северная-7" и "Сторож"', 'без кавычек', '"', '""'].map((s) => [s, F.guillemets(s)]),
      },
      mission: {
        fmtNum: nums.map((x) => [num(x), Tx.fmtNum(x), Tx.fmtNum(x, 1)]),
        fmtTime: secs.map((s) => [num(s), Tx.fmtTime(s)]),
        fmtPar: secs.map((s) => [num(s), Tx.fmtPar(s)]),
        fmtPct: [0, 0.004, 0.005, 0.124, 0.125, 0.5, 0.995, 1, 1.234, -0.2, 2.5].map((v) => [num(v), Tx.fmtPct(v)]),
        fmtKm: [0, 5, 994, 995, 999, 1000, 1049, 1050, 2345, 12345, 99950].map((m) => [m, Tx.fmtKm(m)]),
        peopleCollective: [0, 1, 10, 11, 12, 21, 25, 100].map((n) => [n, Tx.peopleCollective(n)]),
        windLine: [[0, 0], [3.2, 315], [8.6, 300], [17.49, 20], [24.6, 181], [33, 359.9]].map(([s, f]) => [s, f, Tx.windLine(s, f)]),
        conditionsLine: [['calm', 315], ['overcast', 300], ['squall', 280], ['storm', 270], ['nightStorm', 250], ['fog', 90], ['clearing', 200], ['nightCalm', 0], ['bogus', 45]].map(([p, f]) => [p, f, Tx.conditionsLine(p, f)]),
        clockWords: Array.from({ length: 14 }, (_, c) => [c, Tx.clockWords(c)]),
        padGenitive: pads.map((p) => [p, Tx.padGenitive(p)]),
        padName: pads.map((p) => [p, Tx.padName(p)]),
        groupWords: ['swimmer', 'raft', 'hull', 'container', 'injured', 'deck', 'wreck', 'plane', 'bogus'].map((t) => [t, Tx.groupWords(t)]),
      },
    },
  });

  // --- Typewriter: a fake node, scripted starts / updates / finish
  const node = () => ({ textContent: '', classList: { toggle() {}, remove() {}, add() {} } });
  const scripts = [];
  for (const [ms, line, delay, steps] of [
    [22, 'Чайка ноль-седьмой, Берег. Сработал аварийный буй.', 0, [0.01, 0.012, 0.016, 0.1, 0.5, 0.0005, 0.2, 2]],
    [28, 'ОПЕРАЦИЯ «БАЙДАРКА» · 28 августа, 07:40', 0.3, [0.1, 0.1, 0.1, 0.028, 0.0279, 0.05, 1, 1]],
    [undefined, 'Короткая', 0, [0.03, 'finish', 0.5]],
    [22, '', 0, [0.1]],
    [40, 'a b — «в»', 0, [0.039, 0.001, 0.08, 0.2]],
  ]) {
    const typed = [];
    const tw = new Typewriter(node(), { msPerChar: ms, emit: (ch, i) => typed.push([i, ch]) });
    tw.start(line, delay);
    const rows = [[0, tw.shown, tw.done, tw.node.textContent]];
    for (const s of steps) {
      typed.length = 0;
      if (s === 'finish') tw.finish();
      else tw.update(s);
      rows.push([s === 'finish' ? 'finish' : num(s), tw.shown, tw.done, tw.node.textContent, typed.slice()]);
    }
    scripts.push({ msPerChar: ms ?? null, text: line, delay, rows });
  }
  out('text', 'typewriter', { files: [relSrc('ui/common/typewriter.js')], tolerance: BYTES, data: { note: 'rows: [step dt | "finish", shown, done, textContent, typed [[index, ch]]]', scripts } });

  const codes = ['Space', 'ShiftLeft', 'ShiftRight', 'KeyW', 'KeyQ', 'Digit1', 'Digit0', 'Numpad5', 'NumpadAdd', 'NumpadEnter', 'NumpadDecimal', 'NumpadFoo',
    'ArrowUp', 'Tab', 'Mouse0', 'Mouse2', 'Backquote', 'BracketLeft', 'BracketRight', 'F5', 'Key<b>', 'ControlLeft', 'Escape', '', null, undefined];
  out('text', 'keys', { files: [relSrc('ui/common/keys.js')], tolerance: BYTES, data: { labels: codes.map((c) => [c ?? null, keyLabel(c)]) } });
}

// ===================================================================================================== run
const GROUPS = { text };
for (const [k, fn] of Object.entries(GROUPS)) {
  if (!want(k)) continue;
  const t0 = Date.now();
  await fn();
  console.log(`mission/${k}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
for (const r of results) console.log(`  ${r.path}  ${r.bytes} B`);
