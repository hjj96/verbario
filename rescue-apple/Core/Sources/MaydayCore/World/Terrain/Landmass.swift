// world/terrain.js makeHeightFn: the analytic height h(x, z) of a landmass (metres, sea level 0).
//   lobes      elliptical granite domes, ragged coast from domain-warped noise, cliff or slab profile
//              per bearing (the exposed side gets sea cliffs); negative lobes carve coves
//   detail     glacier-polished ridges (ridged fbm stretched along the ice flow) + fbm knobs
//   terraces   granite sheeting: shelves and risers on tilted planes
//   joints     two near-orthogonal fracture sets cut clefts
//   flats      structure footprints blended to a target height; cuts kept under water (jetty)
// A definition is plain data (LandmassDef mirrors the JS object, `nil` = an absent key); `HeightFunction`
// is the prepared closure. Same operation order as the JS (Tests/Vectors/world/landmass_first.json).

/// One lobe {x, z, rx, rz, rot, h, w, k, peak, rag}; nil members take the web's defaults.
public struct LandmassLobe: Equatable, Sendable {
  public var x: Double
  public var z: Double
  public var rx: Double
  public var rz: Double
  public var rot: Double?
  public var h: Double
  public var w: Double?
  public var k: Double?
  public var peak: Double?
  public var rag: Double?

  public init(x: Double, z: Double, rx: Double, rz: Double, rot: Double? = nil, h: Double, w: Double? = nil, k: Double? = nil,
              peak: Double? = nil, rag: Double? = nil) {
    self.x = x
    self.z = z
    self.rx = rx
    self.rz = rz
    self.rot = rot
    self.h = h
    self.w = w
    self.k = k
    self.peak = peak
    self.rag = rag
  }

  /// landforms.js ISLAND_LOBES row: [x, z, rx, rz, rot, h, w, k, peak, rag]
  public init(row a: [Double]) {
    self.init(x: a[0], z: a[1], rx: a[2], rz: a[3], rot: a[4], h: a[5], w: a[6], k: a[7], peak: a[8], rag: a[9])
  }
}

/// A structure footprint (terrain.js footDist): circle {x, z, r}, box {box: [cx, cz, hx, hz], rot}, segment
/// {seg: [[ax, az], [bx, bz]], hw}; plus the flat / cut parameters {y | y0, y1, blend, keep, max}.
public struct Footprint: Equatable, Sendable {
  public enum Shape: Equatable, Sendable {
    case circle(x: Double, z: Double, r: Double)
    case box(cx: Double, cz: Double, hx: Double, hz: Double, rot: Double?)
    case seg(ax: Double, az: Double, bx: Double, bz: Double, hw: Double)
  }

  public var shape: Shape
  public var blend: Double
  public var y: Double?
  public var y0: Double?
  public var y1: Double?
  public var keep: Double?
  public var max: Double?

  public init(shape: Shape, blend: Double, y: Double? = nil, y0: Double? = nil, y1: Double? = nil, keep: Double? = nil, max: Double? = nil) {
    self.shape = shape
    self.blend = blend
    self.y = y
    self.y0 = y0
    self.y1 = y1
    self.keep = keep
    self.max = max
  }

  init(json v: JSONValue) throws {
    if let s = v["seg"].array {
      let a = try s[0].requireDoubles("seg[0]"), b = try s[1].requireDoubles("seg[1]")
      shape = .seg(ax: a[0], az: a[1], bx: b[0], bz: b[1], hw: try v["hw"].requireDouble("hw"))
    } else if let b = v["box"].doubles {
      shape = .box(cx: b[0], cz: b[1], hx: b[2], hz: b[3], rot: v["rot"].double)
    } else {
      shape = .circle(x: try v["x"].requireDouble("x"), z: try v["z"].requireDouble("z"), r: try v["r"].requireDouble("r"))
    }
    blend = try v["blend"].requireDouble("blend")
    y = v["y"].double
    y0 = v["y0"].double
    y1 = v["y1"].double
    keep = v["keep"].double
    max = v["max"].double
  }

