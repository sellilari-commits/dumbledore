// System.swift — idle time, display layout, and screen lock / display change notifications.
//
// Display frames are converted from Cocoa (bottom-left origin) to global top-left points so they
// match Accessibility, Quartz window bounds and Electron's `screen` module.
import AppKit
import CoreGraphics

enum SystemInfo {
  /// Seconds since the last keyboard/mouse/trackpad event in this login session.
  static func idleSeconds() -> Double {
    let any = CGEventType(rawValue: UInt32.max) ?? .null
    let s = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: any)
    return s.isFinite ? (s * 1000).rounded() / 1000 : 0
  }

  /// True while the login window covers the session (screen locked).
  static func isScreenLocked() -> Bool {
    guard let dict = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
    return (dict["CGSSessionScreenIsLocked"] as? Bool) ?? ((dict["CGSSessionScreenIsLocked"] as? NSNumber)?.boolValue ?? false)
  }

  static func displays() -> [Display] {
    onMain { displaysOnMain() }
  }

  @MainActor
  static func displaysOnMain() -> [Display] {
    let screens = NSScreen.screens
    guard let primary = screens.first else { return [] }
    let primaryHeight = primary.frame.height
    func flip(_ r: NSRect) -> Rect {
      Rect(x: Double(r.origin.x), y: Double(primaryHeight - r.origin.y - r.height),
           width: Double(r.width), height: Double(r.height))
    }
    let mainId = CGMainDisplayID()
    return screens.map { screen in
      let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
      let id = number?.uint32Value ?? 0
      return Display(
        id: Int(id), frame: flip(screen.frame), visibleFrame: flip(screen.visibleFrame),
        scale: Double(screen.backingScaleFactor), isMain: id == mainId,
        hasNotch: screen.safeAreaInsets.top > 0)
    }
  }
}

/// Watches lock/unlock and display reconfiguration and emits events. Main thread only.
@MainActor
final class SystemObserver {
  static let shared = SystemObserver()
  private var tokens: [NSObjectProtocol] = []
  private var displayWork: DispatchWorkItem?

  func start() {
    let dnc = DistributedNotificationCenter.default()
    tokens.append(dnc.addObserver(forName: NSNotification.Name("com.apple.screenIsLocked"), object: nil,
                                  queue: .main) { _ in
      Events.emit("screen.locked", EmptyEvent())
    })
    tokens.append(dnc.addObserver(forName: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil,
                                  queue: .main) { _ in
      Events.emit("screen.unlocked", EmptyEvent())
    })
    tokens.append(NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
    ) { _ in
      MainActor.assumeIsolated { SystemObserver.shared.displaysChanged() }
    })
  }

  /// Coalesces bursts of reconfiguration notifications into one event.
  private func displaysChanged() {
    displayWork?.cancel()
    let work = DispatchWorkItem {
      MainActor.assumeIsolated {
        Events.emit("display.changed", DisplayChangedEvent(displays: SystemInfo.displaysOnMain()))
      }
    }
    displayWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
  }
}
