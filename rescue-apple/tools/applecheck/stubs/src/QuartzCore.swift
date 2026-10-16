@_exported import CoreGraphics
import Metal
public protocol CAMetalDrawable: MTLDrawable { var texture: MTLTexture { get } }
open class CALayer: NSObject {}
open class CAMetalLayer: CALayer { open var colorspace: CGColorSpace?; open var pixelFormat: MTLPixelFormat = .bgra8Unorm; open var framebufferOnly = true; open var drawableSize = CGSize.zero }
public func CACurrentMediaTime() -> CFTimeInterval { 0 }
