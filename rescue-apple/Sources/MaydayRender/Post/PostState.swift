// PostState — port of rescue/src/systems/post.js PostFX.update() and its pulse API (PLAN §2.9 post.js row:
// PostState → FinalUniformsCPU; DESIGN §2.8, §8.2): every FinalPass input, the OutputPass exposure and the
// UnrealBloomPass parameters, driven by MaydayCore data (the weather palette, palette.post) and the frame's
// game state. Double with JS math and the web's operation order; FinalUniformsCPU keeps the uniform values
// three uploads (bit-exact against the real PostFX: Tests/Goldens/post/state.json), FinalInput is their
// Float32 copy for the GPU. Uniforms persist between frames like three's (a field the JS only writes under
// a condition keeps its last value).
// Not here (other modules, inputs to update):
//   * lens drops (post/drops.js): the LensDropsModel hook; NoLensDrops is the placeholder until the drop
//     simulation is ported — it never consumes the shared rng (mulberry32(911)), like an empty lens;
//   * thermal view (post/thermal.js) and photo mode (post/photo.js): their state arrives as inputs;
//   * dynamic resolution (DynRes.swift) and the input toggles (photo / thermal keys).
// TODO(Core): PLAN places this in MaydayCore/Post/PostState.swift; it only needs MaydayCore and moves verbatim.
import Foundation
import MaydayCore

/// post/drops.js LensDrops as PostFX drives it (spray from pulses, update every frame).
public protocol LensDropsModel: AnyObject {
  /// Beads on the lens (uDrops = count > 0).
  var count: Int { get }
  func clear()
  /// `rand` is PostFX's mulberry32(911), shared with the spray cooldown.
  func spray(_ strength: Double, rand: () -> Double)
  func update(dt: Double, rate: Double, speed: Double, flowX: Double, flowY: Double, rivulets: Bool,
              cap: Double, dryK: Double, rand: () -> Double)
}

/// Placeholder until post/drops.js is ported: no beads, no rng use.
public final class NoLensDrops: LensDropsModel {
  public init() {}
  public var count: Int { 0 }
  public func clear() {}
  public func spray(_ strength: Double, rand: () -> Double) {}
  public func update(dt: Double, rate: Double, speed: Double, flowX: Double, flowY: Double, rivulets: Bool,
                     cap: Double, dryK: Double, rand: () -> Double) {}
}

/// The weather.state fields post.js reads (nil = weather stub: st undefined).
public struct PostWeatherInput {
  public var palette: Palette                 // st.palette (with .post, .sea, .exposure)
  public var flash: Double = 0                // st.flash
  public var night: Double = 0                // st.night
  public var greenTint: Double = 0            // st.greenTint
  public var flashColor: PaletteColor?        // st.flashColor (linear)
  public var fog: Double = 0                  // st.fog
  public var rain: Double? = 0                // st.rain (nil → `?? 1`)
  public var windDir: SIMD2<Double>?          // st.windDir (x, z unit)
  public var windSpeed: Double = 0            // st.windSpeed
  public var waveHeight: Double = 0           // st.waveHeight
  public var preset: String = ""              // st.preset
  public init(palette: Palette) { self.palette = palette }
}

/// The ctx.heli fields post.js reads (nil = no heli).
public struct PostHeliInput {
  public var hull: Double = 1
  public var fuel: Double = 1
  public var alive = true
  public var velocity = SIMD2<Double>(0, 0)   // x, z m/s
  public var altitude: Double = 99
  public var landed = false
  public init() {}
}

/// Photo mode as FinalPass sees it (post/photo.js PhotoMode.apply / exposureMul / letterboxMix).
public struct PostPhotoInput {
  public var active = false
  public var exposureMul: Double = 1          // 2^ev while active
  public var letterboxMix: Double = 0
  // apply(u, quality, sizeY) while active:
  public var dof: Double = 0
  public var dofFocus: Double = 0.5
  public var dofBand: Double = 0.08
  public var dofTaps: Double = 24
  public var lookMix: Double = 0
  public var lookSat: Double = 1
  public var lookContrast: Double = 1
  public var lookFade: Double = 0
  public var lookShadow = SIMD3<Double>(1, 1, 1)
  public var lookHigh = SIMD3<Double>(1, 1, 1)
  public var extraGrain: Double = 0
  public init() {}
}

