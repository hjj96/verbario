// heli/flight.js FlightModel (DESIGN §3.3, §3.4, §3.8, §3.9), stepped at a fixed 60 Hz by Helicopter.
//
//   W   = weather.windAt(x, z) · profile(alt) · c                 c = 0.6, profile = clamp(.6 + .008·alt, .6, 1.4)
//   u   = input.move();  winch out → u·0.45
//   A   = 14.4 · (boost ? 1.4 : 1) · thrustFactor · (1 − 0.02·passengers)
//   acc = A·u + K·(W − v) + hazards.forceAt(x, z, alt) + assist   K = 0.4 s⁻¹
//
// Vertical: altTarget over MEAN sea level (4–120 m); vyCmd = clamp((altTarget − y)·1.2, −6, +7) + updraft,
// vy chases it at 6 m/s². Skids 1.6 m below the centre. Water strikes, obstacles, pad decks (moving,
// tilting), hard landings, autorotation and the crash descent live here too.
//
// Parity: every expression keeps the JS shape and order (Tests/Vectors/heli/flight_*.json, 600 steps
// bit-exact). Pads are IDs + views (SimContext): `contactPad !== pad` compares PadIDs and a held pad is
// re-read from world.pad(id) each step (the web holds the live object).

/// Why the hull was hit: the web's free-form source string with its two regex rules as properties
/// (PLAN §2.9 `DamageSource`). Sources in the game: landing, deck, water, obstacle (heli), rogue,
/// lightning, debris, tornado, waterspout, hail (hazards).
public struct DamageSource: RawRepresentable, Hashable, Sendable, ExpressibleByStringLiteral {
  public var rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public init(_ s: String) { rawValue = s }
  public init(stringLiteral s: String) { rawValue = s }

  public static let landing: DamageSource = "landing"
  public static let deck: DamageSource = "deck"
  public static let water: DamageSource = "water"
  public static let obstacle: DamageSource = "obstacle"
  public static let unknown: DamageSource = "unknown"

  /// /rogue|wave/: the intake floods (thrust ×0.6 for 3 s)
  public var floodsIntake: Bool { rawValue.contains("rogue") || rawValue.contains("wave") }
  /// /lightning|strike/: EMP (assist off) for 4 s
  public var isElectrical: Bool { rawValue.contains("lightning") || rawValue.contains("strike") }
}

/// heli.crash = { phase, t, reason, deck }
public struct HeliCrashState: Equatable, Sendable {
  public enum Phase: String, Sendable { case autorot, ditched }
  public var phase: Phase
  public var t: Double
  /// 'hull' | 'fuel' | …
  public var reason: String
  /// The pad the failing heli came down on (it stays there, wrecked); nil = the sea.
  public var deck: PadID?

  public init(phase: Phase, t: Double = 0, reason: String, deck: PadID? = nil) {
    self.phase = phase
    self.t = t
    self.reason = reason
    self.deck = deck
  }
}

/// heli.winch.state
public enum WinchState: String, Sendable {
  case stowed, lowering, down, raising
}

/// What FlightModel reads and calls on its helicopter (Helicopter conforms; the flight vectors use a
/// recording stub, exactly like export-vectors.mjs does).
public protocol FlightHost: AnyObject {
  /// smoothed stick (x east, y north)
  var uMove: V2 { get }
  var uMag: Double { get set }
  var winchState: WinchState { get }
  var autorotation: Bool { get }
  var crash: HeliCrashState? { get }
  var hull: Double { get }
  var emp: Double { get }
  var thrustFactor: Double { get }
  var boosting: Bool { get }
  /// cabin.length
  var passengers: Int { get }
  var rotorRPM: Double { get }
  var altTarget: Double { get set }
  /// heli.landed (the pad it sits on)
  var landed: PadID? { get set }
  var alive: Bool { get }

  func damage(_ amount: Double, _ source: DamageSource)
  func onWaterStrike(_ x: Double, _ z: Double, _ strength: Double)
  func onTouch(_ pad: LandingPad, _ relVy: Double)
  /// h.ops.land(pad)
  func land(_ pad: LandingPad)
  /// h.ops.ditch(reason, deck)
  func ditch(_ reason: String, _ deck: LandingPad?)
  /// h.ops.takeoff()
  func takeoff()
}

