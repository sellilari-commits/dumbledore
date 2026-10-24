// Capture.swift — one window's pixels via ScreenCaptureKit, at native (Retina) resolution.
//
// Images stay in memory and are dropped after OCR; nothing is ever written to disk. The caller
// checks Screen Recording first: SCShareableContent would otherwise trigger the system prompt.
import CoreGraphics
import Foundation
import ScreenCaptureKit

enum Capture {
  /// Captures window `id` cropped to its frame (no shadow, no cursor). Nil on any failure.
  static func window(id: CGWindowID, timeout: Double = 3) -> CGImage? {
    guard Permissions.screenRecording else { return nil }
    let box = Box<SCShareableContent>()
    let sem = DispatchSemaphore(value: 0)
    SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
      if let error { Log.debug("shareable content failed: \(error.localizedDescription)") }
      box.value = content
      sem.signal()
    }
    guard sem.wait(timeout: .now() + timeout) == .success,
          let scWindow = box.value?.windows.first(where: { $0.windowID == id }) else { return nil }
    let filter = SCContentFilter(desktopIndependentWindow: scWindow)
    let config = SCStreamConfiguration()
    let scale = CGFloat(filter.pointPixelScale)
    config.width = max(1, Int((filter.contentRect.width * scale).rounded()))
    config.height = max(1, Int((filter.contentRect.height * scale).rounded()))
    config.showsCursor = false
    config.ignoreShadowsSingleWindow = true
    config.captureResolution = .best
    let image = Box<CGImage>()
    let sem2 = DispatchSemaphore(value: 0)
    SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { img, error in
      if let error { Log.debug("window capture failed: \(error.localizedDescription)") }
      image.value = img
      sem2.signal()
    }
    guard sem2.wait(timeout: .now() + timeout) == .success else { return nil }
    return image.value
  }
}

/// A mutable slot for values handed back by completion handlers.
final class Box<T>: @unchecked Sendable {
  private let lock = NSLock()
  private var _value: T?

  var value: T? {
    get {
      lock.lock()
      defer { lock.unlock() }
      return _value
    }
    set {
      lock.lock()
      _value = newValue
      lock.unlock()
    }
  }
}
