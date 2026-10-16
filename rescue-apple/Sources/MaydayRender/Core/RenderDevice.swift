// RenderDevice — MTLDevice, command queue, the app's default.metallib and GPU feature flags
// (PLAN §2.5 «Каркас»).
import Foundation
import Metal

public enum RenderError: Error, CustomStringConvertible {
  case noDevice
  case library(String)
  case resource(String)
  case pipeline(String)

  public var description: String {
    switch self {
    case .noDevice: return "Metal недоступен на этом устройстве"
    case .library(let s): return "Библиотека шейдеров: \(s)"
    case .resource(let s): return "Ресурс GPU: \(s)"
    case .pipeline(let s): return "Конвейер: \(s)"
    }
  }
}

public final class RenderDevice {
  public let device: MTLDevice
  public let queue: MTLCommandQueue
  public let library: MTLLibrary
  /// Tile memory for MSAA colour / depth attachments that never leave the GPU (TBDR).
  public let supportsMemoryless: Bool

  public init(device: MTLDevice? = nil) throws {
    guard let dev = device ?? MTLCreateSystemDefaultDevice() else { throw RenderError.noDevice }
    guard let q = dev.makeCommandQueue(maxCommandBufferCount: 8) else { throw RenderError.resource("command queue") }
    q.label = "MAYDAY.queue"
    // The .metal sources are compiled into the app target (project.yml), so the default library
    // lives in the bundle that contains this class (the app; the hosted unit tests share it).
    let lib: MTLLibrary
    do {
      lib = try dev.makeDefaultLibrary(bundle: Bundle(for: RenderDevice.self))
    } catch {
      throw RenderError.library(error.localizedDescription)
    }
    self.device = dev
    self.queue = q
    self.library = lib
    #if targetEnvironment(simulator)
    self.supportsMemoryless = false
    #else
    self.supportsMemoryless = dev.supportsFamily(.apple3)
    #endif
  }

  /// Largest supported MSAA sample count ≤ wanted (4 → 2 → 1).
  public func sampleCount(atMost wanted: Int) -> Int {
    var n = max(1, wanted)
    while n > 1 && !device.supportsTextureSampleCount(n) { n /= 2 }
    return n
  }

  public func makeFunction(_ name: String, constants: MTLFunctionConstantValues? = nil) throws -> MTLFunction {
    do {
      if let constants = constants {
        return try library.makeFunction(name: name, constantValues: constants)
      }
      guard let f = library.makeFunction(name: name) else { throw RenderError.library("function \(name) not found") }
      return f
    } catch let e as RenderError {
      throw e
    } catch {
      throw RenderError.library("\(name): \(error.localizedDescription)")
    }
  }
}
