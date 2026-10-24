// Permissions.swift — Accessibility / Screen Recording status and the "open System Settings" flow.
//
// `status()` never prompts: AXIsProcessTrusted and CGPreflightScreenCaptureAccess are read-only.
// `request()` triggers the system prompt where one exists and opens the right Privacy pane.
import AppKit
import ApplicationServices
import CoreGraphics

enum Permissions {
  static func status() -> PermissionsSnapshot {
    PermissionsSnapshot(accessibility: AXIsProcessTrusted(), screenRecording: CGPreflightScreenCaptureAccess())
  }

  static var accessibility: Bool { AXIsProcessTrusted() }
  static var screenRecording: Bool { CGPreflightScreenCaptureAccess() }

  static func request(_ kind: PermissionKind) -> Bool {
    let pane: String
    switch kind {
    case .accessibility:
      let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary  // kAXTrustedCheckOptionPrompt
      _ = AXIsProcessTrustedWithOptions(options)
      pane = "Privacy_Accessibility"
    case .screenRecording:
      _ = CGRequestScreenCaptureAccess()
      pane = "Privacy_ScreenCapture"
    }
    guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") else {
      return false
    }
    return onMain { NSWorkspace.shared.open(url) }
  }

  static func requireAccessibility() throws {
    guard AXIsProcessTrusted() else {
      throw RPCError.permission("Accessibility permission is not granted")
    }
  }
}

/// Runs `body` on the main thread and returns its value (direct call when already on main).
func onMain<T: Sendable>(_ body: @MainActor () -> T) -> T {
  if Thread.isMainThread { return MainActor.assumeIsolated(body) }
  return DispatchQueue.main.sync { MainActor.assumeIsolated(body) }
}
