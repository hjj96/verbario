// THREE.Color + THREE.ColorManagement (three.js r185 src/math/Color.js, ColorManagement.js).
//
// Named `Color3`, not `Color`: app code imports SwiftUI next to MaydayCore and SwiftUI.Color would
// make every unqualified `Color` ambiguous.
//
// Colour management as three r185 ships it (and the game never changes): the working space is
// LinearSRGB; hex numbers, CSS strings and `getHex/getHexString/getStyle` are sRGB and converted at the
// boundary; setRGB / setHSL / getRGB / getHSL default to the working space. sRGB and LinearSRGB share
// the Rec.709 primaries, so the XYZ matrices of ColorManagement never run and are not ported.
// Vectors: Tests/Vectors/math/three_color.json.

/// three's colour space strings: SRGBColorSpace 'srgb', LinearSRGBColorSpace 'srgb-linear',
/// NoColorSpace '' (no conversion at all).
public enum ColorSpace: String, Sendable {
  case none = ""
  case srgb = "srgb"
  case linearSRGB = "srgb-linear"

  /// ColorManagement.workingColorSpace
  public static let working: ColorSpace = .linearSRGB
}

/// ColorManagement: the subset of convert() reachable with three's two built-in spaces.
public enum ColorManagement {
  /// SRGBToLinear(c) = c < 0.04045 ? c * 0.0773993808 : pow(c * 0.9478672986 + 0.0521327014, 2.4)
  @inline(__always) public static func SRGBToLinear(_ c: Double) -> Double {
    (c < 0.04045) ? c * 0.0773993808 : JS.pow(c * 0.9478672986 + 0.0521327014, 2.4)
  }

  /// LinearToSRGB(c) = c < 0.0031308 ? c * 12.92 : 1.055 * pow(c, 0.41666) - 0.055
  @inline(__always) public static func LinearToSRGB(_ c: Double) -> Double {
    (c < 0.0031308) ? c * 12.92 : 1.055 * (JS.pow(c, 0.41666)) - 0.055
  }

  /// convert(color, source, target): decode the source transfer, (same primaries), encode the target.
  public static func convert(_ color: inout Color3, _ source: ColorSpace, _ target: ColorSpace) {
    if source == target || source == .none || target == .none { return }
    if source == .srgb {
      color.r = SRGBToLinear(color.r)
      color.g = SRGBToLinear(color.g)
      color.b = SRGBToLinear(color.b)
    }
    if target == .srgb {
      color.r = LinearToSRGB(color.r)
      color.g = LinearToSRGB(color.g)
      color.b = LinearToSRGB(color.b)
    }
  }

  @inline(__always) public static func workingToColorSpace(_ color: inout Color3, _ target: ColorSpace) {
    convert(&color, ColorSpace.working, target)
  }

  @inline(__always) public static func colorSpaceToWorking(_ color: inout Color3, _ source: ColorSpace) {
    convert(&color, source, ColorSpace.working)
  }
}

public struct Color3: Equatable, Sendable {
  public var r: Double
  public var g: Double
  public var b: Double

  /// new Color() = white (1, 1, 1)
  @inline(__always) public init() {
    r = 1
    g = 1
    b = 1
  }

  /// new Color(r, g, b): working-space components, no conversion (Color.set → setRGB)
  @inline(__always) public init(_ r: Double, _ g: Double, _ b: Double) {
    self.r = r
    self.g = g
    self.b = b
  }

  /// new Color(0xrrggbb): sRGB hex → working space
  public init(hex: Double) {
    self.init()
    setHex(hex)
  }

  /// new Color('#rrggbb' | 'rgb(…)' | 'hsl(…)' | name): sRGB style → working space
  public init(style: String) {
    self.init()
    setStyle(style)
  }

  public var array: [Double] { [r, g, b] }

  @inline(__always) public mutating func setScalar(_ s: Double) {
    r = s
    g = s
    b = s
  }

  /// setHex(hex, colorSpace = SRGB): hex = Math.floor(hex); channels (hex >> 16 & 255) / 255 …
  public mutating func setHex(_ hex: Double, _ colorSpace: ColorSpace = .srgb) {
    let h = JSNumber.toInt32(JS.floor(hex))
    r = Double((h >> 16) & 255) / 255
    g = Double((h >> 8) & 255) / 255
    b = Double(h & 255) / 255
    ColorManagement.colorSpaceToWorking(&self, colorSpace)
  }

