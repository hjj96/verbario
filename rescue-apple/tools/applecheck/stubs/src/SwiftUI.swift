// SwiftUI surface used by the app shells — type checking only.
@_exported import Foundation
@_exported import CoreGraphics
@_exported import Combine
#if IOS
import UIKit
#else
import AppKit
#endif

public protocol View { associatedtype Body: View; @ViewBuilder var body: Body { get } }
extension Never: View { public typealias Body = Never; public var body: Never { return fatalError() } }
public struct AnyView: View { public init<V: View>(_ v: V) {}; public var body: Never { return fatalError() } }
public struct EmptyView: View { public init() {}; public var body: Never { return fatalError() } }
public struct ModifiedContent<C>: View { public var body: Never { return fatalError() } }

@resultBuilder public enum ViewBuilder {
  public static func buildExpression<V: View>(_ v: V) -> AnyView { AnyView(v) }
  public static func buildBlock(_ c: AnyView...) -> AnyView { AnyView(EmptyView()) }
  public static func buildOptional(_ c: AnyView?) -> AnyView { AnyView(EmptyView()) }
  public static func buildEither(first: AnyView) -> AnyView { first }
  public static func buildEither(second: AnyView) -> AnyView { second }
  public static func buildLimitedAvailability(_ c: AnyView) -> AnyView { c }
}

public enum HorizontalAlignment { case leading, center, trailing }
public struct Alignment { public static let center = Alignment(); public static let topLeading = Alignment(); public static let top = Alignment(); public static let bottomTrailing = Alignment() }
public enum TextAlignment { case leading, center, trailing }
public enum ColorScheme { case light, dark }
public enum Visibility { case automatic, visible, hidden }
public struct Edge { public struct Set: OptionSet { public let rawValue: Int; public init(rawValue: Int) { self.rawValue = rawValue }; public static let all = Set(rawValue: 15) } }
public struct SafeAreaRegions: OptionSet { public let rawValue: Int; public init(rawValue: Int) { self.rawValue = rawValue }; public static let all = SafeAreaRegions(rawValue: 3) }

