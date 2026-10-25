// world/floaters.js Floaters: floating props (DESIGN §2.11, catalogue #45) — debris fields (planks,
// barrels, life rings, canisters, kayaks, paddles, luggage, a torn sail, net-float chains, fish boxes,
// fenders), drifting containers as scenery, buoys with their real IALA light rhythms and — in one
// container field out of twenty — 300 rubber ducks. Everything bobs on ocean.heightAt / normalAt with lag,
// drifts with current + leeway·wind + hazard surface flow (moored buoys swing round the anchor) and gets
// a foam collar + dark contact disc. The winch cable snags on them (Heli/Winch reads `items`).
//
// The meshes are baked (floater_<shape>.mmesh); here: the layout (mulberry32(seed + 777), the web's draw
// order exactly — an item's own fields are drawn BEFORE add() draws yaw, yawRate and phase), the banks
// (one InstancedMesh per shape: count, capacity, Float32 instance colours) and per frame the pose
// matrices (Float32), the buoy lamp positions, the collars and the container wash stamps.
// Tests/Vectors/world/setup_first_<q>.json, run_first.json, run_mix.json, rhythms.json.

/// One floating prop (floaters.js items[i]).
public struct FloaterItem: Equatable, Sendable {
  public var shape: String
  public var x: Double
  public var z: Double
  public var yaw: Double
  public var yawRate: Double
  public var roll: Double = 0
  public var pitch: Double = 0
  /// tilt gain of the wave normal (1; buoys 1.6, containers 0.7)
  public var tilt: Double = 1
  /// smoothed water height under the item
  public var h: Double = 0
  /// smoothed wave normal (tilted)
  public var nx: Double = 0
  public var ny: Double = 1
  public var nz: Double = 0
  public var phase: Double
  /// per-instance tint (CSS hex) or nil (white)
  public var color: String?
  /// instance index in its bank
  public var idx: Int = -1
  /// anchor of a moored buoy
  public var moored: V2?
  /// lamp index of a buoy light (−1 = none)
  public var light: Int = -1
  /// wave evaluation every n frames (ducks 3)
  public var every: Int = 1
  /// buoy kind (east, west, north, south, isolated, mark)
  public var kind: String?
  /// containers: extra draft
  public var sink: Double?
  /// containers: long-box collar (3)
  public var long: Double?
  /// net-float chains
  public var chain = false
  /// collar radius R·k (0 = none) and the leeway, from the bank's shape
  public var R: Double = 0
  public var leeway: Double = 0.03
  /// container wash timer (nil = never stamped)
  public var washT: Double?
  /// the bank shape's draft (def.y) and scale (def.k)
  public var defY: Double = 0
  public var defK: Double = 1
  /// index of its bank in Floaters.banks (−1 = none)
  public var bank: Int = -1
}

/// One InstancedMesh per shape in use (floaters.js banks: Map shape → {mesh, n, max, def}).
public struct FloaterBank: Sendable {
  public var shape: String
  public var def: FloaterShape
  /// instances used (= mesh.count)
  public var n: Int = 0
  /// capacity (max(count, 8); grows when a later mission needs more)
  public var max: Int
  /// pose matrices, 16 Float32 per instance
  public var matrices: [Float]
  /// instance colours, 3 Float32 per instance (linear)
  public var colors: [Float]
  public var visible: Bool { n > 0 }
}

public final class Floaters {
  public private(set) var items: [FloaterItem] = []
  /// indices into `items` of the moored buoys (floaters.buoys, the audio bell reads them)
  public private(set) var buoys: [Int] = []
  /// banks by shape, in creation order (the web's Map order)
  public private(set) var banks: [FloaterBank] = []
  public private(set) var frame = 0
  public private(set) var duckSource: V2?
  let T: WorldTables

  static let SIDES: [Double] = [-1, 1]

  public init(tables: WorldTables) { T = tables }

  func bankIndex(_ shape: String) -> Int? { banks.firstIndex { $0.shape == shape } }

  /// The shape definition: `buoy:<kind>` = {y 0, R 1.0, k 1.1}; else SHAPES[shape].
  func shapeDef(_ shape: String) -> FloaterShape {
    if shape.hasPrefix("buoy:") { return FloaterShape(k: 1.1, y: 0, R: 1.0, tint: nil, leeway: nil, craft: false) }
    return T.shapes[shape] ?? FloaterShape(k: 1, y: 0, R: 0, tint: nil, leeway: nil, craft: false)
  }

