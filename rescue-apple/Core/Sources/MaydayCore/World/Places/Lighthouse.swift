// world/lighthouse.js Lighthouse «Скалистый» (DESIGN §2.11 [MUST], §3.9, catalogue #31, #43): the start pad.
// The island is a terrain.js landmass (Landforms: heightfield, boulders, krummholz) with surf; the
// structures are ONE baked prop mesh (lighthouse_{q}.mmesh) seated on the sampled terrain. Simulated here:
//   gameplay   pad at DECK_Y on the island, radius 10.5; obstacles: the tower, the radio mast and the
//              collision columns fitted to the rock; surf circles inscribed in the coastline
//   lamps      perimeter / floods / lantern / porch / mast / walkway bollards / jetty head / offload
//              (positions where the web's part builder puts them: walkway kerb heights and jetty piles
//              come from the island sampler)
//   beam       rotating DOUBLE beam (PERIOD s per turn): angle, intensity / density / penetration in fog,
//              the lantern flash when a beam swings across the viewer, the world's SpotLight sweeping the
//              sea toward the heli, light spills on the prop material and on the rock
//   windsock   on the pad, from weather.windAt at the hoop
//   foghorn    every 30 s while the fog is thick (`world:foghorn`; audio plays it, radio announces it)
//   collars    foam round each jetty pile at the live waterline
// Literal numbers of the web's builder (porch, walkway, jetty geometry) keep its expression shape.

public final class Lighthouse: WorldPlace {
  public let kind = PlaceKind.lighthouse
  public let name: String
  public let x: Double
  public let z: Double
  unowned let W: World
  let L: LighthouseTables

  public private(set) var land: IslandLand
  public let padPosition: V3
  public let padRadius: Double = 10.5
  public let lantern: V3
  /// the windsock hoop (world)
  public let hoop: V3
  public private(set) var obstacles: [WorldObstacle]
  public private(set) var shoals: [ShoalCircle]?
  /// the rock as one disc {x − 6, z − 17, r 26, top 10.5} (kept for the HUD / debug; not an obstacle)
  public let island: WorldObstacle
  public var lowerDeck: LowerDeck? { nil }
  public var deckMotion: PadMotion? { nil }

  // positions found while seating the structures (world unless noted)
  public private(set) var doorLamp = V3()
  public private(set) var porchLamp = V3()
  public private(set) var walkLamps: [V3] = []
  /// island-local [x, z] of the jetty-head harbour light
  public private(set) var jettyHead = V2()
  /// world [x, z] of every jetty pile
  public private(set) var piles: [V2] = []
  public private(set) var lanternLamp = -1
  public private(set) var unloadLamps: [Int] = []

  // beam / light state
  /// beam rotation about +Y (rad)
  public private(set) var angle: Double = 1.1
  /// `hold` (debug / screenshots): freeze the beam at this angle
  public var hold: Double?
  /// how lit the light is (0 by day … 1 at night / in fog); nil until the first update (the web's undefined)
  public private(set) var on: Double?
  /// foghorn timer: the first horn soon after the fog rolls in
  public private(set) var fogT: Double = 22
  public private(set) var windsock: Windsock
  /// prop material light-spill slots (materials.js setGlow → uGlowPos (object space, radius) / uGlowCol)
  public private(set) var glows: [WorldGlow]

  public var terrain: [PlacedTerrain] { [PlacedTerrain(mesh: land.land.mesh, offset: V3(x, 0, z))] }

  /// new Lighthouse(W, def): def {x, z, name}; the island is built at the current quality.
  init(world W: World, x: Double, z: Double, name: String?) {
    self.W = W
    let T = W.tables
    L = T.lighthouse
    self.x = x
    self.z = z
    self.name = name.flatMap { $0.isEmpty ? nil : $0 } ?? "Скалистый"
    // the island itself — built first: the structures sample its height
    land = IslandLand(tables: T, quality: W.settingsQuality.flatMap { $0.isEmpty ? nil : $0 } ?? "high")
    windsock = Windsock(seed: 3, tables: T.windsock)
    hoop = V3(x + 10.4, L.deckY + 4.6, z + 7.6)
    glows = Array(repeating: WorldGlow(), count: T.glows)
    padPosition = V3(x, L.deckY, z)
    lantern = V3(x + L.tower.x, L.lanternY, z + L.tower.y)
    obstacles = [
      WorldObstacle(x: x + L.tower.x, z: z + L.tower.y, radius: 5, top: L.lanternY + 3, kind: "tower", name: "маяк"),
      WorldObstacle(x: x + 22, z: z - 31, radius: 1.8, top: 27, kind: "mast", name: "мачта"),
    ]
    island = WorldObstacle(x: x - 6, z: z - 17, radius: 26, top: 10.5, kind: "rock", name: "скалы")
    seat()
    lamps()
    // surf rings = circles inscribed in the real coastline; the rock's collision columns
    shoals = land.shoals.map { ShoalCircle(x: x + $0.x, z: z + $0.z, radius: $0.radius) }
    for o in land.obstacles { obstacles.append(WorldObstacle(x: x + o.x, z: z + o.z, radius: o.radius, top: o.top, kind: "rock", name: "скалы")) }
    // lantern light spill on the gallery & tower top, house windows on the rock
    setGlow(0, L.tower.x, L.lanternY, L.tower.y, 5, T.lighthouse.glowLamp, 0)
    setGlow(1, 0, L.deckY + 4, 0, 14, T.lighthouse.glowFlood, 0)
  }

