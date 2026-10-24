// Focus.swift — the focused element (ax.focused) and focus tracking (focus.changed, app.activated).
//
// NSWorkspace activation notifications re-attach an AXObserver to the new frontmost app; focused
// element / window changes (and value changes of the focused field, debounced) produce
// `focus.changed`. Describing elements runs on a background queue, never on the main thread;
// closures handed to that queue are marked @Sendable so they are not MainActor-isolated.
import AppKit
@preconcurrency import ApplicationServices

enum FocusReader {
  /// The focused UI element of `pid` (default: the frontmost app).
  static func focused(pid: pid_t? = nil) -> (element: AXUIElement, app: AppInfo)? {
    guard Permissions.accessibility else { return nil }
    guard let app = pid.flatMap({ Apps.info(pid: $0) }) ?? (pid == nil ? Apps.frontmost() : nil) else { return nil }
    if app.pid == Apps.frontmostPid { Apps.enableManualAccessibility(app) }
    if let el = AX.element(AX.app(app.pid), kAXFocusedUIElementAttribute) { return (el, app) }
    if let el = AX.element(AX.systemWide, kAXFocusedUIElementAttribute), AX.pid(el) == app.pid { return (el, app) }
    return nil
  }

  static func isSecure(role: String?, subrole: String?) -> Bool {
    role == "AXSecureTextField" || subrole == "AXSecureTextField"
  }

  static func describe(_ el: AXUIElement, app: AppInfo) -> FocusedElement {
    let names = [kAXRoleAttribute, kAXSubroleAttribute, kAXPositionAttribute, kAXSizeAttribute,
                 "AXPlaceholderValue", kAXNumberOfCharactersAttribute, kAXSelectedTextRangeAttribute]
    let v = AX.multiple(el, names)
    let role = AX.str(v[kAXRoleAttribute]) ?? "AXUnknown"
    let subrole = AX.str(v[kAXSubroleAttribute])
    let secure = isSecure(role: role, subrole: subrole)
    let editable = secure || (textInputRoles.contains(role) && AX.isSettable(el, kAXValueAttribute))
    let frame = AX.frame(position: v[kAXPositionAttribute], size: v[kAXSizeAttribute])
    var caret: CGRect?
    var length: Int?
    if !secure {
      length = AX.integer(v[kAXNumberOfCharactersAttribute])
      if length == nil, editable { length = AX.string(el, kAXValueAttribute)?.utf16.count }
      if editable, let sel = AX.range(v[kAXSelectedTextRangeAttribute]) {
        caret = caretRect(el, selection: sel, length: length)
      }
    }
    return FocusedElement(
      pid: Int(app.pid), bundleId: app.bundleId, appName: app.name, role: role, subrole: subrole,
      editable: editable, isSecure: secure, frame: frame.map(Rect.init), caret: caret.map(Rect.init),
      placeholder: secure ? nil : AX.str(v["AXPlaceholderValue"]), valueLength: length,
      ref: RefRegistry.shared.register(el, pid: app.pid))
  }

  /// Caret as a 1-pt-wide rect, from AXBoundsForRange over the character at (or before) the caret.
  static func caretRect(_ el: AXUIElement, selection: CFRange, length: Int?) -> CGRect? {
    let loc = selection.location + selection.length
    func bounds(_ location: Int, _ len: Int) -> CGRect? {
      guard let arg = AX.rangeValue(location, len),
            let r = AX.rect(AX.param(el, kAXBoundsForRangeParameterizedAttribute, arg)),
            r.height > 0, r.origin.x.isFinite, r.origin.y.isFinite else { return nil }
      return r
    }
    if let len = length, loc < len, let r = bounds(loc, 1) {
      return CGRect(x: r.minX, y: r.minY, width: 1, height: r.height)
    }
    if loc > 0, let r = bounds(loc - 1, 1) {
      return CGRect(x: r.maxX, y: r.minY, width: 1, height: r.height)
    }
    if let r = bounds(loc, 0) { return CGRect(x: r.minX, y: r.minY, width: 1, height: r.height) }
    return markerCaret(el, atStart: loc == 0)
  }

  /// Chromium / WebKit content-editables often lack AXBoundsForRange; their text markers work.
  /// A collapsed selection should give a zero-width rect; a wider one is the line box, which
  /// only tells the caret position when the caret sits at the very start (left-to-right text).
  private static func markerCaret(_ el: AXUIElement, atStart: Bool) -> CGRect? {
    guard let range = AX.attr(el, "AXSelectedTextMarkerRange"),
          let r = AX.rect(AX.param(el, "AXBoundsForTextMarkerRange", range)),
          r.height > 0, r.origin.x.isFinite, r.origin.y.isFinite, r.width <= 2 || atStart else { return nil }
    return CGRect(x: r.minX, y: r.minY, width: 1, height: r.height)
  }
}

