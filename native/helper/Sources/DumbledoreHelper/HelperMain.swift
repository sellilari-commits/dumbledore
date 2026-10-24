// HelperMain.swift — command-line options and the `serve` lifecycle (socket, observers, run loop).
//
// The process is an accessory app (no Dock icon). AppKit, AX observers and notifications live on
// the main run loop; requests are served on background queues (see Router).
import AppKit
import ApplicationServices
import Foundation

struct CLIOptions {
  let command: String
  let flags: [String: String]

  init(_ argv: [String]) {
    var cmd: String?
    var flags: [String: String] = [:]
    var i = 0
    while i < argv.count {
      let a = argv[i]
      if a.hasPrefix("--") {
        let key = String(a.dropFirst(2))
        if i + 1 < argv.count, !argv[i + 1].hasPrefix("--") {
          flags[key] = argv[i + 1]
          i += 2
        } else {
          flags[key] = "true"
          i += 1
        }
      } else if a.hasPrefix("-psn_") {
        i += 1  // Finder/LaunchServices process serial number; ignore.
      } else {
        if cmd == nil { cmd = a }
        i += 1
      }
    }
    command = cmd ?? "serve"
    self.flags = flags
  }

  func string(_ key: String) -> String? { flags[key] }
  func int(_ key: String) -> Int? { flags[key].flatMap { Int($0) } }
  func bool(_ key: String) -> Bool { flags[key] == "true" }
}

enum HelperMain {
  static let version = "0.1.0"
  nonisolated(unsafe) static var server: SocketServer?
  nonisolated(unsafe) private static var activity: NSObjectProtocol?
  nonisolated(unsafe) private static var sources: [DispatchSourceProtocol] = []

  static var defaultSocketPath: String {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "\(home)/Library/Application Support/Dumbledore/run/helper.sock"
  }

  @MainActor
  static func run(_ cli: CLIOptions) -> Never {
    signal(SIGPIPE, SIG_IGN)
    Log.verbose = cli.bool("verbose")
    let path = cli.string("socket") ?? defaultSocketPath

    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)

    let server = SocketServer(path: path)
    let router = Handlers.makeRouter()
    server.onLine = { conn, line in router.handle(line: line, connection: conn) }
    server.onConnect = { _ in
      DispatchQueue.main.async { MainActor.assumeIsolated { FocusTracker.shared.refresh() } }
    }
    Events.sink = { [weak server] line in server?.broadcast(line) }
    do {
      try server.start()
    } catch let e as ServerError {
      FileHandle.standardError.write(Data("[helper] \(e.description)\n".utf8))
      if case .alreadyRunning = e { exit(75) }
      exit(1)
    } catch {
      FileHandle.standardError.write(Data("[helper] cannot start: \(error)\n".utf8))
      exit(1)
    }
    self.server = server

    installSignalHandlers()
    if let parent = cli.int("parent-pid") { watchParent(pid_t(parent)) }

    // Stay responsive in the background: no App Nap for the poller and observers.
    activity = ProcessInfo.processInfo.beginActivity(
      options: [.userInitiatedAllowingIdleSystemSleep, .suddenTerminationDisabled],
      reason: "Dumbledore helper serves the study coach")
    AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.5)

    MainActor.assumeIsolated {
      SystemObserver.shared.start()
      FocusTracker.shared.start()
      KeyMap.shared.startObserving()
    }

    let ready = "{\"ready\":true,\"pid\":\(getpid()),\"protocol\":\(helperProtocolVersion)}\n"
    FileHandle.standardOutput.write(Data(ready.utf8))
    Log.debug("listening on \(path); methods: \(router.methods.joined(separator: ", "))")
    app.run()
    exit(0)
  }

  static func shutdown(_ code: Int32) -> Never {
    server?.stop()
    exit(code)
  }

  private static func installSignalHandlers() {
    for sig in [SIGTERM, SIGINT, SIGHUP] {
      signal(sig, SIG_IGN)
      let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
      src.setEventHandler { shutdown(0) }
      src.resume()
      sources.append(src)
    }
  }

  /// Exits when the engine process that launched us goes away (no orphaned helpers).
  private static func watchParent(_ pid: pid_t) {
    guard pid > 1 else { return }
    if kill(pid, 0) != 0 && errno == ESRCH { shutdown(0) }
    let src = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
    src.setEventHandler { shutdown(0) }
    src.resume()
    sources.append(src)
  }
}