  /// footDist(F, x, z) → (distance outside, ≤ 0 inside; t along a segment, else 0)
  @inline(__always) public func distance(_ x: Double, _ z: Double) -> (d: Double, t: Double) {
    switch shape {
    case .seg(let ax, let az, let bx, let bz, let hw):
      let ex = bx - ax, ez = bz - az
      let t = JS.min(1, JS.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)))
      return (JS.hypot(x - ax - ex * t, z - az - ez * t) - hw, t)
    case .box(let cx, let cz, let hx, let hz, let rot):
      var dx = x - cx, dz = z - cz
      if let r = rot, JSNumber.isTruthy(r) {
        let c = JS.cos(r), s = JS.sin(r)
        let u = dx * c - dz * s
        dz = dx * s + dz * c
        dx = u
      }
      let qx = JS.abs(dx) - hx, qz = JS.abs(dz) - hz
      return (JS.hypot(JS.max(qx, 0), JS.max(qz, 0)) + JS.min(JS.max(qx, qz), 0), 0)
    case .circle(let cx, let cz, let r):
      return (JS.hypot(x - cx, z - cz) - r, 0)
    }
  }
}

/// def.joint {sp: [a, b] spacing m, depth m, width m, dir rad}
public struct JointSpec: Equatable, Sendable {
  public var sp: [Double]
  public var depth: Double
  public var width: Double
  public var dir: Double

  public init(sp: [Double], depth: Double, width: Double, dir: Double) {
    self.sp = sp
    self.depth = depth
    self.width = width
    self.dir = dir
  }

  /// `def.joint || {sp: [17, 23], depth: 2.2, width: 1.6, dir: 0.5}`
  public static let defaults = JointSpec(sp: [17, 23], depth: 2.2, width: 1.6, dir: 0.5)
}

/// A landmass definition (makeHeightFn's `def`); nil members are absent keys.
public struct LandmassDef: Equatable, Sendable {
  public var seed: Double
  public var lobes: [LandmassLobe]
  /// unit [x, z] bearing of the open sea (cliffs face it)
  public var expose: V2?
  public var cliff: Double?
  public var ice: Double?
  public var ridge: Double?
  public var bump: Double?
  public var step: Double?
  public var terr: Double?
  public var joint: JointSpec?
  public var flats: [Footprint]
  public var cuts: [Footprint]
  public var floor: Double?
  public var tilt: V2?

  public init(seed: Double, lobes: [LandmassLobe], expose: V2? = nil, cliff: Double? = nil, ice: Double? = nil, ridge: Double? = nil,
              bump: Double? = nil, step: Double? = nil, terr: Double? = nil, joint: JointSpec? = nil, flats: [Footprint] = [],
              cuts: [Footprint] = [], floor: Double? = nil, tilt: V2? = nil) {
    self.seed = seed
    self.lobes = lobes
    self.expose = expose
    self.cliff = cliff
    self.ice = ice
    self.ridge = ridge
    self.bump = bump
    self.step = step
    self.terr = terr
    self.joint = joint
    self.flats = flats
    self.cuts = cuts
    self.floor = floor
    self.tilt = tilt
  }
}

/// makeHeightFn(def): the prepared height function.
public struct HeightFunction {
  struct Lobe {
    var x, z, rx, rz, h, w, k, peak, rag: Double
    var c, s, rm, reach2: Double
  }

  let S: Double
  let lobes: [Lobe]
  let ex: Double, ez: Double
  let cliff: Double
  let ic: Double, isn: Double
  let ridge: Double, bump: Double
  let step: Double, terr: Double
  let J: JointSpec
  let jc: (Double, Double), js: (Double, Double)
  let flats: [Footprint]
  let cuts: [Footprint]
  let floor: Double
  let tiltX: Double, tiltZ: Double