/// post/thermal.js ThermalView outputs.
public struct PostThermalInput {
  public var mix: Double = 0
  public var boot: Double = 0
  public var flick: Double = 1
  public init() {}
}

public struct PostFrameInput {
  public var dt: Double                       // realDt (post runs while paused)
  public var mode: String = "play"            // ctx.mode
  public var weather: PostWeatherInput?
  public var heli: PostHeliInput?
  /// camera.matrixWorld elements e[0], e[2] (right x, z) and e[4], e[6] (up x, z) for _screenVec.
  public var cameraRightXZ = SIMD2<Double>(1, 0)
  public var cameraUpXZ = SIMD2<Double>(0, -1)
  public var letterbox: Double = 0            // ctx.cameraRig.letterbox
  public var thermal = PostThermalInput()
  public var photo = PostPhotoInput()
  /// Drawing-buffer height in px (post.js _size.y = internal resolution): uCA scale.
  public var bufferHeight: Double = 1080
  public init(dt: Double) { self.dt = dt }
}

/// FinalPass uniform values as JS doubles (createFinalMaterial defaults). Colours sRGB.
public struct FinalUniformsCPU: Equatable {
  public var uFlow = SIMD2<Double>(0, -1)
  public var uDrops: Double = 0
  public var uCondense: Double = 0
  public var uSalt: Double = 0
  public var uCA: Double = 0.4
  public var uFlash: Double = 0
  public var uFlashTint = SIMD3<Double>(0.86, 0.9, 1)
  public var uEdge = SIMD4<Double>(0, 0, 0, 0)
  public var uVortex: Double = 0
  public var uBright: Double = 1
  public var uSatMul: Double = 1
  public var uSlope = SIMD3<Double>(1, 1, 1)
  public var uOffset = SIMD3<Double>(0, 0, 0)
  public var uPower: Double = 1
  public var uContrast: Double = 1
  public var uSat: Double = 1
  public var uSplitShadow = SIMD3<Double>(0.5, 0.5, 0.5)
  public var uSplitHighlight = SIMD3<Double>(0.5, 0.5, 0.5)
  public var uSplitStrength: Double = 0
  public var uGreen: Double = 0
  public var uVignette: Double = 0.2
  public var uVignetteColor = SIMD3<Double>(0, 0, 0)
  public var uGrain: Double = 0.03
  public var uNight: Double = 0
  public var uSeed: Double = 0
  public var uLetterbox: Double = 0
  public var uDayToe: Double = 0
  public var uFloor: Double = 0.008
  public var uDof: Double = 0
  public var uDofFocus: Double = 0.5
  public var uDofBand: Double = 0.08
  public var uDofTaps: Double = 24
  public var uLookMix: Double = 0
  public var uLookSat: Double = 1
  public var uLookContrast: Double = 1
  public var uLookFade: Double = 0
  public var uLookShadow = SIMD3<Double>(1, 1, 1)
  public var uLookHigh = SIMD3<Double>(1, 1, 1)
  public var uThermal: Double = 0
  public var uThermBoot: Double = 0
  public var uThermFlick: Double = 1
  public var uThermT: Double = 0
  public init() {}

