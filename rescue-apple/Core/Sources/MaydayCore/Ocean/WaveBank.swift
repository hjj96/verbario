// Fixed Gerstner wave bank — CPU side (systems/ocean/waves.js; DESIGN §2.6.1–2.6.2).
//
// The bank never changes wavelengths or directions at runtime: weather only re-weights amplitudes.
// Everything the vertex shader does is mirrored here with the same arrays and LOD/damping rules, so
// heightAt()/normalAt() agree with the rendered surface (ocean selftest) and — the point of this
// port — with the web's CPU mirror bit for bit (Tests/Vectors/ocean/wavebank_<preset>.json).
//
// Conventions (shared with the shaders):
//   lagrangian point p0 (world xz) → local grid coordinate gl = p0 − offset
//   θ_i = k_i·(D_i · gl) + phase_i          (phase_i wrapped on the CPU, includes k·D·offset − ω·t)
//   P.xz = p0 + Σ b_i·w_i·D_i·cos θ_i
//   P.y  =      Σ a_i·w_i·sin θ_i  + features(p0)
//   w_i  = smoothstep(3.5, 5, L_i / cell(gl)) · edgeFade(gl) · shoalDamp(p0) · coastDamp(p0)

/// A shoal circle (rig legs, wrecks); `on == false` means a terrain coast handles it (coast map).
public struct Shoal: Equatable, Sendable {
  public var x: Double
  public var z: Double
  public var r: Double
  public var on: Bool

  public init(x: Double, z: Double, r: Double, on: Bool = true) {
    self.x = x
    self.z = z
    self.r = r
    self.on = on
  }
}

/// Wave statistics the rest of the game reads (bank.stats).
public struct WaveStats: Equatable, Sendable {
  public var Hs: Double = 0
  public var HsEff: Double = 0.3
  public var Lp: Double = 16
  public var K: Double = 0
  public var sigma: Double = 0.4
  public var Q: Double = 0.25
  /// Set by the first update (undefined before it in the JS).
  public var crestNorm: Double? = nil

  public init() {}
}

/// Result of one Gerstner evaluation at a lagrangian point (waves.js `_ev`).
public struct WaveEval: Equatable, Sendable {
  public var dx = 0.0, dz = 0.0, y = 0.0
  public var jxx = 0.0, jzz = 0.0, jxz = 0.0
  public var sx = 0.0, sz = 0.0
  public var vx = 0.0, vz = 0.0, vy = 0.0

  public init() {}
}

public final class WaveBank {
  public let constants: WaveConstants
  public let maxWaves: Int
  public static let TAU: Double = JS.PI * 2

  public private(set) var count: Int = 8 // active waves (quality)
  public private(set) var gridStep: Double = 2.0 / 300
  public let L: [Double]
  public let k: [Double]
  public let omega: [Double]
  public let dirOffset: [Double]
  public private(set) var Dx: [Double]
  public private(set) var Dz: [Double]
  public private(set) var phi0: [Double] // seeded phase
  public private(set) var a: [Double] // smoothed amplitude
  public private(set) var aTarget: [Double]
  public private(set) var b: [Double] // horizontal (Gerstner) amplitude
  public private(set) var phase: [Double] // wrapped, relative to the grid offset
  public private(set) var align: [Double] // wind alignment (whitecap crest weight)
  public private(set) var baseAngle: Double = 0
  public private(set) var offsetX: Double = 0
  public private(set) var offsetZ: Double = 0
  public private(set) var time: Double = 0
  /// Jump straight to target amplitudes on the next update.
  public var snap = true
  public private(set) var stats = WaveStats()
  /// Shoal circles (≤ 8).
  public var shoals: [Shoal] = []
  /// Coastline distance map (terrain coasts).
  public var coast: CoastMap? = nil
  /// Optional feature field (FeatureSet).
  public var features: (any WaveFeatureField)? = nil
  /// Shader uniform mirrors (Float32): uWaveA = Dx, Dz, k, a; uWaveB = b, phase, L, align.
  public private(set) var uWaveA: [Float]
  public private(set) var uWaveB: [Float]
  private var raw: [Double]