public struct Font {
  public enum Weight { case regular, medium, semibold, bold }
  public enum Design { case `default`, monospaced, rounded, serif }
  public static func system(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Font { Font() }
}
public struct Color: View {
  public init(red: Double, green: Double, blue: Double, opacity: Double = 1) {}
  public static let black = Color(red: 0, green: 0, blue: 0); public static let white = Color(red: 1, green: 1, blue: 1)
  public static let red = Color(red: 1, green: 0, blue: 0); public static let clear = Color(red: 0, green: 0, blue: 0, opacity: 0)
  public func opacity(_ o: Double) -> Color { self }
  public var body: Never { return fatalError() }
}
public protocol Shape: View {}
public struct RoundedRectangle: Shape { public init(cornerRadius: CGFloat) {}; public var body: Never { return fatalError() } }
public struct Text: View {
  public init(_ s: String) {}
  public var body: Never { return fatalError() }
  public func font(_ f: Font?) -> Text { self }
  public func foregroundColor(_ c: Color?) -> Text { self }
}
public struct ZStack: View { public init(alignment: Alignment = .center, @ViewBuilder content: () -> AnyView) {}; public var body: Never { return fatalError() } }
public struct VStack: View { public init(alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> AnyView) {}; public var body: Never { return fatalError() } }
public struct HStack: View { public init(alignment: Alignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> AnyView) {}; public var body: Never { return fatalError() } }

extension View {
  public func font(_ f: Font?) -> ModifiedContent<Self> { ModifiedContent() }
  public func foregroundColor(_ c: Color?) -> ModifiedContent<Self> { ModifiedContent() }
  public func padding(_ length: CGFloat) -> ModifiedContent<Self> { ModifiedContent() }
  public func padding() -> ModifiedContent<Self> { ModifiedContent() }
  public func background<B: View>(_ b: B, alignment: Alignment = .center) -> ModifiedContent<Self> { ModifiedContent() }
  public func clipShape<S: Shape>(_ s: S) -> ModifiedContent<Self> { ModifiedContent() }
  public func frame(minWidth: CGFloat? = nil, idealWidth: CGFloat? = nil, maxWidth: CGFloat? = nil, minHeight: CGFloat? = nil, idealHeight: CGFloat? = nil, maxHeight: CGFloat? = nil, alignment: Alignment = .center) -> ModifiedContent<Self> { ModifiedContent() }
  public func frame(width: CGFloat? = nil, height: CGFloat? = nil, alignment: Alignment = .center) -> ModifiedContent<Self> { ModifiedContent() }
  public func allowsHitTesting(_ enabled: Bool) -> ModifiedContent<Self> { ModifiedContent() }
  public func ignoresSafeArea(_ regions: SafeAreaRegions = .all, edges: Edge.Set = .all) -> ModifiedContent<Self> { ModifiedContent() }
  public func multilineTextAlignment(_ a: TextAlignment) -> ModifiedContent<Self> { ModifiedContent() }
  public func preferredColorScheme(_ s: ColorScheme?) -> ModifiedContent<Self> { ModifiedContent() }
  #if IOS
  public func statusBarHidden(_ hidden: Bool = true) -> ModifiedContent<Self> { ModifiedContent() }
  public func persistentSystemOverlays(_ v: Visibility) -> ModifiedContent<Self> { ModifiedContent() }
  #endif
}

public protocol Scene { associatedtype Body: Scene; @SceneBuilder var body: Body { get } }
public struct AnyScene: Scene { public init<S: Scene>(_ s: S) {}; public var body: Never { return fatalError() } }
extension Never: Scene {}
@resultBuilder public enum SceneBuilder {
  public static func buildExpression<S: Scene>(_ s: S) -> AnyScene { AnyScene(s) }
  public static func buildBlock(_ c: AnyScene...) -> AnyScene { c[0] }
}
public struct WindowGroup: Scene { public init(@ViewBuilder content: () -> AnyView) {}; public var body: Never { return fatalError() } }
public struct ModifiedScene<S>: Scene { public var body: Never { return fatalError() } }
#if !IOS
public struct Window: Scene { public init(_ title: String, id: String, @ViewBuilder content: () -> AnyView) {}; public var body: Never { return fatalError() } }
#endif
public protocol Commands {}
public struct AnyCommands: Commands { public init<C: Commands>(_ c: C) {} }
@resultBuilder public enum CommandsBuilder {
  public static func buildExpression<C: Commands>(_ c: C) -> AnyCommands { AnyCommands(c) }
  public static func buildBlock(_ c: AnyCommands...) -> AnyCommands { c[0] }
}
public struct CommandGroupPlacement { public static let newItem = CommandGroupPlacement(); public static let appInfo = CommandGroupPlacement() }
public struct CommandGroup: Commands { public init(replacing: CommandGroupPlacement, @ViewBuilder addition: () -> AnyView) {} }
extension ViewBuilder { public static func buildBlock() -> AnyView { AnyView(EmptyView()) } }
extension Scene {
  public func defaultSize(width: CGFloat, height: CGFloat) -> ModifiedScene<Self> { ModifiedScene() }
  public func commands(@CommandsBuilder content: () -> AnyCommands) -> ModifiedScene<Self> { ModifiedScene() }
}

public protocol App { associatedtype Body: Scene; @SceneBuilder var body: Body { get }; init() }
extension App { public static func main() {} }

@propertyWrapper public struct StateObject<O: ObservableObject> { public init(wrappedValue: @autoclosure @escaping () -> O) { make = wrappedValue }; private let make: () -> O; public var wrappedValue: O { make() } }
@propertyWrapper public struct ObservedObject<O: ObservableObject> { public init(wrappedValue: O) { self.wrappedValue = wrappedValue }; public var wrappedValue: O }
@propertyWrapper public struct State<V> { public init(wrappedValue: V) { self.wrappedValue = wrappedValue }; public var wrappedValue: V }

#if IOS
public struct UIViewRepresentableContext<R: UIViewRepresentable> { public var coordinator: R.Coordinator { fatalError() } }
public protocol UIViewRepresentable: View where Body == Never {
  associatedtype UIViewType: UIView
  associatedtype Coordinator = Void
  typealias Context = UIViewRepresentableContext<Self>
  func makeUIView(context: Context) -> UIViewType
  func updateUIView(_ uiView: UIViewType, context: Context)
  func makeCoordinator() -> Coordinator
}
extension UIViewRepresentable { public var body: Never { return fatalError() } }
extension UIViewRepresentable where Coordinator == Void { public func makeCoordinator() -> Void {} }
#else
public struct NSViewRepresentableContext<R: NSViewRepresentable> { public var coordinator: R.Coordinator { fatalError() } }
public protocol NSViewRepresentable: View where Body == Never {
  associatedtype NSViewType: NSView
  associatedtype Coordinator = Void
  typealias Context = NSViewRepresentableContext<Self>
  func makeNSView(context: Context) -> NSViewType
  func updateNSView(_ nsView: NSViewType, context: Context)
  func makeCoordinator() -> Coordinator
}
extension NSViewRepresentable { public var body: Never { return fatalError() } }
extension NSViewRepresentable where Coordinator == Void { public func makeCoordinator() -> Void {} }
@propertyWrapper public struct NSApplicationDelegateAdaptor<D: NSObject & NSApplicationDelegate> { public init(_ t: D.Type) {}; public var wrappedValue: D { fatalError() } }
#endif
