// GoldenSupport — access to Tests/Goldens (tools/export/render-goldens.mjs) for MaydayRenderTests, plus the
// comparison helpers of PLAN §5.4 (bit-exact Doubles with an ulp report, Float32 uploads, image metrics).
//
// Where the goldens are found, in order:
//   1. $MAYDAY_GOLDENS (a directory with the Tests/Goldens layout);
//   2. the test bundle's copy (project.yml: Tests/Goldens as a folder reference → <bundle>/Resources/Goldens;
//      the macOS test host is sandboxed, so the source tree is not readable from inside it);
//   3. the source tree: up from this file to rescue-apple/Tests/Goldens (Linux runs, unsandboxed hosts).
import Foundation
import XCTest
import Metal
import MaydayCore
@testable import MaydayApp

private final class GoldenBundleToken {}

enum Goldens {
  static func directory(file: String = #filePath) throws -> URL {
    let fm = FileManager.default
    if let env = ProcessInfo.processInfo.environment["MAYDAY_GOLDENS"], fm.fileExists(atPath: env) {
      return URL(fileURLWithPath: env, isDirectory: true)
    }
    if let res = Bundle(for: GoldenBundleToken.self).resourceURL?.appendingPathComponent("Goldens"),
       fm.fileExists(atPath: res.appendingPathComponent("lighting").path) {
      return res
    }
    var dir = URL(fileURLWithPath: file).deletingLastPathComponent()
    for _ in 0..<6 {
      let cand = dir.appendingPathComponent("Goldens")
      if fm.fileExists(atPath: cand.appendingPathComponent("lighting").path) { return cand }
      dir = dir.deletingLastPathComponent()
    }
    throw XCTSkip("Tests/Goldens not found (run tools/export/render-goldens.mjs, or set MAYDAY_GOLDENS)")
  }

  static func url(_ rel: String) throws -> URL { try directory().appendingPathComponent(rel) }

  /// The `data` member of a wrapped golden file (exact JSON: numbers are the JS doubles).
  static func data(_ rel: String) throws -> JSONValue {
    let root = try JSONValue.load(contentsOf: url(rel))
    let d = root["data"]
    if d.isNull { throw JSONError("\(rel): no data") }
    return d
  }

  /// Golden files of one directory (sorted relative paths with the given extension).
  static func list(_ dir: String, ext: String = "json") throws -> [String] {
    let base = try url(dir)
    let names = try FileManager.default.contentsOfDirectory(atPath: base.path).filter { $0.hasSuffix("." + ext) }.sorted()
    return names.map { dir + "/" + $0 }
  }
}

/// GPU tests run on a Mac (or any Metal device); elsewhere — CI without a GPU, the Linux pre-flight with the
/// SDK stubs — they skip instead of failing.
func requireMetalDevice() throws -> MTLDevice {
  guard let d = MTLCreateSystemDefaultDevice() else { throw XCTSkip("no Metal device") }
  return d
}

// ---- JSON → values ----------------------------------------------------------------------------------------
extension JSONValue {
  func num(_ what: @autoclosure () -> String = "number") throws -> Double { try requireDouble(what()) }
  func nums(_ what: @autoclosure () -> String = "numbers") throws -> [Double] { try requireDoubles(what()) }
  func v3() throws -> V3 {
    let a = try nums("vec3")
    guard a.count == 3 else { throw JSONError("vec3 with \(a.count) components") }
    return V3(a[0], a[1], a[2])
  }
  func color() throws -> PaletteColor {
    let a = try nums("colour")
    guard a.count == 3 else { throw JSONError("colour with \(a.count) components") }
    return PaletteColor(a[0], a[1], a[2])
  }
  func simd2() throws -> SIMD2<Double> {
    let a = try nums("vec2")
    guard a.count == 2 else { throw JSONError("vec2 with \(a.count) components") }
    return SIMD2<Double>(a[0], a[1])
  }
  func simd3() throws -> SIMD3<Double> {
    let a = try nums("vec3")
    guard a.count == 3 else { throw JSONError("vec3 with \(a.count) components") }
    return SIMD3<Double>(a[0], a[1], a[2])
  }
  /// null / missing → nil.
  var optionalDouble: Double? { isNull ? nil : double }
}