public final class FlightModel {
  public static let STEP: Double = 1.0 / 60
  static let K: Double = 0.4
  static let C_WIND: Double = 0.6
  static let A_BASE: Double = 14.4
  /// -SKID_Y (1.6)
  static let SKID: Double = -HeliModel.SKID_Y
  /// fuselage + part of the rotor
  static let OBSTACLE_MARGIN: Double = 6.5
  static let D12: Double = MathUtils.degToRad(12)
  static let D5: Double = MathUtils.degToRad(5)

  /// profile(alt) = clamp(0.6 + 0.008·alt, 0.6, 1.4): wind grows with height
  @inline(__always) public static func profile(_ alt: Double) -> Double { MathUtil.clamp(0.6 + 0.008 * alt, 0.6, 1.4) }

  public unowned let h: FlightHost
  public let ctx: SimContext

  public var p = V3()
  public var v = V3()
  public var prevP = V3()
  public var heading: Double = 0
  public var prevHeading: Double = 0
  public var yawRate: Double = 0
  /// nil = hold the nose
  public var noseTarget: Double?
  /// rotor horizontal acceleration (drives the visual tilt)
  public var thrust = V2()
  public var windEff = V2()
  public var windSmooth = V2()
  public var force = V3()
  public var sea: Double = 0
  public var surface: Double = 0
  public var time: Double = 0
  public var waterCooldown: Double = 0
  public var obstacleCooldown: Double = 0
  public var deckCooldown: Double = 0
  public var contactPad: PadID?
  public var landTimer: Double = 0
  public var landOffset = V2()
  public var landHeading: Double = 0
  public var landPadHeading: Double = 0
  public var turb: Double = 0
  public var lastVy: Double = 0
  let noise = SimplexNoise2D(seed: 9173)

  public init(host: FlightHost, ctx: SimContext) {
    self.h = host
    self.ctx = ctx
  }

  public func reset(_ x: Double, _ y: Double, _ z: Double, _ heading: Double) {
    p.set(x, y, z)
    prevP = p
    v.set(0, 0, 0)
    self.heading = heading
    prevHeading = heading
    yawRate = 0
    thrust.set(0, 0)
    windSmooth.set(0, 0)
    contactPad = nil
    landTimer = 0
    waterCooldown = 0
    obstacleCooldown = 0
    deckCooldown = 0
  }

  /// padVel(pad): (v.x || 0, v.y || 0, v.z || 0), zero for a static pad
  @inline(__always) static func padVel(_ pad: LandingPad?) -> V3 {
    guard let v = pad?.velocity else { return V3() }
    return V3(JSNumber.or(v.x, 0), JSNumber.or(v.y, 0), JSNumber.or(v.z, 0))
  }

  /// Remember where on the deck we sit (pad frame), so moving / turning decks carry the heli.
  public func attachTo(_ pad: LandingPad) {
    let ph = JSNumber.or(pad.heading, 0)
    let dx = p.x - pad.position.x
    let dz = p.z - pad.position.z
    let c = JS.cos(ph)
    let s = JS.sin(ph)
    // heading convention: clockwise from north; rotate world offset into the pad frame
    landOffset.set(dx * c + dz * s, -dx * s + dz * c)
    landPadHeading = ph
    landHeading = heading
  }

