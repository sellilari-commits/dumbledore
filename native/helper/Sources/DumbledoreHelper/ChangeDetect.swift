// ChangeDetect.swift — per-connection change detection: content hashes and 64-bit window dHashes.
//
// AX text is compared by hash. For OCR windows a 9×8 difference hash decides whether to OCR again:
// re-OCR when the Hamming distance is ≥ minChange or the last OCR is older than 30 s.
import CoreGraphics
import Foundation

/// Lock-protected, hence @unchecked Sendable.
final class Session: @unchecked Sendable {
  struct WindowState {
    var hash: String
    var dhash: UInt64?
    var ocrAt: Double?
  }

  private let lock = NSLock()
  private var windows: [String: WindowState] = [:]

  func state(_ key: String) -> WindowState? {
    lock.lock()
    defer { lock.unlock() }
    return windows[key]
  }

  func set(_ key: String, _ state: WindowState) {
    lock.lock()
    defer { lock.unlock() }
    if windows.count > 400 { windows.removeAll() }
    windows[key] = state
  }

  /// Records `hash` for `key` and returns whether it differs from the previous one.
  func update(_ key: String, hash: String, dhash: UInt64? = nil, ocrAt: Double? = nil) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    let prev = windows[key]
    if windows.count > 400 { windows.removeAll() }
    windows[key] = WindowState(hash: hash, dhash: dhash ?? prev?.dhash, ocrAt: ocrAt ?? prev?.ocrAt)
    return prev?.hash != hash
  }
}

enum DHash {
  /// 64-bit difference hash: 9×8 grayscale thumbnail, one bit per horizontal neighbour pair.
  static func compute(_ image: CGImage) -> UInt64 {
    let w = 9
    let h = 8
    var pixels = [UInt8](repeating: 0, count: w * h)
    let drawn: Bool = pixels.withUnsafeMutableBytes { raw in
      guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
      else { return false }
      ctx.interpolationQuality = .high
      ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    guard drawn else { return 0 }
    var hash: UInt64 = 0
    for y in 0..<h {
      for x in 0..<(w - 1) {
        hash <<= 1
        if pixels[y * w + x] > pixels[y * w + x + 1] { hash |= 1 }
      }
    }
    return hash
  }

  static func distance(_ a: UInt64, _ b: UInt64) -> Int { (a ^ b).nonzeroBitCount }
}