  public init(constants: WaveConstants = .web) {
    self.constants = constants
    let n = constants.maxWaves
    maxWaves = n
    let tau = WaveBank.TAU
    L = constants.waveL
    k = constants.waveL.map { tau / $0 }
    omega = constants.waveL.map { 0.9 * (constants.grav * (tau / $0)).squareRoot() } // ω = 0.9·sqrt(g·k)
    dirOffset = constants.waveDirDeg.map { ($0 * JS.PI) / 180 }
    Dx = [Double](repeating: 0, count: n)
    Dz = [Double](repeating: 0, count: n)
    phi0 = [Double](repeating: 0, count: n)
    a = [Double](repeating: 0, count: n)
    aTarget = [Double](repeating: 0, count: n)
    b = [Double](repeating: 0, count: n)
    phase = [Double](repeating: 0, count: n)
    align = [Double](repeating: 0, count: n)
    raw = [Double](repeating: 0, count: n)
    uWaveA = [Float](repeating: 0, count: 4 * n)
    uWaveB = [Float](repeating: 0, count: 4 * n)
    count = n
    setSeed(1, 0)
  }

  // ---- configuration ------------------------------------------------------------------------------
  /// Seeded phases and base swell direction (radians, xz-plane angle of travel).
  public func setSeed(_ seed: Double, _ baseAngle: Double) {
    let s0 = JSNumber.toUint32(seed)
    var rng = Mulberry32(state: s0 == 0 ? 1 : s0) // (seed >>> 0) || 1
    for i in 0..<maxWaves { phi0[i] = rng.next() * WaveBank.TAU }
    setBaseAngle(baseAngle)
    snap = true
  }

  public func setBaseAngle(_ angle: Double) {
    baseAngle = angle
    for i in 0..<maxWaves {
      let ang = angle + dirOffset[i]
      Dx[i] = JS.cos(ang)
      Dz[i] = JS.sin(ang)
    }
  }

  public func setQuality(_ waves: Int, _ gridN: Int) {
    count = Swift.max(0, Swift.min(waves, maxWaves))
    gridStep = 2 / Double(gridN)
    snap = true
  }

  // ---- per-frame update ---------------------------------------------------------------------------
  /// sea: palette.sea {Hs, swellAdd, Q}; windAngle: xz angle the wind blows towards;
  /// shortScale: 1 normally, 0.25 in `clearing` (waves 3… × shortScale).
  public func update(_ dt: Double, _ t: Double, _ sea: SeaState, _ windAngle: Double, _ shortScale: Double,
                     _ offsetX: Double, _ offsetZ: Double) {
    let n = count
    let Hs = JS.max(0, sea.Hs)
    let Lp = MathUtil.clamp(14 * Hs + 12, 16, 120)
    var sum2 = 0.0
    for i in 0..<n {
      let l = JS.log(L[i] / Lp) / 0.45
      let spec = JS.exp(-l * l)
      let c = JS.max(0, JS.cos(baseAngle + dirOffset[i] - windAngle))
      let r = spec * (0.35 + 0.65 * c * c)
      raw[i] = r
      sum2 += r * r
    }
    // normalise over the ACTIVE waves so every quality level has the same Hs
    let norm = sum2 > 0 ? Hs / (4 * JS.sqrt(sum2 / 2)) : 0
    let swellAdd = JS.max(0, JSNumber.or(sea.swellAdd, 0))
    for i in 0..<maxWaves {
      var target = i < n ? raw[i] * norm : 0
      if i == 0 { target += swellAdd }
      if i >= 3 { target *= shortScale }
      aTarget[i] = target
      if snap {
        a[i] = target
      } else if dt > 0 {
        let tau: Double = target > a[i] ? 8 : 20 // grow 8 s, decay 20 s (swell outlives wind)
        a[i] += (target - a[i]) * (1 - JS.exp(-dt / tau))
      }
    }
    snap = false

    var ka = 0.0
    for i in 0..<n { ka += k[i] * a[i] }
    let Q = MathUtil.clamp(sea.Q ?? 0.3, 0, 0.95)
    let div = JS.max(1, ka)
    var a2 = 0.0, K = 0.0, kb2 = 0.0
    for i in 0..<maxWaves {
      b[i] = i < n ? (Q * a[i]) / div : 0
      if i < n {
        a2 += a[i] * a[i]
        let kb = k[i] * b[i]
        K += kb
        kb2 += kb * kb
      }
    }
    time = t
    self.offsetX = offsetX
    self.offsetZ = offsetZ
    var wa2 = 0.0
    for i in 0..<maxWaves {
      let c = JS.max(0, JS.cos(baseAngle + dirOffset[i] - windAngle))
      align[i] = 0.25 + c * c
      if i >= 3 && i < 7 { wa2 += align[i] * align[i] }
    }
    stats.crestNorm = 1 / JS.sqrt(JS.max(wa2 / 2, 1e-4))
    for i in 0..<maxWaves {
      phase[i] = WaveBank.wrapPhase(k[i] * (Dx[i] * offsetX + Dz[i] * offsetZ) + phi0[i] - omega[i] * t)
      let j = i * 4
      uWaveA[j] = Float(Dx[i])
      uWaveA[j + 1] = Float(Dz[i])
      uWaveA[j + 2] = Float(k[i])
      uWaveA[j + 3] = Float(i < n ? a[i] : 0)
      uWaveB[j] = Float(b[i])
      uWaveB[j + 1] = Float(phase[i])
      uWaveB[j + 2] = Float(L[i])
      uWaveB[j + 3] = Float(align[i])
    }
    stats.Hs = Hs
    stats.Lp = Lp
    stats.Q = Q
    stats.HsEff = JS.max(0.3, 4 * JS.sqrt(a2 / 2))
    stats.K = K
    // standard deviation of the normalised crest compression c = (1 − J)/K (≈ Σ k·b·sinθ / K)
    stats.sigma = K > 1e-5 ? JS.sqrt(kb2 / 2) / K : 0.4
  }

