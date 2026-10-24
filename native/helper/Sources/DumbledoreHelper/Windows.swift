// Windows.swift — on-screen window list (Quartz), visibility estimates and AX window lookup.
//
// Bounds from CGWindowListCopyWindowInfo are global top-left points, the protocol's convention.
// Titles there are redacted without Screen Recording, so titles come from Accessibility instead.
import AppKit
import ApplicationServices
import CoreGraphics

struct WindowInfo {
  let id: CGWindowID
  let pid: pid_t
  let bounds: CGRect
  let layer: Int
  let alpha: Double
}

enum Windows {
  /// Normal (layer 0) on-screen windows, front to back.
  static func onScreen() -> [WindowInfo] {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return [] }
    return list.compactMap(parse).filter { $0.layer == 0 && $0.alpha > 0.05 && $0.bounds.width >= 80 && $0.bounds.height >= 60 }
  }

  static func info(id: CGWindowID) -> WindowInfo? {
    guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], id) as? [[String: Any]] else { return nil }
    return list.compactMap(parse).first
  }

  private static func parse(_ d: [String: Any]) -> WindowInfo? {
    guard let num = d[kCGWindowNumber as String] as? NSNumber,
          let pid = d[kCGWindowOwnerPID as String] as? NSNumber,
          let b = d[kCGWindowBounds as String] as? NSDictionary,
          let bounds = CGRect(dictionaryRepresentation: b) else { return nil }
    let layer = (d[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
    let alpha = (d[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1
    return WindowInfo(id: CGWindowID(num.uint32Value), pid: pid_t(pid.int32Value), bounds: bounds, layer: layer, alpha: alpha)
  }

  /// Bounds of all active displays (global top-left points).
  static func displayBounds() -> [CGRect] {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return [] }
    return ids.prefix(Int(count)).map { CGDisplayBounds($0) }
  }

  /// Fraction of the display (the one it overlaps most) that the window covers.
  static func screenFraction(_ r: CGRect) -> Double {
    let screens = displayBounds()
    guard let best = screens.max(by: { overlap($0, r) < overlap($1, r) }), best.width > 0 else { return 0 }
    return overlap(best, r) / Double(best.width * best.height)
  }

  private static func overlap(_ a: CGRect, _ b: CGRect) -> Double {
    let i = a.intersection(b)
    return i.isNull ? 0 : Double(i.width * i.height)
  }

  /// Estimated visible fraction of `win` given the windows in front of it (12×12 sample grid).
  static func visibleFraction(_ win: WindowInfo, above: [WindowInfo]) -> Double {
    guard !above.isEmpty else { return 1 }
    let n = 12
    var visible = 0
    for i in 0..<n {
      for j in 0..<n {
        let p = CGPoint(x: win.bounds.minX + (Double(i) + 0.5) * win.bounds.width / Double(n),
                        y: win.bounds.minY + (Double(j) + 0.5) * win.bounds.height / Double(n))
        if !above.contains(where: { $0.bounds.contains(p) }) { visible += 1 }
      }
    }
    return Double(visible) / Double(n * n)
  }

  /// AX element of the window `id` owned by `pid` (matched by CGWindowID, then by frame).
  static func axWindow(pid: pid_t, id: CGWindowID, bounds: CGRect?) -> AXUIElement? {
    let wins = AX.elements(AX.app(pid), kAXWindowsAttribute)
    if let w = wins.first(where: { AX.windowId($0) == id }) { return w }
    guard let bounds else { return nil }
    return wins.first { w in
      guard let f = AX.frame(w) else { return false }
      return abs(f.minX - bounds.minX) < 2 && abs(f.minY - bounds.minY) < 2 && abs(f.width - bounds.width) < 2
    }
  }

  /// The app's focused (else main, else first) AX window.
  static func focusedAXWindow(pid: pid_t) -> AXUIElement? {
    let app = AX.app(pid)
    return AX.element(app, kAXFocusedWindowAttribute) ?? AX.element(app, kAXMainWindowAttribute)
      ?? AX.elements(app, kAXWindowsAttribute).first
  }

  /// Frontmost layer-0 window of `pid` from the Quartz list.
  static func frontWindow(pid: pid_t) -> WindowInfo? {
    onScreen().first { $0.pid == pid }
  }
}
