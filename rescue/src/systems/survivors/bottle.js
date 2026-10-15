// Bottle with a note (DESIGN §4 #46, op 9★ «Лунная дорожка» props.bottle; very rarely in other ops).
// A small green glass bottle, corked and wax-sealed, a rolled note tied with twine inside, bobbing
// half-awash with the swell and drifting with the current. Pick-up: lower the basket onto it (it sits
// in the basket's wash for ~0.6 s, like a survivor capture) or hover ≤ 6 m right over it (the crew
// fishes it out with the boat hook). Emits `survivor:bottle {title, text, x, z}` (the HUD shows the
// paper card) and books a small style bonus through the mission scorer's `score:add`.
// Readability from 40 m: a foam collar and, in the realistic style, the glass catching the light —
// a sun sparkle by day, a bright wink when the searchlight beam crosses it at night.
import * as THREE from 'three';
import { createRng } from '../../core/math.js';
import { mergeParts } from './geo.js';
import { clamp01 } from './tables.js';

export const BOTTLE_POINTS = 25;
const SCALE = 1.7; // perceptual, like people (×1.5): a 32 cm bottle would be a speck from the cabin
const CAPTURE_T = 0.6; // s in the basket's wash / under the hovering door
const BASKET_R = 1.6; // m, basket ring ↔ bottle
const HOVER_ALT = 6; // m above the water
const HOVER_R = 5; // m, horizontal: «right over it»
const RARE_CHANCE = 0.06; // other ops (not the 9★ op, whose def places it)

// Lore pool: short, documentary, poignant or warm.
export const NOTES = [
  { title: 'Записка рыбака', text: 'Маше. Если найдут — передайте: сети целы, я задержусь до Покрова. Печку топи берёзой, она жарче. Твой Коля. Сейнер «Ветлуга».' },
  { title: 'Детский рисунок', text: 'Фломастером: дом, солнце и вертолёт над волнами. Печатными буквами: «ЭТО ПАПА ЛЕТИТ ЗА ВСЕМИ. ВАРЯ, 6 ЛЕТ».' },
  { title: 'Журнал смотрителя', text: 'Маяк Скалистый, 14 ноября. Ветер норд-вест, семь баллов. Огонь горит исправно. Судов не видел. Чай кончился. Пишу, чтобы кто-нибудь знал: огонь горит.' },
  { title: 'Письмо с парома', text: 'Мы плывём к бабушке. Мама говорит, бутылка доплывёт до Америки. Если ты из Америки — привет! Если нет — тоже привет. Лёша, 3 «Б».' },
  { title: 'Без подписи', text: 'Я не умею писать письма. Просто хочу, чтобы кто-то знал: сегодня было очень красиво. Море светилось под вёслами, как будто внизу город.' },
  { title: 'Дочь вертолётчика', text: 'Тем, кто летает в ночь. Отец вытащил из воды сорок два человека и ни разу об этом не рассказывал. Спасибо вам за свет над водой.' },
  { title: 'На обороте чека', text: 'Чек из сельпо, на обороте карандашом: «Вернусь к весне. Козу не продавай. Лодку не трогай, она течёт. Г.»' },
  { title: 'Метеостанция', text: 'Ст. Мыс Северный, 03 ч. Видимость десять километров, море два балла, огни судна на горизонте. Бросил бутылку из любопытства. Ответьте до востребования.' },
  { title: 'Двадцать лет спустя', text: 'Мы поженились сегодня на этом берегу. Через двадцать лет вернёмся и проверим, доплыла ли. А. и С., 12 июля.' },
  { title: 'Вахтенный журнал', text: 'Т/х «Арктур», 04:10. Боцман — вахтенному: кофе в термосе, не благодари. Звёзды сегодня как гвозди. Курс прежний.' },
];

const UP = new THREE.Vector3(0, 1, 0);
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _s = new THREE.Vector3();
const C_GLINT = new THREE.Color('#FFF8EA');
let noteCursor = -1; // replays in one session read the next note

