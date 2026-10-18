// Metal API surface (Swift names/signatures as imported on Apple platforms) — type checking only.
@_exported import Foundation
@_exported import CoreGraphics

public enum MTLPixelFormat: UInt { case invalid = 0, r8Unorm = 10, rg16Float = 65, rgba8Unorm = 70, bgra8Unorm = 80, bgra8Unorm_srgb = 81, rgba16Float = 115, rgba32Float = 125, depth32Float = 252, rg8Unorm = 30, r16Float = 25, r32Float = 55 }
public enum MTLStorageMode: UInt { case shared = 0, managed = 1, `private` = 2, memoryless = 3 }
public struct MTLTextureUsage: OptionSet { public let rawValue: UInt; public init(rawValue: UInt) { self.rawValue = rawValue }
  public static let unknown = MTLTextureUsage([]); public static let shaderRead = MTLTextureUsage(rawValue: 1); public static let shaderWrite = MTLTextureUsage(rawValue: 2); public static let renderTarget = MTLTextureUsage(rawValue: 4); public static let pixelFormatView = MTLTextureUsage(rawValue: 16) }
public struct MTLResourceOptions: OptionSet { public let rawValue: UInt; public init(rawValue: UInt) { self.rawValue = rawValue }
  public static let storageModeShared = MTLResourceOptions([]); public static let cpuCacheModeWriteCombined = MTLResourceOptions(rawValue: 1); public static let storageModePrivate = MTLResourceOptions(rawValue: 32); public static let storageModeManaged = MTLResourceOptions(rawValue: 16); public static let storageModeMemoryless = MTLResourceOptions(rawValue: 48) }
public enum MTLSamplerAddressMode: UInt { case clampToEdge = 0, mirrorClampToEdge, `repeat`, mirrorRepeat, clampToZero, clampToBorderColor }
public enum MTLSamplerMinMagFilter: UInt { case nearest = 0, linear }
public enum MTLSamplerMipFilter: UInt { case notMipmapped = 0, nearest, linear }
public enum MTLCompareFunction: UInt { case never = 0, less, equal, lessEqual, greater, notEqual, greaterEqual, always }
public enum MTLPrimitiveType: UInt { case point = 0, line, lineStrip, triangle, triangleStrip }
public enum MTLIndexType: UInt { case uint16 = 0, uint32 }
public enum MTLWinding: UInt { case clockwise = 0, counterClockwise }
public enum MTLCullMode: UInt { case none = 0, front, back }
public enum MTLTextureType: UInt { case type1D = 0, type1DArray, type2D, type2DArray, type2DMultisample, typeCube, typeCubeArray, type3D }
public enum MTLGPUFamily: Int { case apple1 = 1001, apple2, apple3, apple4, apple5, apple6, apple7, apple8, apple9; case mac2 = 2002; case common1 = 3001, common2, common3; case metal3 = 5001 }
public enum MTLLoadAction: UInt { case dontCare = 0, load, clear }
public enum MTLStoreAction: UInt { case dontCare = 0, store, multisampleResolve, storeAndMultisampleResolve, unknown, customSampleDepthStore }
public enum MTLDataType: UInt { case none = 0, float = 3, float2, float3, float4, int = 29, uint = 33, bool = 53 }
public enum MTLBlendFactor: UInt { case zero = 0, one, sourceColor, oneMinusSourceColor, sourceAlpha, oneMinusSourceAlpha, destinationColor }
public enum MTLBlendOperation: UInt { case add = 0, subtract, reverseSubtract, min, max }
public enum MTLVertexFormat: UInt { case invalid = 0, uchar2Normalized = 7, uchar3Normalized = 8, uchar4Normalized = 9, short2Normalized = 22, short3Normalized = 23, short4Normalized = 24, half2 = 25, half3 = 26, half4 = 27, float = 28, float2, float3, float4 }
public enum MTLVertexStepFunction: UInt { case constant = 0, perVertex, perInstance }

public struct MTLViewport { public var originX: Double; public var originY: Double; public var width: Double; public var height: Double; public var znear: Double; public var zfar: Double
  public init() { originX = 0; originY = 0; width = 0; height = 0; znear = 0; zfar = 0 }
  public init(originX: Double, originY: Double, width: Double, height: Double, znear: Double, zfar: Double) { self.originX = originX; self.originY = originY; self.width = width; self.height = height; self.znear = znear; self.zfar = zfar } }