  @inline(__always) static func wrapPhase(_ x0: Double) -> Double {
    let x = x0.truncatingRemainder(dividingBy: TAU)
    return x < 0 ? x + TAU : x
  }

  // ---- LOD / damping --------------------------------------------------------------------------------
  /// Cell size of the warped grid at local coordinate (lx, lz) (waves.js cellSize).
  @inline(__always) public func cellSize(_ lx: Double, _ lz: Double) -> Double {
    let m = JS.max(JS.abs(lx), JS.abs(lz)) / constants.gridExtent
    return 608 * gridStep * JS.pow(JS.max(m, 1e-5), 0.375)
  }

  /// waves.js edgeFade(lx, lz)
  @inline(__always) public func edgeFade(_ lx: Double, _ lz: Double) -> Double {
    1 - MathUtil.smoothstepOcean(constants.edgeFade[0], constants.edgeFade[1], JS.max(JS.abs(lx), JS.abs(lz)))
  }

  /// Shoals damp waves near rocks (same falloff as GLSL oceanShoalDamp).
  public func shoalDamp(_ px: Double, _ pz: Double) -> Double {
    var d = 1.0
    for s in shoals {
      if s.on == false { continue } // a terrain coast: the coast map damps it
      let r = JS.hypot(px - s.x, pz - s.z)
      d *= 0.15 + 0.85 * MathUtil.smoothstepOcean(s.r * 0.9, s.r * 2.6, r)
    }
    return d
  }

  // ---- evaluation -------------------------------------------------------------------------------------
  /// Gerstner sum at lagrangian point (px, pz); `deriv` also fills tangent terms and orbital velocity.
  public func eval(_ px: Double, _ pz: Double, _ tOff: Double, _ deriv: Bool) -> WaveEval {
    var ev = WaveEval()
    let lx = px - offsetX
    let lz = pz - offsetZ
    let cell = cellSize(lx, lz)
    var damp = edgeFade(lx, lz) * (shoals.isEmpty ? 1 : shoalDamp(px, pz))
    if let c = coast { damp *= CoastMap.damp(c.distance(px, pz)) }
    var dx = 0.0, dz = 0.0, y = 0.0, jxx = 0.0, jzz = 0.0, jxz = 0.0, sx = 0.0, sz = 0.0, vx = 0.0, vz = 0.0, vy = 0.0
    if damp > 0 {
      for i in 0..<count {
        let w = damp * MathUtil.smoothstepOcean(3.5, 5.0, L[i] / cell)
        if w <= 0 { continue }
        let Dx = self.Dx[i], Dz = self.Dz[i], k = self.k[i]
        let th = k * (Dx * lx + Dz * lz) + phase[i] - omega[i] * tOff
        let s = JS.sin(th), c = JS.cos(th)
        let a = self.a[i] * w, b = self.b[i] * w
        dx += b * c * Dx
        dz += b * c * Dz
        y += a * s
        if deriv {
          let kbs = k * b * s
          jxx += kbs * Dx * Dx
          jzz += kbs * Dz * Dz
          jxz += kbs * Dx * Dz
          let kac = k * a * c
          sx += kac * Dx
          sz += kac * Dz
          let om = omega[i]
          vx += b * om * s * Dx // d/dt of b·cos(… − ω t)
          vz += b * om * s * Dz
          vy -= a * om * c
        }
      }
    }
    ev.dx = dx
    ev.dz = dz
    ev.y = y
    ev.jxx = jxx
    ev.jzz = jzz
    ev.jxz = jxz
    ev.sx = sx
    ev.sz = sz
    ev.vx = vx
    ev.vz = vz
    ev.vy = vy
    return ev
  }

