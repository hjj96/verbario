// world/contact.js Collars: the water contact of everything that floats (DESIGN §2.7.2 [MUST]) — a soft
// foam collar and a dark contact disc, oriented to the local wave normal, brightening in the heli
// searchlight. One instanced list for the whole world, rebuilt every frame between begin() and end():
// per instance the Float32 matrix (unit disc in XZ scaled 1.6·R, elongated along local +z) and
// iData = (foam, dark, lit, phase). Drawn by Shaders/Water/Collars.metal (world_collar_fs).

public final class CollarList {
  public let max: Int
  public private(set) var n = 0
  /// 16 Float32 per instance (column-major)
  public private(set) var matrices: [Float]
  /// iData: foam, dark (−1 = a wake streak without the disc), lit, phase
  public private(set) var data: [Float]

  public init(max: Int = 320) {
    self.max = max
    matrices = [Float](repeating: 0, count: max * 16)
    data = [Float](repeating: 0, count: max * 4)
  }

  public func begin() { n = 0 }

  /// push(x, y, z, nx, ny, nz, R, foam, dark, lit, phase, yaw = 0, elong = 1): (x, y, z) the waterline
  /// centre, n the wave normal, R the object radius.
  public func push(_ x: Double, _ y: Double, _ z: Double, _ nx: Double, _ ny: Double, _ nz: Double, _ R: Double, _ foam: Double,
                   _ dark: Double, _ lit: Double, _ phase: Double, yaw: Double = 0, elong: Double = 1) {
    if n >= max { return }
    let up = V3(0, 1, 0)
    var q = Quat()
    q.setFromUnitVectors(up, V3(nx, ny, nz).normalized())
    if JSNumber.isTruthy(yaw) {
      var qy = Quat()
      qy.setFromAxisAngle(up, yaw)
      q.multiply(qy)
    }
    let r = 1.6 * R
    var m = Mat4()
    m.compose(V3(x, y + 0.06, z), q, V3(r, 1, r * elong))
    m.storeFloat32(into: &matrices, at: n * 16)
    let j = n * 4
    data[j] = Float(foam)
    data[j + 1] = Float(dark)
    data[j + 2] = Float(lit)
    data[j + 3] = Float(phase)
    n += 1
  }

  /// pushWake(x, y, z, R, vx, vz, foam = 0.8, phase = 0): a trailing froth streak R·(0.4 + 0.95·len)
  /// downstream along the drift (vx, vz) m/s; nothing below 0.15 m/s.
  public func pushWake(_ x: Double, _ y: Double, _ z: Double, _ R: Double, _ vx: Double, _ vz: Double, foam: Double = 0.8, phase: Double = 0) {
    let sp = JS.hypot(vx, vz)
    if sp < 0.15 { return }
    let k = JS.min(1, (sp - 0.15) / 1.2)
    let len = 1.6 + 2.6 * k
    let ux = vx / sp, uz = vz / sp
    let off = R * (0.4 + len * 0.95) // the froth starts at the object's downstream edge
    // local +z of the instance → downstream (yaw about +Y maps +z to (sin yaw, cos yaw))
    push(x + ux * off, y - 0.01, z + uz * off, 0, 1, 0, R * 0.85, foam * (0.45 + 0.55 * k), -1, 0, phase + 0.5, yaw: JS.atan2(ux, uz), elong: len)
  }

  /// end(): mesh.count = n (the arrays above are the upload).
  public func end() {}
}
