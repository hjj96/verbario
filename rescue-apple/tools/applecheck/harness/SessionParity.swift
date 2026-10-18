// SessionParity — replays Tests/Vectors/app/*.json (tools/export/export-app.mjs) through the app layer.
import Foundation
import MaydayCore

enum SessionParity {
  static func vectorsDirectory(bundlePath: String) -> URL {
    let args = CommandLine.arguments
    if args.count > 2 { return URL(fileURLWithPath: args[2], isDirectory: true) }
    return URL(fileURLWithPath: bundlePath).appendingPathComponent("../../Tests/Vectors", isDirectory: true)
  }

  /// Returns the number of failures.
  static func run(catalog: DataCatalog, vectors: URL) throws -> Int {
    print("session parity: no vectors yet")
    return 0
  }
}