  public init(_ def: LandmassDef) {
    S = Double(JSNumber.toInt32(def.seed))
    // stable sort: carving lobes (h < 0) after the domes, each group in definition order
    let sorted = def.lobes.filter { !($0.h < 0) } + def.lobes.filter { $0.h < 0 }
    lobes = sorted.map { L in
      let rm = (L.rx * L.rz).squareRoot()
      let reach = JS.max(L.rx, L.rz) * 1.6 + 10
      let rot = JSNumber.or(L.rot, 0)
      return Lobe(x: L.x, z: L.z, rx: L.rx, rz: L.rz, h: L.h, w: L.w ?? 0.45, k: L.k ?? 2, peak: L.peak ?? 0, rag: L.rag ?? 1,
                  c: JS.cos(rot), s: JS.sin(rot), rm: rm, reach2: reach * reach)
    }
    ex = def.expose?.x ?? 0
    ez = def.expose?.y ?? 0
    cliff = def.cliff ?? 0.5
    let ia = def.ice ?? 0.4
    ic = JS.cos(ia)
    isn = JS.sin(ia)
    ridge = def.ridge ?? 2
    bump = def.bump ?? 0.8
    step = def.step ?? 1.7
    terr = def.terr ?? 0.5
    J = def.joint ?? .defaults
    jc = (JS.cos(J.dir), JS.cos(J.dir + 1.45))
    js = (JS.sin(J.dir), JS.sin(J.dir + 1.45))
    flats = def.flats
    cuts = def.cuts
    floor = def.floor ?? -6
    tiltX = def.tilt?.x ?? 0.05
    tiltZ = def.tilt?.y ?? -0.035
  }

  public func callAsFunction(_ x: Double, _ z: Double) -> Double { height(x, z) }