  public func step(_ dt: Double) {
    time += dt
    prevP = p
    prevHeading = heading
    if waterCooldown > 0 { waterCooldown -= dt }
    if obstacleCooldown > 0 { obstacleCooldown -= dt }
    if deckCooldown > 0 { deckCooldown -= dt }

    sea = ctx.ocean?.heightAt(p.x, p.z) ?? 0

    if h.crash?.phase == .ditched { return floatDitched(dt) }
    if h.landed != nil { return stepLanded(dt) }

    // --- environment ---------------------------------------------------------------------------
    let st = ctx.weatherState
    let altSea = JS.max(0, p.y - sea)
    let prof = FlightModel.profile(altSea)
    let W = ctx.weather?.windAt(p.x, p.z) ?? V2()
    let T = JSNumber.or(st.turbulence, 0)
    let t = time
    let n1 = noise.noise(t * 0.9, 3.7)
    let n2 = noise.noise(t * 0.9, 41.3)
    turb = JS.abs(n1) * T
    windEff.set((W.x + T * n1) * prof * FlightModel.C_WIND, (W.y + T * n2) * prof * FlightModel.C_WIND)
    let ks = 1 - JS.exp(-dt / 2) // assist sees the wind smoothed over τ 2 s
    windSmooth.x += (windEff.x - windSmooth.x) * ks
    windSmooth.y += (windEff.y - windSmooth.y) * ks
    var F = V3()
    if let hz = ctx.hazards { F = hz.forceAt(p.x, p.z, altSea) }
    if !(F.x + F.y + F.z).isFinite { F.set(0, 0, 0) }
    force = F

    // --- controls -------------------------------------------------------------------------------
    var ux = h.uMove.x
    var uy = h.uMove.y
    if h.winchState != .stowed {
      ux *= 0.45
      uy *= 0.45
    }
    let crashing = h.crash != nil
    if h.autorotation || crashing {
      ux *= 0.5
      uy *= 0.5
    }
    if h.hull < 0.25 {
      let j = 1 + 0.05 * noise.noise(t * 6.0, 77.7)
      ux *= j
      uy *= j
    }
    let uMag = JS.min(1, JS.hypot(ux, uy))
    h.uMag = uMag
    let rpmAuth = MathUtils.smoothstep(h.rotorRPM, 0.55, 0.88)
    let passengers = Double(h.passengers)
    let A = FlightModel.A_BASE * (h.boosting ? 1.4 : 1) * h.thrustFactor * (1 - 0.02 * passengers) * rpmAuth

    // --- stabilisation assist (only with the stick centred; off during EMP) ----------------------
    var assist = crashing ? "off" : FlightModel.assistSetting(ctx.settings)
    if h.emp > 0 { assist = "off" }
    let centred = 1 - MathUtils.smoothstep(uMag, 0.05, 0.35)
    var asx = 0.0
    var asz = 0.0
    if assist == "full" {
      asx = -FlightModel.K * windSmooth.x - 0.8 * v.x
      asz = -FlightModel.K * windSmooth.y - 0.8 * v.z
      let lim = 0.6 * FlightModel.A_BASE * rpmAuth
      let l = JS.hypot(asx, asz)
      if l > lim {
        asx *= lim / l
        asz *= lim / l
      }
    } else if assist == "standard" {
      asx = -0.7 * FlightModel.K * windSmooth.x
      asz = -0.7 * FlightModel.K * windSmooth.y
    }
    asx *= centred * rpmAuth
    asz *= centred * rpmAuth

    // --- horizontal integration --------------------------------------------------------------------
    let K = FlightModel.K
    let tx = A * ux + asx
    let tz = -A * uy + asz
    thrust.set(tx, tz)
    v.x += (tx + K * (windEff.x - v.x) + F.x) * dt
    v.z += (tz + K * (windEff.y - v.z) + F.z) * dt
    p.x += v.x * dt
    p.z += v.z * dt

    // --- nose (spring ω 7, ≤ 2 rad/s) ---------------------------------------------------------------
    if crashing {
      yawRate += (0.9 - yawRate) * (1 - JS.exp(-dt * 1.5)) // tail rotor gone: slow spin
    } else if let nose = noseTarget {
      let err = MathUtil.wrapAngle(nose - heading)
      yawRate += (49 * err - 14 * yawRate) * dt
    } else {
      yawRate *= JS.exp(-dt * 8)
    }
    yawRate = MathUtil.clamp(yawRate, -2, 2)
    heading = MathUtil.wrapAngle(heading + yawRate * dt)

    // --- vertical -------------------------------------------------------------------------------------
    let SKID = FlightModel.SKID
    var vyCmd: Double
    let pad = ctx.world?.padAt(p.x, p.z)
    let deckY = pad?.position.y ?? -.infinity
    if let crash = h.crash {
      let left = JS.max(0.4, 3 - crash.t)
      vyCmd = -JS.max(6, (p.y - SKID - sea) / left)
    } else if h.autorotation {
      vyCmd = -6
      // flare over a deck: the one chance to land without fuel
      if pad != nil && p.y - SKID - deckY < 9 { vyCmd = -1.8 }
    } else {
      vyCmd = MathUtil.clamp((h.altTarget - p.y) * 1.2, -6, 7) + JSNumber.or(F.y, 0) + T * 0.35 * noise.noise(t * 0.6, 12.1)
      if assist == "full" && h.winchState != .stowed {
        let floor = sea + 3 + SKID // soft floor: crest + 3 m
        vyCmd = JS.max(vyCmd, (floor - p.y) * 1.2)
      }
      // Deck flare (assist on): the sink rate eases off over a pad so a held «down» ends in a soft
      // touchdown (~1.2 m/s) instead of a hard landing. With assist off the pilot does it by hand.
      if pad != nil && assist != "off" {
        let above = JS.max(0, p.y - SKID - deckY)
        if above < 14 { vyCmd = JS.max(vyCmd, -(0.8 + 0.45 * above)) }
      }
    }
    vyCmd *= crashing || h.autorotation ? 1 : 0.15 + 0.85 * rpmAuth
    let dv = vyCmd - v.y
    let maxDv = (crashing ? 12 : 6) * dt
    v.y += MathUtil.clamp(dv, -maxDv, maxDv)
    p.y += v.y * dt
    if p.y > 122 {
      p.y = 122
      if v.y > 0 { v.y = 0 }
    }

    surfaces(dt, pad, deckY)
  }