  /// _bank(shape, max): reuse a bank that is big enough, else (re)create it at the end of the Map.
  func bank(_ shape: String, _ max: Int) {
    if let i = bankIndex(shape) {
      if banks[i].max >= max { return }
      banks.remove(at: i)
    }
    var b = FloaterBank(shape: shape, def: shapeDef(shape), max: max, matrices: [Float](repeating: 0, count: max * 16),
                        colors: [Float](repeating: 0, count: max * 3))
    // mesh.setColorAt(0, white)
    b.colors[0] = 1
    b.colors[1] = 1
    b.colors[2] = 1
    banks.append(b)
  }

  public func clear() {
    items.removeAll()
    buoys.removeAll()
    for i in banks.indices { banks[i].n = 0 }
  }

  /// containerPaint(hex) (survivors/craft.js): the faded container colours, or a 30 % desaturated, 8 %
  /// darker version of any other hex.
  func containerPaint(_ hex: String?) -> String {
    let k = (hex ?? "").lowercased()
    if let f = T.containerFade[k] { return f }
    var c = Color3(style: (hex?.isEmpty == false ? hex! : "#9E4636"))
    let l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15
    c.lerp(Color3(l, l, l), 0.3)
    c.multiplyScalar(0.92)
    return "#" + c.getHexString()
  }

  // ---- setup ------------------------------------------------------------------------------------------

