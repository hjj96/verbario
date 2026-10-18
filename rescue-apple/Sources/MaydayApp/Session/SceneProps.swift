// SceneProps — the free-flight scene's stand-in meshes, drawn by MaydayRender's StandardFamily
// (MeshStandardMaterial, three r185 geometry):
//   * each pad's stubs.js World object: CylinderGeometry(12, 12, 4, 24), #555555, at (x, 2, z);
//   * the helicopter: the web's stub airframe, BoxGeometry(3, 2, 10) #FF5A2A (stubs.js Helicopter), placed
//     with the real Helicopter's body matrix (interpolated position, heading, pitch / bank springs) and
//     casting the sun's shadow (the «shadow altimeter», DESIGN §2.7.2) — until MaydayRender's HeliRenderer
//     draws the baked airframe (PLAN §2.9 heli/model.js row, M3 render-heli).
// Transforms are plain values (`placements`) so the harness can check them without a GPU.
import Foundation
import Metal
import simd
import MaydayCore

/// three r185 CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments = 1,
/// openEnded = false, thetaStart = 0, thetaLength = 2π): torso, then the top cap, then the bottom cap.
enum ThreeCylinderGeometry {
  static func make(radiusTop: Double, radiusBottom: Double, height: Double, radialSegments: Int, heightSegments: Int = 1)
    -> (positions: [Float], normals: [Float], uvs: [Float], indices: [UInt32]) {
    var positions: [Float] = [], normals: [Float] = [], uvs: [Float] = [], indices: [UInt32] = []
    var index: UInt32 = 0
    let halfHeight = height / 2
    let thetaStart = 0.0
    let thetaLength = JS.PI * 2

    // generateTorso()
    var indexArray: [[UInt32]] = []
    let slope = (radiusBottom - radiusTop) / height
    for y in 0...heightSegments {
      var row: [UInt32] = []
      let v = Double(y) / Double(heightSegments)
      let radius = v * (radiusBottom - radiusTop) + radiusTop
      for x in 0...radialSegments {
        let u = Double(x) / Double(radialSegments)
        let theta = u * thetaLength + thetaStart
        let sinTheta = JS.sin(theta)
        let cosTheta = JS.cos(theta)
        positions += [Float(radius * sinTheta), Float(-v * height + halfHeight), Float(radius * cosTheta)]
        let n = V3(sinTheta, slope, cosTheta).normalized()
        normals += [Float(n.x), Float(n.y), Float(n.z)]
        uvs += [Float(u), Float(1 - v)]
        row.append(index)
        index += 1
      }
      indexArray.append(row)
    }
    for x in 0..<radialSegments {
      for y in 0..<heightSegments {
        let a = indexArray[y][x], b = indexArray[y + 1][x], c = indexArray[y + 1][x + 1], d = indexArray[y][x + 1]
        if radiusTop > 0 || y != 0 { indices += [a, b, d] }
        if radiusBottom > 0 || y != heightSegments - 1 { indices += [b, c, d] }
      }
    }

    // generateCap(top)
    func cap(_ top: Bool) {
      let centerIndexStart = index
      let radius = top ? radiusTop : radiusBottom
      let sign: Double = top ? 1 : -1
      for _ in 1...radialSegments {
        positions += [0, Float(halfHeight * sign), 0]
        normals += [0, Float(sign), 0]
        uvs += [0.5, 0.5]
        index += 1
      }
      let centerIndexEnd = index
      for x in 0...radialSegments {
        let u = Double(x) / Double(radialSegments)
        let theta = u * thetaLength + thetaStart
        let cosTheta = JS.cos(theta)
        let sinTheta = JS.sin(theta)
        positions += [Float(radius * sinTheta), Float(halfHeight * sign), Float(radius * cosTheta)]
        normals += [0, Float(sign), 0]
        uvs += [Float(cosTheta * 0.5 + 0.5), Float(sinTheta * 0.5 * sign + 0.5)]
        index += 1
      }
      for x in 0..<radialSegments {
        let c = centerIndexStart + UInt32(x)
        let i = centerIndexEnd + UInt32(x)
        if top { indices += [i, i + 1, c] } else { indices += [i + 1, i, c] }
      }
    }
    if radiusTop > 0 { cap(true) }
    if radiusBottom > 0 { cap(false) }
    return (positions, normals, uvs, indices)
  }