  /// setRGB(r, g, b, colorSpace = working)
  public mutating func setRGB(_ r: Double, _ g: Double, _ b: Double, _ colorSpace: ColorSpace = ColorSpace.working) {
    self.r = r
    self.g = g
    self.b = b
    ColorManagement.colorSpaceToWorking(&self, colorSpace)
  }

  /// setHSL(h, s, l, colorSpace = working): h wraps (euclidean modulo 1), s and l clamp to [0, 1]
  public mutating func setHSL(_ h: Double, _ s: Double, _ l: Double, _ colorSpace: ColorSpace = ColorSpace.working) {
    let h = MathUtils.euclideanModulo(h, 1)
    let s = MathUtils.clamp(s, 0, 1)
    let l = MathUtils.clamp(l, 0, 1)
    if s == 0 {
      r = l
      g = l
      b = l
    } else {
      let p = l <= 0.5 ? l * (1 + s) : l + s - (l * s)
      let q = (2 * l) - p
      r = Color3.hue2rgb(q, p, h + 1 / 3)
      g = Color3.hue2rgb(q, p, h)
      b = Color3.hue2rgb(q, p, h - 1 / 3)
    }
    ColorManagement.colorSpaceToWorking(&self, colorSpace)
  }

  static func hue2rgb(_ p: Double, _ q: Double, _ t: Double) -> Double {
    var t = t
    if t < 0 { t += 1 }
    if t > 1 { t -= 1 }
    if t < 1 / 6 { return p + (q - p) * 6 * t }
    if t < 1 / 2 { return q }
    if t < 2 / 3 { return p + (q - p) * 6 * (2 / 3 - t) }
    return p
  }

  /// setStyle(style, colorSpace = SRGB): 'rgb(r, g, b[, a])', 'rgb(r%, g%, b%)', 'hsl(h, s%, l%[, a])',
  /// '#rgb', '#rrggbb', or a CSS colour name. Unparsable input leaves the colour unchanged (three
  /// only warns).
  public mutating func setStyle(_ style: String, _ colorSpace: ColorSpace = .srgb) {
    let u = Array(style.unicodeScalars)
    // /^(\w+)\(([^\)]*)\)/ — a function-style colour (anything may follow the closing parenthesis)
    var i = 0
    while i < u.count && CSSScan.isWord(u[i]) { i += 1 }
    if i > 0 && i < u.count && u[i] == "(" {
      if let close = u[(i + 1)...].firstIndex(of: ")") {
        let name = String(String.UnicodeScalarView(u[0..<i]))
        let components = Array(u[(i + 1)..<close])
        switch name {
        case "rgb", "rgba":
          if let c = CSSScan.triple(components, percent: false) {
            setRGB(JS.min(255, JSNumber.parseInt(c[0], 10)) / 255,
                   JS.min(255, JSNumber.parseInt(c[1], 10)) / 255,
                   JS.min(255, JSNumber.parseInt(c[2], 10)) / 255, colorSpace)
            return
          }
          if let c = CSSScan.triple(components, percent: true) {
            setRGB(JS.min(100, JSNumber.parseInt(c[0], 10)) / 100,
                   JS.min(100, JSNumber.parseInt(c[1], 10)) / 100,
                   JS.min(100, JSNumber.parseInt(c[2], 10)) / 100, colorSpace)
            return
          }
        case "hsl", "hsla":
          if let c = CSSScan.hslTriple(components) {
            setHSL(JSNumber.parseFloat(c[0]) / 360,
                   JSNumber.parseFloat(c[1]) / 100,
                   JSNumber.parseFloat(c[2]) / 100, colorSpace)
            return
          }
        default:
          break // three: warn('Unknown color model')
        }
        return
      }
    }
    // /^\#([A-Fa-f\d]+)$/
    if u.count > 1 && u[0] == "#" && u[1...].allSatisfy(CSSScan.isHexDigit) {
      let hex = String(String.UnicodeScalarView(u[1...]))
      let size = u.count - 1
      if size == 3 {
        let d = Array(hex)
        setRGB(JSNumber.parseInt(String(d[0]), 16) / 15,
               JSNumber.parseInt(String(d[1]), 16) / 15,
               JSNumber.parseInt(String(d[2]), 16) / 15, colorSpace)
      } else if size == 6 {
        setHex(JSNumber.parseInt(hex, 16), colorSpace)
      }
      return // other sizes: three warns 'Invalid hex color'
    }
    if !style.isEmpty { setColorName(style, colorSpace) }
  }

