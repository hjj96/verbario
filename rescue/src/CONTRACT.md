# MAYDAY — engineering contract

This file is the **single source of truth for how systems talk to each other**.
Game design (what to build and why) lives in `../DESIGN.md`. If the two disagree on an
*interface*, this file wins; on *look/feel/numbers*, DESIGN.md wins.

## Ground rules

* Plain ES modules, no build step. `import * as THREE from 'three'`, addons via `three/addons/...`
  (only the files present in `rescue/vendor/three/addons/` exist — do not import others; if you need
  more, write it yourself).
* **No external assets.** Geometry is built in code, textures via `<canvas>`/`DataTexture`/shaders,
  sound via WebAudio. Fonts: Oswald / JetBrains Mono / Inter from Google Fonts with system fallbacks.
* Each system is one class in `src/systems/<name>.js` (helpers may go in `src/systems/<name>/*.js`
  or `src/ui/*`). **Only edit the files you own.** `src/main.js`, `src/core/*`, `src/CONTRACT.md`
  belong to the integrator — if you need a contract change, say so in your final report.
* A system must never crash the game: guard against other systems being stubs (`src/core/stubs.js`
  shows the minimum each system is guaranteed to expose).
* Performance: no allocations in hot paths (reuse vectors), no per-frame `new THREE.*`, instancing for
  crowds of objects, shared geometries/materials. Respect `ctx.settings.get('quality')`
  (`'low' | 'medium' | 'high'`) and `ctx.settings.detail()` (0.35 / 0.65 / 1 multiplier).
* All user-visible text is **Russian**.
* **Lights:** never add or remove lights after `init()` (it forces every material to recompile and
  stalls for seconds). Create the lights you need up front and **toggle `intensity` only** (`visible`
  also changes the light count and triggers recompiles). Budget: weather 2 (sun/moon
  directional with shadows, hemisphere), heli 2 (searchlight SpotLight, belly/beacon PointLight),
  fx 4 pooled PointLights (flares, lightning ground glow, fires) via `fx.acquireLight()`, world 2
  (lighthouse beam SpotLight, ship deck PointLight). Everything else that glows = emissive materials + bloom.
* Shadows: only the weather sun casts shadows (shadow camera follows the heli, ~250 m box). Heli,
  ships, rig, survivors' rafts `castShadow = true`; ocean `receiveShadow = true`.

## Coordinates & units

* 1 unit = 1 metre, 1 s = 1 s. **Y is up**, sea level is `y = 0`.
* **North = −Z = screen up**, **East = +X = screen right**. The camera looks down (slightly tilted
  toward north). Headings: `heading = 0` faces north (−Z), positive = clockwise (towards east), radians.
* 2D horizontal vectors are `THREE.Vector2` with `.x = world X`, `.y = world Z`.
* Play area: a disc of radius `mission.def.area.radius` (≈1500 m) around the origin. Beyond it the
  sea continues visually but the HUD warns and fuel burns faster.

## Lifecycle

```js
class SomeSystem {
  constructor(ctx)   // create own objects; DO NOT call other systems here
  async init()       // may read other systems (they all exist now, possibly as stubs)
  update(dt)         // called EVERY frame. dt = game seconds, 0 while paused.
  resize(w, h)       // optional
}
```

* `ctx.time = { t, dt, realT, realDt, frame }` — `t/dt` freeze while paused; `realDt` never does.
  Systems that animate while paused (`cameraRig`, `audio`, `hud`, `post`, `radio`) receive `realDt`
  as their `dt`. **Never divide by dt without guarding against 0.**
* Update order (see `main.js`): weather → ocean → world → hazards → heli → survivors → fx →
  cameraRig → radio → mission → audio → hud → post(render).

## ctx (shared object, also `window.__game`)

