// CPU side of the shared look layer (core/look.js class Look): the shared uniforms that drift with
// the wind, and the CPU mirrors of the GLSL fields — what you SEE on the water is what PUSHES the heli:
//   gustField(x, z)  "cat's paws" 0…1       (lookGust)
//   frontsAt(x, z)   moving gust fronts, m/s (lookFronts)
//   cloudAt(x, z)    cloud-shadow cover 0…1  (lookCloud)
// Bit-exact with Node 22 (Tests/Vectors/look/fields.json).

/// One gust front as weather passes it to setFronts (≤ 4): {x, z, dirX, dirZ, strength, width = 140, length = 500}.
public struct GustFront: Equatable, Sendable {
  public var x: Double
  public var z: Double
  public var dirX: Double
  public var dirZ: Double
  public var strength: Double
  public var width: Double? // JS `f.width || 140`
  public var length: Double? // JS `f.length || 500`

  public init(x: Double, z: Double, dirX: Double, dirZ: Double, strength: Double, width: Double? = nil, length: Double? = nil) {
    self.x = x
    self.z = z
    self.dirX = dirX
    self.dirZ = dirZ
    self.strength = strength
    self.width = width
    self.length = length
  }
}

public final class Look {
  public let constants: LookConstants
  public let seed: Double
  public let atlas: LookTexture
  public let detail: LookTexture
  public let lace: LookTexture
  /// decode: slope_uv = (tex * 2 - 1) * detailMaxSlope (per uv unit). Not stored in the .rgba export;
  /// the generator returns it (look.json / Tests check 38.6270549618508 for seed 7).
  public let detailMaxSlope: Double?

  // ---- shared uniforms (look.uniforms) ---------------------------------------------------------------
  public var time: Double = 0 // uTime
  public var wind = V2() // uWind, m/s (x = world X, y = world Z)
  public var windOffset = V2() // uWindOffset: integrated wind travel, m
  public var rain: Double = 0 // uRain
  public var wet: Double = 0 // uWet
  public var flash: Double = 0 // uFlash
  public var night: Double = 0 // uNight
  public var resolution = V2(1, 1) // uResolution (drawing buffer px)
  /// uGustFronts[4]: xy = centre (world x, z), zw = unit direction of travel
  public private(set) var gustFrontsA: [SIMD4<Double>]
  /// uGustFrontsB[4]: x = strength m/s (0 = inactive), y = width (band, m), z = length (m), w unused
  public private(set) var gustFrontsB: [SIMD4<Double>]

  /// CPU mirror of the active fronts, slot order (look._fronts).
  struct Front {
    var x: Double
    var z: Double
    var dx: Double
    var dz: Double
    var s: Double
    var w: Double
    var l: Double
  }

  private(set) var fronts: [Front] = []

  public init(atlas: LookTexture, detail: LookTexture, lace: LookTexture, detailMaxSlope: Double? = nil,
              seed: Double = 7, constants: LookConstants = .web) {
    self.constants = constants
    self.seed = seed
    self.atlas = atlas
    self.detail = detail
    self.lace = lace
    self.detailMaxSlope = detailMaxSlope
    gustFrontsA = Array(repeating: SIMD4<Double>(0, 0, 1, 0), count: 4)
    gustFrontsB = Array(repeating: SIMD4<Double>(0, constants.frontWidth, constants.frontLength, 0), count: 4)
  }

  /// `new Look(seed)`: generates the three textures (slow: ~0.5–3 s; the apps load the exported bytes instead).
  public static func generate(seed: Int = 7, constants: LookConstants = .web) -> Look {
    let atlas = LookTextures.makeAtlas(seed: seed, size: constants.atlasSize)
    let det = LookTextures.makeDetail(seed: Double(seed + 3), size: constants.detailSize)
    let lace = LookTextures.makeLace(seed: seed + 11, size: constants.laceSize)
    return Look(atlas: atlas, detail: det.texture, lace: lace, detailMaxSlope: det.maxSlope, seed: Double(seed), constants: constants)
  }

