public protocol ObservableObject: AnyObject {}
@propertyWrapper public struct Published<Value> {
  public init(wrappedValue: Value) { stored = wrappedValue }
  public init(initialValue: Value) { stored = initialValue }
  private var stored: Value
  public var wrappedValue: Value { get { stored } set { stored = newValue } }
}