  /// setGlow(mat, i, x, y, z, radius, color, intensity)
  func setGlow(_ i: Int, _ gx: Double, _ gy: Double, _ gz: Double, _ radius: Double, _ color: Color3, _ intensity: Double) {
    if i >= glows.count { return }
    var c = color
    c.multiplyScalar(intensity)
    glows[i] = WorldGlow(position: V4(gx, gy, gz, JS.max(0.1, radius)), color: c)
  }

  // ---- seating the structures (the parts of _parts() that position lights and piles) -------------------
  func seat() {
    let S = land.sampler
    let tx = L.tower.x, tz = L.tower.y
    // tower porch lamp: entrance facing the walkway
    let y0 = 10.5
    let dth = 1.33, dc = JS.cos(dth), ds = JS.sin(dth)
    doorLamp = V3(x + tx + dc * 5.4, y0 + 2.62, z + tz + ds * 5.4)
    // walkway pad → tower: kerb heights from the rock, three bollard lights on the east kerb
    walkway(S, a: V2(-3.2, -11.2), b: V2(-7.9, -22.6))
    // keeper's house porch light (_house(gh, minG, 13, −27): floor 10, depth 6.2)
    let hx = 13.0, hz = -27.0, D = 6.2, floor = 10.0
    let dz = hz + D / 2
    porchLamp = V3(x + hx, floor + 2.3, z + dz + 0.3)
    // jetty: concrete deck on two rows of piles (only where it leaves the rock), harbour light at the head
    jetty(S, ja: V2(23, 9), jb: V2(33, 25))
  }

  func walkway(_ S: TerrainSampler, a: V2, b: V2) {
    let dx = b.x - a.x, dz = b.y - a.y
    let len = JS.hypot(dx, dz)
    let ux = dx / len, uz = dz / len, nx = -uz, nz = ux
    let hw = 1.1, kw = 0.2, kh = 0.16
    let N = Int(JS.ceil(len / 0.5))
    var H = [Double]()
    for i in 0...N {
      let t = (Double(i) / Double(N)) * len
      let cx = a.x + ux * t, cz = a.y + uz * t
      var h = -1e9
      for u in [-hw - kw, -hw * 0.5, 0, hw * 0.5, hw + kw] { h = JS.max(h, S.heightAt(cx + nx * u, cz + nz * u)) }
      H.append(h + 0.1)
    }
    let Hs = H.enumerated().map { i, h in JS.max(h, (H[Swift.max(0, i - 1)] + 2 * h + H[Swift.min(N, i + 1)]) / 4) }
    walkLamps = []
    for f in [0.22, 0.55, 0.83] {
      let t = f * len, i = Int(JS.round(f * Double(N)))
      let u = hw + kw * 0.5
      let wx = a.x + ux * t + nx * u, wz = a.y + uz * t + nz * u, y = Hs[i] + kh
      walkLamps.append(V3(x + wx, y + 0.66, z + wz))
    }
  }

  func jetty(_ S: TerrainSampler, ja: V2, jb: V2) {
    let dx = jb.x - ja.x, dz = jb.y - ja.y
    let len = JS.hypot(dx, dz)
    let ux = dx / len, uz = dz / len, nx = -uz, nz = ux
    func at(_ s: Double, _ u: Double) -> V2 { V2(ja.x + ux * s + nx * u, ja.y + uz * s + nz * u) }
    piles = []
    var s = 3.0
    while s <= len {
      defer { s += 4 }
      let ss = JS.min(s, len - 0.4)
      let c = at(ss, 0)
      if S.heightAt(c.x, c.y) > 1.2 { continue } // still on the rock
      for u in [-1.2, 1.2] {
        let p = at(ss, u)
        piles.append(V2(x + p.x, z + p.y))
      }
    }
    jettyHead = at(len - 0.4, 1.0)
  }

