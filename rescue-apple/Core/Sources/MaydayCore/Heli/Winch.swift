// heli/winch.js Winch (DESIGN §2.9, §3.5): hold Space to pay out (4 m/s) to the target surface (water or
// deck) + 1.5 m slack, max 30 m, auto stop; release before capture → reel in at 4 m/s; after capture
// the lift is automatic (3 m/s person, 1.5 m/s stretcher); presses buffer for 0.4 s while the height /
// speed window opens. 14-segment verlet cable (CableVerlet) with wind, game gravity 14 m/s², basket
// drift (0.8·wind_surface − v_b)·0.8, damping 0.15 s⁻¹, never below the surface.
//
// Steadiness S = clamp(1 − 0.12·|v_basket − v_target| − 0.05·|v_heli| − 0.3·[crest ≥ 6 m], 0, 1),
// smoothed 0.3 s. Capture via survivors.nearestFor / attachToBasket / boardOne (CONTRACT).
// Failures: slip («Сорвался!»), snag («ТРОС ЗАХЛЕСТНУЛО»), tension («НАТЯЖЕНИЕ ТРОСА»).
//
// The web's public object `heli.winch` is this class (same object for the whole session). Survivor
// targets are GroupIDs re-read from survivors.group(id) where the web holds the live object. The cable
// lives in Float32Arrays in the web: CableVerlet keeps [Float] and rounds at exactly the JS stores
// (PLAN §2.2), every intermediate stays Double. `render()` produces WinchRenderState for the renderer
// (cable ribbon points, basket / rescuer pose, reach ring) — the meshes themselves are MaydayRender's.

/// A person in the cabin (heli.cabin[i]): the record survivors.boardOne returned, merged over the
/// winch defaults { name: 'Пострадавший', age: 30, condition: 'стабилен' }, plus survivor / stretcher / type.
public struct CabinPerson: Equatable, Sendable {
  /// The survivors' person identity; when boardOne gave none, a heli-local negative serial (−1, −2, …).
  public var id: PersonID
  public var name: String
  /// nil = the person record says `age: null`
  public var age: Double?
  public var condition: String
  public var survivor: GroupID?
  public var stretcher: Bool
  /// s.type of the group the person came from
  public var type: String?

  public init(id: PersonID, name: String = "Пострадавший", age: Double? = 30, condition: String = "стабилен",
              survivor: GroupID? = nil, stretcher: Bool = false, type: String? = nil) {
    self.id = id
    self.name = name
    self.age = age
    self.condition = condition
    self.survivor = survivor
    self.stretcher = stretcher
    self.type = type
  }
}

/// The 14-segment verlet rope (heli/winch.js cur / prev / stepPrev / rend Float32Arrays, xyz per node;
/// node 0 is pinned to the hoist, node N−1 is the basket).
public struct CableVerlet: Equatable, Sendable {
  public static let SEGS = 14
  public static let N = SEGS + 1

  public var cur = [Float](repeating: 0, count: N * 3)
  public var prev = [Float](repeating: 0, count: N * 3)
  /// positions at the start of the last fixed step
  public var stepPrev = [Float](repeating: 0, count: N * 3)

  public init() {}

  /// _pinAll(p): every node (all three buffers) at p.
  public mutating func pinAll(_ p: V3) {
    for i in 0..<CableVerlet.N {
      let k = i * 3
      let x = Float(p.x), y = Float(p.y), z = Float(p.z)
      cur[k] = x
      prev[k] = x
      stepPrev[k] = x
      cur[k + 1] = y
      prev[k + 1] = y
      stepPrev[k + 1] = y
      cur[k + 2] = z
      prev[k + 2] = z
      stepPrev[k + 2] = z
    }
  }

  /// cur[i] as the double JS reads
  @inline(__always) public func c(_ i: Int) -> Double { Double(cur[i]) }
  @inline(__always) func p(_ i: Int) -> Double { Double(prev[i]) }
}

/// What the renderer draws for the winch this frame (Winch.render): cable / basket / rescuer / ring.
public struct WinchRenderState: Equatable, Sendable {
  public static let RING_SEGS = 48

