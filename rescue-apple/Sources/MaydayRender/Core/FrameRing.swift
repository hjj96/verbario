// FrameRing — triple buffering for per-frame GPU data (PLAN §2.5):
// 3 frames in flight guarded by DispatchSemaphore(3); one shared 8 MB MTLBuffer per slot with a bump
// allocator (256-byte alignment, the strictest constant-buffer offset rule across Apple GPUs).
import Foundation
import Metal

public final class FrameRing {
  public static let framesInFlight = 3
  public static let slotBytes = 8 << 20
  public static let alignment = 256

  private let semaphore = DispatchSemaphore(value: FrameRing.framesInFlight)
  private let buffers: [MTLBuffer]
  public private(set) var slot = 0
  private var offset = 0

  public init(device: MTLDevice) throws {
    var list: [MTLBuffer] = []
    for i in 0..<FrameRing.framesInFlight {
      guard let b = device.makeBuffer(length: FrameRing.slotBytes, options: [.storageModeShared, .cpuCacheModeWriteCombined]) else {
        throw RenderError.resource("frame ring buffer \(i)")
      }
      b.label = "MAYDAY.frameRing[\(i)]"
      list.append(b)
    }
    buffers = list
  }

  /// The buffer of the slot being written this frame.
  public var buffer: MTLBuffer { buffers[slot] }

  /// Blocks until the GPU released the oldest slot, then makes it current. Every beginFrame()
  /// must be balanced by exactly one signal(on:) or abandonFrame().
  public func beginFrame() {
    semaphore.wait()
    slot = (slot + 1) % FrameRing.framesInFlight
    offset = 0
  }

  /// Releases the slot when the command buffer that reads it completes.
  public func signal(on commandBuffer: MTLCommandBuffer) {
    let sem = semaphore
    commandBuffer.addCompletedHandler { _ in sem.signal() }
  }

  /// Releases the slot immediately (frame aborted before anything was committed).
  public func abandonFrame() {
    semaphore.signal()
  }

  private static func alignUp(_ x: Int) -> Int {
    (x + FrameRing.alignment - 1) & ~(FrameRing.alignment - 1)
  }

  /// Copies one POD value (a C struct from ShaderTypes.h) into the current slot; returns its offset.
  public func push<T>(_ value: T) -> Int {
    let size = MemoryLayout<T>.stride
    let off = FrameRing.alignUp(offset)
    precondition(off + size <= FrameRing.slotBytes, "FrameRing: slot overflow")
    let dst = buffers[slot].contents().advanced(by: off)
    withUnsafeBytes(of: value) { raw in
      if let base = raw.baseAddress { dst.copyMemory(from: base, byteCount: size) }
    }
    offset = off + size
    return off
  }

  /// Copies an array of POD values; returns the offset of the first element.
  public func push<T>(array: [T]) -> Int {
    let size = MemoryLayout<T>.stride * array.count
    let off = FrameRing.alignUp(offset)
    precondition(off + size <= FrameRing.slotBytes, "FrameRing: slot overflow")
    let dst = buffers[slot].contents().advanced(by: off)
    array.withUnsafeBytes { raw in
      if let base = raw.baseAddress, size > 0 { dst.copyMemory(from: base, byteCount: size) }
    }
    offset = off + size
    return off
  }
}