  // ---- lamps -----------------------------------------------------------------------------------------
  func lamps() {
    let Lm = W.lamps, CH = W.tables.ch
    let perimR = L.perimR, deckY = L.deckY
    // perimeter (green) — 2 per octagon side, on their housings inside the deck edge
    for i in 0..<16 {
      let a = (Double(i) / 16) * JS.PI * 2 + JS.PI / 16
      Lm.add(x + JS.cos(a) * perimR, deckY + 0.14, z + JS.sin(a) * perimR, "#3CFF7A", gain: 3, bulb: 0.14, halo: 0.7, ch: Double(CH.PERIM))
    }
    // pad floods
    Lm.add(x - 9.5, deckY + 1.0, z + 9.29, "#FFE6B0", gain: 3, bulb: 0.2, halo: 1.6, ch: Double(CH.PADLIGHT))
    Lm.add(x + 9.5, deckY + 1.0, z - 9.29, "#FFE6B0", gain: 3, bulb: 0.2, halo: 1.6, ch: Double(CH.PADLIGHT))
    // lantern: a modest soft core — the beam and its flash carry the lighthouse, not a bloom disc
    lanternLamp = Lm.add(x + L.tower.x, L.lanternY, z + L.tower.y, "#FFF4DC", gain: 2.2, bulb: 1.0, halo: 3.6, ch: Double(CH.LANTERN), pen: 0.75)
    // tower porch light, radio mast obstruction light, house porch light, walkway bollards, jetty head
    Lm.add(doorLamp.x, doorLamp.y, doorLamp.z, "#FFE2B0", gain: 2.5, bulb: 0.16, halo: 1.3, ch: Double(CH.PADLIGHT))
    Lm.add(x + 22, 26.8, z - 31, "#FF2015", gain: 5, bulb: 0.2, halo: 2.2, ch: Double(CH.ANTI), pen: 0.4)
    Lm.add(porchLamp.x, porchLamp.y, porchLamp.z, "#FFC98A", gain: 2.5, bulb: 0.14, halo: 1.4, ch: Double(CH.WINDOWS))
    for w in walkLamps { Lm.add(w.x, w.y, w.z, "#FFD9A0", gain: 2, bulb: 0.1, halo: 1.0, ch: Double(CH.PADLIGHT)) }
    Lm.add(x + jettyHead.x, 5.6, z + jettyHead.y, "#12FF6E", gain: 4, bulb: 0.16, halo: 1.6, ch: Double(CH.NAV), pen: 0.3)
    // offload lights (blue) at the deck's four diagonal corners — channel set by the world
    unloadLamps = []
    for i in 0..<4 {
      let a = JS.PI / 4 + (Double(i) * JS.PI) / 2
      unloadLamps.append(Lm.add(x + JS.cos(a) * (L.padR + 0.6), deckY + 0.25, z + JS.sin(a) * (L.padR + 0.6), "#4FA3FF", gain: 4, bulb: 0.2,
                                halo: 1.4, ch: Double(CH.UNLOAD0)))
    }
  }

  /// setUnloadChannel(ch): the blue cascade while the heli unloads here.
  public func setUnloadChannel(_ ch: Int) {
    for i in unloadLamps where i >= 0 { W.lamps.setChannel(i, Double(ch)) }
  }

  public func setQuality(_ q: String) { land.setQuality(q, W.tables) }