  public var cableVisible = false
  public var basketVisible = false
  public var rescuerVisible = false
  public var ringVisible = false
  /// Interpolated cable points (Float32, xyz × N): [0] pinned to the rendered hoist, [N−1] at the bridle
  /// hook. The ribbon vertex pairs (position, aOther) are built from these by the renderer.
  public var rend = [Float](repeating: 0, count: CableVerlet.N * 3)
  public var basketPosition = V3()
  public var basketQuaternion = Quat()
  public var rescuerPosition = V3()
  public var rescuerQuaternion = Quat()
  /// cable material: uLit and the beam (uBeamPos / uBeamDir / uBeamCos / uBeamI)
  public var cableLit: Double = 1
  public var beamPos = V3()
  public var beamDir = V3(0, -1, 0)
  public var beamCos: Double = 0.97
  public var beamIntensity: Double = 0
  /// reach ring: inner / outer vertex per segment end (Float32, (RING_SEGS + 1) × 2 × xyz)
  public var ringPositions = [Float](repeating: 0, count: (RING_SEGS + 1) * 2 * 3)
  /// the ring's animated visibility 0..1 (winch.ringOpacity; drawn while > 0.01)
  public var ringFade: Double = 0
  /// ring material: uColor, uOpacity, uPhase
  public var ringColor = Color3(style: "#E8E4D8")
  public var ringOpacity: Double = 0
  public var ringPhase: Double = 0
}

public final class Winch {
  public static let SEGS = CableVerlet.SEGS
  static let N = CableVerlet.N
  /// game gravity
  static let G: Double = 14
  static let MAX_LEN: Double = 30
  static let SLACK: Double = 1.5
  static let PAY: Double = 4
  static let LIFT_PERSON: Double = 3
  static let LIFT_STRETCHER: Double = 1.5
  static let BUFFER: Double = 0.4
  static let DAMP: Double = 0.15
  /// m/s ground speed to start lowering
  static let WINDOW_SPEED: Double = 5
  /// hoist height above the surface
  static let WINDOW_HEIGHT: Double = MAX_LEN + SLACK + 4.5
  /// basket centre above the surface when it sits in the water
  static let BASKET_FLOAT: Double = 0.25
  /// bridle hook above the basket centre
  static let HOOK: Double = 1.05
  static let RING_SEGS = WinchRenderState.RING_SEGS

  /// [capture radius m, time s] per target type (DESIGN §3.5 table)
  public static let CAPTURE: [String: (r: Double, t: Double)] = [
    "swimmer": (3, 1.0), "raft": (4.5, 0.8), "hull": (3, 1.0), "container": (3, 1.0),
    "deck": (3, 1.0), "wreck": (3, 1.0), "plane": (3, 1.0), "injured": (3, 3.0),
  ]
  static let MAX_CAPTURE_R: Double = 4.5

  // Cable snag on flotsam (DESIGN §3.5 «ТРОС ЗАХЛЕСТНУЛО» [SHOULD]): contact radii of floating props
  // (world floaters by shape, hazard debris by kind). Moored buoys, containers (rescue targets) and toy
  // ducks never snag the cable.
  public static let SNAG_R_FLOAT: [String: Double] = [
    "plank": 0.9, "barrel": 0.6, "ring": 0.55, "canister": 0.45, "kayak": 1.1, "paddle": 0.7, "suitcase": 0.5,
    "fender": 0.45, "fishbox": 0.55, "float": 0.35, "sail": 1.6,
  ]
  public static let SNAG_R_DEBRIS: [String: Double] = ["board": 1.2, "barrel": 0.6, "buoy": 0.65, "boat": 2.4]
  /// cable + basket half-width
  static let SNAG_CABLE: Double = 0.55
  /// s in the water before a crossing counts (items already there don't)
  static let SNAG_SETTLE: Double = 0.8
  /// s between debris snags
  static let SNAG_COOLDOWN: Double = 15

  static let UP = V3(0, 1, 0)
  static let ORANGE: Color3 = {
    var c = Color3(style: "#FF5A1F")
    c.multiplyScalar(1.6)
    return c
  }()
  static let PALE = Color3(style: "#E8E4D8")

  unowned let heli: Helicopter
  let ctx: SimContext

  // ---- public (CONTRACT heli.winch) --------------------------------------------------------------
  public internal(set) var state: WinchState = .stowed
  public internal(set) var length: Double = 0
  public internal(set) var basket = V3()
  public internal(set) var steadiness: Double = 1
  public internal(set) var load: GroupID?
  public internal(set) var speed: Double = 0
  public internal(set) var swing: Double = 0
  public internal(set) var target: GroupID?
  public internal(set) var capture: Double = 0
  // extras for HUD / audio
  /// 0..1 progress of the tension auto-retract timer
  public internal(set) var tension: Double = 0
  /// seconds the winch stays jammed (snag)
  public internal(set) var jammed: Double = 0
  /// surface height under the basket (water or deck)
  public internal(set) var surfaceY: Double = 0
  /// basket height above that surface
  public internal(set) var height: Double = 0
  /// a person is inside the capture radius
  public internal(set) var inRange = false
  /// current capture radius (for the reach ring / HUD sight)
  public internal(set) var radius: Double = 3
  public internal(set) var stretcher = false
  public internal(set) var cabinFull = false
  /// 'high' | 'fast' | 'landed' — why a press did nothing (briefly)
  public internal(set) var denied: String?