private let focusCallback: AXObserverCallback = { _, _, notification, _ in
  // Typing and window drags fire in bursts: debounce those longer than a focus move.
  let name = notification as String
  let delay = name == kAXValueChangedNotification ? 0.25
    : (name == kAXWindowMovedNotification || name == kAXWindowResizedNotification) ? 0.12 : 0.04
  MainActor.assumeIsolated { FocusTracker.shared.scheduleEmit(delay: delay) }
}

@MainActor
final class FocusTracker {
  static let shared = FocusTracker()
  private var observer: AXObserver?
  private var observedPid: pid_t = 0
  private var valueWatched: AXUIElement?
  private var pending: DispatchWorkItem?
  private var retryTimer: Timer?
  private let work = DispatchQueue(label: "helper.focus", qos: .userInitiated)
  /// Last emitted state; only touched on `work`.
  nonisolated(unsafe) private var last: (pid: pid_t, element: AXUIElement?, frame: Rect?, length: Int?)?

  func start() {
    let nc = NSWorkspace.shared.notificationCenter
    _ = nc.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      MainActor.assumeIsolated { FocusTracker.shared.activated(app) }
    }
    _ = nc.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { note in
      if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
        Apps.forget(pid: app.processIdentifier)
      }
    }
    if let front = NSWorkspace.shared.frontmostApplication { attach(front) }
    // Accessibility can be granted while we run: attach as soon as it is.
    retryTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
      MainActor.assumeIsolated { FocusTracker.shared.retryIfNeeded() }
    }
  }

  /// Re-sends the current focus (a client just connected and has no state yet).
  func refresh() {
    work.async { @Sendable [weak self] in self?.last = nil }
    scheduleEmit(delay: 0.05)
  }

  private func activated(_ app: NSRunningApplication?) {
    guard let app else { return }
    Events.emit("app.activated", Apps.info(app).ref)
    attach(app)
  }

  private func retryIfNeeded() {
    guard observer == nil, Permissions.accessibility, let front = NSWorkspace.shared.frontmostApplication else { return }
    attach(front)
  }

  private func attach(_ app: NSRunningApplication) {
    detach()
    let pid = app.processIdentifier
    observedPid = pid
    if Permissions.accessibility {
      let info = Apps.info(app)
      work.async { @Sendable in Apps.enableManualAccessibility(info) }
      var created: AXObserver?
      if AXObserverCreate(pid, focusCallback, &created) == .success, let obs = created {
        let appEl = AX.app(pid)
        // Moves/resizes keep the reported field frame in step with the window.
        for n in [kAXFocusedUIElementChangedNotification, kAXFocusedWindowChangedNotification,
                  kAXWindowMovedNotification, kAXWindowResizedNotification] {
          AXObserverAddNotification(obs, appEl, n as CFString, nil)
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
        observer = obs
      }
    }
    scheduleEmit(delay: 0.04)
  }

  private func detach() {
    if let obs = observer {
      if let el = valueWatched { AXObserverRemoveNotification(obs, el, kAXValueChangedNotification as CFString) }
      CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
    }
    observer = nil
    valueWatched = nil
  }

  func scheduleEmit(delay: Double) {
    pending?.cancel()
    // Explicitly @Sendable: a closure formed here would otherwise be MainActor-isolated, and
    // Swift 6 traps when it runs on the focus queue.
    let item = DispatchWorkItem(block: { @Sendable [weak self] in self?.emitFocus() })
    pending = item
    work.asyncAfter(deadline: .now() + delay, execute: item)
  }

  /// Watch value changes of the focused editable field (to follow its growing frame / length).
  private func watchValue(_ el: AXUIElement?) {
    guard let obs = observer else { return }
    if let old = valueWatched, let el, CFEqual(old, el) { return }
    if let old = valueWatched { AXObserverRemoveNotification(obs, old, kAXValueChangedNotification as CFString) }
    valueWatched = nil
    if let el, AXObserverAddNotification(obs, el, kAXValueChangedNotification as CFString, nil) == .success {
      valueWatched = el
    }
  }

  nonisolated private func emitFocus() {
    guard let app = Apps.frontmost() else { return }
    guard let (el, _) = FocusReader.focused(pid: app.pid) else {
      if let l = last, l.pid == app.pid, l.element == nil { return }
      last = (app.pid, nil, nil, nil)
      Events.emit("focus.changed", FocusChangedEvent(app: app.ref, element: nil))
      DispatchQueue.main.async { MainActor.assumeIsolated { FocusTracker.shared.watchValue(nil) } }
      return
    }
    let desc = FocusReader.describe(el, app: app)
    if let l = last, l.pid == app.pid, let prev = l.element, CFEqual(prev, el), l.frame == desc.frame,
       l.length == desc.valueLength {
      return
    }
    last = (app.pid, el, desc.frame, desc.valueLength)
    Events.emit("focus.changed", FocusChangedEvent(app: app.ref, element: desc))
    let watch = desc.editable && !desc.isSecure ? el : nil
    DispatchQueue.main.async { MainActor.assumeIsolated { FocusTracker.shared.watchValue(watch) } }
  }
}