  /// setColorName(name, colorSpace = SRGB): CSS colour keywords (case-insensitive); unknown → unchanged
  public mutating func setColorName(_ style: String, _ colorSpace: ColorSpace = .srgb) {
    if let hex = Color3.names[style.lowercased()] { setHex(Double(hex), colorSpace) }
  }

  // ---- conversions ----------------------------------------------------------------------------------
  public mutating func copySRGBToLinear(_ c: Color3) {
    r = ColorManagement.SRGBToLinear(c.r)
    g = ColorManagement.SRGBToLinear(c.g)
    b = ColorManagement.SRGBToLinear(c.b)
  }

  public mutating func copyLinearToSRGB(_ c: Color3) {
    r = ColorManagement.LinearToSRGB(c.r)
    g = ColorManagement.LinearToSRGB(c.g)
    b = ColorManagement.LinearToSRGB(c.b)
  }

  public mutating func convertSRGBToLinear() { copySRGBToLinear(self) }
  public mutating func convertLinearToSRGB() { copyLinearToSRGB(self) }

  /// getHex(colorSpace = SRGB) = round(clamp(r * 255, 0, 255)) * 65536 + … (a JS number; NaN stays NaN)
  public func getHex(_ colorSpace: ColorSpace = .srgb) -> Double {
    var c = self
    ColorManagement.workingToColorSpace(&c, colorSpace)
    return JS.round(MathUtils.clamp(c.r * 255, 0, 255)) * 65536
      + JS.round(MathUtils.clamp(c.g * 255, 0, 255)) * 256
      + JS.round(MathUtils.clamp(c.b * 255, 0, 255))
  }

  /// getHexString(colorSpace = SRGB) = ('000000' + getHex().toString(16)).slice(-6)
  public func getHexString(_ colorSpace: ColorSpace = .srgb) -> String {
    let hex = getHex(colorSpace)
    let digits = hex.isNaN ? "NaN" : String(UInt32(hex), radix: 16)
    return String(("000000" + digits).suffix(6))
  }

  /// getHSL(colorSpace = working) → (h, s, l)
  public func getHSL(_ colorSpace: ColorSpace = ColorSpace.working) -> (h: Double, s: Double, l: Double) {
    var c = self
    ColorManagement.workingToColorSpace(&c, colorSpace)
    let r = c.r, g = c.g, b = c.b
    let max = JS.max(r, g, b)
    let min = JS.min(r, g, b)
    var hue = 0.0, saturation = 0.0
    let lightness = (min + max) / 2.0
    if min == max {
      hue = 0
      saturation = 0
    } else {
      let delta = max - min
      saturation = lightness <= 0.5 ? delta / (max + min) : delta / (2 - max - min)
      // switch (max) { case r … case g … case b … } — strict equality, first match wins
      if max == r {
        hue = (g - b) / delta + (g < b ? 6 : 0)
      } else if max == g {
        hue = (b - r) / delta + 2
      } else if max == b {
        hue = (r - g) / delta + 4
      } else {
        hue = .nan // unreachable for finite inputs (three leaves `hue` undefined → NaN)
      }
      hue /= 6
    }
    return (hue, saturation, lightness)
  }

  /// getRGB(colorSpace = working)
  public func getRGB(_ colorSpace: ColorSpace = ColorSpace.working) -> Color3 {
    var c = self
    ColorManagement.workingToColorSpace(&c, colorSpace)
    return c
  }