  // ---- internal ----------------------------------------------------------------------------------
  public internal(set) var cable = CableVerlet()
  var held = false
  var buffer: Double = 0
  var pending = false
  var grace: Double = 0
  var slipT: Double = 0
  var tensionT: Double = 0
  var tensionOn = false
  var autoRetract = false
  var deniedT: Double = 0
  var fullWarned = false
  var spin: Double = 0
  var spinRate: Double = 0
  public internal(set) var basketVel = V3()
  /// s the empty basket has been at the water
  var snagWet: Double = 0
  var snagCd: Double = 0
  /// flotsam currently touching the cable (a crossing = a new entry)
  var snagInside = Set<FlotsamItem.Key>()
  /// crest ≥ 6 m under the basket (last capture step)
  public internal(set) var crestUnder: Double = 0
  /// heli-local serial for cabin records without a survivors identity
  var personSerial = 0

  // ---- render ------------------------------------------------------------------------------------
  public internal(set) var view = WinchRenderState()
  var ringHeights = [Float](repeating: 0, count: WinchRenderState.RING_SEGS + 1)
  var ringOrange: Double = 0

  init(heli: Helicopter, ctx: SimContext) {
    self.heli = heli
    self.ctx = ctx
  }

  // ----------------------------------------------------------------------------------------------
  public func reset() {
    if let l = load { ctx.survivors?.detachFromBasket(l, slip: nil) }
    state = .stowed
    length = 0
    load = nil
    target = nil
    capture = 0
    speed = 0
    swing = 0
    tension = 0
    jammed = 0
    snagWet = 0
    snagCd = 0
    snagInside.removeAll()
    steadiness = 1
    inRange = false
    stretcher = false
    cabinFull = false
    denied = nil
    buffer = 0
    pending = false
    grace = 0
    slipT = 0
    tensionT = 0
    tensionOn = false
    autoRetract = false
    pinAll(heli.hoistWorld)
  }

  func pinAll(_ p: V3) {
    cable.pinAll(p)
    basket = p
  }

  /// Input sample once per rendered frame (Space held, edge buffered for 0.4 s).
  public func input(_ held: Bool, _ pressed: Bool) {
    self.held = held
    if pressed {
      buffer = Winch.BUFFER
      pending = true
    }
  }

  func setState(_ s: WinchState) {
    if state == s { return }
    state = s
    ctx.events.emit(GameEvent.HeliWinch(state: s.rawValue, load: load))
  }

  func deny(_ reason: String) {
    denied = reason
    deniedT = 1.2
    ctx.events.emit(GameEvent.HeliWinchDenied(reason: reason))
  }

  /// The group the basket works (w.target || w.load) as it is now.
  func targetView() -> SurvivorView? {
    guard let id = target ?? load else { return nil }
    return ctx.survivors?.group(id)
  }

  /// Surface under a point: water, a pad deck, or the deck of a structure-type target.
  public func surfaceAt(_ x: Double, _ z: Double) -> Double {
    var y = ctx.ocean?.heightAt(x, z) ?? 0
    if let pad = ctx.world?.padAt(x, z) { y = JS.max(y, pad.position.y) }
    // Decks people stand on (barge, sinking ferry, rig lower deck) wherever the basket is — not only
    // under the current target: a basket swinging off the target must still land on the deck, and
    // the height window counts from the deck (DESIGN §3.5 «на конструкции»).
    let deck = ctx.survivors?.deckAt(x, z) ?? -.infinity
    if deck > y { y = deck }
    let sdeck = ctx.world?.deckAt(x, z) ?? -.infinity // the rig's open lower deck
    if sdeck > y { y = sdeck }
    if let t = targetView(), t.type == "deck" || t.type == "wreck" {
      let d = JS.hypot(t.position.x - x, t.position.z - z)
      if d < 12 { y = JS.max(y, JS.max(JSNumber.or(t.position.y, 0), JSNumber.or(t.height, 0))) }
    }
    return y
  }