  /// The Float32 upload (FinalPass FinalInput; uCA stays in internal-resolution px, PostChain rescales).
  public var finalInput: FinalInput {
    func f3(_ v: SIMD3<Double>) -> SIMD3<Float> { SIMD3<Float>(Float(v.x), Float(v.y), Float(v.z)) }
    var g = FinalInput()
    g.flow = SIMD2<Float>(Float(uFlow.x), Float(uFlow.y))
    g.drops = Float(uDrops)
    g.condense = Float(uCondense)
    g.salt = Float(uSalt)
    g.ca = Float(uCA)
    g.flash = Float(uFlash)
    g.flashTint = f3(uFlashTint)
    g.edge = SIMD4<Float>(Float(uEdge.x), Float(uEdge.y), Float(uEdge.z), Float(uEdge.w))
    g.vortex = Float(uVortex)
    g.bright = Float(uBright)
    g.satMul = Float(uSatMul)
    g.slope = f3(uSlope)
    g.offset = f3(uOffset)
    g.power = Float(uPower)
    g.contrast = Float(uContrast)
    g.sat = Float(uSat)
    g.splitShadow = f3(uSplitShadow)
    g.splitHighlight = f3(uSplitHighlight)
    g.splitStrength = Float(uSplitStrength)
    g.green = Float(uGreen)
    g.vignette = Float(uVignette)
    g.vignetteColor = f3(uVignetteColor)
    g.grain = Float(uGrain)
    g.night = Float(uNight)
    g.seed = Float(uSeed)
    g.letterbox = Float(uLetterbox)
    g.dayToe = Float(uDayToe)
    g.blackFloor = Float(uFloor)
    g.dof = Float(uDof)
    g.dofFocus = Float(uDofFocus)
    g.dofBand = Float(uDofBand)
    g.dofTaps = Float(uDofTaps)
    g.lookMix = Float(uLookMix)
    g.lookSat = Float(uLookSat)
    g.lookContrast = Float(uLookContrast)
    g.lookFade = Float(uLookFade)
    g.lookShadow = f3(uLookShadow)
    g.lookHigh = f3(uLookHigh)
    g.thermal = Float(uThermal)
    g.thermBoot = Float(uThermBoot)
    g.thermFlick = Float(uThermFlick)
    g.thermT = Float(uThermT)
    return g
  }
}

/// post.js pulses.
public struct PostPulses: Equatable {
  public var damage: Double = 0, caKick: Double = 0, caHold: Double = 0, vortex: Double = 0, flash: Double = 0
  public var after: Double = 0, pause: Double = 0, salt: Double = 0, sprayCd: Double = 0
}

public final class PostState {
  /// DAMAGE_RED #B3121A, AMBER #FFB547 (THREE.Color: linear), BLACK.
  public static let DAMAGE_RED = SRGB.color(hex: 0xB3121A)
  public static let AMBER = SRGB.color(hex: 0xFFB547)
  public static let BLACK = PaletteColor(0, 0, 0)

  public private(set) var quality: String
  public var reduceFlashes = false
  public private(set) var reduceMotion = false
  public private(set) var pulses = PostPulses()
  public private(set) var uniforms = FinalUniformsCPU()
  public private(set) var exposure: Double = 1                 // renderer.toneMappingExposure
  public private(set) var bloomStrength: Double = 0.3          // ScaledBloomPass(…, 0.3, 0.45, 1.1)
  public private(set) var bloomRadius: Double = 0.45
  public private(set) var bloomThreshold: Double = 1.1
  public private(set) var realT: Double = 0
  public private(set) var seedT: Double = 0
  public private(set) var seed: Double = 0
  public private(set) var rng = Mulberry32(seed: 911)
  public let drops: LensDropsModel

  public init(quality: String, reduceFlashes: Bool = false, reduceMotion: Bool = false, drops: LensDropsModel = NoLensDrops()) {
    self.quality = quality
    self.reduceFlashes = reduceFlashes
    self.reduceMotion = reduceMotion
    self.drops = drops
  }

  // ---- settings ----------------------------------------------------------------------------------------

  /// _applyQuality(q) (the parts that are post state: drops cleared on low).
  public func applyQuality(_ q: String) {
    quality = q
    if q == "low" { drops.clear() }
  }

  /// settings 'reduceMotion' turned on → drops.clear().
  public func setReduceMotion(_ on: Bool) {
    reduceMotion = on
    if on { drops.clear() }
  }

  private var dropsAllowed: Bool { quality != "low" && !reduceMotion }

  private func nextRandom() -> Double { rng.next() }

  // ---- pulses and events ---------------------------------------------------------------------------------

  /// pulse(name, strength): 'damage' | 'hit' | 'lightning' | 'strike' | 'vortex' | 'spray' | 'salt' | 'flash'.
  public func pulse(_ name: String, _ strength: Double = 1) {
    let s = strength.isFinite ? strength : 1
    let reduce = reduceFlashes
    switch name {
    case "damage", "hit":
      pulses.damage = JS.max(pulses.damage, MathUtil.clamp(s, 0, 1))
    case "lightning":
      if !reduce { pulses.caKick = JS.max(pulses.caKick, 2 * s); pulses.caHold = 0.12 }
    case "strike":
      if !reduce { pulses.caKick = JS.max(pulses.caKick, 4 * s); pulses.caHold = 0.12 }
    case "vortex":
      pulses.vortex = JS.max(pulses.vortex, MathUtil.clamp(s, 0, 1))
    case "spray":
      if dropsAllowed { drops.spray(s, rand: { self.nextRandom() }) }
    case "salt":
      pulses.salt = MathUtil.clamp(pulses.salt + 0.25 * s, 0, 1)
    case "flash":
      pulses.flash = JS.max(pulses.flash, MathUtil.clamp(s, 0, reduce ? 0.3 : 1))
    default:
      break
    }
  }