  /// setup(props, seed, detail): build from def.world.props. `ducksParam` = ctx.params.has('ducks').
  public func setup(props: JSONValue, seed: Double, detail: Double, ducksParam: Bool, lamps: LampRegistry, ocean: WorldOcean?) {
    clear()
    var r = Mulberry32(seed: Double(JSNumber.toInt32(seed)) + 777)
    var counts: [(String, Int)] = []
    func count(_ shape: String) {
      if let i = counts.firstIndex(where: { $0.0 == shape }) { counts[i].1 += 1 } else { counts.append((shape, 1)) }
    }
    // add(shape, o): `o` is evaluated first (its own draws), then the defaults draw yaw, yawRate, phase
    func add(_ shape: String, _ o: (inout FloaterItem) -> Void) {
      count(shape)
      let yaw = r.next() * JS.PI * 2, yawRate = (r.next() - 0.5) * 0.08, phase = r.next() * 10
      var it = FloaterItem(shape: shape, x: 0, z: 0, yaw: yaw, yawRate: yawRate, phase: phase)
      o(&it)
      items.append(it)
    }
    func pick(_ mix: [(String, Double)]) -> String {
      var u = r.next()
      for (s, w) in mix {
        u -= w
        if u <= 0 { return s }
      }
      return mix[mix.count - 1].0
    }
    func tintOf(_ shape: String) -> String? {
      guard let t = T.shapes[shape]?.tint, !t.isEmpty else { return nil }
      return t[Int((r.next() * Double(t.count)).rounded(.down))]
    }
    let MIX: [String: [(String, Double)]] = [
      "kayak": [("kayak", 0.45), ("paddle", 0.3), ("fishbox", 0.1), ("ring", 0.15)],
      "paddle": [("paddle", 1)],
      "luggage": [("suitcase", 0.5), ("ring", 0.15), ("plank", 0.15), ("fender", 0.2)],
      "planks": [("plank", 0.5), ("barrel", 0.15), ("canister", 0.15), ("ring", 0.1), ("fishbox", 0.1)],
      "sail": [("plank", 0.35), ("ring", 0.2), ("fender", 0.3), ("canister", 0.15)],
      "nets": [("fishbox", 0.4), ("plank", 0.3), ("barrel", 0.3)],
      "barrels": [("barrel", 0.6), ("canister", 0.4)],
      "default": [("plank", 0.4), ("barrel", 0.2), ("ring", 0.15), ("canister", 0.25)],
    ]

    for d in props["debris"].array ?? [] {
      let n = worldCount(JS.max(1, JS.round(JSNumber.or(d["count"].double, 6) * (0.6 + 0.4 * detail))))
      let rad = JSNumber.or(d["radius"].double, 30)
      let kind = d["kind"].string
      let mix = kind.flatMap { MIX[$0] } ?? MIX["default"]!
      let dx = d["x"].double ?? .nan, dz = d["z"].double ?? .nan
      if kind == "sail" { add("sail") { $0.x = dx; $0.z = dz; $0.color = nil } }
      if kind == "nets" {
        // chains of net floats: they rise and fall along the swell — the wave shape made visible
        for _ in 0..<worldCount(JS.max(1, JS.round(Double(n) / 3))) {
          let cx = dx + (r.next() - 0.5) * rad, cz = dz + (r.next() - 0.5) * rad
          let a = r.next() * JS.PI * 2
          let col = tintOf("float")
          for k in 0..<10 {
            let kd = Double(k)
            let bend = JS.sin(kd * 0.45) * 2.5
            let x = cx + JS.cos(a) * kd * 1.6 - JS.sin(a) * bend, z = cz + JS.sin(a) * kd * 1.6 + JS.cos(a) * bend
            add("float") { $0.x = x; $0.z = z; $0.color = col; $0.yawRate = 0; $0.chain = true }
          }
        }
      }
      for _ in 0..<n {
        let shape = pick(mix)
        let ang = r.next() * JS.PI * 2, dist = r.next().squareRoot() * rad
        let x = dx + JS.cos(ang) * dist, z = dz + JS.sin(ang) * dist
        let color = tintOf(shape)
        var roll: Double? = nil
        if shape == "kayak" && r.next() < 0.5 { roll = JS.PI } // capsized
        if shape == "barrel" || shape == "canister" || shape == "fishbox" { roll = (r.next() - 0.5) * 0.5 }
        add(shape) {
          $0.x = x
          $0.z = z
          $0.color = color
          if let ro = roll { $0.roll = ro }
        }
      }
    }

    var ducks: JSONValue? = nil
    let containers = props["containers"].array ?? []
    for c in containers {
      // awash: 0.3–0.6 m of freeboard, listing 5–15° on a flooded corner
      let x = c["x"].double ?? .nan, z = c["z"].double ?? .nan
      let hex = c["color"].string
      let color = (hex.map { !$0.isEmpty } ?? false) ? containerPaint(hex) : tintOf("container")
      let roll = (r.next() < 0.5 ? -1.0 : 1.0) * (0.09 + r.next() * 0.17)
      let pitch = (r.next() - 0.5) * 0.12
      let sink = r.next() * 0.3
      add("container") { $0.x = x; $0.z = z; $0.color = color; $0.roll = roll; $0.pitch = pitch; $0.tilt = 0.7; $0.long = 3; $0.sink = sink }
      if ducks == nil && r.next() < 0.05 { ducks = c } // 1 in 20: a broken container spilled its cargo
    }
    if ducks != nil || ducksParam {
      let src = ducks ?? containers.first
      let sx = src.map { $0["x"].double ?? .nan } ?? 60, sz = src.map { $0["z"].double ?? .nan } ?? -40
      let n = worldCount(JS.round(300 * (0.4 + 0.6 * detail)))
      let a0 = r.next() * JS.PI * 2
      for _ in 0..<Swift.max(0, n) {
        let along = JS.pow(r.next(), 0.7) * 120
        let lat = (r.next() - 0.5) * (6 + along * 0.35)
        let x = sx + JS.cos(a0) * along - JS.sin(a0) * lat, z = sz + JS.sin(a0) * along + JS.cos(a0) * lat
        let yawRate = (r.next() - 0.5) * 0.4
        add("duck") { $0.x = x; $0.z = z; $0.yawRate = yawRate; $0.every = 3 }
      }
      duckSource = V2(sx, sz)
    } else {
      duckSource = nil
    }

    for b in props["buoys"].array ?? [] {
      let k = b["kind"].string ?? ""
      let kind = T.buoyKinds.contains(k) ? k : "mark"
      let x = b["x"].double ?? .nan, z = b["z"].double ?? .nan
      add("buoy:\(kind)") { $0.x = x; $0.z = z; $0.moored = V2(x, z); $0.kind = kind; $0.tilt = 1.6; $0.yawRate = 0.02 }
    }

    // allocate banks (only shapes in use become visible)
    for i in banks.indices { banks[i].n = 0 }
    for (shape, n) in counts { bank(shape, Swift.max(n, 8)) }
    for i in items.indices {
      guard let bi = bankIndex(items[i].shape) else { continue }
      let def = banks[bi].def
      items[i].bank = bi
      items[i].idx = banks[bi].n
      banks[bi].n += 1
      items[i].defY = def.y
      items[i].defK = def.k
      items[i].R = JSNumber.or(def.R, 0) * JSNumber.or(def.k, 1)
      items[i].leeway = def.leeway ?? 0.03
      let c = items[i].color.map { Color3(style: $0) } ?? Color3(1, 1, 1)
      let j = items[i].idx * 3
      banks[bi].colors[j] = Float(c.r)
      banks[bi].colors[j + 1] = Float(c.g)
      banks[bi].colors[j + 2] = Float(c.b)
      if items[i].moored != nil {
        let kind = items[i].kind ?? "mark"
        let ch = Double(T.ch.BUOY0 + (T.buoyKinds.firstIndex(of: kind) ?? -1))
        items[i].light = lamps.add(items[i].x, 3.6, items[i].z, T.buoyLight[kind] ?? "#FFFFFF", gain: 5, bulb: 0.2, halo: 2.4, ch: ch, pen: 0.35)
        buoys.append(i)
      }
    }
    frame = 0
    // settle on the water immediately
    update(0, env: nil, settle: true, ocean: ocean, hazards: nil, collars: nil, lamps: lamps)
  }