  /// getStyle(colorSpace = SRGB): 'rgb(R,G,B)' (rounded, not clamped), or 'color(<space> r g b)'
  public func getStyle(_ colorSpace: ColorSpace = .srgb) -> String {
    var c = self
    ColorManagement.workingToColorSpace(&c, colorSpace)
    if colorSpace != .srgb {
      return "color(\(colorSpace.rawValue) \(JSNumber.toFixed(c.r, 3)) \(JSNumber.toFixed(c.g, 3)) \(JSNumber.toFixed(c.b, 3)))"
    }
    return "rgb(\(JSNumber.toString(JS.round(c.r * 255))),\(JSNumber.toString(JS.round(c.g * 255))),\(JSNumber.toString(JS.round(c.b * 255))))"
  }

  /// offsetHSL(h, s, l) = setHSL(hsl.h + h, hsl.s + s, hsl.l + l)
  public mutating func offsetHSL(_ h: Double, _ s: Double, _ l: Double) {
    let hsl = getHSL()
    setHSL(hsl.h + h, hsl.s + s, hsl.l + l)
  }

  // ---- arithmetic ---------------------------------------------------------------------------------
  public mutating func add(_ c: Color3) {
    r += c.r
    g += c.g
    b += c.b
  }

  public mutating func addColors(_ c1: Color3, _ c2: Color3) {
    r = c1.r + c2.r
    g = c1.g + c2.g
    b = c1.b + c2.b
  }

  public mutating func addScalar(_ s: Double) {
    r += s
    g += s
    b += s
  }

  /// sub(c): channels floored at 0 (Math.max(0, r - c.r))
  public mutating func sub(_ c: Color3) {
    r = JS.max(0, r - c.r)
    g = JS.max(0, g - c.g)
    b = JS.max(0, b - c.b)
  }

  public mutating func multiply(_ c: Color3) {
    r *= c.r
    g *= c.g
    b *= c.b
  }

  public mutating func multiplyScalar(_ s: Double) {
    r *= s
    g *= s
    b *= s
  }

  /// lerp(c, alpha): r += (c.r - r) * alpha
  public mutating func lerp(_ c: Color3, _ alpha: Double) {
    r += (c.r - r) * alpha
    g += (c.g - g) * alpha
    b += (c.b - b) * alpha
  }

  /// lerpColors(c1, c2, alpha): r = c1.r + (c2.r - c1.r) * alpha
  public mutating func lerpColors(_ c1: Color3, _ c2: Color3, _ alpha: Double) {
    r = c1.r + (c2.r - c1.r) * alpha
    g = c1.g + (c2.g - c1.g) * alpha
    b = c1.b + (c2.b - c1.b) * alpha
  }

  /// lerpHSL(c, alpha): HSL components lerped with MathUtils.lerp, then setHSL (working space)
  public mutating func lerpHSL(_ c: Color3, _ alpha: Double) {
    let a = getHSL()
    let bb = c.getHSL()
    let h = MathUtils.lerp(a.h, bb.h, alpha)
    let s = MathUtils.lerp(a.s, bb.s, alpha)
    let l = MathUtils.lerp(a.l, bb.l, alpha)
    setHSL(h, s, l)
  }

  public mutating func setFromVector3(_ v: V3) {
    r = v.x
    g = v.y
    b = v.z
  }

  public mutating func applyMatrix3(_ m: Mat3) {
    let r = self.r, g = self.g, b = self.b
    self.r = m[0] * r + m[3] * g + m[6] * b
    self.g = m[1] * r + m[4] * g + m[7] * b
    self.b = m[2] * r + m[5] * g + m[8] * b
  }

  /// equals(c): strict === per channel
  @inline(__always) public func equals(_ c: Color3) -> Bool { c.r == r && c.g == g && c.b == b }

