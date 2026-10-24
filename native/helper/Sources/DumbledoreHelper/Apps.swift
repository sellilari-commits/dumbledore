// Apps.swift — running-app facts: identity, "is this Dumbledore?", Chromium/Electron detection and
// the AXManualAccessibility switch that makes Chromium-based apps expose their full AX tree.
import AppKit
import ApplicationServices

struct AppInfo {
  let pid: pid_t
  let bundleId: String
  let name: String
  let bundlePath: String?

  var ref: AppRef { AppRef(pid: Int(pid), bundleId: bundleId, appName: name) }
}

enum Apps {
  private static let lock = NSLock()
  nonisolated(unsafe) private static var chromiumByPath: [String: Bool] = [:]
  nonisolated(unsafe) private static var manualAXPids: Set<pid_t> = []

  /// Dumbledore's own processes (the app, its helper, and Electron while developing).
  static func isOwn(_ bundleId: String) -> Bool {
    bundleId.hasPrefix("org.stuhi.dumbledore") || bundleId == "com.github.Electron"
  }

  /// System surfaces that are never read: the lock screen and the screen saver.
  static let neverRead: Set<String> = ["com.apple.loginwindow", "com.apple.ScreenSaver.Engine", "com.apple.SecurityAgent"]

  /// Windows of this app may be perceived (subject to the caller's exclusions).
  static func isReadable(_ bundleId: String) -> Bool { !isOwn(bundleId) && !neverRead.contains(bundleId) }

  static func info(_ app: NSRunningApplication) -> AppInfo {
    AppInfo(pid: app.processIdentifier, bundleId: app.bundleIdentifier ?? "",
            name: app.localizedName ?? app.bundleURL?.deletingPathExtension().lastPathComponent ?? "",
            bundlePath: app.bundleURL?.path)
  }

  static func info(pid: pid_t) -> AppInfo? {
    guard let app = NSRunningApplication(processIdentifier: pid) else { return nil }
    return info(app)
  }

  static func frontmost() -> AppInfo? {
    guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
    return info(app)
  }

  static var frontmostPid: pid_t? { NSWorkspace.shared.frontmostApplication?.processIdentifier }

  private static let chromiumBundlePrefixes = [
    "com.google.Chrome", "org.chromium.Chromium", "com.microsoft.edgemac", "com.brave.Browser",
    "company.thebrowser.Browser", "com.vivaldi.Vivaldi", "com.operasoftware.Opera", "com.openai.atlas",
    "ai.perplexity.comet", "com.sigmaos.sigmaos",
  ]

  /// Chrome-family browsers and Electron apps: AX insertion is unreliable there, so we paste.
  static func isChromiumLike(_ app: AppInfo) -> Bool {
    if chromiumBundlePrefixes.contains(where: { app.bundleId.hasPrefix($0) }) { return true }
    guard let path = app.bundlePath else { return false }
    lock.lock()
    if let cached = chromiumByPath[path] {
      lock.unlock()
      return cached
    }
    lock.unlock()
    let frameworks = (try? FileManager.default.contentsOfDirectory(atPath: "\(path)/Contents/Frameworks")) ?? []
    let found = frameworks.contains { name in
      name.hasSuffix(".framework") && (name.contains("Electron") || name.contains("Chromium") || name.contains("Chrome"))
    }
    lock.lock()
    chromiumByPath[path] = found
    lock.unlock()
    return found
  }

  /// Asks a Chromium/Electron app to build its full accessibility tree. Done once per process,
  /// and only for the frontmost app (it costs the target app memory). Returns true only on the
  /// call that switched it on, so the caller can give the app a moment to build the tree.
  /// Chrome itself answers "unsupported" (-25205) and builds its tree lazily on first query.
  @discardableResult
  static func enableManualAccessibility(_ app: AppInfo) -> Bool {
    guard !isOwn(app.bundleId), isChromiumLike(app), Permissions.accessibility else { return false }
    lock.lock()
    let done = manualAXPids.contains(app.pid)
    if !done { manualAXPids.insert(app.pid) }
    lock.unlock()
    guard !done else { return false }
    // Not AXEnhancedUserInterface: that VoiceOver switch slows window animations in Chromium.
    let err = AX.set(AX.app(app.pid), "AXManualAccessibility", kCFBooleanTrue)
    Log.debug("AXManualAccessibility on \(app.bundleId): \(err.rawValue)")
    return err == .success
  }

  /// Forget per-process caches for exited apps.
  static func forget(pid: pid_t) {
    lock.lock()
    manualAXPids.remove(pid)
    lock.unlock()
  }
}