  // ---- update -----------------------------------------------------------------------------------------

  /// update(dt, env, settle): drift, bob on the waves (far items every 8th frame, ducks every 3rd), pose
  /// matrices, buoy lamps, container wash, collars.
  public func update(_ dt: Double, env: WorldEnv?, settle: Bool = false, ocean: WorldOcean?, hazards: WorldHazards?, collars: CollarList?,
                     lamps: LampRegistry) {
    if items.isEmpty { return }
    frame += 1
    let t = env?.t ?? 0
    let dtv = JSNumber.or(dt, 0)
    let kh = settle ? 1 : 1 - JS.exp(-dtv * 5)
    let kn = settle ? 1 : 1 - JS.exp(-dtv / 0.3) // tilt follows the swell with a 0.3 s lag
    let UP = V3(0, 1, 0)
    for i in items.indices {
      var it = items[i]
      // drift: current + leeway·wind + hazard surface flow (moored buoys swing around the anchor)
      if dt > 0 {
        var vx = (env?.current.x ?? 0) + (env.map { $0.wind.x * it.leeway } ?? 0)
        var vz = (env?.current.y ?? 0) + (env.map { $0.wind.y * it.leeway } ?? 0)
        if let hz = hazards {
          let f = hz.surfaceFlowAt(it.x, it.z)
          vx += f.x
          vz += f.y
        }
        if let m = it.moored {
          let ax = m.x + vx * 6, az = m.y + vz * 6
          it.x += (ax - it.x) * JS.min(1, dt * 0.2)
          it.z += (az - it.z) * JS.min(1, dt * 0.2)
        } else {
          it.x += vx * dt
          it.z += vz * dt
        }
        it.yaw += it.yawRate * dt
      }
      // far away / staggered: skip the wave evaluation (keep the last pose, still drift)
      let far = env.map { JS.abs(it.x - $0.focus.x) + JS.abs(it.z - $0.focus.y) > 520 } ?? false
      let skip = !settle && ((far && (frame + i) % 8 != 0) || (it.every > 1 && (frame + i) % it.every != 0))
      if !skip, let oc = ocean {
        let h = oc.heightAt(it.x, it.z)
        it.h = settle ? h : it.h + (h - it.h) * JS.min(1, kh * Double(it.every))
        if it.R > 0 || it.moored != nil || it.long != nil {
          let n = oc.worldNormalAt(it.x, it.z)
          let k = JS.min(1, kn * Double(it.every))
          it.nx += (n.x * it.tilt - it.nx) * k
          it.ny += (n.y - it.ny) * k
          it.nz += (n.z * it.tilt - it.nz) * k
        }
      }
      // pose
      var q = Quat()
      q.setFromUnitVectors(UP, V3(it.nx, it.ny, it.nz).normalized())
      var qy = Quat()
      qy.setFromAxisAngle(UP, it.yaw)
      q.multiply(qy)
      if JSNumber.isTruthy(it.roll) || JSNumber.isTruthy(it.pitch) {
        var qr = Quat()
        qr.setFromEuler(Euler(it.roll, 0, it.pitch))
        q.multiply(qr)
      }
      var y = it.h + JSNumber.or(it.defY, 0) * JSNumber.or(it.defK, 1) - JSNumber.or(it.sink, 0)
      if it.moored != nil {
        // buoys rock on their mooring: extra sway
        let sw = 0.06 * JS.sin(t * 1.3 + it.phase)
        var qr = Quat()
        qr.setFromAxisAngle(V3(JS.cos(it.phase), 0, JS.sin(it.phase)), sw)
        q.premultiply(qr)
        y -= 0.35
      }
      var m = Mat4()
      let k = JSNumber.or(it.defK, 1)
      m.compose(V3(it.x, y, it.z), q, V3(k, k, k))
      if it.bank >= 0 && it.bank < banks.count && it.idx >= 0 { m.storeFloat32(into: &banks[it.bank].matrices, at: it.idx * 16) }
      if it.light >= 0 {
        var p = V3(0, 3.66, 0)
        p.applyMatrix4(m)
        lamps.setLocal(it.light, p.x, p.y, p.z)
      }
      // containers: the swell washes over the roof — foam where the sea stands above it at an end
      if it.long != nil && !far && env != nil && dt > 0, let oc = ocean {
        it.washT = JSNumber.or(it.washT, 0) - dt
        if (it.washT ?? 0) <= 0 {
          it.washT = 0.5
          let c = JS.cos(it.yaw), s = JS.sin(it.yaw)
          for e in Floaters.SIDES {
            let ex = it.x + c * 2.6 * e, ez = it.z - s * 2.6 * e
            if oc.heightAt(ex, ez) > y + T.containerFreeboard - 0.12 {
              oc.stampFoam(ex, ez, radius: 1.5, strength: 0.55)
              it.washT = 1.2
            }
          }
        }
      }
      // foam collar + contact disc
      if it.R > 0 && !far && env != nil, let cl = collars {
        let lit = ocean?.searchlightLevel(it.x, it.z) ?? 0
        if it.long != nil {
          // one collar hugging the 6.06 × 2.44 m box, stretched along local +z (the box's long axis is +x → yaw + 90°)
          cl.push(it.x, it.h, it.z, it.nx, it.ny, it.nz, 1.4 * JSNumber.or(it.defK, 1), 0.75, 0.25, lit, it.phase, yaw: it.yaw + JS.PI / 2, elong: 2.4)
        } else {
          cl.push(it.x, it.h, it.z, it.nx, it.ny, it.nz, it.R, it.moored != nil ? 0.8 : 0.55, 0.25, lit, it.phase)
        }
      }
      items[i] = it
    }
  }

