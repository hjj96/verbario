// Objectives with live progress, the HUD's one-line current task («Найдите плот к северу от маяка»)
// for the mission director (DESIGN §7.2 brief «□ / ◇» goals, §7.3 mission strip). Called at 2 Hz.
import { plural, fmtPar, bearingDeg, toWords, groupWords, padGenitive, padName } from './text.js';

// [{ id, text, kind: 'main'|'bonus', progress, target, done, failed, tags? }]
export function buildObjectives(m, def) {
  const o = [];
  if (def.attract) return o;
  const mk = (id, text, kind, target, extra) => ({ id, text, kind, progress: 0, target, done: false, failed: false, ...extra });
  if (def.endless) {
    o.push(mk('calls', 'Закрывайте вызовы', 'main', 0));
    o.push(mk('lost', 'Потерять меньше десяти', 'main', 10));
    return o;
  }
  const n = def.objectives.rescue;
  const total = def.total;
  o.push(mk('rescue', `Спасти не менее ${n} ${plural(n, 'человека', 'человек', 'человек')}`, 'main', n));
  if (total > n) o.push(mk('all', `Найти и доставить всех — ${total}`, 'bonus', total));
  o.push(mk('hull', 'Без серьёзных повреждений', 'bonus', 1, { progress: 1 }));
  if (def.par) o.push(mk('par', `Уложиться в ${fmtPar(def.par)}`, 'bonus', def.par));
  for (const x of def.objectives.extra || []) {
    const tags = x.tags || [x.tag];
    const target = m.ledger.manifest.filter((p) => tags.includes(p.tag)).length || 1;
    o.push(mk(x.id, x.text, 'bonus', target, { tags }));
  }
  return o;
}

// Refresh progress in place; emits mission:objective on done/failed changes and count changes.
export function updateObjectives(m) {
  const st = m.ledger.stats;
  const h = m.ctx.heli;
  for (const o of m.objectives) {
    const wasDone = o.done;
    const wasFailed = o.failed;
    const prev = o.progress;
    switch (o.id) {
      case 'rescue':
      case 'all':
        o.progress = st.rescued;
        o.done = st.rescued >= o.target;
        break;
      case 'hull':
        o.progress = h?.hull ?? 1;
        if (o.progress < 0.5) o.failed = true;
        break;
      case 'par':
        o.progress = m.elapsed;
        if (m.elapsed > o.target) o.failed = true;
        break;
      case 'calls':
        o.progress = m.shift.closed;
        break;
      case 'lost':
        o.progress = st.lost;
        o.failed = st.lost >= o.target;
        break;
      default:
        if (o.tags) {
          let n = 0;
          let lost = false;
          for (const e of m.ledger.manifest) {
            if (!o.tags.includes(e.tag)) continue;
            if (e.status === 'rescued') n++;
            else if (e.status === 'lost') lost = true;
          }
          o.progress = n;
          o.done = n >= o.target;
          if (!o.done && lost) o.failed = true;
        }
    }
    const countChanged = o.id !== 'par' && o.id !== 'hull' && o.progress !== prev;
    if (o.done !== wasDone || o.failed !== wasFailed || countChanged) m.ctx.events.emit('mission:objective', { objective: o });
  }
}

// The current task line; emits mission:task when it changes.
export function updateTask(m) {
  const ctx = m.ctx;
  const h = ctx.heli;
  if (!h?.position) return;
  const hx = h.position.x;
  const hz = h.position.z;
  const W = ctx.world;
  const nearestPad = W?.nearestPad?.(hx, hz) || null;
  const cabin = h.cabin ? h.cabin.length : 0;
  let text;
  if ((h.fuel ?? 1) < 0.25 && !h.landed) text = `Топливо на исходе — на ${padName(nearestPad)}`;
  else if (cabin >= (h.capacity || 6)) text = `Салон заполнен — на ${padName(nearestPad)}`;
  else if (h.winch?.load) text = 'Подъём — держите машину ровно';
  else {
    let best = null;
    let bd = Infinity;
    let hidden = null;
    let hd = Infinity;
    for (const s of ctx.survivors?.list || []) {
      if (!s?.position || s.state === 'rescued' || s.state === 'lost') continue;
      const d = Math.hypot(s.position.x - hx, s.position.z - hz);
      if (s.spotted || s.state === 'spotted' || s.state === 'winching') {
        if (d < bd) {
          bd = d;
          best = s;
        }
      } else if (d < hd) {
        hd = d;
        hidden = s;
      }
    }
    if (best) {
      const n = best.remaining ?? best.count ?? 1;
      text = `Поднимите ${groupWords(best.type).acc}${n > 1 ? ` — ${n} чел.` : ''}`;
    } else if (hidden) {
      // describe the search area relative to the nearest pad («к северу от маяка»)
      const datum = m.ledger.datumFor(hidden) || hidden.position;
      const pad = W?.nearestPad?.(datum.x, datum.z);
      text = pad
        ? `Найдите ${groupWords(hidden.type).acc} ${toWords(bearingDeg(datum.x - pad.position.x, datum.z - pad.position.z))} от ${padGenitive(pad)}`
        : `Найдите ${groupWords(hidden.type).acc}`;
    } else if (cabin > 0) text = `Доставьте людей на ${padName(nearestPad)}`;
    else if (m.endless) text = 'Ждите вызова · заправьтесь, пока тихо';
    else text = h.landed ? 'Ждите новостей от Берега' : `Возвращайтесь на ${padName(nearestPad)}`;
  }
  if (text !== m.task) {
    m.task = text;
    ctx.events.emit('mission:task', { text });
  }
}