  public func height(_ x: Double, _ z: Double) -> Double {
    typealias N = TerrainNoise
    // domain warp: no two coves alike
    let X = x + 6.5 * N.fbm2(x * 0.019, z * 0.019, S + 1, 3)
    let Z = z + 6.5 * N.fbm2(x * 0.019 + 5.2, z * 0.019 + 1.3, S + 2, 3)
    let cn = 6 * N.fbm2(X * 0.045, Z * 0.045, S + 3, 3) + 2.2 * N.fbm2(X * 0.12, Z * 0.12, S + 5, 2) + 1.3 * N.noise2(X * 0.35, Z * 0.35, S + 4)
      + 0.6 * N.noise2(X * 0.9, Z * 0.9, S + 6)
    var h = floor
    for L in lobes {
      let dx = X - L.x, dz = Z - L.z
      let dd = dx * dx + dz * dz
      if dd > L.reach2 { continue }
      let u = (dx * L.c - dz * L.s) / L.rx
      let v = (dx * L.s + dz * L.c) / L.rz
      let inv = 1 / (dd.squareRoot() + 1e-3)
      let ax = dx * inv, az = dz * inv
      // cliffs on the exposed bearings, slabs in the lee (+ a little noise around the shore)
      let an = 0.5 + 0.5 * N.noise2(ax * 1.7 + L.x * 0.07, az * 1.7 + L.z * 0.07, S + 7)
      let e = N.sstep(-0.35, 0.75, ax * ex + az * ez)
      let w = JS.max(0.05, L.w * (1 - cliff * (0.25 + 0.75 * e) * (0.35 + 0.65 * an)))
      let d = (u * u + v * v).squareRoot() + (cn * L.rag) / L.rm
      if L.h < 0 {
        // cove: carve below sea level inside the ellipse
        let cv = d < 1 ? L.h * (1 - d * d) : (d - 1) * 30
        h = -N.smax(-h, -cv, 1.5)
        continue
      }
      let lh: Double
      if d < 1 {
        let s = JS.min(1, (1 - d) / w)
        let rise = 1 - JS.pow(1 - s, L.k)
        let crown = L.peak > 0 ? 1 - L.peak + L.peak * JS.pow(1 - d, 1.35) : 0.62 + 0.38 * (1 - d * d)
        lh = L.h * rise * crown
      } else {
        let crown0 = L.peak > 0 ? 1 - L.peak : 0.62
        lh = JS.max(floor, (-L.h * crown0 * L.k * (d - 1)) / w)
      }
      h = N.smax(h, lh, 1.6)
    }
    if h < -3.5 && cuts.isEmpty { return h } // deep water: no detail needed (the sea is opaque)
    let land = N.sstep(-0.6, 2.4, h)
    if land > 0 {
      // glacier-polished whalebacks along the ice flow + knobs
      let iu = (X * ic + Z * isn) * 0.03
      let iv = (-X * isn + Z * ic) * 0.075
      h += land * ridge * (N.ridged2(iu, iv, S + 11, 4) - 0.42)
      h += land * bump * N.fbm2(X * 0.12, Z * 0.12, S + 13, 3)
      // the shore step is never a smooth wall: buttresses, gullies and fallen blocks
      let shore = land * (1 - N.sstep(3, 6.5, h))
      if shore > 0 { h += shore * 1.4 * (N.ridged2(X * 0.16, Z * 0.16, S + 15, 3) - 0.45) }
      // granite sheeting: shelves and risers
      if h > 0.2 && terr > 0 {
        let st = step * (1 + 0.28 * N.noise2(X * 0.031, Z * 0.031, S + 17))
        let hT = h + X * tiltX + Z * tiltZ // sheeting planes are tilted, not contour lines
        let t = hT / st
        let fl = t.rounded(.down)
        let f = t - fl
        let ter = (fl + N.sstep(0.28, 0.72, f)) * st
        h += (ter - hT) * terr * land
      }
      // joint clefts (two fracture sets; only some joints open, in stretches)
      let jl = N.sstep(0.2, 2.5, h)
      if jl > 0 && J.depth > 0 {
        for k in 0..<2 {
          let sp = k < J.sp.count ? J.sp[k] : .nan
          let jck = k == 0 ? jc.0 : jc.1, jsk = k == 0 ? js.0 : js.1
          let kd = Double(k)
          let q = X * jck + Z * jsk + 2.4 * N.noise2(X * 0.04, Z * 0.04, S + 19 + kd)
          let cell = (q / sp + 0.5).rounded(.down)
          let act = N.hash01(cell, kd, S + 23)
          if act < 0.38 { continue }
          let dist = JS.abs(q - cell * sp)
          let wd = J.width * (0.6 + 0.9 * act)
          if dist >= wd { continue }
          let along = -X * jsk + Z * jck
          let pres = N.sstep(-0.15, 0.35, N.noise2(along * 0.045, cell * 1.73, S + 29 + kd))
          if pres <= 0 { continue }
          let g = 1 - dist / wd
          h -= jl * J.depth * (0.55 + 0.9 * (act - 0.38)) * g * g * (3 - 2 * g) * pres
        }
      }
    }
    // structure footprints
    for F in flats {
      let fd = F.distance(x, z)
      let wgt = 1 - N.sstep(0, F.blend, fd.d)
      if wgt <= 0 { continue }
      var target: Double
      if let mx = F.max {
        target = JS.min(h, mx)
      } else {
        let ty: Double
        if case .seg = F.shape { ty = (F.y0 ?? .nan) + ((F.y1 ?? .nan) - (F.y0 ?? .nan)) * fd.t } else { ty = F.y ?? .nan }
        let keep = F.keep ?? 0.12
        target = ty + (h - ty) * keep
      }
      h += (target - h) * wgt
    }
    for F in cuts {
      let fd = F.distance(x, z)
      let wgt = 1 - N.sstep(0, F.blend, fd.d)
      if wgt > 0 { h = JS.min(h, h + ((F.y ?? .nan) - h) * wgt) }
    }
    return h
  }
}