  public func seatsUsed() -> Int {
    var n = 0
    for p in heli.cabin { n += p.stretcher ? 2 : 1 }
    return n
  }

  // ----------------------------------------------------------------------------------------------
  /// Fixed 60 Hz step. hoist = world position of the cable top this step.
  public func step(_ dt: Double, _ hoist: V3) {
    let h = heli
    cable.stepPrev = cable.cur
    if buffer > 0 { buffer -= dt }
    if deniedT > 0 {
      deniedT -= dt
      if deniedT <= 0 { denied = nil }
    }

    let gs = JS.hypot(h.velocity.x, h.velocity.z)
    let prevLen = length
    let wantDown = (held || buffer > 0) && !autoRetract && h.alive && h.crash == nil

    // --- length control / state machine -----------------------------------------------------------
    if jammed > 0 {
      jammed = JS.max(0, jammed - dt)
    } else if state == .stowed {
      if wantDown && ctx.mode == .play {
        let surf = surfaceAt(hoist.x, hoist.z)
        let reason: String? = h.landed != nil ? "landed" : hoist.y - surf > Winch.WINDOW_HEIGHT ? "high" : gs > Winch.WINDOW_SPEED ? "fast" : nil
        if let reason {
          if pending && buffer <= 0 {
            // The 0.4 s buffer ran out and the window is still shut: tell the HUD why (once per press).
            // Holding Space keeps waiting — lowering starts the moment the window opens.
            pending = false
            deny(reason)
          }
        } else {
          buffer = 0
          pending = false
          fullWarned = false
          setState(.lowering)
        }
      }
    } else if state == .lowering || state == .down {
      if load == nil && !(held || buffer > 0) {
        setState(.raising)
      } else if load == nil {
        let surf = surfaceAt(basket.x, basket.z)
        let target = JS.min(Winch.MAX_LEN, JS.max(0, hoist.y - surf - Winch.BASKET_FLOAT + Winch.SLACK))
        let d = target - length
        length += JS.sign(d) * JS.min(JS.abs(d), Winch.PAY * dt)
        // hysteresis: 'down' once at the surface; back to 'lowering' only if the heli climbs ≥ 1 m
        if state == .lowering && JS.abs(d) < 0.08 { setState(.down) } else if state == .down && d > 1 { setState(.lowering) }
      }
    }
    if state == .raising && jammed <= 0 {
      let rate = load != nil ? (stretcher ? Winch.LIFT_STRETCHER : Winch.LIFT_PERSON) : Winch.PAY
      length = JS.max(0, length - rate * dt)
      if load == nil && wantDown && !autoRetract && gs <= Winch.WINDOW_SPEED {
        setState(.lowering)
      } else if length <= 0.02 {
        if load != nil { board() }
        length = 0
        autoRetract = false
        if wantDown && gs <= Winch.WINDOW_SPEED { setState(.lowering) } else { setState(.stowed) }
      }
    }
    speed = dt > 0 ? (length - prevLen) / dt : 0

    // --- cable physics ------------------------------------------------------------------------------
    if length < 0.05 && state == .stowed {
      pinAll(hoist)
      basketVel.set(0, 0, 0)
    } else {
      simulate(dt, hoist)
    }

    // --- capture / failures -------------------------------------------------------------------------
    captureStep(dt, gs)
    failures(dt, gs)
  }