| key | what |
|---|---|
| `THREE, renderer, scene, camera, container, hudRoot` | rendering basics. `hudRoot` = `#hud` div (pointer-events none by default; enable per element). Renderer: no canvas MSAA (post does MSAA on its target), `PCFShadowMap`, ACES, sRGB; camera FOV 40, near 2, far 1200 |
| `look` | **shared look layer** `core/look.js` — see below. Use it; don't re-invent noise/fog/merge |
| `settings` | `get(k)`, `set(k,v)`, `onChange(fn)`, `detail()`; keys in `core/settings.js` (quality, volumes, reduceFlashes, reduceMotion, screenShake, colorblindMarkers, subtitles, invertLift, showFps, textScale, hudScale, vibration, assist `'full'|'standard'|'off'`, difficulty `'cadet'|'pilot'|'ace'`, seenFlashWarning) |
| `events` | `on(name, fn) → off`, `once`, `emit(name, payload)` |
| `input` | `axis('moveX'|'moveY'|'lift'|'aimX'|'aimY')`, `move() → {x,y}`, `down/pressed/released(action)`, `rawPressed(action)` (ignores `enabled`), `enabled` flag, `setVirtualAxis/Button` (touch UI), `rumble()`, `lastDevice`, `mouse`, `consumeWheel()` |
| `rng`, `noise` | seeded `createRng` / `createNoise2D` from `core/math.js` (also `damp`, `clamp`, `GLSL_NOISE`, …) |
| `mode` / `setMode(m)` | `'title' | 'briefing' | 'play' | 'paused' | 'debrief'`. **Only `mission` calls `setMode`.** Emits `game:mode {from,to}` |
| `timeScale` | slow-mo hook (mission/cameraRig may set briefly, e.g. 0.3 for a dramatic moment) |
| `debug`, `params` | `?debug` flag, URL params (e.g. `?mission=3`, `?weather=storm`, `?quality=low`) |
| systems | `weather, ocean, world, hazards, heli, survivors, fx, cameraRig, radio, mission, audio, hud, post` |

### Input actions (`core/input.js`, bindings by `event.code`, never Ctrl)
Axes: `moveX`, `moveY` (+1 = north/screen-up), `lift` (+1 climb: E/R/PageUp, −1: Q/F/PageDown, RT/LT),
`aimX/aimY` (right stick). Buttons: `winch` (Space, A), `boost` (Shift, LB), `searchlight` (L, X),
`flare` (G, **LMB on the canvas**, B), `raftDrop` (C, **RMB**, D-pad →), `horn` (H, Y — loudspeaker),
`altPreset1/2/3` (1/2/3 → 15/40/90 m), `altUp/altDown` (D-pad ↑↓), `map` (Tab/M, View), `pause`
(Esc/P, Start), `confirm` (Enter, A), `back` (Esc/Backspace, B), `zoom` (Z, RB), `navUp/Down/Left/Right`
(arrows/WASD/D-pad, for menus). `input.mouse.lastMoveT` (performance.now ms) — nose follows cursor
for 2 s after the mouse moved. Context menu is disabled over the canvas.

### look (`core/look.js`, owned by the integrator)
* Textures (tiling, linear, mipmapped): `look.atlas` (R fbm, G Worley F1, B Worley F2−F1, A hash; 256²),
  `look.detail` (RG slopes 0.5 = flat, B height; 256²; decode `slope = (tex*2-1)*look.detailMaxSlope` per uv unit),
  `look.lace` (R foam lace, G blotches, B fine lace; 512²).
