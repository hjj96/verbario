// fx/lightpool.js — pooled PointLights (CONTRACT light budget: fx owns exactly 4, created once; DESIGN
// §2.7.1 «пул fx ×4»: flares 800–1400 cd with 12–18 Hz flicker, lightning ground glow, fire).
//
// Callers get VIRTUAL handles — any number of them. Every frame the 4 physical lights are assigned to the
// handles that matter most (intensity × proximity to the camera focus) with hysteresis, so a fifth flare
// never steals a light mid-flicker and nothing ever adds / removes a light (no PSO variants). The physical
// lights feed `point[2..5]` of the renderer's LightsUniforms and the FX air uniforms (uFxLightPos / Col).

public final class LightHandle {
  public var position = V3()
  public internal(set) var color = Color3(1, 1, 1)
  public internal(set) var intensity: Double = 0
  public internal(set) var distance: Double = 60
  public internal(set) var decay: Double = 2
  public internal(set) var alive = false
  /// physical light index or −1
  public internal(set) var slot = -1
  var score: Double = 0
  weak var pool: LightPool?

  init(pool: LightPool) { self.pool = pool }

  @discardableResult
  public func set(_ i: Double) -> LightHandle {
    intensity = i.isFinite ? JS.max(0, i) : 0
    return self
  }

  @discardableResult
  public func setColor(_ c: Color3) -> LightHandle {
    color = c
    return self
  }

  @discardableResult
  public func setDistance(_ d: Double) -> LightHandle {
    if d.isFinite && d > 0 { distance = d }
    return self
  }

  public func release() {
    if !alive { return }
    alive = false
    intensity = 0
    pool?.free(self)
  }

  public var active: Bool { alive && slot >= 0 }
}

/// One of the 4 physical PointLights as the renderer draws it.
public struct PhysicalLight: Equatable, Sendable {
  public var position = V3(0, -1000, 0)
  public var color = Color3(1, 1, 1)
  public var intensity: Double = 0
  public var distance: Double = 60
  public var decay: Double = 2
}

public final class LightPool {
  public let physical: Int
  let hysteresis: Double
  public private(set) var lights: [PhysicalLight]
  var owner: [LightHandle?]
  /// live handles
  public private(set) var handles: [LightHandle] = []
  /// recycled handle objects
  var spare: [LightHandle] = []

  public init(physical: Int, hysteresis: Double) {
    self.physical = physical
    self.hysteresis = hysteresis
    lights = [PhysicalLight](repeating: PhysicalLight(), count: physical)
    owner = [LightHandle?](repeating: nil, count: physical)
  }

  public func acquire(_ color: Color3, _ intensity: Double = 0, _ distance: Double = 60) -> LightHandle {
    let h = spare.popLast() ?? LightHandle(pool: self)
    h.alive = true
    h.slot = -1
    h.position = V3(0, 0, 0)
    h.color = color
    h.intensity = intensity.isFinite ? JS.max(0, intensity) : 0
    h.distance = distance.isFinite && distance > 0 ? distance : 60
    handles.append(h)
    return h
  }

  func free(_ h: LightHandle) {
    if let i = handles.firstIndex(where: { $0 === h }) { handles.remove(at: i) }
    if h.slot >= 0 {
      owner[h.slot] = nil
      lights[h.slot].intensity = 0
      h.slot = -1
    }
    if spare.count < 32 { spare.append(h) }
  }

  public func releaseAll() {
    var i = handles.count - 1
    while i >= 0 {
      handles[i].release()
      i -= 1
    }
  }

  /// focusX / Z: camera ground focus. Fills the physical lights and the air uniforms' light block.
  public func update(_ focusX: Double, _ focusZ: Double, _ air: inout FxAirUniforms) {
    let hs = handles
    for h in hs {
      let dx = h.position.x - focusX
      let dz = h.position.z - focusZ
      let d = (dx * dx + dz * dz).squareRoot()
      let reach = JS.max(20, h.distance)
      h.score = h.intensity > 0 ? h.intensity / (1 + JS.pow(JS.max(0, d - 0.5 * reach) / reach, 2)) : 0
      if h.slot >= 0 { h.score *= hysteresis } // incumbents keep their light unless clearly beaten
    }
    // candidates sorted by score (few handles: insertion sort, descending, stable)
    var c = [LightHandle]()
    for h in hs {
      if h.score <= 0 { continue }
      var i = c.count
      c.append(h)
      while i > 0 && c[i - 1].score < h.score {
        c[i] = c[i - 1]
        i -= 1
      }
      c[i] = h
    }
    // winners keep / receive a slot; losers drop theirs
    for (k, h) in c.enumerated() where k >= physical && h.slot >= 0 {
      owner[h.slot] = nil
      h.slot = -1
    }
    for h in hs where h.score <= 0 && h.slot >= 0 {
      owner[h.slot] = nil
      h.slot = -1
    }
    for k in 0..<min(physical, c.count) {
      let h = c[k]
      if h.slot >= 0 { continue }
      guard let free = owner.firstIndex(where: { $0 == nil }) else { break }
      owner[free] = h
      h.slot = free
    }
    // push state to the physical lights and the shared air uniforms
    for i in 0..<physical {
      if let h = owner[i], h.alive && h.intensity > 0 {
        lights[i].position = h.position
        lights[i].color = h.color
        lights[i].intensity = h.intensity
        lights[i].distance = h.distance
        lights[i].decay = h.decay
        air.fxLightPos[i] = V4(h.position.x, h.position.y, h.position.z, h.intensity)
        air.fxLightCol[i] = V4(h.color.r, h.color.g, h.color.b, h.distance)
      } else {
        lights[i].intensity = 0
        air.fxLightPos[i].w = 0
      }
    }
  }
}
