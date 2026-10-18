// Linux check of the Swift .mmesh parser (Sources/MaydayRender/Mesh/MMeshFile.swift) against the JS decoder
// (tools/meshfmt/read.mjs): for every file in the summary written by `verify.mjs --summary`, the header,
// tables, bounds, stream bytes (FNV-1a), decoded first / last values, index stream and meta block must agree,
// and corrupted copies must be rejected. Built and run by tools/meshfmt/check-loader.sh.
import Foundation

func fnv1a<S: Sequence>(_ bytes: S) -> UInt32 where S.Element == UInt8 {
  var h: UInt32 = 0x811c9dc5
  for b in bytes { h = (h ^ UInt32(b)) &* 0x01000193 }
  return h
}

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: loader-check <meshes dir> <summary.json>"); exit(2) }
let dir = URL(fileURLWithPath: args[1], isDirectory: true)
let summary = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[2]))) as! [String: Any]
let files = summary["files"] as! [String: [String: Any]]
var problems: [String] = []
func check(_ ok: Bool, _ what: @autoclosure () -> String) { if !ok { problems.append(what()) } }
func num(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? .nan }

for name in files.keys.sorted() {
  let s = files[name]!
  let data = try Data(contentsOf: dir.appendingPathComponent(name))
  let m: MMeshFile
  do { m = try MMeshFile(data: data) } catch { problems.append("\(name): \(error)"); continue }
  check(m.vertexCount == Int(num(s["vertexCount"])), "\(name): vertexCount \(m.vertexCount)")
  check(m.indexCount == Int(num(s["indexCount"])), "\(name): indexCount \(m.indexCount)")
  check(m.indexed == (s["indexed"] as? Bool), "\(name): indexed")
  check(m.metaJSON.count == Int(num(s["metaLength"])), "\(name): meta length")
  check(fnv1a(m.metaJSON) == UInt32(num(s["metaFnv"])), "\(name): meta bytes")
  let bounds = (s["bounds"] as! [Any]).map { Float(num($0)) }
  let mine = [m.sphereCenter.x, m.sphereCenter.y, m.sphereCenter.z, m.sphereRadius,
              m.boxMin.x, m.boxMin.y, m.boxMin.z, m.boxMax.x, m.boxMax.y, m.boxMax.z]
  check(bounds == mine, "\(name): bounds \(mine) vs \(bounds)")
  let ranges = s["ranges"] as! [[String: Any]]
  check(ranges.count == m.ranges.count, "\(name): range count")
  for (r, js) in zip(m.ranges, ranges) {
    check(r.name == js["name"] as? String && r.start == Int(num(js["start"])) && r.count == Int(num(js["count"])), "\(name): range \(r.name)")
  }
  let attrs = s["attributes"] as! [[String: Any]]
  check(attrs.count == m.attributes.count, "\(name): attribute count")
  for (a, js) in zip(m.attributes, attrs) {
    check(a.name == js["name"] as? String, "\(name): attribute \(a.name)")
    check(Int(a.format.rawValue) == Int(num(js["format"])) && a.components == Int(num(js["components"])) && a.offset == Int(num(js["offset"])),
          "\(name): \(a.name) layout")
    check(fnv1a(m.raw(a)) == UInt32(num(js["fnv"])), "\(name): \(a.name) stream bytes")
    let f = m.floats(a)
    let first = (js["first"] as! [Any]).map { Float(num($0)) }
    let last = (js["last"] as! [Any]).map { Float(num($0)) }
    check(Array(f.prefix(a.components)) == first && Array(f.suffix(a.components)) == last, "\(name): \(a.name) decoded values")
  }
  if m.indexed {
    var ib: [UInt8] = []
    for i in m.indices() { ib += [UInt8(i & 0xff), UInt8(i >> 8 & 0xff), UInt8(i >> 16 & 0xff), UInt8(i >> 24)] }
    check(fnv1a(ib) == UInt32(num(s["indexFnv"])), "\(name): index stream")
  }
  // corrupted copies must be rejected
  var b = [UInt8](data)
  b[0] = 0x58
  check((try? MMeshFile(bytes: b)) == nil, "\(name): bad magic accepted")
  b = [UInt8](data)
  b[4] = 2
  check((try? MMeshFile(bytes: b)) == nil, "\(name): version 2 accepted")
  b = [UInt8](data)
  b.append(contentsOf: [UInt8](repeating: 0, count: 16))
  check((try? MMeshFile(bytes: b)) == nil, "\(name): trailing bytes accepted")
  if m.indexed {
    b = [UInt8](data)
    b[m.indexOffset] = 0xff; b[m.indexOffset + 1] = 0xff; b[m.indexOffset + 2] = 0xff
    check((try? MMeshFile(bytes: b)) == nil, "\(name): index out of range accepted")
  }
}

if problems.isEmpty {
  print("loader-check: ok (\(files.count) files parsed by MMeshFile.swift, identical to read.mjs)")
} else {
  for p in problems.prefix(40) { print("  " + p) }
  print("loader-check: \(problems.count) problem(s)")
  exit(1)
}