  /// ctx.settings.get('assist') || 'standard' (a non-string truthy value never equals 'full'/'standard'/'off').
  static func assistSetting(_ s: SettingsQuery) -> String {
    let a = s.get("assist")
    if !a.jsTruthy { return "standard" }
    return a.string ?? a.jsToString
  }

  // Decks, water strikes, obstacles.
  private func surfaces(_ dt: Double, _ pad: LandingPad?, _ deckY: Double) {
    let SKID = FlightModel.SKID
    let skid = p.y - SKID
    let prevSkid = prevP.y - SKID
    surface = JS.max(sea, deckY)

    // --- pad decks (moving / tilting) ----------------------------------------------------------------
    if let pad = pad, skid < deckY {
      let pv = FlightModel.padVel(pad)
      if let crash = h.crash, prevSkid >= deckY - 0.7 {
        // the failing heli comes down on a deck instead of the water
        p.y = deckY + SKID
        h.ditch(crash.reason, pad)
        return
      }
      if prevSkid >= deckY - 0.7 {
        let relVy = v.y - pv.y
        if contactPad != pad.id {
          let tilt = JS.abs(JSNumber.or(pad.tilt, 0))
          if relVy < -5 {
            h.damage(0.15, .landing)
            v.y = pv.y + 3
          } else if relVy < -2.5 {
            h.damage(0.05, .landing)
          }
          if tilt > FlightModel.D5 && deckCooldown <= 0 && pad.type == "ship" {
            h.damage(0.08, .deck)
            v.y = pv.y + 2.5
            deckCooldown = 1.5
          }
          h.onTouch(pad, relVy)
        }
        contactPad = pad.id
        p.y = deckY + SKID
        if v.y < pv.y { v.y = pv.y }
        // skid friction on the deck
        let f = JS.min(1, 6 * dt)
        v.x += (pv.x - v.x) * f
        v.z += (pv.z - v.z) * f
      } else {
        // flew into the side of the deck structure from below
        _ = bump(pad.position.x, pad.position.z, JSNumber.or(pad.radius, 12), .obstacle)
      }
    } else if pad == nil || skid > deckY + 0.25 {
      contactPad = nil
    }

    // Landing criteria: inside the circle, vy < 2.5, rel. horizontal < 3, deck tilt < 12°, held 1 s.
    if let cpID = contactPad, h.crash == nil, let cp = ctx.world?.pad(cpID) {
      let pv = FlightModel.padVel(cp)
      let relH = JS.hypot(v.x - pv.x, v.z - pv.z)
      let ok = relH < 3 && JS.abs(v.y - pv.y) < 2.5 && JS.abs(JSNumber.or(cp.tilt, 0)) < FlightModel.D12 && h.altTarget <= p.y + 0.6
      landTimer = ok ? landTimer + dt : 0
      if landTimer >= 1.0 {
        landTimer = 0
        h.land(cp)
        return
      }
    } else {
      landTimer = 0
    }

    // --- water ------------------------------------------------------------------------------------------
    if skid < sea && contactPad == nil {
      if h.crash != nil || h.autorotation {
        h.ditch(h.crash?.reason ?? "fuel", nil)
        return
      }
      if waterCooldown <= 0 {
        waterCooldown = 1
        h.damage(0.06 + 0.02 * JS.abs(v.y), .water)
        v.y = 4
        h.onWaterStrike(p.x, p.z, JS.abs(v.y))
      }
      p.y = JS.max(p.y, sea + SKID - 0.3)
    }

    // --- obstacles (rig derrick, lighthouse, masts, fog rocks) ----------------------------------------
    if let obs = ctx.world?.obstacles, !obs.isEmpty {
      for o in obs {
        if skid >= (o.top ?? .infinity) { continue }
        if bump(o.x, o.z, JSNumber.or(o.radius, 2) + FlightModel.OBSTACLE_MARGIN, .obstacle) { break }
      }
    }
  }

