// Perceive.swift — `frontmost` and `perceive`: which windows to read and how (AX first, OCR fallback).
//
// Dumbledore's own windows and `excludeBundleIds` are never read. OCR runs only when allowed and
// the window yields < 200 characters of AX text, its app is on the OCR list, or forceOcr is set,
// and only with Screen Recording granted (otherwise the AX text is returned as is).
import AppKit
import ApplicationServices
import CoreGraphics

enum Perceiver {
  /// Apps whose content is mostly pixels: slides, scanned PDFs, video.
  static let ocrBundleIds: Set<String> = [
    "com.apple.Preview", "com.apple.iWork.Keynote", "com.microsoft.Powerpoint", "com.apple.QuickTimePlayerX",
    "org.videolan.vlc", "com.colliderli.iina", "io.mpv", "com.apple.TV", "com.apple.FaceTime",
  ]
  static let minAXChars = 200
  static let ocrMaxAgeMs = 30_000.0

  static func frontmost() -> FrontmostInfo? {
    guard let app = Apps.frontmost() else { return nil }
    var windowId: Int?
    var title: String?
    var frame: CGRect?
    var fullScreen = false
    var url: String?
    if Permissions.accessibility, let win = Windows.focusedAXWindow(pid: app.pid) {
      let v = AX.multiple(win, [kAXTitleAttribute, kAXPositionAttribute, kAXSizeAttribute, "AXFullScreen"])
      title = AX.str(v[kAXTitleAttribute])
      frame = AX.frame(position: v[kAXPositionAttribute], size: v[kAXSizeAttribute])
      fullScreen = AX.boolean(v["AXFullScreen"]) ?? false
      windowId = AX.windowId(win).map(Int.init)
      if Apps.isReadable(app.bundleId) { url = AXTextReader.url(of: win) }
    }
    if windowId == nil || frame == nil, let w = Windows.frontWindow(pid: app.pid) {
      windowId = windowId ?? Int(w.id)
      frame = frame ?? w.bounds
    }
    return FrontmostInfo(pid: Int(app.pid), bundleId: app.bundleId, appName: app.name, windowId: windowId,
                         windowTitle: title, windowFrame: frame.map(Rect.init), isFullScreen: fullScreen, url: url)
  }

  private struct Target {
    let app: AppInfo
    let window: WindowInfo?
    let axWindow: AXUIElement?
  }

  static func perceive(_ p: PerceiveParams, session: Session) -> PerceiveResult {
    // Never read anything while the screen is locked (windows stay capturable behind the lock).
    if SystemInfo.isScreenLocked() { return PerceiveResult(windows: []) }
    let excluded = Set(p.excludeBundleIds)
    func allowed(_ app: AppInfo) -> Bool { Apps.isReadable(app.bundleId) && !excluded.contains(app.bundleId) }
    var targets: [Target] = []
    let frontPid = Apps.frontmostPid
    switch p.scope {
    case .frontmost:
      guard let app = Apps.frontmost(), allowed(app) else { return PerceiveResult(windows: []) }
      let axWin = Permissions.accessibility ? Windows.focusedAXWindow(pid: app.pid) : nil
      let win = axWin.flatMap(AX.windowId).flatMap(Windows.info(id:)) ?? Windows.frontWindow(pid: app.pid)
      guard axWin != nil || win != nil else { return PerceiveResult(windows: []) }  // e.g. Finder on the desktop
      targets.append(Target(app: app, window: win, axWindow: axWin))
    case .visible:
      // Dumbledore's own windows (orb, panels) neither count as content nor as occluders.
      let all = Windows.onScreen().filter { w in Apps.info(pid: w.pid).map { !Apps.isOwn($0.bundleId) } ?? true }
      var seenFront = false
      for (i, w) in all.enumerated() {
        guard targets.count < 6, let app = Apps.info(pid: w.pid), allowed(app) else { continue }
        let isFront = w.pid == frontPid && !seenFront
        if isFront { seenFront = true }
        if !isFront, Windows.screenFraction(w.bounds) < 0.25 { continue }
        if Windows.visibleFraction(w, above: Array(all[..<i])) < 0.3 { continue }
        let axWin = Permissions.accessibility ? Windows.axWindow(pid: w.pid, id: w.id, bounds: w.bounds) : nil
        targets.append(Target(app: app, window: w, axWindow: axWin))
      }
    }
    let windows = targets.map { read($0, params: p, session: session, isFront: $0.app.pid == frontPid) }
    return PerceiveResult(windows: windows)
  }