* `look.uniforms` — **shared uniform objects**: `uTime, uWind (Vector2 m/s), uWindOffset (integrated wind
  travel m), uRain, uWet, uFlash, uNight, uResolution, uAtlas, uDetail, uLace, uGustFronts[4], uGustFrontsB[4]`.
  Put them into your material's `uniforms` by reference (`{...look.uniforms, myStuff}`), then include
  `LOOK_GLSL_UNIFORMS` + `LOOK_GLSL_FUNCS` in the shader: `lookGust(xz)` (cat's-paw field 0..1),
  `lookFronts(xz)` (gust-front extra wind m/s), `lookCloud(xz)` (cloud cover 0..1).
* CPU mirrors (identical maths): `look.gustField(x,z)`, `look.frontsAt(x,z)`, `look.cloudAt(x,z)`,
  `look.sampleAtlas/sampleLace/sampleDetail(u, v, ch)`.
* Writers: `main.js` → `look.setTime(t)`, `setResolution`; **weather** → `look.setWind(windVec2, dt)`,
  `look.setFronts([{x, z, dirX, dirZ, strength, width:140, length:500}])` every frame, and
  `look.uniforms.uRain/uWet/uFlash/uNight.value`.
* Fog: the global fog chunks are patched — fog distance is the **horizontal distance from the point under
  the screen centre** with a height falloff (visibility bubble). `THREE.Fog(color, near, far)` takes the
  horizontal metres from DESIGN §2.3. Custom `ShaderMaterial`s with `fog: true` must compute
  `mvPosition` before `#include <fog_vertex>` and include the fog chunks.
* `look.keyline({color, opacity, px})` — inverted-hull outline material (constant px thickness).
* `look.merge(parts)` — merge `[{geometry, color, position, rotation, scale | matrix}]` into one
  geometry with baked vertex colours (use `vertexColors: true`). `look.canvasTexture(w, h, draw)`.

## Systems

### weather (`systems/weather.js`, class `Weather`)
Owns: weather state machine, wind field, gusts, lightning scheduling, time of day, **scene lights**
(sun/moon `DirectionalLight` with shadows following the heli, `HemisphereLight`), `scene.fog`,
`scene.background` colour, palette interpolation.
```js
weather.state = {
  preset,            // current preset name (see DESIGN.md weather table)
  intensity,         // 0..1 overall storminess
  windDir,           // Vector2 unit (direction wind blows TOWARDS)
  windSpeed,         // m/s mean
  gust,              // m/s current extra gust magnitude (already included in windAt)
  rain, fog, hail,   // 0..1
  lightning,         // 0..1 strike frequency factor
  waveHeight,        // significant wave height in metres (ocean reads it), ~0.3 calm .. 9 storm
  waveChoppiness,    // 0..1
  night,             // 0..1 darkness
  timeOfDay,         // 0..1 (0.25 sunrise, 0.5 noon, 0.75 sunset)
  flash,             // 0..1 current lightning flash brightness (already scaled by reduceFlashes)
  visibility,        // metres
  palette: {         // blended palette (DESIGN §2.3), THREE.Color unless noted
    sky, fogColor, deep, body, crest, shallow, foam, sun, ambient, ambientGround, spec, accent, shadowTint,
    sunIntensity, ambientIntensity, shadowIntensity, fogNear, fogFar, exposure, envIntensity,   // numbers
    sea: { Hs, swellAdd, Q, detail, whitecaps, streaks, foamLines, roughness },                   // DESIGN §2.6.3
    post: { bloomStrength, bloomRadius, bloomThreshold, saturation, contrast, slope /*Vector3*/, offset /*Vector3*/,
            power, splitShadow /*Color*/, splitHighlight /*Color*/, splitStrength, vignette, vignetteColor /*Color*/,
            grain, ca, drops },                                                                    // DESIGN §2.8
  },
  palettePrev,       // palette of the preset we are transitioning FROM (for the spatial front)
  sunDir,            // Vector3 to the sun/moon used for SHADOWS (clamped elevation, DESIGN §2.3 "cheated sun")
  sunDirVisual,      // Vector3 true visual sun direction (glitter, sky warmth)
  front,             // { origin: Vector2, dir: Vector2, speed, width, active, t } spatial weather front (DESIGN §2.5)
  greenTint,         // 0..1 tornado overlay (hazards drive it via weather.setGreenTint(v))
  stElmo,            // 0..1 St. Elmo's fire on the heli (charge near the heli)
  pressure,          // hPa (falls 15 s BEFORE a worse preset)
  gustFronts,        // [{x, z, dirX, dirZ, strength, width, length, eta}] ≤ 4 (same data given to look.setFronts)
  turbulence,        // m/s noise amplitude for the heli (DESIGN §3.13)
  beaufort, seaState,// integers for the HUD
}
weather.windAt(x, z, out /*Vector2*/) → out   // m/s incl. gusts & local gust fronts
weather.setPreset(name, transitionSeconds = 0)
weather.forecast() → [{ in: seconds, preset }]  // for HUD/radio
weather.strikeLightning(x, z, { cloudOnly })   // forced strike (hazards may call)
weather.setGreenTint(v)                         // 0..1 target, eased
weather.spawnGust({ strength, dir /*Vector2|undefined*/, eta = 6, harmless })  // scripted gust front (onboarding)
weather.runEndless()                            // «Смена» escalation (DESIGN §3.13), called by mission in endless mode
weather.detectBase() → { base, altBonus }       // DESIGN §3.10 table for the current blend (survivors use it)
weather.runScript(def.weather)                  // done automatically on mission:setup
```
Weather schedules lightning (frequency per preset): 70% in-cloud (`cloudOnly`), the rest hit the sea
≤ 600 m from the heli; above 70 m alt 35% of those target the heli. 2 s (cadet 3 s) before a sea strike
it emits `weather:charge {x, z, radius: 30, eta}` and raises `stElmo` if the heli is inside. At the strike
it emits `weather:lightning`, runs the flash envelope (§2.8, honouring `reduceFlashes`) and swings the
shadow light toward the strike for ~350 ms. **hazards** applies lightning damage/EMP/near-miss bonus;
**fx** draws bolts/spiders; **audio** thunder.
Events emitted: `weather:preset {from, to, over}`, `weather:gust {dir: Vector2, strength, eta, x, z}` (telegraph,
eta ≈ 6 s before the front reaches the heli), `weather:charge {x, z, radius, eta}`,
`weather:lightning {x, z, distance /*from heli*/, strength, cloudOnly}`, `weather:pressure {pressure, trend}`.

### ocean (`systems/ocean.js`, class `Ocean`)
Owns: the sea surface mesh (follows camera), its shader (waves, colour, foam, ripples, downwash),
underwater depth tint. Reads `weather.state` (waveHeight, palette, sunDir, flash, rain).
```js
ocean.heightAt(x, z) → y            // surface height at current time (CPU match of the GPU waves)
ocean.normalAt(x, z, out /*Vector3*/) → out
ocean.velocityAt?(x, z, out)        // optional: surface drift (Vector2)
ocean.splash(x, z, radius, strength)        // expanding ring ripple + foam (pooled, e.g. 24 slots)
ocean.heightAt(x, z, tOffset = 0)          // tOffset: look-ahead seconds (HUD wave window, winch)
ocean.setDownwash(x, z, radius, strength)   // rotor downwash disc this frame (0 strength = off)
ocean.setSearchlight(pos /*Vector3*/, dir /*Vector3*/, cosOuter, intensity)  // heli calls every frame (intensity 0 = off)
ocean.searchlightAt(x, z) → 0..1            // CPU: how lit a point is (survivors' reflective tape, detection)
ocean.addGlint(x, z, radius, intensity, color)  // call EVERY frame per light reflection (strobes, nav lights, raft lamps);
                                            // ocean keeps the 8 most intense, uploads them next update, then clears
ocean.stamp(kind, x, z, opts)               // optional water-memory stamps: 'foam','dye','scar','oil','disturb'
ocean.addWake(x, z, strength)               // foam trail points (boats, survivors swimming)
ocean.setFeature(id, f) / ocean.removeFeature(id)   // large-scale surface features rendered IN the water
    // f = { type: 'rogue', origin: Vector2, dir: Vector2, speed, height, length /*crest length*/, width /*front-to-back*/ }
    //   | { type: 'whirlpool', x, z, radius, strength /*0..1*/ }
    //   | { type: 'vortex', x, z, radius, strength }     // waterspout base: spray ring + swirl
    // Max 4 features at once. heightAt() INCLUDES them (never add hazards.waveLiftAt on top).
    // Hazards own the gameplay; ocean owns the look.
ocean.setShoals(list)                       // ≤ 8 [{x, z, radius}] rocks/shallows: depth ramp, damped waves, surf band (world calls)
ocean.mesh
```
The sea surface **must** receive the helicopter's shadow and be lit by the scene's lights (heli
searchlight `SpotLight`, flare/strobe `PointLight`s) — e.g. `MeshStandardMaterial`/`MeshPhysicalMaterial`
with `onBeforeCompile` (Gerstner displacement in the vertex shader, colour/foam in the fragment shader),
or an equivalent custom shader that reads those lights.

### world (`systems/world.js`, class `World`)
Owns: static/moving props — rescue ship(s), oil rig, lighthouse, coast/rocks, buoys, debris,
containers, capsized boats as scenery; **helipads** (delivery + refuel points).
```js
world.pads = [{ id, name, type /*'ship'|'rig'|'lighthouse'|'coast'*/, position /*Vector3 deck top*/,
                radius, refuel: true, heading, object3d }]
world.padAt(x, z) → pad | null        // pad whose landing circle contains (x,z)
world.nearestPad(x, z) → pad
world.obstacles = [{ x, z, radius, top }]  // tall things the heli can hit (rig derrick, lighthouse, masts, fog rocks)
// pad extra fields: height (deck height), tilt (current deck tilt rad), velocity (Vector3), services
// { fuel /*%/s*/, repair /*%/s*/, resupply /*bool*/ }, lee (bool, rig: lee turbulence wedge)
// world emits 'world:foghorn' {x, z} (lighthouse in fog, every 30 s) and 'world:horn' {x, z} (Arktur, heli < 300 m)
```

### hazards (`systems/hazards.js`, class `Hazards`)
Owns: waterspouts/tornadoes, rogue waves, whirlpools, lightning ground strikes zones, gust fronts
visuals if any, hail cells, fog banks (whatever DESIGN.md lists). Visuals + forces + telegraphs.
```js
hazards.list                                  // active hazards [{id, type, position: Vector3, radius, ...}]
hazards.spawn(type, opts) → hazard
hazards.clear()
hazards.forceAt(x, z, altitude, out /*Vector3*/) → out   // acceleration m/s² applied to the heli
hazards.surfaceFlowAt(x, z, out /*Vector2*/) → out       // horizontal drift m/s for floating things
hazards.waveLiftAt(x, z) → metres                        // rogue-wave part of the sea height — INFO ONLY, already inside ocean.heightAt
hazards.imminent → { type, position, eta } | null        // the most urgent upcoming hazard (camera reveal, music riser)
hazards.dangerAt(x, z, altitude) → 0..1                  // for HUD warnings
```
Events: `hazard:warning {type, position, eta, text}`, `hazard:spawn {hazard}`, `hazard:hit {type, damage}`, `hazard:end {hazard}`,
`hazard:near-miss {type}` (style bonus).
Types: `'waterspout'`, `'tornado'`, `'rogue'`, `'whirlpool'`, `'downburst'` (NICE), `'hail'` (NICE). Also owns
lightning **damage** (listens to `weather:charge`/`weather:lightning`; draws the charge ring on the water),
the tornado `greenTint` (`weather.setGreenTint`), random hazards when `def.hazardsRandom`/endless.
Mechanics & telegraphs: DESIGN §3.12, look: §2.12, ocean features via `ocean.setFeature`.

### heli (`systems/heli.js`, class `Helicopter`)
Owns: helicopter model, flight model, altitude, fuel, hull, cabin, winch + rescue basket + cable,
searchlight, nav lights, rotor, landing/refuel/unload on pads.
```js
heli.position      // Vector3 (y = altitude above sea level)
heli.velocity      // Vector3 m/s
heli.heading       // rad
heli.altitude      // metres above the local sea surface
heli.fuel, heli.hull   // 0..1
heli.cabin         // array of rescued survivor records on board
heli.capacity      // seats
heli.landed        // pad | null
heli.alive         // false after crash
heli.searchlight   // bool
heli.winch = { state /*'stowed'|'lowering'|'down'|'raising'*/, length, basket /*Vector3 world*/, steadiness /*0..1*/,
               load /*survivor|null*/, speed /*m/s cable*/, swing /*rad*/, target /*survivor|null*/, capture /*0..1*/ }
heli.rotorRPM      // 0..1
heli.load          // 0..1 rotor load (audio)
heli.bank          // rad visual bank
heli.boost         // bool
heli.engineTemp    // 0..100
heli.flares, heli.rafts   // remaining consumables
heli.emp           // seconds of EMP left (HUD glitch, radar off)
heli.aim           // Vector3 world point under the cursor / right stick (searchlight & flare target)
heli.altTarget     // commanded altitude
heli.group         // Object3D
heli.reset(spawn)                 // {x, z, heading, pad?}
heli.applyImpulse(v /*Vector3*/)  // instant velocity change
heli.damage(amount, source)       // 0..1 hull
heli.addFuel(amount)
heli.autoTakeoff(altitude = 40)  // onboarding: take off by itself
heli.onPad                       // pad currently landed on (alias of landed)
```
Events: `heli:damage {amount, source, hull}`, `heli:crash {reason}`, `heli:winch {state}`,
`heli:pickup {survivor}`, `heli:land {pad}`, `heli:takeoff {pad}`, `heli:unload {pad, count, people}`,
`heli:fuel-low {fuel, level /*'low'|'critical'|'empty'|'bingo'*/}`, `heli:refuel {pad}`, `heli:flare {x, z}`,
`heli:tension {level}`, `heli:raft-drop {x, z}`, `heli:loudspeaker {x, z}`, `heli:searchlight {on}`.
Flight model, altitude bands, winch, fuel, hull, pads: DESIGN §3.3–3.9 (fixed 60 Hz physics step with accumulator).

### survivors (`systems/survivors.js`, class `Survivors`)
Owns: people in the water / on rafts / boats / containers, their visuals & animation, drift,
hypothermia, distress markers (smoke, flares, strobe, waving), being picked up by the winch.
```js
survivors.list = [{ id, type, position /*Vector3*/, count /*people in group*/, remaining,
                    health /*0..1*/, state /*'hidden'|'drifting'|'spotted'|'winching'|'rescued'|'lost'*/,
                    spotted /*bool*/, priority /*bool, e.g. injured*/, object3d,
                    height /*deck height for 'deck'/'wreck'*/, signals /*{rockets, epirb, smoke, dye, mirror}*/ }]
// types: 'swimmer' | 'raft' | 'hull' | 'container' | 'injured' | 'deck' | 'wreck' (+ NICE 'plane')
survivors.datums = [{ x, z, radius, ids }]   // search areas (drift + grow 0.5 m/s), HUD draws them
survivors.spawn(def) → survivor
survivors.clear()
survivors.nearestFor(x, z, maxDist) → survivor | null   // closest pick-up-able
survivors.attachToBasket(s) / detachFromBasket(s)       // called by heli's winch logic
survivors.remainingCount(), survivors.rescuedCount(), survivors.lostCount()
```
Pickup protocol: heli winch logic calls `survivors.nearestFor(basket.x, basket.z, 3)` when the basket
is at the surface; if returned and steadiness is good it calls `attachToBasket(s)`; when the basket is
back in the cabin heli calls `survivors.boardOne(s)` → returns a person record `{name, age, condition}`
for `heli.cabin`, decrements `s.remaining`, emits `survivor:rescued` when the group is empty.
Events: `survivor:spawn {s}`, `survivor:spotted {s, by}`, `survivor:critical {s}`, `survivor:lost {s}`,
`survivor:boarded {s, person}`, `survivor:rescued {s}` (group fully lifted), `survivor:signal {s, kind:
'rocket'|'whistle'|'smoke'|'mirror'|'epirb'|'strobe', x, z, error}`, `survivor:shout {s}`.
People count as **delivered** when `heli:unload` happens at a pad (scoring uses that).
Detection (DESIGN §3.10) is computed by survivors: detectR table, searchlight 0.4 s in the pool, player
flares (`heli:flare`, 45 m for 40 s), loudspeaker responses (`heli:loudspeaker`), signals.
`heli:raft-drop` spawns an empty raft that nearby swimmers swim to.

### fx (`systems/fx.js`, class `Effects`)
Owns: GPU particle pools (rain streaks, sea spray, splash droplets, mist, smoke, flare sparks, hail,
debris bits), screen-independent world ambient life (birds, dolphins/whales, jellyfish glow, fish).
```js
fx.splash(x, y, z, size)        // droplets burst
fx.spray(x, z, dir /*Vector2*/, amount)
fx.smoke(x, y, z, color, amount)        // emitter tick
fx.sparks(x, y, z, color, amount)
fx.flare(x, z)                  // dropped marker flare (burns ~40 s, red light + smoke)
fx.burst(name, position, opts)  // generic named effect
fx.acquireLight(color, intensity, distance) → handle { position, set(intensity), release() }  // pooled PointLights
fx.bolt(x, z, strength)         // lightning bolt visual (also triggered by weather:lightning events)
```
fx also owns: wind streak lines on the water (telegraph `weather:gust`), low cloud/scud layers drifting
between camera and sea in bad weather, birds, dolphins/whales, night jellyfish glow.

### cameraRig (`systems/camera.js`, class `CameraRig`)
Owns `ctx.camera` placement. Modes: `'follow'` (top-down follow with look-ahead by velocity, zoom by
altitude/speed), `'attract'` (title screen slow drift), `'cinematic'` (debrief / dramatic).
```js
cameraRig.mode
cameraRig.shake(strength /*0..1*/, duration)   // scaled by settings.screenShake
cameraRig.punch(fovDelta, duration)
cameraRig.focus(position, duration)            // temporarily look at something
cameraRig.worldToScreen(v /*Vector3*/, out) → out {x, y (px), onScreen, behind}
cameraRig.screenToWater(ndcX, ndcY, out /*Vector3*/) → out   // ray-plane hit at y = 0 (cursor aim)
cameraRig.letterbox    // 0..1 current letterbox amount (post/hud draw the bars)
cameraRig.zoom                                 // current zoom factor
```

### radio (`systems/radio.js`, class `Radio`)
Owns: radio chatter content (Russian), queueing/priorities, reacting to events with lines.
```js
radio.say(speaker /*'dispatch'|'pilot'|'winchman'|'survivor'|'coastguard'|'ship'*/, text,
          { priority = 1, duration, name /*caption, e.g. 'БЕРЕГ'*/, channel /*'ext'|'ics'|'handheld'*/, id })
radio.line(id, vars)   // say a catalogue line from DESIGN §5 by id with template vars
```
Emits `radio:line {speaker, name, channel, text, duration, priority, id}` (HUD shows subtitles, audio plays
squelch + vowel "babble"). Queue rules, templates ({square}, {clock}, {dist}, {dir}, {heading}): DESIGN §5.

### mission (`systems/mission.js`, class `Mission`)
Owns: game flow & modes, campaign definitions, endless mode, objectives, timers, scoring, medals,
progress persistence, onboarding prompts, pause toggling, fail/complete logic.
```js
mission.def            // current mission definition (format below)
mission.list           // all campaign missions
mission.start(idOrIndex)  // emits mission:setup then switches to 'briefing'
mission.launch()          // briefing → play
mission.score, mission.stats = { rescued, lost, time, damageTaken, fuelUsed, ... }
mission.objectives     // [{ id, text, done, progress, target }]
```
Flow: `title` → (`ui:start` / `ui:select-mission {index}`) → `mission.start()` → `briefing` → (`ui:launch`)
→ `play` ⇄ `paused` (input `pause` or `ui:resume`) → `debrief` (`mission:complete` / `mission:failed`) →
(`ui:next` / `ui:retry` / `ui:menu`).
Events: `mission:setup {def}` (**every system resets itself from `def` in its listener**; order of
listeners = system order, so world pads exist before heli spawns), `mission:start {def}`,
`mission:objective {objective}`, `mission:complete {stats, score, medals}`, `mission:failed {reason, stats}`,
`mission:hint {text, key}` (onboarding prompts for HUD), `score:add {points, reason, position}`.

Mission definition (`def`):
```js
{
  id, index, title, subtitle, brief /*Russian text*/, seed,
  area: { radius },
  timeOfDay,                         // 0..1 start
  weather: { start: 'calm', script: [{ at /*s*/, to /*preset*/, over /*s*/ }] },
  world: { pads: [{ type, x, z, heading, name, drift /*{x,z} m/s*/ }], props: { buoys, debris, containers, boats, rig, lighthouse, rocks } },
  heli: { pad: 0 } | { x, z, heading, altitude },
  survivors: [{ type, x, z, count, at /*spawn time s*/, hidden /*needs search*/ }],
  hazards: [{ type, at, x, z, ...opts }],
  objectives: { rescue /*min people*/, timeLimit /*s or 0*/ },
  waterTemp /*°C, default 8*/, current /*{x, z} m/s*/, par /*s*/, medals,
  hazardsRandom /*bool: random hazards per preset frequency*/,
  // survivors[] may also have: signals {rockets, epirb, smoke, dye, mirror}, datumRadius, height (deck), name
  endless?: true,
}
Campaign content & numbers: DESIGN §3.14–3.16.
```

### audio (`systems/audio.js`, class `AudioEngine`)
Owns: WebAudio graph, all procedural sounds and music. Unlocks on first user gesture
(`pointerdown`/`keydown`). Listens to events and polls `heli`, `weather` each frame.
```js
audio.unlock(); audio.play(name, opts); audio.setMuted(bool)
```

### hud (`systems/hud.js`, class `Hud`) + `src/ui/*` + `src/ui/hud.css`
Owns: all DOM UI — title screen, mission select, briefing, in-game HUD (altitude, speed, fuel, hull,
wind, cabin, compass, off-screen survivor arrows, radar/minimap, winch steadiness, warnings), radio
subtitles, hints, pause/settings, debrief, touch controls (calls `input.setVirtualAxis/Button`).
Emits `ui:*` events only; never mutates game state directly except `settings.set`.

### post (`systems/post.js`, class `PostFX`)
Owns: `EffectComposer` stack (render, bloom, custom grade/vignette/grain/CA/lens-rain/flash pass,
output) and `render(dt)`. Reads weather & heli state for per-weather tuning, `settings.reduceFlashes`.
```js
post.render(dt); post.resize(w, h); post.pulse(name, strength) // e.g. 'damage' red edge, 'lightning'
```

## Debug / test URL parameters (must keep working — automated playtests depend on them)

| param | owner | effect |
|---|---|---|
| `?autostart` | mission | skip title & briefing, go straight to `play` |
| `?mission=N` | mission | campaign mission index (0-based); `?mission=endless` for endless mode |
| `?weather=<preset>` | weather | force this preset at start and disable the weather script |
| `?tod=0.8` | weather | force time of day |
| `?quality=low|medium|high` | settings | override quality |
| `?debug` | everyone | extra logging / overlays allowed (HUD may show an FPS + state panel) |
| `?seed=N` | mission | override mission seed |
| `?nohud` | hud | hide all DOM UI (for clean screenshots) |
| `?only=ocean,weather` | main | use stubs for every system except the listed ones (isolated testing) |
| `?stub=hud,audio` | main | force stubs for the listed systems |

Systems expose enough on `window.__game` for tests, e.g. `__game.weather.setPreset('storm', 0)`,
`__game.hazards.spawn('waterspout', {x, z})`, `__game.heli.position`, `__game.mission.start(2)`.

## Event catalogue (quick list)
`game:ready`, `game:mode`, `ui:start`, `ui:select-mission`, `ui:launch`, `ui:resume`, `ui:retry`,
`ui:next`, `ui:menu`, `ui:settings`, `mission:setup`, `mission:start`, `mission:objective`,
`mission:complete`, `mission:failed`, `mission:hint`, `score:add`, `weather:preset`, `weather:gust`,
`weather:lightning`, `hazard:warning`, `hazard:spawn`, `hazard:hit`, `hazard:end`, `heli:damage`,
`heli:crash`, `heli:winch`, `heli:pickup`, `heli:land`, `heli:takeoff`, `heli:unload`, `heli:fuel-low`,
`heli:refuel`, `heli:flare`, `survivor:spawn`, `survivor:spotted`, `survivor:critical`, `survivor:lost`,
`survivor:boarded`, `survivor:rescued`, `radio:line`.