  /// Loads Resources/Textures/{atlas,detail,lace}.rgba through the catalog (sha256-verified).
  public static func load(catalog: DataCatalog, look: LookData) throws -> Look {
    func tex(_ name: String) throws -> LookTexture {
      guard let info = look.textures[name] else { throw DataCatalogError("look.json: no texture \(name)") }
      return try LookTextures.load(info, catalog: catalog)
    }
    let atlas = try tex("atlas")
    let detail = try tex("detail")
    let lace = try tex("lace")
    return Look(atlas: atlas, detail: detail, lace: lace, detailMaxSlope: nil, seed: look.constants.lookSeed, constants: look.constants)
  }

  // ---- updates (weather calls setWind/setFronts every frame; main.js calls setTime) ------------------
  public func setTime(_ t: Double) { time = t }

  /// setWind(windVec2, dt): uWind = wind; uWindOffset += wind * dt
  public func setWind(_ w: V2, _ dt: Double) {
    wind = w
    windOffset.addScaled(w, dt)
  }

  /// setFronts(fronts): slots 0…3; a slot is active when `strength > 0`.
  public func setFronts(_ list: [GustFront]) {
    fronts.removeAll(keepingCapacity: true)
    for i in 0..<4 {
      if i < list.count, list[i].strength > 0 {
        let f = list[i]
        let w = JSNumber.or(f.width, constants.frontWidth)
        let l = JSNumber.or(f.length, constants.frontLength)
        gustFrontsA[i] = SIMD4<Double>(f.x, f.z, f.dirX, f.dirZ)
        gustFrontsB[i] = SIMD4<Double>(f.strength, w, l, 0)
        fronts.append(Front(x: f.x, z: f.z, dx: f.dirX, dz: f.dirZ, s: f.strength, w: w, l: l))
      } else {
        gustFrontsB[i].x = 0
      }
    }
  }

  public func setResolution(_ w: Double, _ h: Double) { resolution.set(w, h) }

  // ---- CPU mirrors of the GLSL functions --------------------------------------------------------------
  /// sampleAtlas(u, v, ch = 0); u, v in tile units (wraps).
  @inline(__always) public func sampleAtlas(_ u: Double, _ v: Double, _ ch: Int = 0) -> Double { atlas.sample(u, v, ch) }
  @inline(__always) public func sampleLace(_ u: Double, _ v: Double, _ ch: Int = 0) -> Double { lace.sample(u, v, ch) }
  @inline(__always) public func sampleDetail(_ u: Double, _ v: Double, _ ch: Int = 2) -> Double { detail.sample(u, v, ch) }

  /// Gust intensity 0…1 at world (x, z).
  public func gustField(_ x: Double, _ z: Double) -> Double {
    let o = windOffset
    let r = sampleAtlas((x - o.x * constants.gustDrift) * constants.gustScale, (z - o.y * constants.gustDrift) * constants.gustScale, 0)
    return MathUtil.smoothLook(0.45, 0.8, r)
  }

  /// Extra wind speed (m/s) from the moving gust fronts at world (x, z).
  public func frontsAt(_ x: Double, _ z: Double) -> Double {
    var s = 0.0
    for f in fronts {
      let rx = x - f.x
      let rz = z - f.z
      let along = rx * f.dx + rz * f.dz
      let lat = -rx * f.dz + rz * f.dx
      if JS.abs(along) >= 0.5 * f.w { continue }
      let band = JS.pow(JS.sin(JS.PI * (along / f.w + 0.5)), 2)
      let taper = JS.exp(-2 * JS.pow(lat / (0.5 * f.l), 2))
      s += band * taper * f.s
    }
    return s
  }

  /// Cloud cover 0…1 at world (x, z) (two scales + domain warp).
  public func cloudAt(_ x: Double, _ z: Double) -> Double {
    let o = windOffset
    var u = (x - o.x * constants.cloudDrift) * constants.cloudScale + 0.37
    var v = (z - o.y * constants.cloudDrift) * constants.cloudScale + 0.61
    let wx = sampleAtlas(u * 0.53 + 0.11, v * 0.53 + 0.29, 0) - 0.5
    let wz = sampleAtlas(u * 0.53 + 0.47, v * 0.53 + 0.83, 0) - 0.5
    u += wx * 0.18
    v += wz * 0.18
    let r = 0.65 * sampleAtlas(u, v, 0) + 0.35 * sampleAtlas(u * 2.31 + 0.23, v * 2.31 + 0.71, 0)
    return MathUtil.smoothLook(0.44, 0.66, r)
  }
}