  /// Color.NAMES (CSS colour keywords → sRGB hex).
  public static let names: [String: UInt32] = [
    "aliceblue": 0xF0F8FF, "antiquewhite": 0xFAEBD7, "aqua": 0x00FFFF, "aquamarine": 0x7FFFD4, "azure": 0xF0FFFF,
    "beige": 0xF5F5DC, "bisque": 0xFFE4C4, "black": 0x000000, "blanchedalmond": 0xFFEBCD, "blue": 0x0000FF, "blueviolet": 0x8A2BE2,
    "brown": 0xA52A2A, "burlywood": 0xDEB887, "cadetblue": 0x5F9EA0, "chartreuse": 0x7FFF00, "chocolate": 0xD2691E, "coral": 0xFF7F50,
    "cornflowerblue": 0x6495ED, "cornsilk": 0xFFF8DC, "crimson": 0xDC143C, "cyan": 0x00FFFF, "darkblue": 0x00008B, "darkcyan": 0x008B8B,
    "darkgoldenrod": 0xB8860B, "darkgray": 0xA9A9A9, "darkgreen": 0x006400, "darkgrey": 0xA9A9A9, "darkkhaki": 0xBDB76B, "darkmagenta": 0x8B008B,
    "darkolivegreen": 0x556B2F, "darkorange": 0xFF8C00, "darkorchid": 0x9932CC, "darkred": 0x8B0000, "darksalmon": 0xE9967A, "darkseagreen": 0x8FBC8F,
    "darkslateblue": 0x483D8B, "darkslategray": 0x2F4F4F, "darkslategrey": 0x2F4F4F, "darkturquoise": 0x00CED1, "darkviolet": 0x9400D3,
    "deeppink": 0xFF1493, "deepskyblue": 0x00BFFF, "dimgray": 0x696969, "dimgrey": 0x696969, "dodgerblue": 0x1E90FF, "firebrick": 0xB22222,
    "floralwhite": 0xFFFAF0, "forestgreen": 0x228B22, "fuchsia": 0xFF00FF, "gainsboro": 0xDCDCDC, "ghostwhite": 0xF8F8FF, "gold": 0xFFD700,
    "goldenrod": 0xDAA520, "gray": 0x808080, "green": 0x008000, "greenyellow": 0xADFF2F, "grey": 0x808080, "honeydew": 0xF0FFF0, "hotpink": 0xFF69B4,
    "indianred": 0xCD5C5C, "indigo": 0x4B0082, "ivory": 0xFFFFF0, "khaki": 0xF0E68C, "lavender": 0xE6E6FA, "lavenderblush": 0xFFF0F5, "lawngreen": 0x7CFC00,
    "lemonchiffon": 0xFFFACD, "lightblue": 0xADD8E6, "lightcoral": 0xF08080, "lightcyan": 0xE0FFFF, "lightgoldenrodyellow": 0xFAFAD2, "lightgray": 0xD3D3D3,
    "lightgreen": 0x90EE90, "lightgrey": 0xD3D3D3, "lightpink": 0xFFB6C1, "lightsalmon": 0xFFA07A, "lightseagreen": 0x20B2AA, "lightskyblue": 0x87CEFA,
    "lightslategray": 0x778899, "lightslategrey": 0x778899, "lightsteelblue": 0xB0C4DE, "lightyellow": 0xFFFFE0, "lime": 0x00FF00, "limegreen": 0x32CD32,
    "linen": 0xFAF0E6, "magenta": 0xFF00FF, "maroon": 0x800000, "mediumaquamarine": 0x66CDAA, "mediumblue": 0x0000CD, "mediumorchid": 0xBA55D3,
    "mediumpurple": 0x9370DB, "mediumseagreen": 0x3CB371, "mediumslateblue": 0x7B68EE, "mediumspringgreen": 0x00FA9A, "mediumturquoise": 0x48D1CC,
    "mediumvioletred": 0xC71585, "midnightblue": 0x191970, "mintcream": 0xF5FFFA, "mistyrose": 0xFFE4E1, "moccasin": 0xFFE4B5, "navajowhite": 0xFFDEAD,
    "navy": 0x000080, "oldlace": 0xFDF5E6, "olive": 0x808000, "olivedrab": 0x6B8E23, "orange": 0xFFA500, "orangered": 0xFF4500, "orchid": 0xDA70D6,
    "palegoldenrod": 0xEEE8AA, "palegreen": 0x98FB98, "paleturquoise": 0xAFEEEE, "palevioletred": 0xDB7093, "papayawhip": 0xFFEFD5, "peachpuff": 0xFFDAB9,
    "peru": 0xCD853F, "pink": 0xFFC0CB, "plum": 0xDDA0DD, "powderblue": 0xB0E0E6, "purple": 0x800080, "rebeccapurple": 0x663399, "red": 0xFF0000, "rosybrown": 0xBC8F8F,
    "royalblue": 0x4169E1, "saddlebrown": 0x8B4513, "salmon": 0xFA8072, "sandybrown": 0xF4A460, "seagreen": 0x2E8B57, "seashell": 0xFFF5EE,
    "sienna": 0xA0522D, "silver": 0xC0C0C0, "skyblue": 0x87CEEB, "slateblue": 0x6A5ACD, "slategray": 0x708090, "slategrey": 0x708090, "snow": 0xFFFAFA,
    "springgreen": 0x00FF7F, "steelblue": 0x4682B4, "tan": 0xD2B48C, "teal": 0x008080, "thistle": 0xD8BFD8, "tomato": 0xFF6347, "turquoise": 0x40E0D0,
    "violet": 0xEE82EE, "wheat": 0xF5DEB3, "white": 0xFFFFFF, "whitesmoke": 0xF5F5F5, "yellow": 0xFFFF00, "yellowgreen": 0x9ACD32,
  ]
}

