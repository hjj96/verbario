// KeyCodeMap — physical keys → KeyboardEvent.code strings (PLAN §2.8 «Ввод», D16).
// Bindings, settings and the web's input.json all speak `KeyboardEvent.code` (layout independent,
// so ЙЦУКЕН works). Two physical-key sources:
//   * HID usage page 0x07 (GCKeyCode.rawValue on iOS/iPadOS hardware keyboards; UIKeyboardHIDUsage);
//   * macOS virtual key codes (NSEvent.keyCode, Carbon kVK_* — positional ANSI/ISO layout).
// Names follow Chromium's code table (ui/events/keycodes/dom/dom_code_data.inc).
import Foundation

enum KeyCodeMap {
  /// HID keyboard usage → code.
  static let hid: [Int: String] = {
    var m: [Int: String] = [:]
    let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    for (i, ch) in letters.enumerated() { m[0x04 + i] = "Key\(ch)" }
    for i in 1...9 { m[0x1D + i] = "Digit\(i)" }          // 0x1E … 0x26
    m[0x27] = "Digit0"
    m[0x28] = "Enter"
    m[0x29] = "Escape"
    m[0x2A] = "Backspace"
    m[0x2B] = "Tab"
    m[0x2C] = "Space"
    m[0x2D] = "Minus"
    m[0x2E] = "Equal"
    m[0x2F] = "BracketLeft"
    m[0x30] = "BracketRight"
    m[0x31] = "Backslash"
    m[0x32] = "Backslash"            // non-US # (ISO)
    m[0x33] = "Semicolon"
    m[0x34] = "Quote"
    m[0x35] = "Backquote"
    m[0x36] = "Comma"
    m[0x37] = "Period"
    m[0x38] = "Slash"
    m[0x39] = "CapsLock"
    for i in 1...12 { m[0x39 + i] = "F\(i)" }            // 0x3A … 0x45
    m[0x46] = "PrintScreen"
    m[0x47] = "ScrollLock"
    m[0x48] = "Pause"
    m[0x49] = "Insert"
    m[0x4A] = "Home"
    m[0x4B] = "PageUp"
    m[0x4C] = "Delete"
    m[0x4D] = "End"
    m[0x4E] = "PageDown"
    m[0x4F] = "ArrowRight"
    m[0x50] = "ArrowLeft"
    m[0x51] = "ArrowDown"
    m[0x52] = "ArrowUp"
    m[0x53] = "NumLock"
    m[0x54] = "NumpadDivide"
    m[0x55] = "NumpadMultiply"
    m[0x56] = "NumpadSubtract"
    m[0x57] = "NumpadAdd"
    m[0x58] = "NumpadEnter"
    for i in 1...9 { m[0x58 + i] = "Numpad\(i)" }        // 0x59 … 0x61
    m[0x62] = "Numpad0"
    m[0x63] = "NumpadDecimal"
    m[0x64] = "IntlBackslash"
    m[0x65] = "ContextMenu"
    m[0x67] = "NumpadEqual"
    m[0xE0] = "ControlLeft"
    m[0xE1] = "ShiftLeft"
    m[0xE2] = "AltLeft"
    m[0xE3] = "MetaLeft"
    m[0xE4] = "ControlRight"
    m[0xE5] = "ShiftRight"
    m[0xE6] = "AltRight"
    m[0xE7] = "MetaRight"
    return m
  }()

  /// macOS virtual key code (NSEvent.keyCode) → code.
  static let mac: [UInt16: String] = [
    0x00: "KeyA", 0x01: "KeyS", 0x02: "KeyD", 0x03: "KeyF", 0x04: "KeyH", 0x05: "KeyG", 0x06: "KeyZ",
    0x07: "KeyX", 0x08: "KeyC", 0x09: "KeyV", 0x0A: "IntlBackslash", 0x0B: "KeyB", 0x0C: "KeyQ",
    0x0D: "KeyW", 0x0E: "KeyE", 0x0F: "KeyR", 0x10: "KeyY", 0x11: "KeyT", 0x12: "Digit1", 0x13: "Digit2",
    0x14: "Digit3", 0x15: "Digit4", 0x16: "Digit6", 0x17: "Digit5", 0x18: "Equal", 0x19: "Digit9",
    0x1A: "Digit7", 0x1B: "Minus", 0x1C: "Digit8", 0x1D: "Digit0", 0x1E: "BracketRight", 0x1F: "KeyO",
    0x20: "KeyU", 0x21: "BracketLeft", 0x22: "KeyI", 0x23: "KeyP", 0x24: "Enter", 0x25: "KeyL",
    0x26: "KeyJ", 0x27: "Quote", 0x28: "KeyK", 0x29: "Semicolon", 0x2A: "Backslash", 0x2B: "Comma",
    0x2C: "Slash", 0x2D: "KeyN", 0x2E: "KeyM", 0x2F: "Period", 0x30: "Tab", 0x31: "Space",
    0x32: "Backquote", 0x33: "Backspace", 0x35: "Escape", 0x36: "MetaRight", 0x37: "MetaLeft",
    0x38: "ShiftLeft", 0x39: "CapsLock", 0x3A: "AltLeft", 0x3B: "ControlLeft", 0x3C: "ShiftRight",
    0x3D: "AltRight", 0x3E: "ControlRight", 0x3F: "Fn", 0x41: "NumpadDecimal", 0x43: "NumpadMultiply",
    0x45: "NumpadAdd", 0x47: "NumLock", 0x4B: "NumpadDivide", 0x4C: "NumpadEnter", 0x4E: "NumpadSubtract",
    0x51: "NumpadEqual", 0x52: "Numpad0", 0x53: "Numpad1", 0x54: "Numpad2", 0x55: "Numpad3",
    0x56: "Numpad4", 0x57: "Numpad5", 0x58: "Numpad6", 0x59: "Numpad7", 0x5B: "Numpad8", 0x5C: "Numpad9",
    0x60: "F5", 0x61: "F6", 0x62: "F7", 0x63: "F3", 0x64: "F8", 0x65: "F9", 0x67: "F11", 0x6D: "F10",
    0x6F: "F12", 0x72: "Insert", 0x73: "Home", 0x74: "PageUp", 0x75: "Delete", 0x76: "F4", 0x77: "End",
    0x78: "F2", 0x79: "PageDown", 0x7A: "F1", 0x7B: "ArrowLeft", 0x7C: "ArrowRight", 0x7D: "ArrowDown",
    0x7E: "ArrowUp",
  ]

  /// Device-dependent modifier masks (NX_DEVICE*KEYMASK in NSEvent.modifierFlags.rawValue): which
  /// physical modifier is down, so ShiftLeft / ShiftRight (boost) are tracked separately.
  static let macModifierMasks: [(code: String, mask: UInt)] = [
    ("ControlLeft", 0x0000_0001), ("ShiftLeft", 0x0000_0002), ("ShiftRight", 0x0000_0004),
    ("MetaLeft", 0x0000_0008), ("MetaRight", 0x0000_0010), ("AltLeft", 0x0000_0020),
    ("AltRight", 0x0000_0040), ("ControlRight", 0x0000_2000),
  ]
}
