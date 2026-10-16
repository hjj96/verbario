// The look layer's procedural noise textures (core/look.js makeAtlas / makeDetail / makeLace) and the
// CPU bilinear sampler (sampleBuf) that gustField/cloudAt read.
//
// The apps load the exported bytes (Resources/Textures/*.rgba, sha256 in manifest.json / look.json);
// the generators are ported too so the parity tests can prove the bytes and so the textures can be
// rebuilt without the web exporter. Bit-exact with Node 22 (sha256 in Tests/Vectors/look/fields.json).

/// A square RGBA8 texture as the web keeps it (Uint8Array, row-major, 4 bytes per texel, row 0 = v 0).
public struct LookTexture: Equatable, Sendable {
  public let size: Int
  public var data: [UInt8]

  public init(size: Int, data: [UInt8]) {
    self.size = size
    self.data = data
  }

  /// look.js sampleBuf(data, size, u, v, ch): bilinear, wrapping, texel centres at (i + 0.5) / size; 0…1.
  @inline(__always) public func sample(_ u: Double, _ v: Double, _ ch: Int) -> Double {
    let x = u * Double(size) - 0.5
    let y = v * Double(size) - 0.5
    let xi = x.rounded(.down)
    let yi = y.rounded(.down)
    let fx = x - xi
    let fy = y - yi
    let m = Int32(size - 1)
    let ix = JSNumber.toInt32(xi), iy = JSNumber.toInt32(yi)
    let x0 = Int(ix & m), x1 = Int((ix &+ 1) & m), y0 = Int(iy & m), y1 = Int((iy &+ 1) & m)
    let a = Double(data[(y0 * size + x0) * 4 + ch])
    let b = Double(data[(y0 * size + x1) * 4 + ch])
    let c = Double(data[(y1 * size + x0) * 4 + ch])
    let d = Double(data[(y1 * size + x1) * 4 + ch])
    return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) / 255
  }

  public var sha256: String { SHA256.hex(data) }
}

public enum LookTextures {
  // ---- deterministic hash / noise helpers (look.js) -------------------------------------------------

  /// hash2i(x, y, seed) → [0, 1). x, y, seed are small integers (exact in double, like the JS).
  @inline(__always) static func hash2i(_ x: Int, _ y: Int, _ seed: Int) -> Double {
    // (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
    let sum = Int64(x) &* 374_761_393 &+ Int64(y) &* 668_265_263 &+ Int64(seed) &* 2_147_483_647
    var h = UInt32(truncatingIfNeeded: sum)
    // h = Math.imul(h ^ (h >>> 13), 1274126177)
    h = (h ^ (h >> 13)) &* 1_274_126_177
    // h ^= h >>> 16
    h ^= h >> 16
    return Double(h) / 4294967296.0
  }

  @inline(__always) static func wrap(_ a: Int, _ period: Int) -> Int { ((a % period) + period) % period }

  /// periodicValueNoise(u, v, period, seed)
  static func periodicValueNoise(_ u: Double, _ v: Double, _ period: Int, _ seed: Int) -> Double {
    let p = Double(period)
    let x = u * p
    let y = v * p
    let xf = x.rounded(.down)
    let yf = y.rounded(.down)
    let fx = x - xf
    let fy = y - yf
    let sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    let sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    let xi = Int(xf), yi = Int(yf)
    let a = hash2i(wrap(xi, period), wrap(yi, period), seed)
    let b = hash2i(wrap(xi + 1, period), wrap(yi, period), seed)
    let c = hash2i(wrap(xi, period), wrap(yi + 1, period), seed)
    let d = hash2i(wrap(xi + 1, period), wrap(yi + 1, period), seed)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }

  /// periodicGradNoise(u, v, period, seed): Perlin gradient noise on a periodic lattice.
  static func periodicGradNoise(_ u: Double, _ v: Double, _ period: Int, _ seed: Int) -> Double {
    let p = Double(period)
    let x = u * p
    let y = v * p
    let xf = x.rounded(.down)
    let yf = y.rounded(.down)
    let fx = x - xf
    let fy = y - yf
    let sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    let sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    let xi = Int(xf), yi = Int(yf)
    func g(_ ix: Int, _ iy: Int, _ dx: Double, _ dy: Double) -> Double {
      let a = hash2i(wrap(ix, period), wrap(iy, period), seed) * JS.PI * 2
      return JS.cos(a) * dx + JS.sin(a) * dy
    }
    let a = g(xi, yi, fx, fy)
    let b = g(xi + 1, yi, fx - 1, fy)
    let c = g(xi, yi + 1, fx, fy - 1)
    let d = g(xi + 1, yi + 1, fx - 1, fy - 1)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }

  static func periodicGradFbm(_ u: Double, _ v: Double, _ basePeriod: Int, _ octaves: Int, _ seed: Int) -> Double {
    var sum = 0.0, amp = 0.5, norm = 0.0
    var p = basePeriod
    for o in 0..<octaves {
      sum += amp * periodicGradNoise(u, v, p, seed + o * 17)
      norm += amp
      amp *= 0.5
      p *= 2
    }
    return sum / norm
  }

  static func periodicFbm(_ u: Double, _ v: Double, _ basePeriod: Int, _ octaves: Int, _ seed: Int) -> Double {
    var sum = 0.0, amp = 0.5, norm = 0.0
    var p = basePeriod
    for o in 0..<octaves {
      sum += amp * periodicValueNoise(u, v, p, seed + o * 17)
      norm += amp
      amp *= 0.5
      p *= 2
    }
    return sum / norm
  }

  /// Tileable Worley: (F1, F2) in cell units.
  static func worley(_ u: Double, _ v: Double, _ cells: Int, _ seed: Int) -> (Double, Double) {
    let n = Double(cells)
    let x = u * n
    let y = v * n
    let xi = Int(x.rounded(.down))
    let yi = Int(y.rounded(.down))
    var f1 = 9.0, f2 = 9.0
    for j in -1...1 {
      for i in -1...1 {
        let cx = xi + i
        let cy = yi + j
        let wx = wrap(cx, cells)
        let wy = wrap(cy, cells)
        let px = Double(cx) + hash2i(wx, wy, seed)
        let py = Double(cy) + hash2i(wx, wy, seed + 101)
        let dx = px - x
        let dy = py - y
        let d = (dx * dx + dy * dy).squareRoot()
        if d < f1 {
          f2 = f1
          f1 = d
        } else if d < f2 {
          f2 = d
        }
      }
    }
    return (f1, f2)
  }

  @inline(__always) static func byte(_ x: Double) -> UInt8 { JSNumber.toUint8(JSNumber.round(x)) }

  // ---- generators -------------------------------------------------------------------------------------

  /// makeAtlas(seed): R = gradient fbm histogram-matched to value fbm, G = Worley F1, B = F2 − F1, A = hash.
  public static func makeAtlas(seed: Int, size: Int = 256) -> LookTexture {
    let S = size
    let n = S * S
    var ref = [Float](repeating: 0, count: n)
    var grad = [Float](repeating: 0, count: n)
    for y in 0..<S {
      for x in 0..<S {
        let u = Double(x) / Double(S)
        let v = Double(y) / Double(S)
        ref[y * S + x] = Float(JS.min(1, JS.max(0, (periodicFbm(u, v, 4, 4, seed) - 0.15) / 0.7)))
        grad[y * S + x] = Float(periodicGradFbm(u, v, 4, 5, seed + 3))
      }
    }
    // order.sort((a, b) => grad[a] - grad[b]) — V8's sort is stable: ties keep index order.
    var order = Array(0..<n)
    order.sort { a, b in
      let ga = grad[a], gb = grad[b]
      if ga != gb { return ga < gb }
      return a < b
    }
    // ref.sort(): Float32Array numeric ascending (no NaN / -0 can occur here: ref = max(0, …)).
    ref.sort()
    var rch = [Float](repeating: 0, count: n)
    for k in 0..<n { rch[order[k]] = ref[k] }
    var data = [UInt8](repeating: 0, count: n * 4)
    for y in 0..<S {
      for x in 0..<S {
        let u = Double(x) / Double(S)
        let v = Double(y) / Double(S)
        let r = Double(rch[y * S + x])
        let w = worley(u, v, 8, seed + 7)
        let i = (y * S + x) * 4
        data[i] = byte(r * 255)
        data[i + 1] = byte(JS.min(1, w.0 / 1.0) * 255)
        data[i + 2] = byte(JS.min(1, (w.1 - w.0) / 0.8) * 255)
        data[i + 3] = byte(hash2i(x, y, seed + 99) * 255)
      }
    }
    return LookTexture(size: S, data: data)
  }

