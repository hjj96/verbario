// heli/lights.js HeliLights (DESIGN §2.9, §2.7.1, §4 #3/#7/#8): emissive bulbs (one additive draw, per-
// channel intensities), the belly PointLight that makes the sea under the heli pulse red/white at night,
// the light spill painted onto the hull, and every lamp's reflection on the water via ocean.addGlint().
//
// Timings: nav red/green/white steady; roof + belly beacon rotate, pow(cos, 8) at 0.9 Hz; white strobes
// double-flash 0–45 / 140–185 ms every 1.1 s; door #B3121A while the winch is out; St. Elmo's fire
// crackles on the nose probes. reduceFlashes: strobes at 40 %, single flash (≤ 1 Hz).
//
// `chan` is the lights material's uChan Float32Array in the web: values are rounded to Float where JS
// stores them and read back as those floats (the glint / spill gains use the stored values).

public final class HeliLights {
  static let STROBE_PERIOD: Double = 1.1
  static let BEACON_HZ: Double = 0.9
  public static let LIGHT_CHANNELS = 10
  public static let HULL_GLOWS = 8

  /// Emissive gains (×6–14 per DESIGN) — HDR so bloom picks them up.
  enum GAIN {
    static let nav: Double = 7, navWhite: Double = 6, beacon: Double = 10, strobe: Double = 14, door: Double = 7
    static let elmo: Double = 9, lens: Double = 12, flir: Double = 0
  }

  /// Belly light candela per source (tuned so the night sea visibly pulses under the heli).
  enum BELLY {
    static let strobe: Double = 3400, beacon: Double = 1500, door: Double = 1100
  }

  public enum COL {
    public static let red = Color3(style: "#FF2015")
    public static let green = Color3(style: "#12FF6E")
    public static let white = Color3(style: "#FFFFFF")
    public static let beacon = Color3(style: "#FF1A10")
    public static let door = Color3(style: "#B3121A")
    public static let lens = Color3(style: "#FFF1DA")
  }

  typealias CH = HeliModel.Channel

  /// Glint sources: [point, colour, channel, base glint intensity]
  static let GLINTS: [(point: V3, color: Color3, ch: CH, base: Double)] = [
    (HeliModel.Points.navPort, COL.red, .navRed, 0.35),
    (HeliModel.Points.navStbd, COL.green, .navGreen, 0.35),
    (HeliModel.Points.navTail, COL.white, .navWhite, 0.1), // steady white: small, never a white disc between strobes
    (HeliModel.Points.beacon, COL.beacon, .beacon, 0.6),
    (HeliModel.Points.strobeL, COL.white, .strobe, 1.0),
    (HeliModel.Points.strobeR, COL.white, .strobe, 1.0),
    (HeliModel.Points.door, COL.door, .door, 0.5),
    (HeliModel.Points.lens, COL.lens, .lens, 0.25),
  ]

  /// Light spill painted onto the hull (local glow slots of the hull material): [point, colour, channel, radius m, gain]
  static let SPILL: [(point: V3, color: Color3, ch: CH, radius: Double, gain: Double)] = [
    (HeliModel.Points.strobeL, COL.white, .strobe, 2.4, 0.05),
    (HeliModel.Points.strobeR, COL.white, .strobe, 2.4, 0.05),
    (HeliModel.Points.beacon, COL.beacon, .beacon, 2.2, 0.07),
    (HeliModel.Points.beaconLow, COL.beacon, .beacon, 2.0, 0.06),
    (HeliModel.Points.navPort, COL.red, .navRed, 1.5, 0.05),
    (HeliModel.Points.navStbd, COL.green, .navGreen, 1.5, 0.05),
    (HeliModel.Points.door, COL.door, .door, 1.8, 0.08),
    (HeliModel.Points.lens, COL.lens, .lens, 1.5, 0.05),
  ]

