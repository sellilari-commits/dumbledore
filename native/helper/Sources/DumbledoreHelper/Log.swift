// Log.swift — stderr logging plus the `helper.log` notification, and the event emitter.
//
// Only info/warn/error reach the engine as `helper.log`; debug stays on stderr (and only with
// --verbose). Log messages must never contain screen text, field values or clipboard contents.
import Foundation

enum Events {
  /// Set once at startup (before any thread starts) to the server's broadcast function.
  nonisolated(unsafe) static var sink: ((Data) -> Void)?

  static func emit<P: Encodable>(_ method: String, _ params: P) {
    guard let sink else { return }
    do {
      sink(try RPC.notificationLine(method: method, params: params))
    } catch {
      FileHandle.standardError.write(Data("[helper] cannot encode event \(method): \(error)\n".utf8))
    }
  }
}

enum Log {
  nonisolated(unsafe) static var verbose = false
  private static let lock = NSLock()

  static func debug(_ message: @autoclosure () -> String) {
    guard verbose else { return }
    write("debug", message())
  }

  static func info(_ message: String) {
    write("info", message)
    Events.emit("helper.log", LogEvent(level: .info, message: message))
  }

  static func warn(_ message: String) {
    write("warn", message)
    Events.emit("helper.log", LogEvent(level: .warn, message: message))
  }

  static func error(_ message: String) {
    write("error", message)
    Events.emit("helper.log", LogEvent(level: .error, message: message))
  }

  private static func write(_ level: String, _ message: String) {
    let line = "[helper] \(isoNow()) \(level) \(message)\n"
    lock.lock()
    FileHandle.standardError.write(Data(line.utf8))
    lock.unlock()
  }
}

private let isoFormatterLock = NSLock()
nonisolated(unsafe) private let isoFormatter: ISO8601DateFormatter = {
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return f
}()

func isoNow() -> String {
  isoFormatterLock.lock()
  defer { isoFormatterLock.unlock() }
  return isoFormatter.string(from: Date())
}

/// Monotonic milliseconds (for budgets and gesture timing).
@inline(__always) func monoMs() -> Double {
  Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000
}

/// FNV-1a 64-bit hash as 16 hex digits (content hashes; not cryptographic).
func fnv1a64(_ s: String) -> String {
  var h: UInt64 = 0xcbf2_9ce4_8422_2325
  for b in s.utf8 {
    h ^= UInt64(b)
    h = h &* 0x0000_0100_0000_01B3
  }
  return String(format: "%016llx", h)
}
