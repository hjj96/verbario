// "Water memory" — the CPU half of systems/ocean/memory.js WaterMemory (DESIGN §2.6.6): the stamp
// queue (push / clear, ≤ MAX_STAMPS per frame, Float32 instance attributes like the web's
// InstancedBufferAttributes) and the window that follows the camera focus (re-centred by whole texels),
// plus the advect uniforms of each step (shift, centre, per-channel half-life decay, dye diffusion).
// The two ping-pong render targets, the advect pass and the instanced stamp pass are the renderer's
// (MaydayRender WaterMemoryPass); it consumes `frame` after every update().
//
// Channels: R foam (half-life 3 s), G dye (240 s, light diffusion), B disturbance for bioluminescence /
// roughness (0.8 s), A oil (600 s). Double with JS math; Float only where the web writes Float32Arrays.

public final class WaterMemoryQueue {
  /// memory.js SHAPE: stamp kinds understood by the stamp shader (aC.x).
  public enum Shape: String, Sendable {
    case disc, ring, wake
  }

  /// The advect pass uniforms of the last update() (memory.js advect.uniforms).
  public struct Advect: Equatable, Sendable {
    /// (new centre − old centre) / extent (whole texels)
    public var shift = V2()
    /// new centre, world
    public var center = V2()
    public var extent: Double
    public var dt: Double = 0
    /// m/s
    public var windV = V2()
    /// per-channel multiplier for this frame: 0.5^(dt / HALF_LIFE[c])
    public var decay = V4(1, 1, 1, 1)
    public var texel: V2
    /// dye diffusion amount for this frame: min(1, dt · 0.6)
    public var diffuse: Double = 0
  }

  /// The ocean feature uniforms the advect pass reads for its swirl (memory.js spreads the ocean's
  /// uFeatCount / uFeatA / uFeatB / uFeatC / uDownwash into the advect material): their values when
  /// update() runs — inside ocean.update, so uDownwash still holds the previous frame's _lateUpload.
  public struct Flow: Equatable, Sendable {
    public var count = 0
    public var a: [Float] = []
    public var b: [Float] = []
    public var c: [Float] = []
    public var downwash = V4(0, 0, 10, 0)

    public init(count: Int = 0, a: [Float] = [], b: [Float] = [], c: [Float] = [], downwash: V4 = V4(0, 0, 10, 0)) {
      self.count = count
      self.a = a
      self.b = b
      self.c = c
      self.downwash = downwash
    }
  }

  /// What the renderer draws for one update(): clear both targets first (needsClear), advect (with
  /// `flow`), then `count` stamps (aA = x, z, radius, strength; aB = foam, dye, disturbance, oil;
  /// aC = shape, inner, dirX, dirZ — 4 floats each per stamp).
  public struct Frame: Equatable, Sendable {
    /// 1, 2, 3 … per update(): a new value = a step to draw (the web only advances while dt > 0)
    public var serial = 0
    public var clear = false
    public var advect: Advect
    public var flow = Flow()
    public var count = 0
    public var aA: [Float] = []
    public var aB: [Float] = []
    public var aC: [Float] = []
  }

  public let size: Int
  public let extent: Double
  public let texel: Double
  public let maxStamps: Int
  public let halfLife: [Double]
  let shapes: [String: Double]

  /// Window centre (snapped), world x / z — ocean uMemWin.xy.
  public private(set) var center = V2()
  public private(set) var centerInit = false
  /// Stamps queued since the last update (memory.js `count`).
  public private(set) var count = 0
  public private(set) var needsClear = true
  /// Instance attributes (Float32Array(MAX_STAMPS · 4) each, stale beyond `count` like the web's).
  public private(set) var aA: [Float]
  public private(set) var aB: [Float]
  public private(set) var aC: [Float]
  /// advect.uniforms
  public private(set) var advect: Advect
  /// The last update()'s draw (nil before the first).
  public private(set) var frame: Frame?

  /// new WaterMemory(renderer, size, extent, …)
  public init(size: Int, extent: Double, tables: OceanSimTables) {
    self.size = size
    self.extent = extent
    texel = extent / Double(size)
    maxStamps = tables.maxStamps
    halfLife = tables.halfLife
    shapes = tables.stampShape
    aA = [Float](repeating: 0, count: tables.maxStamps * 4)
    aB = aA
    aC = aA
    advect = Advect(extent: extent, texel: V2(1 / Double(size), 1 / Double(size)))
  }

  /// push(shape, x, z, radius, strength, f, d, b, o, inner = 0.7, dirX = 0, dirZ = 1): ignored when the
  /// queue is full or radius / strength are not > 0 (NaN included).
  public func push(_ shape: Shape, _ x: Double, _ z: Double, _ radius: Double, _ strength: Double,
                   _ f: Double, _ d: Double, _ b: Double, _ o: Double, inner: Double = 0.7, dirX: Double = 0, dirZ: Double = 1) {
    if count >= maxStamps || !(radius > 0) || !(strength > 0) { return }
    let j = count * 4
    aA[j] = Float(x)
    aA[j + 1] = Float(z)
    aA[j + 2] = Float(radius)
    aA[j + 3] = Float(strength)
    aB[j] = Float(f)
    aB[j + 1] = Float(d)
    aB[j + 2] = Float(b)
    aB[j + 3] = Float(o)
    aC[j] = Float(shapes[shape.rawValue] ?? 0) // SHAPE[shape] ?? 0
    aC[j + 1] = Float(inner)
    aC[j + 2] = Float(dirX)
    aC[j + 3] = Float(dirZ)
    count += 1
  }

  /// clear(): both targets to zero on the next update, queued stamps dropped.
  public func clear() {
    needsClear = true
    count = 0
  }

  /// update(dt, focusX, focusZ, windX, windZ): re-centre on the focus by whole texels, this step's advect
  /// uniforms, then hand the queued stamps (and the feature flow) to the renderer (`frame`) and empty the queue.
  public func update(_ dt: Double, _ focusX: Double, _ focusZ: Double, _ windX: Double, _ windZ: Double, flow: Flow = Flow()) {
    let clearNow = needsClear
    needsClear = false
    let nx = JS.round(focusX / texel) * texel
    let nz = JS.round(focusZ / texel) * texel
    if !centerInit {
      center = V2(nx, nz)
      centerInit = true
    }
    advect.shift = V2((nx - center.x) / extent, (nz - center.y) / extent)
    advect.center = V2(nx, nz)
    advect.dt = dt
    advect.windV = V2(windX, windZ)
    advect.decay = V4(JS.pow(0.5, dt / halfLife[0]), JS.pow(0.5, dt / halfLife[1]), JS.pow(0.5, dt / halfLife[2]),
                      JS.pow(0.5, dt / halfLife[3]))
    advect.diffuse = JS.min(1, dt * 0.6)
    center = V2(nx, nz)

    var fr = Frame(serial: (frame?.serial ?? 0) + 1, clear: clearNow, advect: advect, flow: flow)
    if count > 0 {
      let n = count * 4
      fr.count = count
      fr.aA = Array(aA[0..<n])
      fr.aB = Array(aB[0..<n])
      fr.aC = Array(aC[0..<n])
      count = 0
    }
    frame = fr
  }
}
