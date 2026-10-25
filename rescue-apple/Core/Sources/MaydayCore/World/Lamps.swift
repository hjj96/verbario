// world/lamps.js Lamps: every navigation light, floodlight, perimeter light, lantern and buoy flash of
// the world as ONE instanced list (bulb core + soft halo, drawn additively by Shaders/World/Lamp.metal).
// Per lamp, exactly the web's instance attributes (Float32Array):
//   iPos (xyz world), iCol (linear rgb, gain), iSz (bulb m, halo m, channel, fog penetration)
// Lamps parented to a moving place (the ship, M5) keep a local position; `refresh(parentMatrix:)`
// rewrites their world position each frame. Brightness comes from the channel values (World.channels).

public final class LampRegistry {
  public let max: Int
  public private(set) var count = 0
  public private(set) var iPos: [Float]
  public private(set) var iCol: [Float]
  public private(set) var iSz: [Float]
  /// local positions (= world for unparented lamps)
  public private(set) var local: [Float]
  /// parent id per lamp (nil = world space); `dynamic` lists the parented ones
  public private(set) var parents: [Int?] = []
  public private(set) var dynamic: [Int] = []

  public init(max: Int = 768) {
    self.max = max
    iPos = [Float](repeating: 0, count: max * 3)
    iCol = [Float](repeating: 0, count: max * 4)
    iSz = [Float](repeating: 0, count: max * 4)
    local = [Float](repeating: 0, count: max * 3)
  }

  public func clear() {
    count = 0
    parents.removeAll(keepingCapacity: true)
    dynamic.removeAll(keepingCapacity: true)
  }

  /// add(x, y, z, color, {gain = 4, bulb = 0.22, halo = 2.2, ch = 0, pen = 0.15, parent}) → index (−1 when full).
  /// `color` is a CSS hex string (THREE.Color.set: sRGB → linear).
  @discardableResult
  public func add(_ x: Double, _ y: Double, _ z: Double, _ color: String, gain: Double = 4, bulb: Double = 0.22, halo: Double = 2.2,
                  ch: Double = 0, pen: Double = 0.15, parent: Int? = nil) -> Int {
    if count >= max { return -1 }
    let i = count
    count += 1
    local[i * 3] = Float(x)
    local[i * 3 + 1] = Float(y)
    local[i * 3 + 2] = Float(z)
    parents.append(parent)
    if parent != nil { dynamic.append(i) }
    iPos[i * 3] = Float(x)
    iPos[i * 3 + 1] = Float(y)
    iPos[i * 3 + 2] = Float(z)
    let c = Color3(style: color)
    iCol[i * 4] = Float(c.r)
    iCol[i * 4 + 1] = Float(c.g)
    iCol[i * 4 + 2] = Float(c.b)
    iCol[i * 4 + 3] = Float(gain)
    iSz[i * 4] = Float(bulb)
    iSz[i * 4 + 1] = Float(halo)
    iSz[i * 4 + 2] = Float(ch)
    iSz[i * 4 + 3] = Float(pen)
    return i
  }

  /// setLocal(i, x, y, z): move a lamp (local to its parent; world for unparented lamps).
  public func setLocal(_ i: Int, _ x: Double, _ y: Double, _ z: Double) {
    if i < 0 || i >= count { return }
    local[i * 3] = Float(x)
    local[i * 3 + 1] = Float(y)
    local[i * 3 + 2] = Float(z)
    if parents[i] == nil {
      iPos[i * 3] = Float(x)
      iPos[i * 3 + 1] = Float(y)
      iPos[i * 3 + 2] = Float(z)
    }
  }

  public func setGain(_ i: Int, _ gain: Double) {
    if i < 0 || i >= count { return }
    iCol[i * 4 + 3] = Float(gain)
  }

  /// iSz.z = channel (Lighthouse.setUnloadChannel: the pad's blue offload channel).
  public func setChannel(_ i: Int, _ ch: Double) {
    if i < 0 || i >= count { return }
    iSz[i * 4 + 2] = Float(ch)
  }

  /// update(): refresh the world positions of the lamps parented to `parent` (its matrixWorld).
  public func refresh(parent: Int, matrixWorld m: Mat4) {
    for i in dynamic where parents[i] == parent {
      var v = V3(Double(local[i * 3]), Double(local[i * 3 + 1]), Double(local[i * 3 + 2]))
      v.applyMatrix4(m)
      iPos[i * 3] = Float(v.x)
      iPos[i * 3 + 1] = Float(v.y)
      iPos[i * 3 + 2] = Float(v.z)
    }
  }
}
