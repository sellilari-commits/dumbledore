// Refs.swift — opaque element handles. `ref` strings cross the protocol; the AXUIElement stays here.
//
// Refs look like "ax:<pid>:<n>". The registry keeps the most recent 256 elements; resolving an
// evicted or dead element returns nil.
import ApplicationServices
import Foundation

/// Lock-protected, hence @unchecked Sendable.
final class RefRegistry: @unchecked Sendable {
  static let shared = RefRegistry()
  private let lock = NSLock()
  private var elements: [String: AXUIElement] = [:]
  private var order: [String] = []
  private var counter = 0
  private let capacity = 256

  func register(_ el: AXUIElement, pid: pid_t) -> String {
    lock.lock()
    defer { lock.unlock() }
    // Reuse the handle of an element we already know (cheap linear scan of recent refs).
    for key in order.suffix(16).reversed() {
      if let known = elements[key], CFEqual(known, el) { return key }
    }
    counter += 1
    let key = "ax:\(pid):\(counter)"
    elements[key] = el
    order.append(key)
    if order.count > capacity {
      let evicted = order.removeFirst()
      elements[evicted] = nil
    }
    return key
  }

  /// The element for `ref`, or nil when unknown, evicted or no longer alive.
  func resolve(_ ref: String) -> AXUIElement? {
    lock.lock()
    let el = elements[ref]
    lock.unlock()
    guard let el, AX.isAlive(el) else { return nil }
    return el
  }
}