  func simulate(_ dt: Double, _ hoist: V3) {
    let N = Winch.N
    let rest = JS.max(0.02, length / Double(Winch.SEGS))
    let bx = cable.c((N - 1) * 3)
    let bz = cable.c((N - 1) * 3 + 2)
    let surf = surfaceAt(bx, bz)
    surfaceY = surf

    // Wind at the basket (surface wind × profile × c, DESIGN §3.3/§3.5).
    let wind = ctx.weather?.windAt(bx, bz) ?? V2()
    let prof = JS.min(1.4, JS.max(0.6, 0.6 + 0.008 * JS.max(0, cable.c((N - 1) * 3 + 1) - surf)))
    let wx = wind.x * prof * 0.6
    let wz = wind.y * prof * 0.6
    let damp = JS.max(0, 1 - Winch.DAMP * dt)
    let dt2 = dt * dt

    var cur = cable.cur
    var prev = cable.prev
    // Pin the top.
    cur[0] = Float(hoist.x)
    cur[1] = Float(hoist.y)
    cur[2] = Float(hoist.z)
    for i in 1..<N {
      let k = i * 3
      let isBasket = i == N - 1
      let vx = (Double(cur[k]) - Double(prev[k])) * damp
      let vy = (Double(cur[k + 1]) - Double(prev[k + 1])) * damp
      let vz = (Double(cur[k + 2]) - Double(prev[k + 2])) * damp
      // wind drag as an acceleration toward 0.8·wind (basket) / wind (light cable points)
      let kx = isBasket ? 0.8 : 0.5
      let ax = (kx * wx - vx / dt) * (isBasket ? 0.8 : 0.6)
      let az = (kx * wz - vz / dt) * (isBasket ? 0.8 : 0.6)
      prev[k] = cur[k]
      prev[k + 1] = cur[k + 1]
      prev[k + 2] = cur[k + 2]
      cur[k] = Float(Double(cur[k]) + (vx + ax * dt2))
      cur[k + 1] = Float(Double(cur[k + 1]) + (vy - Winch.G * dt2))
      cur[k + 2] = Float(Double(cur[k + 2]) + (vz + az * dt2))
    }
    // Rope constraints: only resist stretching (slack cable may bunch up). Basket is heavy.
    for _ in 0..<12 {
      for i in 0..<(N - 1) {
        let a = i * 3
        let b = a + 3
        let dx = Double(cur[b]) - Double(cur[a])
        let dy = Double(cur[b + 1]) - Double(cur[a + 1])
        let dz = Double(cur[b + 2]) - Double(cur[a + 2])
        let d = (dx * dx + dy * dy + dz * dz).squareRoot()
        if d <= rest || d < 1e-6 { continue }
        let ia: Double = i == 0 ? 0 : 1
        let ib: Double = i + 1 == N - 1 ? 0.15 : 1
        let sum = ia + ib
        let corr = (d - rest) / d / sum
        cur[a] = Float(Double(cur[a]) + dx * corr * ia)
        cur[a + 1] = Float(Double(cur[a + 1]) + dy * corr * ia)
        cur[a + 2] = Float(Double(cur[a + 2]) + dz * corr * ia)
        cur[b] = Float(Double(cur[b]) - dx * corr * ib)
        cur[b + 1] = Float(Double(cur[b + 1]) - dy * corr * ib)
        cur[b + 2] = Float(Double(cur[b + 2]) - dz * corr * ib)
      }
      // Surface: the basket floats, cable points lie on the water.
      for i in 1..<N {
        let k = i * 3 + 1
        let floor = surf + (i == N - 1 ? Winch.BASKET_FLOAT : 0.05)
        if Double(cur[k]) < floor { cur[k] = Float(floor) }
      }
    }
    // Water drag on the floating basket.
    let kb = (N - 1) * 3
    if Double(cur[kb + 1]) <= surf + Winch.BASKET_FLOAT + 0.05 {
      let f = JS.max(0, 1 - 3 * dt)
      prev[kb] = Float(Double(cur[kb]) - (Double(cur[kb]) - Double(prev[kb])) * f)
      prev[kb + 2] = Float(Double(cur[kb + 2]) - (Double(cur[kb + 2]) - Double(prev[kb + 2])) * f)
      prev[kb + 1] = cur[kb + 1]
    }
    cable.cur = cur
    cable.prev = prev
    basketVel.set((Double(cur[kb]) - Double(prev[kb])) / dt, (Double(cur[kb + 1]) - Double(prev[kb + 1])) / dt,
                  (Double(cur[kb + 2]) - Double(prev[kb + 2])) / dt)
    basket.set(Double(cur[kb]), Double(cur[kb + 1]), Double(cur[kb + 2]))
    height = basket.y - Winch.BASKET_FLOAT - surf
    let hx = basket.x - hoist.x
    let hz = basket.z - hoist.z
    swing = JS.atan2(JS.hypot(hx, hz), JS.max(0.01, hoist.y - basket.y))
  }