/// Hand-written equivalents of the regular expressions Color.setStyle uses (JS `\s` = ECMAScript
/// WhiteSpace + LineTerminator, `\d` = ASCII digits, `\w` = [A-Za-z0-9_]).
enum CSSScan {
  static func isWord(_ c: Unicode.Scalar) -> Bool {
    (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == "_"
  }

  static func isDigit(_ c: Unicode.Scalar) -> Bool { c >= "0" && c <= "9" }

  static func isHexDigit(_ c: Unicode.Scalar) -> Bool {
    isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F")
  }

  struct Cursor {
    let u: [Unicode.Scalar]
    var i = 0
    var atEnd: Bool { i >= u.count }
    mutating func skipSpace() { while i < u.count && JSNumber.isJSWhitespace(u[i]) { i += 1 } }
    mutating func eat(_ c: Unicode.Scalar) -> Bool {
      if i < u.count && u[i] == c {
        i += 1
        return true
      }
      return false
    }
    /// (\d+)
    mutating func digits() -> String? {
      let s = i
      while i < u.count && CSSScan.isDigit(u[i]) { i += 1 }
      return i > s ? String(String.UnicodeScalarView(u[s..<i])) : nil
    }
    /// (\d*\.?\d+) — the longest such token (the regex's greedy choice, given the separators that follow)
    mutating func decimal() -> String? {
      let s = i
      var j = i
      while j < u.count && CSSScan.isDigit(u[j]) { j += 1 }
      if j < u.count && u[j] == "." {
        var k = j + 1
        while k < u.count && CSSScan.isDigit(u[k]) { k += 1 }
        if k > j + 1 {
          i = k
          return String(String.UnicodeScalarView(u[s..<i]))
        }
      }
      if j > s {
        i = j
        return String(String.UnicodeScalarView(u[s..<i]))
      }
      return nil
    }
  }

  /// `^\s*(\d+)%?\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*(?:,\s*(\d*\.?\d+)\s*)?$` (the `%` present iff `percent`)
  static func triple(_ u: [Unicode.Scalar], percent: Bool) -> [String]? {
    var c = Cursor(u: u)
    var out = [String]()
    for k in 0..<3 {
      c.skipSpace()
      guard let d = c.digits() else { return nil }
      if percent && !c.eat("%") { return nil }
      out.append(d)
      c.skipSpace()
      if k < 2 && !c.eat(",") { return nil }
    }
    return alphaTail(&c) ? out : nil
  }

  /// `^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$`
  static func hslTriple(_ u: [Unicode.Scalar]) -> [String]? {
    var c = Cursor(u: u)
    var out = [String]()
    for k in 0..<3 {
      c.skipSpace()
      guard let d = c.decimal() else { return nil }
      if k > 0 && !c.eat("%") { return nil }
      out.append(d)
      c.skipSpace()
      if k < 2 && !c.eat(",") { return nil }
    }
    return alphaTail(&c) ? out : nil
  }

  /// `(?:,\s*(\d*\.?\d+)\s*)?$` after the third component's trailing `\s*`
  static func alphaTail(_ c: inout Cursor) -> Bool {
    if c.atEnd { return true }
    guard c.eat(",") else { return false }
    c.skipSpace()
    guard c.decimal() != nil else { return false }
    c.skipSpace()
    return c.atEnd
  }
}
