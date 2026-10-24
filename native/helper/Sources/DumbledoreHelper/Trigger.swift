// Trigger.swift — the Dumbledore key, Goldfish-style: poll modifier state, no event taps.
//
// A background thread reads CGEventSourceFlagsState at ~100 Hz (device-dependent bits tell left
// from right). Any key or mouse press while the key is held (CGEventSourceCounterForEventType)
// cancels the gesture, so ⌥2 = "@" never fires. No Input Monitoring permission is needed.
//
// Gestures: `tap` is emitted on release (≤ tapMaxMs); a second clean tap that starts within
// doubleTapMs of the previous tap's release emits `doubleTap` instead of a second `tap`;
// holding ≥ holdMinMs emits `holdStart`, and releasing it `holdEnd`.
import Carbon
import CoreGraphics
import Foundation

struct GestureConfig: Equatable {
  var key: TriggerKey
  var tapMaxMs: Double
  var holdMinMs: Double
  var doubleTapMs: Double

  static let defaults = GestureConfig(key: .rightOption, tapMaxMs: 350, holdMinMs: 500, doubleTapMs: 300)
}

/// Pure gesture state machine (unit-tested in SelfTest).
struct GestureClassifier {
  private enum State { case idle, down(start: Double, clean: Bool, double: Bool), holding }
  var config: GestureConfig
  private var state = State.idle
  private var lastTapRelease: Double?

  init(config: GestureConfig) { self.config = config }

  var isIdle: Bool { if case .idle = state { return true }; return false }

  /// One poll. `interrupted`: another key or a click happened since the press began.
  mutating func step(now: Double, keyDown: Bool, othersDown: Bool, interrupted: Bool) -> Gesture? {
    switch state {
    case .idle:
      guard keyDown else { return nil }
      let double = lastTapRelease.map { now - $0 <= config.doubleTapMs } ?? false
      if !double { lastTapRelease = nil }
      state = .down(start: now, clean: !othersDown, double: double)
      return nil
    case .down(let start, let wasClean, let double):
      let clean = wasClean && !othersDown && !interrupted
      if keyDown {
        if clean, now - start >= config.holdMinMs {
          state = .holding
          lastTapRelease = nil
          return .holdStart
        }
        state = .down(start: start, clean: clean, double: double)
        return nil
      }
      state = .idle
      guard clean, now - start <= config.tapMaxMs else {
        lastTapRelease = nil
        return nil
      }
      if double {
        lastTapRelease = nil
        return .doubleTap
      }
      lastTapRelease = now
      return .tap
    case .holding:
      guard !keyDown else { return nil }
      state = .idle
      return .holdEnd
    }
  }
}

/// NX_DEVICE* bits of CGEventFlags (IOLLEvent.h).
enum ModifierBits {
  static let leftControl: UInt64 = 0x0000_0001
  static let leftShift: UInt64 = 0x0000_0002
  static let rightShift: UInt64 = 0x0000_0004
  static let leftCommand: UInt64 = 0x0000_0008
  static let rightCommand: UInt64 = 0x0000_0010
  static let leftOption: UInt64 = 0x0000_0020
  static let rightOption: UInt64 = 0x0000_0040
  static let rightControl: UInt64 = 0x0000_2000
  static let fn: UInt64 = 0x0080_0000
  static let all: UInt64 = leftControl | leftShift | rightShift | leftCommand | rightCommand | leftOption | rightOption
    | rightControl | fn

  static func mask(_ key: TriggerKey) -> UInt64 {
    switch key {
    case .rightOption: return rightOption
    case .leftOption: return leftOption
    case .rightCommand: return rightCommand
    case .rightShift: return rightShift
    case .rightControl: return rightControl
    case .fn: return fn
    }
  }
}

/// Config is lock-protected; the classifier lives on the poll thread only.
final class TriggerPoller: @unchecked Sendable {
  static let shared = TriggerPoller()
  private let lock = NSLock()
  private var config: GestureConfig?
  private var thread: Thread?

  func configure(_ p: ShortcutParams) {
    let cfg = GestureConfig(key: p.key, tapMaxMs: Double(p.tapMaxMs), holdMinMs: Double(p.holdMinMs),
                            doubleTapMs: Double(p.doubleTapMs))
    lock.lock()
    config = p.enabled ? cfg : nil
    let needsThread = p.enabled && thread == nil
    if needsThread {
      let t = Thread { [weak self] in self?.loop() }
      t.name = "helper.trigger"
      t.qualityOfService = .userInteractive
      thread = t
    }
    let t = thread
    lock.unlock()
    if needsThread { t?.start() }
  }

  private func current() -> GestureConfig? {
    lock.lock()
    defer { lock.unlock() }
    return config
  }

  private static func inputCounter() -> UInt64 {
    let types: [CGEventType] = [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown]
    return types.reduce(0) { $0 + UInt64(CGEventSource.counterForEventType(.combinedSessionState, eventType: $1)) }
  }

  private func loop() {
    var classifier: GestureClassifier?
    var pressCounter: UInt64?
    while true {
      guard let cfg = current() else {
        classifier = nil
        pressCounter = nil
        usleep(200_000)
        continue
      }
      if classifier?.config != cfg { classifier = GestureClassifier(config: cfg) }
      let flags = CGEventSource.flagsState(.combinedSessionState).rawValue
      let own = ModifierBits.mask(cfg.key)
      let keyDown = flags & own != 0
      let othersDown = flags & (ModifierBits.all & ~own) != 0
      var interrupted = false
      if keyDown || pressCounter != nil {
        let counter = TriggerPoller.inputCounter()
        if let start = pressCounter { interrupted = counter != start } else { pressCounter = counter }
      }
      let gesture = classifier?.step(now: monoMs(), keyDown: keyDown, othersDown: othersDown, interrupted: interrupted)
      if !keyDown { pressCounter = nil }
      if let gesture {
        Events.emit("key.trigger", KeyTriggerEvent(gesture: gesture, key: cfg.key, secureInput: IsSecureEventInputEnabled()))
      }
      usleep(10_000)
    }
  }
}