  static func mesh(device: MTLDevice, radiusTop: Double, radiusBottom: Double, height: Double, radialSegments: Int,
                   label: String = "cylinder") throws -> MeshBuffer {
    let g = make(radiusTop: radiusTop, radiusBottom: radiusBottom, height: height, radialSegments: radialSegments)
    return try MeshBuffer(device: device, label: label,
                          streams: [VertexStream(.position, components: 3, data: g.positions),
                                    VertexStream(.normal, components: 3, data: g.normals),
                                    VertexStream(.uv, components: 2, data: g.uvs)],
                          indices: g.indices)
  }
}

/// One stand-in mesh instance this frame.
struct PropPlacement {
  enum Kind { case pad, heli }
  var kind: Kind
  /// matrixWorld (three column-major elements)
  var model: Mat4
  /// THREE.Color(hex) → linear
  var color: Color3
  var castShadow: Bool
  var receiveShadow: Bool
}

final class SceneProps {
  /// stubs.js Helicopter: BoxGeometry(3, 2, 10), MeshStandardMaterial({ color: 0xff5a2a })
  static let heliBox = (width: 3.0, height: 2.0, depth: 10.0, color: 0xFF5A2A as Double)
  /// stubs.js World: CylinderGeometry(12, 12, 4, 24), MeshStandardMaterial({ color: 0x555555 })
  static let padSegments = 24

  let family: StandardFamily
  private let heliMesh: MeshBuffer
  private let padMesh: MeshBuffer

  init(renderer: Renderer) throws {
    family = try StandardFamily(renderer: renderer)
    let dev = renderer.device.device
    heliMesh = try ThreeBoxGeometry.mesh(device: dev, width: SceneProps.heliBox.width, height: SceneProps.heliBox.height,
                                         depth: SceneProps.heliBox.depth, label: "heli.stub")
    padMesh = try ThreeCylinderGeometry.mesh(device: dev, radiusTop: FreeFlightWorld.padRadius, radiusBottom: FreeFlightWorld.padRadius,
                                             height: FreeFlightWorld.objectHeight, radialSegments: SceneProps.padSegments, label: "pad.stub")
    renderer.addFamily(family)
  }

  /// Where every stand-in sits this frame (pads first, in world.pads order, then the heli).
  static func placements(_ s: GameSession) -> [PropPlacement] {
    var out: [PropPlacement] = []
    for p in s.world.padList {
      var m = Mat4()
      m.compose(p.objectPosition, Quat(), V3(1, 1, 1))
      out.append(PropPlacement(kind: .pad, model: m, color: Color3(hex: FreeFlightWorld.objectColorHex), castShadow: false,
                               receiveShadow: true))
    }
    out.append(PropPlacement(kind: .heli, model: s.heli.visual.bodyMatrix, color: Color3(hex: SceneProps.heliBox.color),
                             castShadow: true, receiveShadow: true))
    return out
  }

  /// Refreshes the family's items from the session (call once per frame before rendering).
  func update(_ s: GameSession) {
    family.items = SceneProps.placements(s).enumerated().map { i, p in
      var it = StandardItem(id: i, mesh: p.kind == .heli ? heliMesh : padMesh, model: CameraMatrices.toDouble(p.model))
      it.color = SIMD3<Float>(Float(p.color.r), Float(p.color.g), Float(p.color.b))
      it.castShadow = p.castShadow
      it.receiveShadow = p.receiveShadow
      return it
    }
  }
}