  // ---- update ----------------------------------------------------------------------------------------
  public func update(_ dt: Double, _ env: WorldEnv) {
    let CH = W.tables.ch
    let GL = W.tables.lighthouse
    if let h = hold, h.isFinite {
      angle = h
    } else {
      angle = JSNumber.mod(angle + (dt * JS.PI * 2) / L.period, JS.PI * 2)
    }

    // the light works at night and in poor visibility (fog, heavy rain)
    let lit = MathUtil.clamp(JS.max(JS.max(env.night * 1.15, env.fogK * 1.2), JS.max(MathUtil.smoothstep(4000, 1200, env.visibility), 0.35 * env.rain)), 0, 1)
    on = lit
    W.beam.uIntensity = lit * (0.42 + 0.6 * env.fogK)
    W.beam.uDensity = 0.03 + 0.07 * env.rain + 0.16 * env.fogK // fog scatters more, stays translucent
    W.beam.uPen = 0.45 + 0.4 * env.fogK
    W.beam.uFall = 1.7

    // beam directions (world): +X rotated by angle about Y → (cos a, 0, −sin a); twin = opposite
    let bx = JS.cos(angle), bz = -JS.sin(angle)
    // the lantern flashes when a beam swings across the viewer (camera position, horizontal)
    let cam = env.camPos
    let vx = cam.x - lantern.x, vz = cam.z - lantern.z
    let vl = JSNumber.or(JS.hypot(vx, vz), 1)
    let facing = JS.abs((bx * vx + bz * vz) / vl)
    let flash = JS.pow(facing, 40) * (env.reduceFlashes ? 0.35 : 1)
    // daylight: off behind its lens (a faint glint); lit: a modest steady core that flares only while a beam
    // swings across the viewer (one dominant light per frame, §2.1)
    W.setChannel(CH.LANTERN, JS.max(W.channel(CH.LANTERN), 0.03 + lit * (0.4 + 1.5 * flash)))
    setGlow(0, L.tower.x, L.lanternY, L.tower.y, 5, GL.glowLamp, lit * (0.45 + 0.9 * flash))
    setGlow(1, 0, L.deckY + 3, 0, 13, GL.glowFlood, 0.22 * W.channel(CH.PADLIGHT))
    // base floods at the tower foot: the light dies out ~10 m up, the lantern stays the one bright point
    setGlow(2, L.tower.x, 10.5, L.tower.y + 5.5, 6.5, GL.glowLamp, 0.6 * W.channel(CH.PADLIGHT))
    // the same floods / windows spill onto the rock round them (terrain material, world space)
    let pl = W.channel(CH.PADLIGHT)
    W.setTerrainGlow(0, x, L.deckY, z, 21, GL.glowFlood, 0.9 * pl)
    W.setTerrainGlow(1, x + L.tower.x, 12, z + L.tower.y + 3, 12, GL.glowLamp, 0.8 * pl)
    W.setTerrainGlow(2, x + 13, 10, z - 22.5, 7, GL.glowWindow, 0.45 * W.channel(CH.WINDOWS))
    W.setTerrainGlow(3, x + jettyHead.x, 3, z + jettyHead.y, 7, GL.glowNav, 0.3 * W.channel(CH.NAV))

    // SpotLight: sweep the sea with whichever beam faces the heli; the swap happens at zero
    if W.spotOwner == nil {
      W.spotOwner = ObjectIdentifier(self)
      let hp = env.heliPos
      let hx = hp.x - lantern.x, hz = hp.z - lantern.z
      let hl = JSNumber.or(JS.hypot(hx, hz), 1)
      let c = (bx * hx + bz * hz) / hl
      let sgn = c >= 0 ? 1.0 : -1.0
      let reach = 260.0
      W.lights.spotPosition = lantern
      W.lights.spotTarget = V3(lantern.x + sgn * bx * reach, 0, lantern.z + sgn * bz * reach)
      W.lights.spotIntensity = lit * MathUtil.smoothstep(0.05, 0.4, JS.abs(c)) * (32000 + 26000 * env.fogK) * (0.6 + 0.4 * env.night)
    }

    // jetty piles break the swell: small foam collars round each pile at the live waterline
    if let ocean = W.ocean {
      for (i, p) in piles.enumerated() {
        W.collars.push(p.x, ocean.heightAt(p.x, p.y), p.y, 0, 1, 0, 0.42, 0.75, 0.25, 0, Double(i) * 0.37)
      }
    }

    // windsock on the pad
    let w = W.windAt(hoop.x, hoop.z)
    windsock.update(W.rigging, hoop: hoop, w.x, w.y, t: env.t, dt: dt)

    // foghorn every 30 s in fog (audio plays it; radio line c_light announces it)
    if env.fogK > 0.45 && dt > 0 {
      fogT += dt
      if fogT >= 30 {
        fogT = 0
        W.events.emit(GameEvent.WorldFoghorn(x: lantern.x, z: lantern.z))
      }
    } else {
      fogT = JS.min(fogT, 26)
    }
  }

  public func dispose() {
    for i in 0..<4 { W.setTerrainGlow(i, 0, -1e4, 0, 1, Color3(0, 0, 0), 0) }
  }
}

/// A light-spill slot: position (xyz) + radius (w), colour × intensity (linear).
public struct WorldGlow: Equatable, Sendable {
  public var position = V4(0, -1e4, 0, 1)
  public var color = Color3(0, 0, 0)

  public init() {}

  public init(position: V4, color: Color3) {
    self.position = position
    self.color = color
  }
}
