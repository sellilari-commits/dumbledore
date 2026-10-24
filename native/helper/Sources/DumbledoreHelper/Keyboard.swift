// Keyboard.swift — layout-correct key codes (UCKeyTranslate), key-combo parsing and key posting.
//
// The key map is rebuilt on the main thread whenever the input source changes. Events are posted
// from a private event source with exactly the flags we set, so a still-held ⌥ never leaks in.
import AppKit
import Carbon
import CoreGraphics

/// Lock-protected maps (built on main), hence @unchecked Sendable.
final class KeyMap: @unchecked Sendable {
  static let shared = KeyMap()
  private let lock = NSLock()
  private var plain: [String: CGKeyCode] = [:]
  private var shifted: [String: CGKeyCode] = [:]
  private var command: [String: CGKeyCode] = [:]
  private var built = false

  /// US-ANSI positions, used when the layout has no 'uchr' data.
  static let ansi: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
    "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
    "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
    "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
  ]

  static let named: [String: CGKeyCode] = [
    "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
    "forwarddelete": 117, "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "left": 123, "right": 124,
    "down": 125, "up": 126, "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100,
    "f9": 101, "f10": 109, "f11": 103, "f12": 111, "kpenter": 76,
  ]

  @MainActor
  func startObserving() {
    rebuild()
    let name = NSNotification.Name(kTISNotifySelectedKeyboardInputSourceChanged as String)
    DistributedNotificationCenter.default().addObserver(forName: name, object: nil, queue: .main) { _ in
      MainActor.assumeIsolated { KeyMap.shared.rebuild() }
    }
  }

  @MainActor
  func rebuild() {
    var p: [String: CGKeyCode] = [:]
    var s: [String: CGKeyCode] = [:]
    var c: [String: CGKeyCode] = [:]
    let sources = [TISCopyCurrentKeyboardLayoutInputSource(), TISCopyCurrentASCIICapableKeyboardLayoutInputSource()]
    for case let src? in sources.map({ $0?.takeRetainedValue() }) {
      guard let ptr = TISGetInputSourceProperty(src, kTISPropertyUnicodeKeyLayoutData) else { continue }
      let data = Unmanaged<CFData>.fromOpaque(ptr).takeUnretainedValue() as Data
      let kbdType = UInt32(LMGetKbdType())
      data.withUnsafeBytes { raw in
        guard let layout = raw.bindMemory(to: UCKeyboardLayout.self).baseAddress else { return }
        func translate(_ code: Int, _ mods: Int) -> String? {
          var dead: UInt32 = 0
          var chars = [UniChar](repeating: 0, count: 4)
          var len = 0
          let st = UCKeyTranslate(layout, UInt16(code), UInt16(kUCKeyActionDown), UInt32((mods >> 8) & 0xFF), kbdType,
                                  OptionBits(kUCKeyTranslateNoDeadKeysMask), &dead, chars.count, &len, &chars)
          return st == noErr && len > 0 ? String(utf16CodeUnits: chars, count: len) : nil
        }
        for code in 0..<128 {
          if let ch = translate(code, 0), p[ch] == nil { p[ch] = CGKeyCode(code) }
          if let ch = translate(code, shiftKey), s[ch] == nil { s[ch] = CGKeyCode(code) }
          if let ch = translate(code, cmdKey)?.lowercased(), c[ch] == nil { c[ch] = CGKeyCode(code) }
        }
      }
      if !p.isEmpty { break }
    }
    lock.lock()
    plain = p
    shifted = s
    command = c
    built = true
    lock.unlock()
    Log.debug("key map rebuilt: v=\(p["v"].map { String($0) } ?? "?")")
  }

  private func ensureBuilt() {
    lock.lock()
    let ok = built
    lock.unlock()
    if !ok { onMain { rebuild() } }
  }

  /// Key code (and whether Shift is needed) that types `ch` in the current layout.
  func keyCode(for ch: String) -> (code: CGKeyCode, shift: Bool)? {
    ensureBuilt()
    lock.lock()
    defer { lock.unlock() }
    if let c = plain[ch] { return (c, false) }
    if let c = shifted[ch] { return (c, true) }
    if let c = plain[ch.lowercased()] { return (c, ch != ch.lowercased()) }
    if let c = KeyMap.ansi[ch.lowercased()] { return (c, false) }
    return nil
  }

  /// Key code for `ch` while ⌘ is held (handles "Dvorak – QWERTY ⌘" style layouts).
  func commandKeyCode(for ch: String) -> CGKeyCode? {
    ensureBuilt()
    lock.lock()
    defer { lock.unlock() }
    return command[ch.lowercased()] ?? plain[ch.lowercased()] ?? KeyMap.ansi[ch.lowercased()]
  }
}

struct KeyCombo: Equatable {
  let flags: CGEventFlags
  let key: String  // a named key ("escape") or one character ("a")

  static func == (a: KeyCombo, b: KeyCombo) -> Bool { a.flags == b.flags && a.key == b.key }

  /// Parses "cmd+shift+a", "escape", "ctrl+alt+cmd+d". Returns nil for unknown modifiers/keys.
  static func parse(_ s: String) -> KeyCombo? {
    let trimmed = s.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else { return nil }
    var parts = trimmed.split(separator: "+", omittingEmptySubsequences: false).map { String($0) }
    if trimmed.hasSuffix("++") || trimmed == "+" {  // the "+" key itself
      parts = Array(parts.dropLast(2)) + ["+"]
    }
    guard let last = parts.popLast(), !last.isEmpty else { return nil }
    var flags: CGEventFlags = []
    for m in parts {
      switch m.lowercased() {
      case "cmd", "command", "meta", "⌘": flags.insert(.maskCommand)
      case "shift", "⇧": flags.insert(.maskShift)
      case "alt", "opt", "option", "⌥": flags.insert(.maskAlternate)
      case "ctrl", "control", "⌃": flags.insert(.maskControl)
      case "fn": flags.insert(.maskSecondaryFn)
      default: return nil
      }
    }
    let key = last.count == 1 ? last : last.lowercased()
    guard key.count == 1 || KeyMap.named[key] != nil else { return nil }
    return KeyCombo(flags: flags, key: key)
  }

  /// Resolves to a key code + final flags in the current layout.
  func resolve() -> (code: CGKeyCode, flags: CGEventFlags)? {
    if let named = KeyMap.named[key] { return (named, flags) }
    if flags.contains(.maskCommand), let c = KeyMap.shared.commandKeyCode(for: key) {
      return (c, flags.union(key != key.lowercased() ? .maskShift : []))
    }
    guard let (code, shift) = KeyMap.shared.keyCode(for: key) else { return nil }
    return (code, shift ? flags.union(.maskShift) : flags)
  }
}

enum KeyPoster {
  /// Posts key down + up with exactly `flags`. Needs Accessibility.
  static func post(code: CGKeyCode, flags: CGEventFlags) -> Bool {
    guard let src = CGEventSource(stateID: .privateState),
          let down = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false) else { return false }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    usleep(8_000)
    up.post(tap: .cghidEventTap)
    return true
  }
}
