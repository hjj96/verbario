// fx/particles.js ParticlePool — GPU particle pools (DESIGN §2.13, §2.9 damage smoke, §2.10 signals).
//
// A pool is ONE instanced draw call. The CPU only writes a particle once, at birth (a ring buffer with
// partial uploads); the vertex shader integrates everything analytically (Shaders/FX/Particles.metal):
//   p(t) = p0 + vT·t + (v0 − vT)·(1 − e^{−kt})/k,  vT = w + (0, accY/k, 0)
// plus swirl in the rotor downwash, turbulence, size / colour / alpha over life and velocity stretch.
// Kinds: 'spray' (alpha droplet puffs), 'smoke' (alpha eroding puffs), 'glow' (additive sparks, embers,
// bioluminescent sparkles). The six vec4 attributes are kept here exactly as the web's Float32Arrays:
//   iA p0.xyz, birth time · iB v0.xyz, life · iC size0, size1, rotation, spin · iD colour rgb, alpha
//   iE drag k, accY, windFollow, flags · iF end colour rgb, emissive
// Every slot starts dead (life 0). `uploadRange` is the dirty span the renderer has not uploaded yet.

public final class ParticlePool {
  public let name: String
  /// 'spray' | 'smoke' | 'glow'
  public let kind: String
  /// buffer size (high quality)
  public let max: Int
  /// live slots: geometry.instanceCount (the quality budget)
  public private(set) var capacity: Int
  public private(set) var head = 0
  public private(set) var emitted = 0
  public private(set) var iA: [Float]
  public private(set) var iB: [Float]
  public private(set) var iC: [Float]
  public private(set) var iD: [Float]
  public private(set) var iE: [Float]
  public private(set) var iF: [Float]
  var dirtyLo = Int.max
  var dirtyHi = -1
  /// slots written since the renderer's last upload (inclusive), merged across flushes
  public private(set) var uploadRange: ClosedRange<Int>?
  let random: () -> Double

  /// mesh.renderOrder
  public var renderOrder: Int { kind == "glow" ? 23 : 21 }

  public init(name: String, kind: String, maxCapacity: Int, random: @escaping () -> Double) {
    self.name = name
    self.kind = kind
    max = maxCapacity
    capacity = maxCapacity
    self.random = random
    iA = [Float](repeating: 0, count: maxCapacity * 4)
    iB = [Float](repeating: 0, count: maxCapacity * 4)
    iC = [Float](repeating: 0, count: maxCapacity * 4)
    iD = [Float](repeating: 0, count: maxCapacity * 4)
    iE = [Float](repeating: 0, count: maxCapacity * 4)
    iF = [Float](repeating: 0, count: maxCapacity * 4)
  }

  /// setCapacity(n): max(16, min(max, n|0)); a change kills everything (life 0, full upload once).
  public func setCapacity(_ n0: Int) {
    let n = Swift.max(16, Swift.min(max, n0))
    if n == capacity { return }
    capacity = n
    head = 0
    for i in 0..<(max * 4) { iB[i] = 0 }
    dirtyLo = 0
    dirtyHi = max - 1
  }

  /// emit(t, x, y, z, vx, vy, vz, life, size0, size1, col, alpha, col2, preset, rot = Math.random() · 6.283):
  /// write one particle. col / col2 linear (may be HDR); `rot` nil draws it, then the spin draw follows.
  public func emit(_ t: Double, _ x: Double, _ y: Double, _ z: Double, _ vx: Double, _ vy: Double, _ vz: Double, _ life: Double, _ size0: Double,
                   _ size1: Double, _ col: Color3, _ alpha: Double, _ col2: Color3?, _ preset: ParticlePreset, rot: Double? = nil) {
    let r = rot ?? random() * 6.283
    let i = head
    head = (i + 1) % capacity
    let o = i * 4
    iA[o] = Float(x); iA[o + 1] = Float(y); iA[o + 2] = Float(z); iA[o + 3] = Float(t)
    iB[o] = Float(vx); iB[o + 1] = Float(vy); iB[o + 2] = Float(vz); iB[o + 3] = Float(life)
    iC[o] = Float(size0); iC[o + 1] = Float(size1); iC[o + 2] = Float(r)
    iC[o + 3] = Float(JSNumber.or(preset.spin, 0) * (random() * 2 - 1))
    iD[o] = Float(col.r); iD[o + 1] = Float(col.g); iD[o + 2] = Float(col.b); iD[o + 3] = Float(alpha)
    iE[o] = Float(preset.drag); iE[o + 1] = Float(preset.accY); iE[o + 2] = Float(preset.wind); iE[o + 3] = Float(JSNumber.or(preset.flags, 0))
    let c2 = col2 ?? col
    iF[o] = Float(c2.r); iF[o + 1] = Float(c2.g); iF[o + 2] = Float(c2.b); iF[o + 3] = Float(JSNumber.or(preset.emissive, 0))
    if i < dirtyLo { dirtyLo = i }
    if i > dirtyHi { dirtyHi = i }
    emitted += 1
  }

  /// flush(): hand the slots written since the last flush to the upload range (one contiguous span; a
  /// wrap-around marks the whole span), merged with whatever the renderer has not uploaded yet.
  public func flush() {
    if dirtyHi < 0 { return }
    var lo = dirtyLo
    var hi = dirtyHi
    if let p = uploadRange {
      lo = Swift.min(lo, p.lowerBound)
      hi = Swift.max(hi, p.upperBound)
    }
    uploadRange = lo...hi
    dirtyLo = Int.max
    dirtyHi = -1
  }

  /// The renderer uploaded `uploadRange`.
  public func uploaded() { uploadRange = nil }
}