  private static func read(_ t: Target, params p: PerceiveParams, session: Session, isFront: Bool) -> PerceivedWindow {
    let key = "\(t.app.pid):\(t.window.map { String($0.id) } ?? "ax")"
    var title: String?
    var url: String?
    var frame = t.window?.bounds
    var ax: AXTextResult?
    if let axWin = t.axWindow {
      // First time for this Electron app: give it a moment to build the tree it was asked for.
      if isFront, Apps.enableManualAccessibility(t.app) { usleep(150_000) }
      let v = AX.multiple(axWin, [kAXTitleAttribute, kAXPositionAttribute, kAXSizeAttribute])
      title = AX.str(v[kAXTitleAttribute])
      frame = frame ?? AX.frame(position: v[kAXPositionAttribute], size: v[kAXSizeAttribute])
      let focused = isFront ? FocusReader.focused(pid: t.app.pid)?.element : nil
      let walkStart = monoMs()
      let text = AXTextReader.read(window: axWin, windowFrame: frame, focused: focused, maxChars: p.maxChars)
      Log.debug("ax walk \(t.app.bundleId): \(text.visited) nodes, \(text.chars) chars, "
        + "\(Int(monoMs() - walkStart)) ms\(text.timedOut ? " (budget hit)" : ""), "
        + "kept \(text.trim.rawValue), dropped \(text.droppedChars) chars")
      // The walk records the page's AXURL; search separately only when it stopped early.
      url = text.url ?? (text.sawWebArea || !(text.timedOut || text.chars >= p.maxChars) ? nil : AXTextReader.url(of: axWin))
      ax = text
    }
    let windowId = t.window.map { Int($0.id) } ?? t.axWindow.flatMap(AX.windowId).map(Int.init)
    func make(_ source: TextSource, changed: Bool, hash: String, lines: [TextLine]) -> PerceivedWindow {
      PerceivedWindow(pid: Int(t.app.pid), bundleId: t.app.bundleId, appName: t.app.name, windowId: windowId,
                      title: title, url: url, frame: frame.map(Rect.init), source: source, changed: changed,
                      contentHash: hash, lines: changed ? lines : [], capturedAt: isoNow())
    }
    let axChars = ax?.chars ?? 0
    let wantOcr = p.allowOcr && (p.forceOcr || axChars < minAXChars || ocrBundleIds.contains(t.app.bundleId))
    if wantOcr, let win = t.window, let frame, let ocr = ocrWindow(win, frame: frame, key: key, params: p, session: session) {
      return make(.ocr, changed: ocr.changed, hash: ocr.hash, lines: ocr.lines)
    }
    let lines = ax?.lines ?? []
    let hash = "ax:" + fnv1a64(lines.map(\.text).joined(separator: "\n"))
    let changed = session.update(key, hash: hash)
    return make(.ax, changed: changed, hash: hash, lines: lines)
  }

  private static func ocrWindow(_ win: WindowInfo, frame: CGRect, key: String, params p: PerceiveParams,
                                session: Session) -> (changed: Bool, hash: String, lines: [TextLine])? {
    let started = monoMs()
    guard Permissions.screenRecording, let image = Capture.window(id: win.id) else { return nil }
    let dhash = DHash.compute(image)
    let now = monoMs()
    Log.debug("captured \(image.width)x\(image.height) in \(Int(now - started)) ms")
    if let prev = session.state(key), let pd = prev.dhash, let at = prev.ocrAt, prev.hash.hasPrefix("ocr:"),
       DHash.distance(pd, dhash) < max(1, p.minChange), now - at < ocrMaxAgeMs {
      return (false, prev.hash, [])
    }
    guard let raw = try? OCR.recognize(image) else { return nil }
    Log.debug("ocr \(raw.count) lines in \(Int(monoMs() - now)) ms")
    var lines = OCR.textLines(raw, frame: frame)
    var total = 0
    lines = lines.filter { l in
      total += l.text.count
      return total <= p.maxChars
    }
    let hash = "ocr:" + fnv1a64(lines.map(\.text).joined(separator: "\n"))
    let changed = session.update(key, hash: hash, dhash: dhash, ocrAt: now)
    return (changed, hash, lines)
  }
}