// Geometry in real metres, long axis along +X (neck at +X), centred on the waterline point.
function buildGeometry() {
  // lathe profile around +Y (base at −Y), then laid along +X
  const pts = [
    [0.0, -0.15], [0.03, -0.149], [0.0375, -0.142], [0.038, -0.12], [0.038, 0.04], [0.035, 0.066],
    [0.026, 0.088], [0.017, 0.104], [0.0145, 0.118], [0.0145, 0.148], [0.0172, 0.151], [0.0172, 0.158], [0.013, 0.16],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const glass = new THREE.LatheGeometry(pts, 16).rotateZ(-Math.PI / 2);
  glass.deleteAttribute('uv');
  const lay = [0, 0, -Math.PI / 2]; // cylinder Y axis → +X
  const opaque = mergeParts([
    { geometry: new THREE.CylinderGeometry(0.022, 0.022, 0.15, 10), color: '#D8CBA8', position: [-0.035, -0.006, 0], rotation: lay }, // rolled note
    { geometry: new THREE.CylinderGeometry(0.0232, 0.0232, 0.012, 10), color: '#5E4630', position: [-0.03, -0.006, 0], rotation: lay }, // twine
    { geometry: new THREE.CylinderGeometry(0.0138, 0.0128, 0.032, 8), color: '#9A7650', position: [0.152, 0, 0], rotation: lay }, // cork
    { geometry: new THREE.CylinderGeometry(0.0195, 0.0185, 0.012, 10), color: '#6E1C17', position: [0.166, 0, 0], rotation: lay }, // wax seal
  ]);
  return { glass, opaque };
}

export class Bottle {
  constructor(sv) {
    this.sv = sv;
    this.active = false;
    this.taken = false;
    this.x = 0;
    this.z = 0;
    this.y = 0;
    this.yaw = 0;
    this.phase = 0;
    this.capT = 0;
    this.lift = null; // pick-up animation {t, x, y, z, tx, ty, tz}
    this.nrm = new THREE.Vector3(0, 1, 0);
    const { glass, opaque } = buildGeometry();
    const group = (this.group = new THREE.Group());
    group.name = 'survivors.bottle';
    group.matrixAutoUpdate = false;
    group.visible = false;
    // bottle-green glass: thin, glossy, see-through (the note reads through it)
    this.glassMat = new THREE.MeshStandardMaterial({
      color: '#3E6E4E', roughness: 0.07, metalness: 0.05, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
    });
    this.opaqueMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    const inner = new THREE.Mesh(opaque, this.opaqueMat);
    const shell = new THREE.Mesh(glass, this.glassMat);
    shell.renderOrder = 12; // after the ocean
    for (const m of [inner, shell]) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      group.add(m);
    }
    sv.root.add(group);
  }

  clear() {
    this.active = false;
    this.taken = false;
    this.lift = null;
    this.capT = 0;
    this.group.visible = false;
  }

  // def.world.props.bottle places it (op 9★); otherwise a small chance near a survivor group.
  setup(def) {
    this.clear();
    if (!def) return;
    const seed = (def.seed ?? 1) >>> 0;
    const rng = createRng((seed * 97 + 13) >>> 0);
    let force = false;
    try {
      force = new URLSearchParams(globalThis.location?.search || '').has('bottle');
    } catch {
      force = false;
    }
    const p = def.world?.props?.bottle;
    let pos = p && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, z: p.z } : null;
    if (!pos && (force || Math.random() < RARE_CHANCE)) pos = this._scatter(def, rng);
    if (!pos) return;
    this.active = true;
    this.x = pos.x;
    this.z = pos.z;
    this.yaw = rng.range(0, Math.PI * 2);
    this.phase = rng.range(0, 100);
    this.y = this.sv.ctx.ocean?.heightAt?.(this.x, this.z) ?? 0;
    this.nrm.set(0, 1, 0);
    if (noteCursor < 0) noteCursor = Math.floor(rng.next() * NOTES.length);
    this.group.visible = true;
  }

  // 40–90 m off a survivor group (they are in open water), clear of pads and obstacles
  _scatter(def, rng) {
    const groups = (def.survivors || []).filter((e) => e && Number.isFinite(e.x) && Number.isFinite(e.z));
    if (!groups.length) return null;
    const w = this.sv.ctx.world;
    const blocked = [...(w?.obstacles || []), ...(w?.pads || [])];
    for (let k = 0; k < 8; k++) {
      const g = groups[Math.floor(rng.next() * groups.length)];
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(40, 90);
      const x = g.x + Math.cos(a) * r;
      const z = g.z + Math.sin(a) * r;
      if (blocked.every((o) => !Number.isFinite(o?.x) || Math.hypot(o.x - x, o.z - z) > (o.radius || 20) + 12)) return { x, z };
    }
    return null;
  }

  // Simulation + drawing; called inside survivors._draw (collars/glows are open).
  frame(env, dt) {
    if (!this.active) return;
    const sv = this.sv;
    const ocean = sv.ctx.ocean;
    const t = env.t;
    if (this.lift) return this._lift(env, dt);
    // drift: surface current + a little windage (it rides low)
    if (env.play && dt > 0) {
      this.x += (sv.current.x + 0.02 * env.windSpeed * env.windDirX) * dt;
      this.z += (sv.current.y + 0.02 * env.windSpeed * env.windDirZ) * dt;
      this.yaw += dt * 0.08 * Math.sin(t * 0.21 + this.phase);
    }
    this.y = ocean?.heightAt ? ocean.heightAt(this.x, this.z) : 0;
    if (ocean?.normalAt) {
      ocean.normalAt(this.x, this.z, _n);
      this.nrm.lerp(_n, dt > 0 ? 1 - Math.exp(-dt / 0.25) : 1).normalize();
    }
    // half-awash, neck up a little, rolling and pitching with the chop
    _q.setFromUnitVectors(UP, this.nrm);
    _q.multiply(_q2.setFromAxisAngle(UP, this.yaw));
    _q.multiply(_q2.setFromAxisAngle(AX_Z, 0.13 + 0.07 * Math.sin(t * 1.7 + this.phase)));
    _q.multiply(_q2.setFromAxisAngle(AX_X, 0.25 * Math.sin(t * 1.1 + this.phase * 1.3)));
    const bob = 0.012 * Math.sin(t * 2.3 + this.phase);
    this._place(this.x, this.y - 0.025 + bob, this.z, _q, SCALE);
    // thin wet collar along the glass (collar elongates along its Z; the bottle lies along X)
    sv.collars.push(this.x, this.y, this.z, this.nrm.x, this.nrm.y, this.nrm.z, 0.11, 0.3, 0.5, 0, this.phase, this.yaw + Math.PI / 2, 2.2);
    this._glint(env);
    if (env.play && env.rotorHeard) this._pickup(env, dt); // flying (not sitting on a pad)
  }

  _place(x, y, z, q, scale) {
    _m.compose(_v.set(x, y, z), q, _s.setScalar(scale));
    this.group.matrix.copy(_m);
    this.group.matrixWorld.copy(_m);
    for (const c of this.group.children) c.matrixWorld.copy(_m);
  }

  // glass catches the light: sun sparkle (day, clear) and the searchlight beam (night)
  _glint(env) {
    const sv = this.sv;
    const ocean = sv.ctx.ocean;
    const flick = Math.pow(Math.max(0, Math.sin(env.t * 2.9 + this.phase)), 10);
    let k = 0;
    if (env.sunny) k = 0.9 * flick;
    const beam = ocean?.searchlightAt ? ocean.searchlightAt(this.x, this.z, this.y) : 0;
    if (beam > 0.05) k = Math.max(k, beam * (0.55 + 0.45 * flick));
    if (k <= 0.02) return;
    if (env.reduceFlashes) k *= 0.5;
    sv.glows.add(this.x, this.y + 0.08, this.z, 0.07, C_GLINT, 2.4 * k, 0.55, 0.35 * k, 0);
    ocean?.addGlint?.(this.x, this.z, 0.8, 0.5 * k, C_GLINT);
  }

  _pickup(env, dt) {
    const dB = env.bWet ? Math.hypot(env.bx - this.x, env.bz - this.z) : Infinity;
    const dH = Math.hypot(env.hx - this.x, env.hz - this.z);
    const basket = dB < BASKET_R;
    const hover = env.alt <= HOVER_ALT && dH <= HOVER_R;
    if (basket || hover) this.capT += dt;
    else this.capT = Math.max(0, this.capT - dt * 2);
    if (this.capT < CAPTURE_T) return;
    this._take(env, basket ? 'basket' : 'hover');
  }

  _take(env, by) {
    const sv = this.sv;
    const ctx = sv.ctx;
    this.taken = true;
    const to = by === 'basket' ? { x: env.bx, y: env.by + 0.3, z: env.bz } : { x: env.hx, y: env.hy - 1, z: env.hz };
    this.lift = { t: 0, x: this.x, y: this.y, z: this.z, tx: to.x, ty: to.y, tz: to.z };
    noteCursor = (noteCursor + 1) % NOTES.length;
    const note = NOTES[noteCursor];
    const pos = { x: this.x, y: this.y, z: this.z };
    sv._emit('survivor:bottle', { title: note.title, text: note.text, x: this.x, z: this.z, by });
    // small style bonus through the existing score event: the mission's own style (if it knows
    // 'bottle'), else a plain style line in the scorer, else the bare event for the HUD popup
    const m = ctx.mission;
    let pts = 0;
    try {
      pts = m?.style?.('bottle', pos) || 0;
      if (!pts && m?.scorer?.add && m.state === 'play') pts = m.scorer.add('style', BOTTLE_POINTS, 'Бутылка с запиской', pos);
    } catch {
      pts = 0;
    }
    if (!pts && !m?.scorer) ctx.events.emit('score:add', { points: BOTTLE_POINTS, reason: 'Бутылка с запиской', position: pos, kind: 'style', style: 'bottle' });
  }

  // up into the basket / the door, shrinking out of sight
  _lift(env, dt) {
    const L = this.lift;
    L.t += dt;
    const k = clamp01(L.t / 0.8);
    const e = k * k * (3 - 2 * k);
    _q.setFromAxisAngle(UP, this.yaw);
    _q.multiply(_q2.setFromAxisAngle(AX_Z, 0.4 * e));
    this._place(L.x + (L.tx - L.x) * e, L.y + (L.ty - L.y) * e, L.z + (L.tz - L.z) * e, _q, SCALE * (1 - 0.85 * e));
    if (k >= 1) {
      this.active = false;
      this.lift = null;
      this.group.visible = false;
    }
  }
}
