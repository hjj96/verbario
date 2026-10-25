// Typewriter text timing (rescue/src/ui/common/typewriter.js; DESIGN §7.2 briefing 28 ms/char, §7.5 radio
// 22 ms/char, §7.7 logbook lines) without the DOM: how many characters of a line are visible after the
// elapsed time, which ones were typed in this update (the HUD emits `ui:type {ch, voice}` for each so the
// audio can tick the teletype and babble the speaker's vowels), and `finish()` to show everything at once
// (click / Space).
//
// Characters are UTF-16 code units, exactly like the web's `text[i]` / `text.slice(0, n)` (all game text
// is in the BMP, so a code unit is a character).

/// ui/common/typewriter.js Typewriter (the text node is the caller's: it draws `visible`).
public struct Typewriter: Sendable {
  /// ms per character (opts.msPerChar || 28)
  public let msPerChar: Double
  public let cursor: Bool
  public private(set) var units: [UInt16] = []
  /// characters shown so far
  public private(set) var shown = 0
  /// typing clock in seconds (negative during the start delay)
  public private(set) var t: Double = 0
  public private(set) var done = true

  public init(msPerChar: Double = 28, cursor: Bool = true) {
    self.msPerChar = JSNumber.isTruthy(msPerChar) ? msPerChar : 28
    self.cursor = cursor
  }

  /// The whole line.
  public var text: String { String(decoding: units, as: UTF16.self) }
  /// What the text node holds now (`text.slice(0, shown)`).
  public var visible: String { String(decoding: units[0..<min(shown, units.count)], as: UTF16.self) }
  /// The node's `is-typing` class (the blinking cursor).
  public var isTyping: Bool { !done && cursor }

  /// start(text, delay): restart with a new line after `delay` seconds. Returns true when the line is empty
  /// (the web then calls onDone right away).
  @discardableResult
  public mutating func start(_ text: String, delay: Double = 0) -> Bool {
    units = Array(text.utf16)
    shown = 0
    t = -delay
    done = units.isEmpty
    return done
  }

  /// finish(): show everything at once. Returns true when it ended the typing now (onDone).
  @discardableResult
  public mutating func finish() -> Bool {
    if done { return false }
    shown = units.count
    done = true
    return true
  }

  /// update(dt): advance the clock; returns the indices typed in this step (each one emits `ui:type`),
  /// and whether the line has just been completed (onDone).
  public mutating func update(_ dt: Double) -> (typed: Range<Int>, finished: Bool) {
    if done { return (shown..<shown, false) }
    t += dt
    if t < 0 { return (shown..<shown, false) }
    let n = Swift.min(units.count, Int(JS.floor((t * 1000) / msPerChar)))
    if n == shown { return (shown..<shown, false) }
    let typed = shown..<Swift.max(shown, n)
    shown = n
    if n >= units.count {
      done = true
      return (typed, true)
    }
    return (typed, false)
  }

  /// The UTF-16 unit typed at index i (the `ch` of ui:type).
  public func unit(at i: Int) -> String { i >= 0 && i < units.count ? String(decoding: [units[i]], as: UTF16.self) : "" }
}