  /// Lagrangian point whose displaced position lands on world (x, z): fixed-point iterations.
  public func invert(_ x: Double, _ z: Double, _ tOff: Double = 0, iterations: Int = 3) -> (px: Double, pz: Double) {
    var px = x, pz = z
    for _ in 0..<Swift.max(iterations, 0) {
      let ev = eval(px, pz, tOff, false)
      px = x - ev.dx
      pz = z - ev.dz
    }
    return (px, pz)
  }

  @inline(__always) func featureHeight(_ px: Double, _ pz: Double, _ tOff: Double) -> Double {
    if let f = features { return f.heightAt(px, pz, tOff) }
    return 0
  }

  /// Surface height at world (x, z) (waves + features). Note the JS adds `+ 0` without features
  /// (turning a -0 height into +0); this keeps that.
  public func heightAt(_ x: Double, _ z: Double, _ tOff: Double = 0) -> Double {
    let p = invert(x, z, tOff)
    return eval(p.px, p.pz, tOff, false).y + featureHeight(p.px, p.pz, tOff)
  }

  /// Exact normal of the displaced surface (same tangent cross product as the vertex shader).
  public func normalAt(_ x: Double, _ z: Double, _ tOff: Double = 0) -> V3 {
    let p = invert(x, z, tOff)
    let px = p.px, pz = p.pz
    let ev = eval(px, pz, tOff, true)
    var fx = 0.0, fz = 0.0
    if let f = features, f.active {
      let fd = constants.fd
      let f0 = featureHeight(px, pz, tOff)
      fx = (featureHeight(px + fd, pz, tOff) - f0) / fd
      fz = (featureHeight(px, pz + fd, tOff) - f0) / fd
    }
    // Tx = (1−jxx, sx+fx, −jxz), Tz = (−jxz, sz+fz, 1−jzz), N = Tz × Tx
    let ax = -ev.jxz, ay = ev.sz + fz, az = 1 - ev.jzz
    let bx = 1 - ev.jxx, by = ev.sx + fx, bz = -ev.jxz
    let nx = ay * bz - az * by
    let ny = az * bx - ax * bz
    let nz = ax * by - ay * bx
    let h = JS.hypot(nx, ny, nz)
    let l = JSNumber.isTruthy(h) ? h : 1
    return V3(nx / l, ny / l, nz / l)
  }

  /// Orbital velocity of the surface at world (x, z): (x, vertical, z).
  public func velocityAt(_ x: Double, _ z: Double, _ tOff: Double = 0) -> V3 {
    let p = invert(x, z, tOff)
    let ev = eval(p.px, p.pz, tOff, true)
    return V3(ev.vx, ev.vy, ev.vz)
  }

  /// Horizontal orbital velocity (the JS Vector2 out variant): (x, z).
  public func velocityXZAt(_ x: Double, _ z: Double, _ tOff: Double = 0) -> V2 {
    let p = invert(x, z, tOff)
    let ev = eval(p.px, p.pz, tOff, true)
    return V2(ev.vx, ev.vz)
  }

  /// Forward evaluation (lagrangian → displaced), the self-test's independent reference.
  public func forward(_ px: Double, _ pz: Double, _ tOff: Double = 0) -> V3 {
    let ev = eval(px, pz, tOff, false)
    return V3(px + ev.dx, ev.y + featureHeight(px, pz, tOff), pz + ev.dz)
  }

  /// uWaveA as one float4 per wave (Dx, Dz, k, a) — the renderer's per-wave uniform layout.
  public var waveA4: [SIMD4<Float>] {
    (0..<maxWaves).map { SIMD4<Float>(uWaveA[$0 * 4], uWaveA[$0 * 4 + 1], uWaveA[$0 * 4 + 2], uWaveA[$0 * 4 + 3]) }
  }

  /// uWaveB as one float4 per wave (b, phase, L, align).
  public var waveB4: [SIMD4<Float>] {
    (0..<maxWaves).map { SIMD4<Float>(uWaveB[$0 * 4], uWaveB[$0 * 4 + 1], uWaveB[$0 * 4 + 2], uWaveB[$0 * 4 + 3]) }
  }

  /// ocean.js waveLiftAt part: feature height at the lagrangian point under world (x, z).
  public func featureLiftAt(_ x: Double, _ z: Double, _ tOff: Double = 0) -> Double {
    let p = invert(x, z, tOff)
    return features?.heightAt(p.px, p.pz, tOff) ?? 0
  }
}