  let ctx: SimContext
  var t: Double = 0
  /// 0..1 current strobe output (HUD / audio / post read it)
  public internal(set) var strobe: Double = 0
  public internal(set) var beacon: Double = 0
  public internal(set) var door: Double = 0
  let blinkSeed: Double
  var lensLevel: Double = 0

  /// lights material uChan (Float32Array(LIGHT_CHANNELS)) and uHalo
  public internal(set) var chan = [Float](repeating: 0, count: LIGHT_CHANNELS)
  public internal(set) var halo: Double = 0.35
  /// belly PointLight (0xffffff, 0, 90 m, decay 2) at POINTS.belly on the body: colour (normalised) and intensity
  public internal(set) var bellyColor = Color3(1, 1, 1)
  public internal(set) var bellyIntensity: Double = 0
  /// hull material uGlowPos (xyz + radius) / uGlowCol
  public internal(set) var glowPos = [V4](repeating: V4(0, -100, 0, 1), count: HULL_GLOWS)
  public internal(set) var glowCol = [Color3](repeating: Color3(0, 0, 0), count: HULL_GLOWS)

  init(ctx: SimContext) {
    self.ctx = ctx
    blinkSeed = ctx.random() * 10
  }

  /// h = Helicopter (public state). dt = game seconds; `body` = the airframe body's matrixWorld.
  func update(_ dt: Double, _ h: Helicopter, body: Mat4) {
    let st = ctx.weatherState
    let night = JSNumber.or(st.night, 0)
    let reduce = ctx.settings.get("reduceFlashes").jsTruthy
    t += dt
    let t = self.t
    let powered = h.rotorRPM > 0.05 || h.alive

    // --- strobe: double flash (single, dimmer when reduceFlashes) ------------------------------
    let ph = JSNumber.mod(t, HeliLights.STROBE_PERIOD)
    var strobe: Double = ph < 0.045 ? 1 : !reduce && ph >= 0.14 && ph < 0.185 ? 1 : 0
    if reduce { strobe *= 0.4 }
    if !powered { strobe = 0 }
    self.strobe = strobe

    // --- rotating beacon --------------------------------------------------------------------------
    let beacon = JS.pow(JS.max(0, JS.cos(t * HeliLights.BEACON_HZ * JS.PI * 2)), 8)
    self.beacon = beacon

    // --- door light while the winch is out (eased) ---------------------------------------------
    let doorT: Double = h.winch.state != .stowed && h.alive ? 1 : 0
    door += (doorT - door) * (1 - JS.exp(-dt * 6))

    // --- nav lights; below 25 % hull the green one blinks erratically ---------------------------
    var green: Double = 1
    if h.hull < 0.25 {
      let f = JS.sin(t * 13.1 + blinkSeed) + JS.sin(t * 7.3) * 0.8 + JS.sin(t * 29.0) * 0.5
      green = f > 0.6 ? 0.08 : 1
    }
    let navOn: Double = h.ditched ? 0 : 1

    // --- St. Elmo's fire on the nose probes (30 Hz crackle) ---------------------------------------
    let elmo = JSNumber.or(st.stElmo, 0)
    let crack = JS.sin(JS.floor(t * 30) * 12.9898) * 43758.5453
    let crackle = elmo > 0.01 ? elmo * (0.35 + (crack - JS.floor(crack) > 0.45 ? 1 : 0)) : 0

    // --- searchlight lens --------------------------------------------------------------------------
    lensLevel = h.beam.intensity

    chan[CH.navRed.rawValue] = Float(GAIN.nav * navOn)
    chan[CH.navGreen.rawValue] = Float(GAIN.nav * navOn * green)
    chan[CH.navWhite.rawValue] = Float(GAIN.navWhite * navOn)
    chan[CH.beacon.rawValue] = Float(GAIN.beacon * (0.06 + 0.94 * beacon) * (powered ? 1 : 0))
    chan[CH.strobe.rawValue] = Float(GAIN.strobe * strobe)
    chan[CH.door.rawValue] = Float(GAIN.door * door)
    chan[CH.elmo.rawValue] = Float(GAIN.elmo * crackle)
    chan[CH.lens.rawValue] = Float(GAIN.lens * lensLevel)
    chan[CH.flir.rawValue] = 0
    // Halos: a touch by day, stronger at night; low quality (no bloom) relies on them entirely.
    let low = ctx.settings.get("quality").string == "low"
    halo = (low ? 0.9 : 0.2) * (0.03 + 0.97 * night * night)

    // --- belly PointLight: pulses with strobes / beacon, red door light while winching ----------
    let W = COL.white, B = COL.beacon, D = COL.door
    var c = Color3(0, 0, 0)
    c.r += W.r * BELLY.strobe * strobe + B.r * BELLY.beacon * beacon + D.r * BELLY.door * door
    c.g += W.g * BELLY.strobe * strobe + B.g * BELLY.beacon * beacon + D.g * BELLY.door * door
    c.b += W.b * BELLY.strobe * strobe + B.b * BELLY.beacon * beacon + D.b * BELLY.door * door
    let I = JS.max(c.r, c.g, c.b)
    if I > 1e-3 { bellyColor.setRGB(c.r / I, c.g / I, c.b / I) }
    // By day the effect is invisible anyway; keep it physically modest so it never fights the sun.
    // Keep the pool on the surface roughly constant: E = I/d², so scale by (d/20 m)² near the surface
    // (otherwise the strobe floods the deck when parked).
    let d = JS.max(0.5, (h.position.y + HeliModel.Points.belly.y) - JSNumber.or(h.surfaceY, 0))
    let near = JS.min(1, (d / 20) * (d / 20))
    bellyIntensity = powered ? I * near * (0.08 + 0.92 * night) : 0

    spill(night)
    glints(h, night, body)
  }

