// swift-tools-version:5.9
//
// MAYDAY native core. Builds and tests on Linux (swift test) and Apple platforms.
// Lives in rescue-apple/Core, a CHILD of the directory that holds Mayday.xcodeproj: Xcode rejects a
// local package that is an ancestor of the project (project.yml `packages: Mayday: path: Core`).
//   swift test --package-path rescue-apple/Core
// Data / vectors stay at rescue-apple/{Resources,Tests/Vectors}; tests find them by walking up from
// #filePath to the directory that holds Resources/Data/manifest.json (DataCatalog.locateRoot).
// MaydayCore is pure Swift + Foundation (JSON, Data, URL); JavaScript Math.* comes from the
// small C target CJSMath (fdlibm + V8 algorithms) so results are bit-identical to Node 22
// on every platform. Render/audio/UI/app targets live in project.yml (XcodeGen), not here.
import PackageDescription

let package = Package(
  name: "Mayday",
  platforms: [.iOS(.v16), .macOS(.v13)],
  products: [
    .library(name: "MaydayCore", targets: ["MaydayCore"]),
  ],
  targets: [
    .target(
      name: "CJSMath",
      path: "Sources/CJSMath",
      linkerSettings: [.linkedLibrary("m", .when(platforms: [.linux]))]
    ),
    .target(
      name: "MaydayCore",
      dependencies: ["CJSMath"],
      path: "Sources/MaydayCore"
    ),
    .testTarget(
      name: "MaydayCoreTests",
      dependencies: ["MaydayCore", "CJSMath"],
      path: "Tests/MaydayCoreTests"
    ),
  ]
)