  // ----------------------------------------------------------------------------------------------
  func captureStep(_ dt: Double, _ gs: Double) {
    let h = heli
    let cadet = ctx.settings.get("difficulty").string == "cadet"
    let mult = cadet ? 1.4 : 1

    // Steadiness (always computed while the cable is out).
    var tv = V3()
    if let t = targetView(), let v = t.velocity { tv.set(JSNumber.or(v.x, 0), JSNumber.or(v.y, 0), JSNumber.or(v.z, 0)) }
    var vb = basketVel
    vb.sub(tv)
    let vrel = vb.length
    let waterAtBasket = ctx.ocean?.heightAt(basket.x, basket.z) ?? 0
    let crest: Double = state != .stowed && waterAtBasket >= 6 ? 1 : 0
    let sRaw = state == .stowed ? 1 : JS.min(1, JS.max(0, 1 - 0.12 * vrel - 0.05 * gs - 0.3 * crest))
    steadiness += (sRaw - steadiness) * (1 - JS.exp(-dt / 0.3))
    crestUnder = crest

    if load != nil || state == .stowed || state == .raising || jammed > 0 || !h.alive {
      target = load
      inRange = false
      if load == nil { capture = 0 }
      return
    }

    let s = ctx.survivors?.nearestFor(basket.x, basket.z, Winch.MAX_CAPTURE_R * mult)
    target = s?.id
    guard let s else {
      inRange = false
      capture = JS.max(0, capture - dt * 2)
      radius = 3 * mult
      return
    }
    let spec = Winch.CAPTURE[s.type] ?? (3, 1.0)
    let injured = s.type == "injured"
    let r = spec.r * mult
    radius = r
    let d = JS.hypot(basket.x - s.position.x, basket.z - s.position.z)
    let maxH = s.type == "swimmer" || injured ? 1.5 : 2.2
    let inRangeNow = d <= r && height <= maxH
    inRange = inRangeNow
    if inRangeNow { grace = 0.3 } else { grace -= dt }
    let minS = injured ? 0.6 : 0.45

    // Cabin space (stretcher = 2 seats).
    let need = injured ? 2 : 1
    let full = seatsUsed() + need > (h.capacity > 0 ? h.capacity : 6)
    cabinFull = full
    if full {
      capture = 0
      if inRangeNow && !fullWarned {
        fullWarned = true
        ctx.events.emit(GameEvent.HeliCabinFull(survivor: s.id, seats: seatsUsed()))
      }
      return
    }
    if inRangeNow || grace > 0 {
      if injured && steadiness < 0.6 { capture = 0 } else if steadiness >= minS { capture += dt / spec.t }
    } else {
      capture = 0
    }
    if capture >= 1 { attach(s) }
  }

  func attach(_ s: SurvivorView) {
    capture = 1
    load = s.id
    target = s.id
    stretcher = s.type == "injured"
    slipT = 0
    ctx.survivors?.attachToBasket(s.id)
    ctx.events.emit(GameEvent.HeliCapture(survivor: s.id))
    state = .down
    setState(.raising)
  }

  func board() {
    let s = load
    let type = s.flatMap { ctx.survivors?.group($0)?.type }
    let person = s.flatMap { ctx.survivors?.boardOne($0) }
    var rec = CabinPerson(id: PersonID(0), survivor: s, stretcher: stretcher, type: type)
    if let p = person {
      if let n = p.name { rec.name = n }
      rec.age = p.age
      if let c = p.condition { rec.condition = c }
    }
    if let id = person?.person {
      rec.id = id
    } else {
      personSerial += 1
      rec.id = PersonID(-personSerial)
    }
    heli.cabin.append(rec)
    load = nil
    target = nil
    capture = 0
    stretcher = false
    ctx.events.emit(GameEvent.HeliPickup(survivor: s, person: rec.id))
  }

  /// _slip(reason): the person falls out of the basket (heat loss 10).
  public func slip(_ reason: String) {
    guard let s = load else { return }
    ctx.survivors?.detachFromBasket(s, slip: BasketSlip(heatLoss: 10, reason: reason))
    load = nil
    capture = 0
    stretcher = false
    slipT = 0
    ctx.events.emit(GameEvent.HeliSlip(survivor: s, reason: reason))
  }