  /// The winch's view (FlotsamItem: source .floater, id = index in items).
  public var flotsam: [FlotsamItem] {
    items.enumerated().map { i, it in FlotsamItem(source: .floater, id: i, shape: it.shape, x: it.x, z: it.z, moored: it.moored != nil) }
  }
}

/// floaters.js buoyRhythm(kind, t, reduce): real IALA light rhythms, 0…1 at time t; reduce → soft ≤ 1 Hz
/// pulses at 40 % (photosensitivity, DESIGN §2.8).
public func buoyRhythm(_ kind: String, _ t: Double, _ reduce: Bool) -> Double {
  if reduce { return 0.4 * JS.pow(0.5 + 0.5 * JS.sin(t * JS.PI * 2 * 0.25), 3) }
  func flash(_ ph: Double, _ on: Double) -> Double { ph < on ? 1 : 0 }
  switch kind {
  case "north": return flash(JSNumber.mod(t * 1.0, 1), 0.35) // Q: continuous quick, 60/min
  case "east": // Q(3) 10 s
    let ph = JSNumber.mod(t, 10)
    return ph < 3 ? flash(JSNumber.mod(ph, 1), 0.35) : 0
  case "south": // Q(6) + LFl 15 s
    let ph = JSNumber.mod(t, 15)
    return ph < 6 ? flash(JSNumber.mod(ph, 1), 0.35) : ph < 8 ? 1 : 0
  case "west": // Q(9) 15 s
    let ph = JSNumber.mod(t, 15)
    return ph < 9 ? flash(JSNumber.mod(ph, 1), 0.35) : 0
  case "isolated": // Fl(2) 5 s
    let ph = JSNumber.mod(t, 5)
    return ph < 0.5 || (ph > 1.0 && ph < 1.5) ? 1 : 0
  default: return JSNumber.mod(t, 4) < 0.6 ? 1 : 0 // Fl Y 4 s
  }
}