  /// Push out of a cylinder (x, z, R) with a bounce; damage 15 % with a 1 s cooldown.
  @discardableResult
  func bump(_ x: Double, _ z: Double, _ R: Double, _ source: DamageSource, _ cylinderIsOuter: Bool = true) -> Bool {
    let dx = p.x - x
    let dz = p.z - z
    let d = JS.hypot(dx, dz)
    if !cylinderIsOuter || d >= R { return false }
    let nx = d > 1e-3 ? dx / d : 1
    let nz = d > 1e-3 ? dz / d : 0
    p.x = x + nx * R
    p.z = z + nz * R
    let vn = v.x * nx + v.z * nz
    if vn < 0 {
      v.x -= nx * vn * 1.7
      v.z -= nz * vn * 1.7
    }
    v.x += nx * 2
    v.z += nz * 2
    if obstacleCooldown <= 0 {
      obstacleCooldown = 1
      h.damage(0.15, source)
    }
    return true
  }

  // Sitting on a pad: carried by the moving / turning deck; services handled by HeliOps.
  private func stepLanded(_ dt: Double) {
    guard let id = h.landed, let pad = ctx.world?.pad(id) else {
      h.landed = nil
      return
    }
    let ph = JSNumber.or(pad.heading, 0)
    let c = JS.cos(ph)
    let s = JS.sin(ph)
    let ox = landOffset.x
    let oz = landOffset.y
    p.x = pad.position.x + ox * c - oz * s
    p.z = pad.position.z + ox * s + oz * c
    // The commanded altitude rides with the heaving deck, so only an explicit climb (lift, preset,
    // autoTakeoff) puts it above the skids — never the deck dropping away under a stale crest value.
    let y0 = p.y
    p.y = pad.position.y + FlightModel.SKID
    h.altTarget += p.y - y0
    heading = MathUtil.wrapAngle(landHeading + (ph - landPadHeading))
    v = FlightModel.padVel(pad)
    yawRate = 0
    thrust.set(0, 0)
    surface = pad.position.y
    // Lift-off: commanded altitude above the deck and the rotor at flight RPM.
    if ctx.mode == .play && h.alive && h.altTarget > p.y + 0.8 && h.rotorRPM > 0.8 && !h.autorotation {
      h.takeoff()
      v.y = 1.5
      contactPad = pad.id
    }
  }

  // Ditched: bob on the swell, drift slowly (or sit wrecked on the deck it came down on).
  private func floatDitched(_ dt: Double) {
    if let deckID = h.crash?.deck, let deck = ctx.world?.pad(deckID) {
      let ph = JSNumber.or(deck.heading, 0)
      let c = JS.cos(ph)
      let s = JS.sin(ph)
      p.x = deck.position.x + landOffset.x * c - landOffset.y * s
      p.z = deck.position.z + landOffset.x * s + landOffset.y * c
      p.y = deck.position.y + FlightModel.SKID
      v.set(0, 0, 0)
      thrust.set(0, 0)
      surface = deck.position.y
      return
    }
    let target = sea + 0.55
    p.y += (target - p.y) * JS.min(1, dt * 3)
    v.x *= JS.exp(-dt * 0.9)
    v.z *= JS.exp(-dt * 0.9)
    v.y = 0
    p.x += v.x * dt
    p.z += v.z * dt
    yawRate *= JS.exp(-dt * 0.6)
    heading = MathUtil.wrapAngle(heading + yawRate * dt)
    thrust.set(0, 0)
    surface = sea
  }
}