  /// makeDetail(seed): tileable sum of 30 sines. R,G = slopes / maxSlope (0.5 = flat), B = height, A = 255.
  public static func makeDetail(seed: Double, size: Int = 256) -> (texture: LookTexture, maxSlope: Double) {
    struct Wave {
      var kx: Double
      var ky: Double
      var a: Double
      var ph: Double
    }
    var waves = [Wave]()
    var lcg = JSLCG.numerical(seed: seed)
    while waves.count < 30 {
      let ang = (lcg.next() - 0.5) * 2 * (JS.PI / 2) * (1.0 / 4) * 2
      let mag = 2 + (lcg.next() * 22).rounded(.down)
      let kx = JSNumber.round(JS.cos(ang) * mag)
      let ky = JSNumber.round(JS.sin(ang) * mag)
      if kx == 0 && ky == 0 { continue }
      let k = JS.hypot(kx, ky)
      waves.append(Wave(kx: kx, ky: ky, a: JS.pow(k, -1.5), ph: lcg.next() * JS.PI * 2))
    }
    let S = size
    let n = S * S
    var su = [Float](repeating: 0, count: n)
    var sv = [Float](repeating: 0, count: n)
    var hh = [Float](repeating: 0, count: n)
    var maxS = 1e-6, minH = Double.infinity, maxH = -Double.infinity
    for y in 0..<S {
      for x in 0..<S {
        let u = Double(x) / Double(S)
        let v = Double(y) / Double(S)
        var h = 0.0, du = 0.0, dv = 0.0
        for wv in waves {
          let ph = 2 * JS.PI * (wv.kx * u + wv.ky * v) + wv.ph
          h += wv.a * JS.sin(ph)
          let c = wv.a * 2 * JS.PI * JS.cos(ph)
          du += c * wv.kx
          dv += c * wv.ky
        }
        let i = y * S + x
        su[i] = Float(du)
        sv[i] = Float(dv)
        hh[i] = Float(h)
        maxS = JS.max(maxS, JS.abs(du), JS.abs(dv))
        minH = JS.min(minH, h)
        maxH = JS.max(maxH, h)
      }
    }
    var data = [UInt8](repeating: 0, count: n * 4)
    for i in 0..<n {
      data[i * 4] = byte((Double(su[i]) / maxS * 0.5 + 0.5) * 255)
      data[i * 4 + 1] = byte((Double(sv[i]) / maxS * 0.5 + 0.5) * 255)
      data[i * 4 + 2] = byte(((Double(hh[i]) - minH) / (maxH - minH)) * 255)
      data[i * 4 + 3] = 255
    }
    return (LookTexture(size: S, data: data), maxS)
  }

  /// makeLace(seed): R = 3-octave Worley lace with fbm holes, G = blotches, B = fine lace, A = 255.
  public static func makeLace(seed: Int, size: Int = 512) -> LookTexture {
    let S = size
    var data = [UInt8](repeating: 0, count: S * S * 4)
    for y in 0..<S {
      for x in 0..<S {
        let u = Double(x) / Double(S)
        let v = Double(y) / Double(S)
        var lace = 0.0, amp = 1.0, norm = 0.0
        for o in 0..<3 {
          let w = worley(u, v, 6 << o, seed + o * 31)
          let edge = 1 - MathUtil.smoothLook(0.0, 0.12 + 0.04 * Double(o), w.1 - w.0)
          lace += edge * amp
          norm += amp
          amp *= 0.6
        }
        lace /= norm
        let holes = MathUtil.smoothLook(0.35, 0.65, periodicFbm(u, v, 4, 3, seed + 5))
        let blot = periodicFbm(u, v, 3, 3, seed + 9)
        let i = (y * S + x) * 4
        data[i] = byte(JS.min(1, lace * (0.35 + 0.65 * holes) * 1.4) * 255)
        data[i + 1] = byte(blot * 255)
        let w = worley(u, v, 24, seed + 77)
        data[i + 2] = byte((1 - MathUtil.smoothLook(0, 0.1, w.1 - w.0)) * 255)
        data[i + 3] = 255
      }
    }
    return LookTexture(size: S, data: data)
  }

  // ---- loading ----------------------------------------------------------------------------------------

  /// Loads an exported raw RGBA8 file (size × size × 4 bytes) through the catalog (sha256 verified).
  public static func load(_ info: LookTextureInfo, catalog: DataCatalog) throws -> LookTexture {
    let bytes = try catalog.bytes(path: info.file, verify: true)
    guard info.width == info.height, bytes.count == info.width * info.height * 4 else {
      throw DataCatalogError("\(info.file): \(bytes.count) bytes for \(info.width)x\(info.height) RGBA8")
    }
    if !info.sha256.isEmpty && SHA256.hex(bytes) != info.sha256 {
      throw DataCatalogError("\(info.file): sha256 differs from look.json")
    }
    return LookTexture(size: info.width, data: bytes)
  }
}