public struct MTLSize { public var width: Int; public var height: Int; public var depth: Int; public init() { width = 0; height = 0; depth = 0 }; public init(width: Int, height: Int, depth: Int) { self.width = width; self.height = height; self.depth = depth } }
public struct MTLOrigin { public var x: Int; public var y: Int; public var z: Int; public init() { x = 0; y = 0; z = 0 }; public init(x: Int, y: Int, z: Int) { self.x = x; self.y = y; self.z = z } }
public struct MTLClearColor { public var red: Double; public var green: Double; public var blue: Double; public var alpha: Double; public init() { red = 0; green = 0; blue = 0; alpha = 0 }; public init(red: Double, green: Double, blue: Double, alpha: Double) { self.red = red; self.green = green; self.blue = blue; self.alpha = alpha } }
public struct MTLScissorRect { public var x: Int; public var y: Int; public var width: Int; public var height: Int; public init(x: Int, y: Int, width: Int, height: Int) { self.x = x; self.y = y; self.width = width; self.height = height } }

public protocol MTLResource: AnyObject { var label: String? { get set }; var device: MTLDevice { get } }
public protocol MTLBuffer: MTLResource { func contents() -> UnsafeMutableRawPointer; var length: Int { get } }
public protocol MTLTexture: MTLResource { var width: Int { get }; var height: Int { get }; var pixelFormat: MTLPixelFormat { get }; var mipmapLevelCount: Int { get }; var sampleCount: Int { get }; var textureType: MTLTextureType { get } }
public protocol MTLSamplerState: AnyObject { var label: String? { get } }
public protocol MTLDepthStencilState: AnyObject { var label: String? { get } }
public protocol MTLRenderPipelineState: AnyObject { var label: String? { get } }
public protocol MTLComputePipelineState: AnyObject { var maxTotalThreadsPerThreadgroup: Int { get }; var threadExecutionWidth: Int { get } }
public protocol MTLFunction: AnyObject { var name: String { get } }
public protocol MTLDrawable: AnyObject { func present() }
public protocol MTLLibrary: AnyObject {
  func makeFunction(name functionName: String) -> MTLFunction?
  func makeFunction(name: String, constantValues: MTLFunctionConstantValues) throws -> MTLFunction
}
public protocol MTLCommandQueue: AnyObject { var label: String? { get set }; func makeCommandBuffer() -> MTLCommandBuffer? }
public typealias MTLCommandBufferHandler = (MTLCommandBuffer) -> Void
public protocol MTLCommandBuffer: AnyObject {
  var label: String? { get set }
  var error: Error? { get }
  var gpuStartTime: CFTimeInterval { get }
  var gpuEndTime: CFTimeInterval { get }
  func addCompletedHandler(_ block: @escaping MTLCommandBufferHandler)
  func addScheduledHandler(_ block: @escaping MTLCommandBufferHandler)
  func commit()
  func waitUntilCompleted()
  func present(_ drawable: MTLDrawable)
  func present(_ drawable: MTLDrawable, afterMinimumDuration duration: CFTimeInterval)
  func makeRenderCommandEncoder(descriptor renderPassDescriptor: MTLRenderPassDescriptor) -> MTLRenderCommandEncoder?
  func makeComputeCommandEncoder() -> MTLComputeCommandEncoder?
  func makeBlitCommandEncoder() -> MTLBlitCommandEncoder?
}
public protocol MTLCommandEncoder: AnyObject { var label: String? { get set }; func endEncoding(); func pushDebugGroup(_ string: String); func popDebugGroup(); func insertDebugSignpost(_ string: String) }
public protocol MTLRenderCommandEncoder: MTLCommandEncoder {
  func setViewport(_ viewport: MTLViewport)
  func setScissorRect(_ rect: MTLScissorRect)
  func setRenderPipelineState(_ pipelineState: MTLRenderPipelineState)
  func setDepthStencilState(_ depthStencilState: MTLDepthStencilState?)
  func setFrontFacing(_ frontFacingWinding: MTLWinding)
  func setCullMode(_ cullMode: MTLCullMode)
  func setDepthBias(_ depthBias: Float, slopeScale: Float, clamp: Float)
  func setVertexBuffer(_ buffer: MTLBuffer?, offset: Int, index: Int)
  func setVertexBytes(_ bytes: UnsafeRawPointer, length: Int, index: Int)
  func setVertexTexture(_ texture: MTLTexture?, index: Int)
  func setVertexSamplerState(_ sampler: MTLSamplerState?, index: Int)
  func setFragmentBuffer(_ buffer: MTLBuffer?, offset: Int, index: Int)
  func setFragmentBytes(_ bytes: UnsafeRawPointer, length: Int, index: Int)
  func setFragmentTexture(_ texture: MTLTexture?, index: Int)
  func setFragmentSamplerState(_ sampler: MTLSamplerState?, index: Int)
  func drawPrimitives(type primitiveType: MTLPrimitiveType, vertexStart: Int, vertexCount: Int)
  func drawPrimitives(type primitiveType: MTLPrimitiveType, vertexStart: Int, vertexCount: Int, instanceCount: Int)
  func drawIndexedPrimitives(type primitiveType: MTLPrimitiveType, indexCount: Int, indexType: MTLIndexType, indexBuffer: MTLBuffer, indexBufferOffset: Int)
  func drawIndexedPrimitives(type primitiveType: MTLPrimitiveType, indexCount: Int, indexType: MTLIndexType, indexBuffer: MTLBuffer, indexBufferOffset: Int, instanceCount: Int)
}
public protocol MTLComputeCommandEncoder: MTLCommandEncoder {
  func setComputePipelineState(_ state: MTLComputePipelineState)
  func setBuffer(_ buffer: MTLBuffer?, offset: Int, index: Int)
  func setBytes(_ bytes: UnsafeRawPointer, length: Int, index: Int)
  func setTexture(_ texture: MTLTexture?, index: Int)
  func setSamplerState(_ sampler: MTLSamplerState?, index: Int)
  func dispatchThreadgroups(_ threadgroupsPerGrid: MTLSize, threadsPerThreadgroup: MTLSize)
  func dispatchThreads(_ threadsPerGrid: MTLSize, threadsPerThreadgroup: MTLSize)
}
public protocol MTLBlitCommandEncoder: MTLCommandEncoder {
  func copy(from sourceBuffer: MTLBuffer, sourceOffset: Int, sourceBytesPerRow: Int, sourceBytesPerImage: Int, sourceSize: MTLSize, to destinationTexture: MTLTexture, destinationSlice: Int, destinationLevel: Int, destinationOrigin: MTLOrigin)
  func copy(from sourceTexture: MTLTexture, sourceSlice: Int, sourceLevel: Int, sourceOrigin: MTLOrigin, sourceSize: MTLSize, to destinationBuffer: MTLBuffer, destinationOffset: Int, destinationBytesPerRow: Int, destinationBytesPerImage: Int)
  func generateMipmaps(for texture: MTLTexture)
}
public protocol MTLDevice: AnyObject {
  var name: String { get }
  func makeCommandQueue() -> MTLCommandQueue?
  func makeCommandQueue(maxCommandBufferCount: Int) -> MTLCommandQueue?
  func makeDefaultLibrary() -> MTLLibrary?
  func makeDefaultLibrary(bundle: Bundle) throws -> MTLLibrary
  func supportsFamily(_ gpuFamily: MTLGPUFamily) -> Bool
  func supportsTextureSampleCount(_ sampleCount: Int) -> Bool
  func makeBuffer(length: Int, options: MTLResourceOptions) -> MTLBuffer?
  func makeBuffer(bytes pointer: UnsafeRawPointer, length: Int, options: MTLResourceOptions) -> MTLBuffer?
  func makeTexture(descriptor: MTLTextureDescriptor) -> MTLTexture?
  func makeSamplerState(descriptor: MTLSamplerDescriptor) -> MTLSamplerState?
  func makeDepthStencilState(descriptor: MTLDepthStencilDescriptor) -> MTLDepthStencilState?
  func makeRenderPipelineState(descriptor: MTLRenderPipelineDescriptor) throws -> MTLRenderPipelineState
  func makeComputePipelineState(function computeFunction: MTLFunction) throws -> MTLComputePipelineState
}
public func MTLCreateSystemDefaultDevice() -> MTLDevice? { nil }

