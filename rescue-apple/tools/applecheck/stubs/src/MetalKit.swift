@_exported import Metal
@_exported import QuartzCore
#if IOS
import UIKit
public typealias MTKViewBase = UIView
#else
import AppKit
public typealias MTKViewBase = NSView
#endif
public protocol MTKViewDelegate: NSObjectProtocol {
  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize)
  func draw(in view: MTKView)
}
open class MTKView: MTKViewBase {
  public init(frame frameRect: CGRect, device: MTLDevice?) { super.init(frame: frameRect) }
  public required init(coder: NSCoder) { super.init(frame: .zero) }
  open weak var delegate: MTKViewDelegate?
  open var device: MTLDevice?
  open var currentDrawable: CAMetalDrawable? { nil }
  open var currentRenderPassDescriptor: MTLRenderPassDescriptor? { nil }
  open var colorPixelFormat: MTLPixelFormat = .bgra8Unorm
  open var depthStencilPixelFormat: MTLPixelFormat = .invalid
  open var sampleCount = 1
  open var framebufferOnly = true
  open var preferredFramesPerSecond = 60
  open var isPaused = false
  open var enableSetNeedsDisplay = false
  open var autoResizeDrawable = true
  open var drawableSize = CGSize.zero
  open var clearColor = MTLClearColor()
  #if !IOS
  open var colorspace: CGColorSpace?
  #endif
}