  /// 'heli:damage' {source, amount}.
  public func onHeliDamage(source: String, amount: Double?) {
    let a = amount ?? 0
    let amt = (a == 0 || a.isNaN) ? 0.1 : a                  // Number(e.amount) || 0.1
    pulse("damage", MathUtil.clamp(0.45 + amt * 3, 0.45, 1))
    let s = source
    if s.contains("water") || s.contains("wave") || s.contains("rogue") || s.contains("crest") || s.contains("splash") {
      pulse("spray", 0.8)
    }
  }

  /// 'weather:lightning' {distance, cloudOnly}.
  public func onLightning(distance: Double?, cloudOnly: Bool) {
    let near = distance.map { $0 < 40 } ?? false
    pulse(near && !cloudOnly ? "strike" : "lightning", 1)
  }

  /// 'hazard:hit' {type}.
  public func onHazardHit(type: String) {
    if type == "lightning" { pulse("strike", 1) }
    if type == "rogue" { pulse("spray", 1.2) }
  }

  // ---- frame -----------------------------------------------------------------------------------------------

  /// _screenVec(vx, vz): world xz → screen (x right, y up) through the camera's horizontal right / up.
  static func screenVec(_ vx: Double, _ vz: Double, right: SIMD2<Double>, up: SIMD2<Double>) -> SIMD2<Double> {
    var rx = right.x, rz = right.y
    var ux = up.x, uz = up.y
    let rh = JS.hypot(rx, rz), uh = JS.hypot(ux, uz)
    let rl = rh == 0 || rh.isNaN ? 1 : rh
    let ul = uh == 0 || uh.isNaN ? 1 : uh
    rx /= rl; rz /= rl; ux /= ul; uz /= ul
    return SIMD2<Double>(vx * rx + vz * rz, vx * ux + vz * uz)
  }

  /// setSRGB: THREE.Color (linear) → sRGB-encoded components.
  static func srgb(_ c: PaletteColor) -> SIMD3<Double> {
    SIMD3<Double>(SRGB.fromLinear(c.r), SRGB.fromLinear(c.g), SRGB.fromLinear(c.b))
  }

  @inline(__always) static func truthy(_ x: Double) -> Double { (x == 0 || x.isNaN) ? 0 : x }   // `x || 0`