  func failures(_ dt: Double, _ gs: Double) {
    // «Сорвался!»: S < 0.25 for 1.5 s while the loaded basket is < 3 m above the water.
    if load != nil && height < 3 && steadiness < 0.25 {
      slipT += dt
      if slipT >= 1.5 {
        slip("unsteady")
        if state == .raising && held { setState(.down) }
      }
    } else {
      slipT = 0
    }

    // «НАТЯЖЕНИЕ ТРОСА»: > 5 m/s with > 3 m paid out → after 1.5 s the cable reels in by itself.
    if state != .stowed && length > 3 && gs > Winch.WINDOW_SPEED && !autoRetract {
      if !tensionOn {
        tensionOn = true
        ctx.events.emit(GameEvent.HeliTension(level: 0, phase: "warn"))
      }
      tensionT += dt
      if tensionT >= 1.5 {
        autoRetract = true
        tensionT = 0
        tensionOn = false
        if load != nil { slip("tension") }
        ctx.events.emit(GameEvent.HeliTension(level: 1, phase: "release"))
        state = .down
        setState(.raising)
      }
    } else if tensionT > 0 {
      tensionT = JS.max(0, tensionT - dt * 2)
      if tensionT == 0 && tensionOn {
        tensionOn = false
        ctx.events.emit(GameEvent.HeliTension(level: 0, phase: "clear"))
      }
    }
    tension = tensionT / 1.5

    // «ТРОС ЗАХЛЕСТНУЛО» [SHOULD]: a rogue crest sweeps over an empty basket at the water → jam 6 s.
    if load == nil && jammed <= 0 && length > 3 && height < 2.5, let hz = ctx.hazards {
      let lift = JSNumber.or(hz.waveLiftAt(basket.x, basket.z), 0)
      if lift > 3 {
        jammed = 6
        ctx.events.emit(GameEvent.HeliSnag(x: basket.x, z: basket.z, reason: "wave"))
      }
    }
    // …or a plank / barrel / hazard wreckage drifting across the EMPTY cable where it meets the water.
    snagCd = JS.max(0, snagCd - dt)
    if load == nil && length > 3 && height < 2.5 && state != .stowed {
      snagWet += dt
      let hit = flotsamCrossing()
      if let hit, jammed <= 0 && snagCd <= 0 && snagWet > Winch.SNAG_SETTLE {
        jammed = 6
        snagCd = Winch.SNAG_COOLDOWN
        ctx.events.emit(GameEvent.HeliSnag(x: basket.x, z: basket.z, reason: "debris", kind: hit.shape.isEmpty ? "debris" : hit.shape))
      }
    } else if snagWet > 0 || !snagInside.isEmpty {
      snagWet = 0
      snagInside.removeAll()
    }
  }

  /// Returns a flotsam item that has just started touching the low cable (basket or the node above
  /// it), or nil. Reads world floaters and hazard debris positions only.
  func flotsamCrossing() -> FlotsamItem? {
    let N = Winch.N
    let kb = (N - 1) * 3
    let ka = (N - 2) * 3
    let bx = cable.c(kb), bz = cable.c(kb + 2)
    // on a deck (structure targets, pads) nothing floats past the basket
    let water = ctx.ocean?.heightAt(bx, bz) ?? surfaceY
    if surfaceY - water > 1 { return nil }
    let lowA = cable.c(ka + 1) - surfaceY < 2.5 // the node above the basket is near the water too
    let ax = cable.c(ka), az = cable.c(ka + 2)
    var hit: FlotsamItem?
    func test(_ it: FlotsamItem, _ r: Double) {
      if !(it.x + it.z).isFinite { return }
      let rr = r + Winch.SNAG_CABLE
      let touch = JS.pow(it.x - bx, 2) + JS.pow(it.z - bz, 2) < rr * rr || (lowA && JS.pow(it.x - ax, 2) + JS.pow(it.z - az, 2) < rr * rr)
      if touch {
        if !snagInside.contains(it.key) {
          snagInside.insert(it.key)
          if hit == nil && snagWet > Winch.SNAG_SETTLE { hit = it }
        }
      } else if snagInside.contains(it.key) {
        snagInside.remove(it.key)
      }
    }
    if let fl = ctx.world?.floaters, !fl.isEmpty {
      for it in fl {
        guard let r = Winch.SNAG_R_FLOAT[it.shape], JSNumber.isTruthy(r), !it.moored else { continue }
        if JS.abs(it.x - bx) > 8 || JS.abs(it.z - bz) > 8 {
          snagInside.remove(it.key)
          continue
        }
        test(it, r)
      }
    }
    if let items = ctx.hazards?.debris {
      for it in items {
        guard let r = Winch.SNAG_R_DEBRIS[it.shape], JSNumber.isTruthy(r) else { continue }
        // airborne tornado junk passes over the cable; only what floats at the surface snags it
        if !it.y.isFinite || JS.abs(it.y - surfaceY) > 1.5 {
          snagInside.remove(it.key)
          continue
        }
        test(it, r)
      }
    }
    return hit
  }