/// The palette fields render-goldens.mjs exports (paletteJSON): light, env bake and post inputs.
func goldenPalette(_ j: JSONValue) throws -> Palette {
  var p = Palette()
  p.sky = try j["sky"].color()
  p.fogColor = try j["fogColor"].color()
  p.deep = try j["deep"].color()
  p.sun = try j["sun"].color()
  p.ambient = try j["ambient"].color()
  p.ambientGround = try j["ambientGround"].color()
  p.sunIntensity = try j["sunIntensity"].num()
  p.ambientIntensity = try j["ambientIntensity"].num()
  p.shadowIntensity = try j["shadowIntensity"].num()
  p.shadowRadius = try j["shadowRadius"].num()
  p.exposure = try j["exposure"].num()
  p.envIntensity = try j["envIntensity"].num()
  p.fog = try j["fog"].num()
  p.scud = try j["scud"].num()
  p.fogNear = try j["fogNear"].num()
  p.fogFar = try j["fogFar"].num()
  p.sea.whitecaps = try j["sea"]["whitecaps"].num()
  let q = j["post"]
  p.post.bloomStrength = try q["bloomStrength"].num()
  p.post.bloomRadius = try q["bloomRadius"].num()
  p.post.bloomThreshold = try q["bloomThreshold"].num()
  p.post.saturation = try q["saturation"].num()
  p.post.contrast = try q["contrast"].num()
  p.post.slope = try q["slope"].v3()
  p.post.offset = try q["offset"].v3()
  p.post.power = try q["power"].num()
  p.post.splitShadow = try q["splitShadow"].color()
  p.post.splitHighlight = try q["splitHighlight"].color()
  p.post.splitStrength = try q["splitStrength"].num()
  p.post.vignette = try q["vignette"].num()
  p.post.vignetteColor = try q["vignetteColor"].color()
  p.post.grain = try q["grain"].num()
  p.post.ca = try q["ca"].num()
  p.post.drops = try q["drops"].num()
  return p
}

// ---- comparisons ------------------------------------------------------------------------------------------
/// Distance in units in the last place between two Doubles (0 = identical bits; Int.max across signs / NaN).
func ulpDistance(_ a: Double, _ b: Double) -> Int {
  if a.bitPattern == b.bitPattern { return 0 }
  if a.isNaN || b.isNaN || (a.sign != b.sign && a != 0 && b != 0) { return Int.max }
  let ia = Int64(bitPattern: a.bitPattern & 0x7FFF_FFFF_FFFF_FFFF)
  let ib = Int64(bitPattern: b.bitPattern & 0x7FFF_FFFF_FFFF_FFFF)
  return Int(abs(ia - ib))
}

/// Bit-exact Double comparison (PLAN §5.4): reports both values and the ulp distance.
func assertBits(_ swift: Double, _ web: Double, _ what: @autoclosure () -> String,
                file: StaticString = #filePath, line: UInt = #line) {
  if swift.bitPattern != web.bitPattern && !(swift.isNaN && web.isNaN) {
    XCTFail("\(what()): swift \(swift) web \(web) (\(ulpDistance(swift, web)) ulp)", file: file, line: line)
  }
}

func assertBits(_ swift: [Double], _ web: [Double], _ what: @autoclosure () -> String,
                file: StaticString = #filePath, line: UInt = #line) {
  guard swift.count == web.count else {
    XCTFail("\(what()): \(swift.count) values, web \(web.count)", file: file, line: line)
    return
  }
  for i in 0..<swift.count { assertBits(swift[i], web[i], "\(what())[\(i)]", file: file, line: line) }
}

func assertBits(_ swift: V3, _ web: JSONValue, _ what: @autoclosure () -> String,
                file: StaticString = #filePath, line: UInt = #line) {
  assertBits([swift.x, swift.y, swift.z], (try? web.nums()) ?? [], what(), file: file, line: line)
}

func assertBits(_ swift: PaletteColor, _ web: JSONValue, _ what: @autoclosure () -> String,
                file: StaticString = #filePath, line: UInt = #line) {
  assertBits([swift.r, swift.g, swift.b], (try? web.nums()) ?? [], what(), file: file, line: line)
}

/// A value three uploads as a GLSL float: the port's Float must equal Float(js double).
func assertFloat(_ swift: Float, _ web: Double, _ what: @autoclosure () -> String,
                 file: StaticString = #filePath, line: UInt = #line) {
  if swift.bitPattern != Float(web).bitPattern {
    XCTFail("\(what()): swift \(swift) web Float(\(web)) = \(Float(web))", file: file, line: line)
  }
}
