// world/rigging.js: the small animated bits of the world as ONE instanced list of tapered sticks
// (radius 1 → 0.86, height 1 along +Y from the base; drawn on the prop pipeline): windsock segments
// (catalogue #31), and in M5 the «Арктур» signalman's arms / wands and the radar bar. Per instance the
// Float32 matrix and the Float32 instance colour (linear; > 1 glows), rebuilt between begin() and end().

public final class RiggingList {
  public let max: Int
  public private(set) var n = 0
  public private(set) var matrices: [Float]
  public private(set) var colors: [Float]

  public init(max: Int = 96) {
    self.max = max
    matrices = [Float](repeating: 0, count: max * 16)
    colors = [Float](repeating: 0, count: max * 3)
    // mesh.setColorAt(0, white) at construction
    colors[0] = 1
    colors[1] = 1
    colors[2] = 1
  }

  public func begin() { n = 0 }

  /// push(ax, ay, az, dir, len, r, color): a stick from world point a along unit direction dir.
  public func push(_ ax: Double, _ ay: Double, _ az: Double, _ dir: V3, _ len: Double, _ r: Double, _ color: Color3) {
    if n >= max { return }
    var q = Quat()
    q.setFromUnitVectors(V3(0, 1, 0), dir)
    var m = Mat4()
    m.compose(V3(ax, ay, az), q, V3(r, len, r))
    m.storeFloat32(into: &matrices, at: n * 16)
    colors[n * 3] = Float(color.r)
    colors[n * 3 + 1] = Float(color.g)
    colors[n * 3 + 2] = Float(color.b)
    n += 1
  }

  public func end() {}
}

/// rigging.js Windsock: a fabric cone of 4 tapered sag segments in weathered orange / off-white. Fully
/// streams at ~8 m/s with a slight tail sag, bellies and droops progressively in lighter air, hangs limp in
/// a calm; the cloth breathes and the tail flutters harder, faster with the wind (×1.5 for the top-down camera).
public struct Windsock: Sendable {
  public var phase: Double
  /// smoothed extension 0…1
  public var ext: Double = 0.5
  /// smoothed horizontal direction (towards)
  public var dir = V2(1, 0)
  let T: WindsockTables

  public init(seed: Double = 0, tables: WindsockTables) {
    phase = seed * 1.37
    T = tables
  }

  /// update(rig, hoop, wx, wz, t, dt): hoop = world position of the sock mouth, (wx, wz) the wind (towards).
  public mutating func update(_ rig: RiggingList, hoop: V3, _ wx: Double, _ wz: Double, t: Double, dt: Double) {
    let speed = JS.hypot(wx, wz)
    let ext = MathUtil.smoothstepThree(speed, 0.6, 8.5)
    let k = dt > 0 ? 1 - JS.exp(-dt * 2.2) : 0
    self.ext += (ext - self.ext) * k
    if speed > 0.15 && dt > 0 {
      let tx = wx / speed, tz = wz / speed
      let kk = 1 - JS.exp(-dt * 1.6)
      dir.x += (tx - dir.x) * kk
      dir.y += (tz - dir.y) * kk
      let l = JSNumber.or(JS.hypot(dir.x, dir.y), 1)
      dir.x /= l
      dir.y /= l
    }
    let e = self.ext
    let h = V3(dir.x, 0, dir.y)
    let side = V3(-dir.y, 0, dir.x)
    var a = hoop
    let SEGS = T.segs
    let segLen = T.sockLen / Double(SEGS)
    let fq = 2.2 + 0.35 * speed
    for i in 0..<SEGS {
      let fi = Double(i)
      let f = fi / Double(SEGS - 1)
      // droop below the horizontal: a limp sock hangs (≈80°); in moderate air the cloth sags more with
      // every segment (a curve, not a stiff cone); a full sock sags a few degrees at the tail
      let mid = e * (1 - e) * 4
      var droop = (1 - e) * (1.2 + 0.14 * fi) + e * (0.05 + 0.04 * fi * fi) + mid * 0.22 * fi
      let flAmp = (0.03 + 0.11 * f) * (0.25 + 0.75 * e) * (0.5 + 0.5 * JS.min(1, speed / 14))
      droop += flAmp * JS.sin(t * fq * 1.3 + phase + fi * 0.9)
      let yaw = flAmp * 1.4 * JS.sin(t * fq + phase * 2.1 + fi * 0.7)
      let cd = JS.cos(droop)
      var seg = h
      seg.multiplyScalar(cd * JS.cos(yaw))
      seg.addScaledVector(side, cd * JS.sin(yaw))
      seg.y = -JS.sin(JS.min(1.5, droop))
      seg.normalize()
      let breathe = 1 + (0.05 + 0.05 * f) * e * JS.sin(t * fq * 2.1 + phase + fi * 1.7)
      let r = T.r0 * (1 - 0.17 * fi) * (0.62 + 0.38 * e) * breathe
      rig.push(a.x, a.y, a.z, seg, segLen * 1.04, r, i % 2 == 1 ? T.white : T.orange)
      a.addScaledVector(seg, segLen)
    }
  }
}
