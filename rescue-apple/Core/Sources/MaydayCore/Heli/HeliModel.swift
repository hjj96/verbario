// heli/model.js: the airframe's named points and sizes that gameplay code reads (the mesh itself is
// baked to heli_*.mmesh, PLAN §6). Local frame: nose → −Z, up +Y, starboard (right) +X; origin = the
// rotor-mast axis at mid-fuselage; skids at y = −1.6. HeliDataTests checks these against
// Resources/Data/heli.json (`heli/model`).

public enum HeliModel {
  /// Main rotor radius (m).
  public static let ROTOR_R: Double = 8.1
  /// Tail rotor radius (m).
  public static let TAIL_R: Double = 1.4
  /// Skid height below the origin (m).
  public static let SKID_Y: Double = -1.6

  /// POINTS: key named points (local) used by the lights, searchlight, winch, smoke…
  public enum Points {
    /// Winch cable top (boom tip, starboard door).
    public static let hoist = V3(2.12, 0.6, -1.45)
    public static let door = V3(1.24, 0.52, -1.45)
    /// Searchlight lens.
    public static let lens = V3(0.55, -1.42, -4.02)
    /// Belly PointLight.
    public static let belly = V3(0, -2.6, -0.2)
    public static let exhaustL = V3(-0.86, 1.36, 2.72)
    public static let exhaustR = V3(0.86, 1.36, 2.72)
    public static let navPort = V3(-2.15, -0.56, 0.62)
    public static let navStbd = V3(2.15, -0.56, 0.62)
    public static let navTail = V3(0, 0.74, 10.12)
    public static let beacon = V3(0, 1.6, 1.8)
    public static let beaconLow = V3(0, -1.1, 0.7)
    public static let strobeL = V3(-1.68, 0.82, 8.56)
    public static let strobeR = V3(1.68, 0.82, 8.56)
    public static let probeL = V3(-0.3, -0.16, -5.95)
    public static let probeR = V3(0.3, -0.16, -5.95)
    public static let mast = V3(0, 2.12, -0.3)
    public static let tailRotor = V3(-0.27, 2.1, 9.95)

    /// Every point by its web name (data check, renderer lookups).
    public static let all: [String: V3] = [
      "hoist": hoist, "door": door, "lens": lens, "belly": belly, "exhaustL": exhaustL, "exhaustR": exhaustR,
      "navPort": navPort, "navStbd": navStbd, "navTail": navTail, "beacon": beacon, "beaconLow": beaconLow,
      "strobeL": strobeL, "strobeR": strobeR, "probeL": probeL, "probeR": probeR, "mast": mast, "tailRotor": tailRotor,
    ]
  }

  /// CH: light channels (index into the lights material uChan[]).
  public enum Channel: Int, CaseIterable, Sendable {
    case navRed = 0, navGreen, navWhite, beacon, strobe, door, elmo, lens, flir
  }
}