  /// Feed the hull material's local glow slots (only matters at night; free by day).
  func spill(_ night: Double) {
    let k = 0.1 + 0.9 * night
    for i in 0..<min(HeliLights.SPILL.count, glowPos.count) {
      let sp = HeliLights.SPILL[i]
      let p = sp.point
      glowPos[i].set(p.x, p.y, p.z, sp.radius)
      var col = sp.color
      col.multiplyScalar(Double(chan[sp.ch.rawValue]) * sp.gain * k)
      glowCol[i] = col
    }
  }

  /// Reflections on the water: mirror each light through the local sea plane and intersect the
  /// camera→mirror ray with it, so the glint sits where a real reflection would be. Seen from the
  /// cinematic heights a lamp's reflection is a small wave-broken sparkle, not a blob bigger than the
  /// aircraft: radius and gain shrink with camera height, and the steady lamps are capped well below
  /// the strobe (the ocean's specular term breaks what is left up on the wave facets).
  func glints(_ h: Helicopter, _ night: Double, _ body: Mat4) {
    guard let ocean = ctx.ocean, ocean.acceptsGlints else { return }
    let cam = ctx.camera.position
    let sea = JSNumber.or(h.seaY, 0)
    let scale = 0.05 + 0.95 * night * night // reflections of small lamps only matter after dusk
    let alt = MathUtil.smoothLook(90, 360, cam.y - sea)
    let rK = 1 - 0.62 * alt
    let iK = 1 - 0.6 * alt
    for g in HeliLights.GLINTS {
      let I = Double(chan[g.ch.rawValue]) / 10
      if I < 0.02 { continue }
      var w = g.point
      w.applyMatrix4(body)
      let hgt = w.y - sea
      if hgt < 0.2 { continue }
      let my = sea - hgt // mirrored light height
      let t = (cam.y - sea) / JS.max(0.01, cam.y - my)
      let gx = cam.x + (w.x - cam.x) * t
      let gz = cam.z + (w.z - cam.z) * t
      let r = (0.75 + 0.035 * hgt) * rK
      var gi = I * g.base * scale * iK
      if g.ch != .strobe { gi = JS.min(gi, 0.3) }
      ocean.addGlint(gx, gz, r, gi, g.color)
    }
  }
}