  // ----------------------------------------------------------------------------------------------
  /// Per rendered frame: interpolate the cable, place basket / rescuer, lay the reach ring.
  public func render(_ dt: Double, _ alpha: Double, _ beam: SearchlightBeam?) {
    let N = Winch.N
    let out = state != .stowed || length > 0.05
    view.cableVisible = out
    view.basketVisible = out
    view.rescuerVisible = out && length > 1.2
    let ringTarget: Double = out && state != .raising && load == nil ? 1 : 0
    view.ringFade += (ringTarget - view.ringFade) * (1 - JS.exp(-dt * 6))
    view.ringVisible = view.ringFade > 0.01
    if !out && !view.ringVisible { return }

    var R = view.rend
    for i in 0..<(N * 3) {
      let a = Double(cable.stepPrev[i])
      R[i] = Float(a + (Double(cable.cur[i]) - a) * alpha)
    }
    // The ribbon is pinned to the rendered hoist (heli is interpolated too).
    let hp = heli.hoistRender
    R[0] = Float(hp.x)
    R[1] = Float(hp.y)
    R[2] = Float(hp.z)
    let kb = (N - 1) * 3
    // Basket orientation: up along the last cable segment, slow spin (faster with a person).
    let bx = Double(R[kb])
    let by = Double(R[kb + 1])
    let bz = Double(R[kb + 2])
    var ux = Double(R[kb - 3]) - bx
    var uy = Double(R[kb - 2]) - by
    var uz = Double(R[kb - 1]) - bz
    var ul = JS.hypot(ux, uy, uz)
    if ul < 1e-4 || uy < 0.2 * ul {
      ux = 0
      uy = 1
      uz = 0
      ul = 1
    }
    ux /= ul
    uy /= ul
    uz /= ul
    spinRate += ((load != nil ? 0.35 : 0.12) - spinRate) * (1 - JS.exp(-dt))
    spin += spinRate * dt
    view.basketPosition.set(bx, by, bz)
    var q = Quat()
    q.setFromUnitVectors(Winch.UP, V3(ux, uy, uz))
    var qs = Quat()
    qs.setFromAxisAngle(Winch.UP, spin + heli.heading * -1)
    q.multiply(qs)
    view.basketQuaternion = q
    // The ribbon ends at the bridle hook, not inside the basket.
    let hook = Winch.HOOK * 1.4
    R[kb] = Float(bx + ux * hook)
    R[kb + 1] = Float(by + uy * hook)
    R[kb + 2] = Float(bz + uz * hook)
    if view.rescuerVisible {
      view.rescuerPosition.set(Double(R[kb]), Double(R[kb + 1]), Double(R[kb + 2]))
      view.rescuerQuaternion = q
    }
    view.rend = R

    let st = ctx.weatherState
    view.cableLit = 0.25 + 0.75 * (1 - JSNumber.or(st.night, 0)) + 2 * JSNumber.or(st.flash, 0)
    if let beam {
      view.beamPos = beam.origin
      view.beamDir = beam.dir
      view.beamCos = beam.cosOuter
      view.beamIntensity = beam.intensity
    }

    // Reach ring: hugs the waves around the basket's water point.
    if view.ringVisible { ring(dt, bx, bz) }
  }

  func ring(_ dt: Double, _ cx: Double, _ cz: Double) {
    let r = radius
    let half = 0.16
    var P = view.ringPositions
    let segs = Winch.RING_SEGS
    for i in 0...segs {
      let a = (Double(i) / Double(segs)) * JS.PI * 2
      let c = JS.cos(a)
      let s = JS.sin(a)
      var y: Double = 0
      if i == segs {
        y = Double(ringHeights[0])
      } else {
        let px = cx + c * r
        let pz = cz + s * r
        y = (ctx.ocean?.heightAt(px, pz) ?? 0) + 0.22
        // decks: the ring sits on the deck top when the basket works a structure
        if surfaceY > y + 0.5 && height < 3 { y = surfaceY + 0.12 }
        ringHeights[i] = Float(y)
      }
      let k = i * 6
      P[k] = Float(cx + c * (r - half))
      P[k + 1] = Float(y)
      P[k + 2] = Float(cz + s * (r - half))
      P[k + 3] = Float(cx + c * (r + half))
      P[k + 4] = Float(y)
      P[k + 5] = Float(cz + s * (r + half))
    }
    view.ringPositions = P
    ringOrange += ((inRange ? 1 : 0) - ringOrange) * (1 - JS.exp(-dt * 10))
    var col = Winch.PALE
    col.lerp(Winch.ORANGE, ringOrange)
    view.ringColor = col
    view.ringOpacity = view.ringFade * (0.55 + 0.4 * ringOrange)
    view.ringPhase += dt * (0.15 + 0.5 * ringOrange)
  }
}