  /// PostFX.update(dt) (after the thermal / photo updates, which arrive as inputs).
  public func update(_ f: PostFrameInput) {
    let dt = f.dt
    realT += dt
    let st = f.weather
    let pal = st?.palette
    let P = pal?.post
    let heli = f.heli
    let reduce = reduceFlashes
    let paused = f.mode == "paused"
    let photo = f.photo.active
    let gdt = paused || photo ? 0 : dt

    // --- pulses
    pulses.damage = JS.max(0, pulses.damage - dt * (reduce ? 1.1 : 1.7))
    if pulses.caHold > 0 { pulses.caHold -= dt } else { pulses.caKick = JS.max(0, pulses.caKick - dt * 30) }
    pulses.vortex = JS.max(0, pulses.vortex - dt * 3)
    pulses.flash = JS.max(0, pulses.flash - dt * 4)
    pulses.pause = MathUtil.damp(pulses.pause, paused ? 1 : 0, 9, dt)
    pulses.salt = JS.max(0, pulses.salt - gdt / 40)

    let flash = MathUtil.clamp(PostState.truthy(st?.flash ?? 0) + pulses.flash, 0, 1)
    // afterimage: −0.25 stop for 0.6 s once the flash has passed
    if flash > 0.35 { pulses.after = 1 } else { pulses.after = JS.max(0, pulses.after - dt / 0.6) }
    let afterMul = JS.pow(2, -0.25 * pulses.after * (1 - flash))
    let night = PostState.truthy(st?.night ?? 0)
    let visFlash = flash * (1 - f.thermal.mix)
    exposure = (pal?.exposure ?? 1) * (1 + 2.4 * visFlash * (1 - 0.5 * night)) * afterMul * f.photo.exposureMul

    // --- bloom
    if let P = P {
      bloomStrength = P.bloomStrength * (1 - 0.45 * flash)
      bloomRadius = P.bloomRadius
      bloomThreshold = P.bloomThreshold * (1 + 5 * flash)
    }

    // --- grading uniforms (palette colours are linear → FinalPass works in sRGB)
    var u = uniforms
    if let P = P, let st = st {
      u.uSlope = SIMD3<Double>(P.slope.x, P.slope.y, P.slope.z)
      u.uOffset = SIMD3<Double>(P.offset.x, P.offset.y, P.offset.z)
      u.uPower = P.power
      u.uContrast = P.contrast
      let green = PostState.truthy(st.greenTint)
      u.uSat = P.saturation * (1 - 0.45 * green)
      u.uGreen = green
      u.uSplitShadow = PostState.srgb(P.splitShadow)
      u.uSplitHighlight = PostState.srgb(P.splitHighlight)
      u.uSplitStrength = P.splitStrength
      u.uVignette = P.vignette
      u.uVignetteColor = PostState.srgb(P.vignetteColor)
      u.uGrain = P.grain
      u.uCA = (P.ca + pulses.caKick) * (f.bufferHeight / 1080)
    }
    u.uNight = night
    u.uFloor = 0.006 + 0.006 * night
    // daylight toe for the dark storm grades (none at night: night water stays 0.015–0.06)
    u.uDayToe = 0.05 * (1 - MathUtil.smoothLook(0.4, 0.75, night))
    u.uFlash = flash
    if let fc = st?.flashColor { u.uFlashTint = PostState.srgb(fc) }
    u.uSatMul = (1 - 0.65 * flash) * (1 - 0.3 * pulses.damage) * (1 - 0.6 * pulses.pause)
    u.uBright = 1 - 0.35 * pulses.pause
    u.uVortex = pulses.vortex
    u.uLetterbox = photo ? f.photo.letterboxMix : MathUtil.clamp(PostState.truthy(f.letterbox), 0, 1)

    // photo options (DOF, grade preset) and the FLIR view
    var extraGrain = 0.0
    if !photo {
      u.uDof = 0
      u.uLookMix = 0
    } else {
      let p = f.photo
      u.uDof = p.dof
      u.uDofFocus = p.dofFocus
      u.uDofBand = p.dofBand
      u.uDofTaps = p.dofTaps
      u.uLookMix = p.lookMix
      if p.lookMix > 0 {
        u.uLookSat = p.lookSat
        u.uLookContrast = p.lookContrast
        u.uLookFade = p.lookFade
        u.uLookShadow = p.lookShadow
        u.uLookHigh = p.lookHigh
      }
      extraGrain = p.extraGrain
    }
    let th = f.thermal
    u.uThermal = th.mix
    u.uThermBoot = th.boot
    u.uThermFlick = th.flick
    u.uThermT = realT
    u.uGrain = (P?.grain ?? 0.03) * (1 - th.mix) + 0.032 * th.mix + extraGrain

    // grain reseeded at 24 Hz
    seedT += dt
    if seedT >= 1.0 / 24 {
      seedT = JSNumber.mod(seedT, 1.0 / 24)
      seed = JSNumber.mod(seed + 1, 997)
      u.uSeed = seed + rng.next()
    }

    // --- edge pulses: damage, hull < 25 % breathing, low-fuel amber
    var E = (r: 0.0, g: 0.0, b: 0.0, a: 0.0)
    func addEdge(_ c: PaletteColor, _ a: Double) {
      if a <= 0 { return }
      E.r += c.r * a
      E.g += c.g * a
      E.b += c.b * a
      E.a += a
    }
    addEdge(reduce ? PostState.BLACK : PostState.DAMAGE_RED, (reduce ? 0.4 : 0.5) * pulses.damage)
    let alive = heli?.alive ?? true
    let hull = heli?.hull ?? 1
    if hull < 0.25 && alive {
      let breath = 0.5 - 0.5 * JS.cos(realT * JS.PI)   // 0.5 Hz
      addEdge(PostState.DAMAGE_RED, 0.28 * breath * (1 - (hull / 0.25) * 0.5))
    }
    let fuel = heli?.fuel ?? 1
    if fuel < 0.25 && fuel > 0 && alive {
      let hz = fuel < 0.1 ? 1.2 : 0.6
      let ph = JSNumber.mod(realT * hz, 1)
      let pulse = JS.exp(-ph * 5) * (1 - JS.exp(-ph * 60))
      addEdge(PostState.AMBER, (fuel < 0.1 ? 0.3 : 0.2) * pulse)
    }
    if E.a > 0 {
      // averaged in linear space, uploaded as sRGB like every other FinalPass colour
      let c = PostState.srgb(PaletteColor(E.r / E.a, E.g / E.a, E.b / E.a))
      u.uEdge = SIMD4<Double>(c.x, c.y, c.z, JS.min(0.75, E.a))
    } else {
      u.uEdge.w = 0
    }

    // --- lens drops, condensation, salt
    let allowDrops = dropsAllowed
    let rivulets = allowDrops && quality == "high"
    if allowDrops {
      let vx = PostState.truthy(heli?.velocity.x ?? 0)
      let vz = PostState.truthy(heli?.velocity.y ?? 0)
      let speed = JS.hypot(vx, vz)
      let vs = PostState.screenVec(-vx, -vz, right: f.cameraRightXZ, up: f.cameraUpXZ)   // drops run against the motion
      let ws = PostState.truthy(st?.windSpeed ?? 0)
      var fx = vs.x * 0.7
      var fy = vs.y * 0.7
      if let wd = st?.windDir {
        let wsv = PostState.screenVec(wd.x * ws, wd.y * ws, right: f.cameraRightXZ, up: f.cameraUpXZ)
        fx += wsv.x * 0.3
        fy += wsv.y * 0.3
      }
      fy -= 0.6   // a little gravity toward the bottom of the frame
      let fh = JS.hypot(fx, fy)
      let fl = fh == 0 || fh.isNaN ? 1 : fh
      u.uFlow = SIMD2<Double>(fx / fl, fy / fl)
      let rain = st.map { $0.rain ?? 1 } ?? 1
      let dropsAmt = PostState.truthy(P?.drops ?? 0)
      let rate = dropsAmt * 12 * MathUtil.clamp(0.25 + 1.2 * rain, 0, 1)
      // low over breaking seas: spray + salt («Висение ниже 8 м над бурунами»)
      let alt = heli?.altitude ?? 99
      let rough = PostState.truthy(pal?.sea.whitecaps ?? 0) > 0.08 || PostState.truthy(st?.waveHeight ?? 0) > 1.6
      if !paused && alt < 8 && rough && !(heli?.landed ?? false) && alive {
        pulses.sprayCd -= dt
        if pulses.sprayCd <= 0 {
          pulses.sprayCd = 1.2 + rng.next() * 1.5
          drops.spray(0.25 + 0.25 * (1 - alt / 8), rand: { self.nextRandom() })
        }
        if speed < 8 { pulses.salt = MathUtil.clamp(pulses.salt + gdt * 0.06, 0, 1) }
      }
      // light-rain / dry presets keep only a few beads; rain left over from a previous preset clears quickly
      let cap: Double = dropsAmt < 0.2 ? 6 : 0
      let dryK: Double = st?.preset == "clearing" ? 1 : 3.5
      drops.update(dt: gdt, rate: rate, speed: speed, flowX: u.uFlow.x, flowY: u.uFlow.y, rivulets: rivulets,
                   cap: cap, dryK: dryK, rand: { self.nextRandom() })
      u.uDrops = drops.count > 0 ? 1 : 0
    } else {
      u.uDrops = 0
    }
    let fogginess = PostState.truthy(st?.fog ?? 0)
    u.uCondense = rivulets ? MathUtil.clamp((fogginess - 0.5) / 0.5, 0, 1) * 0.9 : 0
    u.uSalt = rivulets ? pulses.salt : 0
    uniforms = u
  }

  /// The PostInput for the renderer (exposure, bloom, FinalPass).
  public var postInput: PostInput {
    var p = PostInput()
    p.exposure = Float(exposure)
    p.bloomStrength = Float(bloomStrength)
    p.bloomRadius = Float(bloomRadius)
    p.bloomThreshold = Float(bloomThreshold)
    p.finalPass = uniforms.finalInput
    return p
  }
}