open class MTLFunctionConstantValues: NSObject { public override init() {}; open func setConstantValue(_ value: UnsafeRawPointer, type: MTLDataType, index: Int) {} }
open class MTLTextureDescriptor: NSObject {
  open class func texture2DDescriptor(pixelFormat: MTLPixelFormat, width: Int, height: Int, mipmapped: Bool) -> MTLTextureDescriptor { MTLTextureDescriptor() }
  open var textureType: MTLTextureType = .type2D; open var pixelFormat: MTLPixelFormat = .rgba8Unorm; open var width = 1; open var height = 1
  open var mipmapLevelCount = 1; open var sampleCount = 1; open var usage: MTLTextureUsage = .shaderRead; open var storageMode: MTLStorageMode = .private
}
open class MTLSamplerDescriptor: NSObject {
  open var sAddressMode: MTLSamplerAddressMode = .clampToEdge; open var tAddressMode: MTLSamplerAddressMode = .clampToEdge; open var rAddressMode: MTLSamplerAddressMode = .clampToEdge
  open var minFilter: MTLSamplerMinMagFilter = .nearest; open var magFilter: MTLSamplerMinMagFilter = .nearest; open var mipFilter: MTLSamplerMipFilter = .notMipmapped
  open var maxAnisotropy = 1; open var compareFunction: MTLCompareFunction = .never; open var label: String?
}
open class MTLDepthStencilDescriptor: NSObject { open var depthCompareFunction: MTLCompareFunction = .always; open var isDepthWriteEnabled = false; open var label: String? }
open class MTLRenderPipelineColorAttachmentDescriptor: NSObject {
  open var pixelFormat: MTLPixelFormat = .invalid; open var isBlendingEnabled = false
  open var sourceRGBBlendFactor: MTLBlendFactor = .one; open var destinationRGBBlendFactor: MTLBlendFactor = .zero; open var rgbBlendOperation: MTLBlendOperation = .add
  open var sourceAlphaBlendFactor: MTLBlendFactor = .one; open var destinationAlphaBlendFactor: MTLBlendFactor = .zero; open var alphaBlendOperation: MTLBlendOperation = .add
}
open class MTLRenderPipelineColorAttachmentDescriptorArray: NSObject { open subscript(attachmentIndex: Int) -> MTLRenderPipelineColorAttachmentDescriptor! { get { nil } set {} } }
open class MTLVertexAttributeDescriptor: NSObject { open var format: MTLVertexFormat = .invalid; open var offset = 0; open var bufferIndex = 0 }
open class MTLVertexAttributeDescriptorArray: NSObject { open subscript(attributeIndex: Int) -> MTLVertexAttributeDescriptor! { get { nil } set {} } }
open class MTLVertexBufferLayoutDescriptor: NSObject { open var stride = 0; open var stepFunction: MTLVertexStepFunction = .perVertex; open var stepRate = 1 }
open class MTLVertexBufferLayoutDescriptorArray: NSObject { open subscript(bufferIndex: Int) -> MTLVertexBufferLayoutDescriptor! { get { nil } set {} } }
open class MTLVertexDescriptor: NSObject { public override init() {}; open var attributes = MTLVertexAttributeDescriptorArray(); open var layouts = MTLVertexBufferLayoutDescriptorArray() }
open class MTLRenderPipelineDescriptor: NSObject {
  open var label: String?; open var vertexFunction: MTLFunction?; open var fragmentFunction: MTLFunction?; open var vertexDescriptor: MTLVertexDescriptor?
  open var colorAttachments = MTLRenderPipelineColorAttachmentDescriptorArray(); open var depthAttachmentPixelFormat: MTLPixelFormat = .invalid
  open var rasterSampleCount = 1
}
open class MTLRenderPassAttachmentDescriptor: NSObject { open var texture: MTLTexture?; open var resolveTexture: MTLTexture?; open var level = 0; open var loadAction: MTLLoadAction = .dontCare; open var storeAction: MTLStoreAction = .dontCare }
open class MTLRenderPassColorAttachmentDescriptor: MTLRenderPassAttachmentDescriptor { open var clearColor = MTLClearColor() }
open class MTLRenderPassDepthAttachmentDescriptor: MTLRenderPassAttachmentDescriptor { open var clearDepth: Double = 1 }
open class MTLRenderPassColorAttachmentDescriptorArray: NSObject { open subscript(attachmentIndex: Int) -> MTLRenderPassColorAttachmentDescriptor! { get { nil } set {} } }
open class MTLRenderPassDescriptor: NSObject {
  public override init() {}
  open var colorAttachments = MTLRenderPassColorAttachmentDescriptorArray(); open var depthAttachment: MTLRenderPassDepthAttachmentDescriptor! = nil
}
