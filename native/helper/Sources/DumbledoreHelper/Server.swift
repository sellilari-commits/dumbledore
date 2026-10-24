// Server.swift — newline-delimited JSON-RPC over a Unix domain socket.
//
// The socket's parent directory is created with 0700 and the socket itself is 0600; peers must run
// as the same user (getpeereid). A stale socket file is removed; a live one (another helper
// answering) makes startup fail so two helpers never fight over one path.
import Darwin
import Foundation

/// Writes go through a serial queue; `closed` is lock-protected.
final class Connection: @unchecked Sendable {
  let id: Int
  let fd: Int32
  let peerPid: pid_t
  /// Per-connection state (change detection), so a reconnecting engine starts fresh.
  let session = Session()
  private let writeQueue: DispatchQueue
  private let lock = NSLock()
  private var closed = false

  init(id: Int, fd: Int32, peerPid: pid_t) {
    self.id = id
    self.fd = fd
    self.peerPid = peerPid
    writeQueue = DispatchQueue(label: "helper.conn.\(id).write")
  }

  var isClosed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return closed
  }

  /// Writes one line (a newline is appended). Lines never interleave.
  func send(_ line: Data) {
    writeQueue.async { [self] in
      guard !isClosed else { return }
      var payload = line
      payload.append(0x0A)
      let ok = payload.withUnsafeBytes { raw -> Bool in
        guard var p = raw.baseAddress else { return true }
        var left = raw.count
        while left > 0 {
          let n = Darwin.write(fd, p, left)
          if n < 0 {
            if errno == EINTR || errno == EAGAIN { continue }
            return false
          }
          left -= n
          p = p.advanced(by: n)
        }
        return true
      }
      if !ok { close() }
    }
  }

  /// Reads lines until EOF on a dedicated thread.
  func startReading(onLine: @escaping @Sendable (Connection, Data) -> Void, onClose: @escaping @Sendable (Connection) -> Void) {
    let thread = Thread { [self] in
      var splitter = LineSplitter()
      let chunk = UnsafeMutablePointer<UInt8>.allocate(capacity: 65536)
      defer { chunk.deallocate() }
      while true {
        let n = Darwin.read(fd, chunk, 65536)
        if n < 0 && errno == EINTR { continue }
        if n <= 0 { break }
        let (lines, tooLong) = splitter.feed(UnsafeBufferPointer(start: chunk, count: n))
        for line in lines { onLine(self, line) }
        if tooLong { send(RPC.errorLine(id: .null, RPCError(code: RPCCode.parse, message: "line too long"))) }
      }
      close()
      onClose(self)
    }
    thread.name = "helper.conn.\(id).read"
    thread.start()
  }

  func close() {
    lock.lock()
    let wasClosed = closed
    closed = true
    lock.unlock()
    if !wasClosed {
      shutdown(fd, SHUT_RDWR)
      Darwin.close(fd)
    }
  }
}

/// Splits a byte stream into lines (LF or CRLF; empty lines dropped) in linear time: only bytes
/// not searched before are scanned (memchr), and the consumed prefix is dropped once per chunk.
/// A line longer than `maxLine` is reported once and skipped up to its newline.
struct LineSplitter {
  let maxLine: Int
  private var buffer: [UInt8] = []
  private var scanned = 0
  private var discarding = false

  init(maxLine: Int = 16 * 1024 * 1024) { self.maxLine = maxLine }

  /// Bytes held for an unfinished line.
  var pending: Int { buffer.count }

  mutating func feed(_ bytes: UnsafeBufferPointer<UInt8>) -> (lines: [Data], tooLong: Bool) {
    buffer.append(contentsOf: bytes)
    var lines: [Data] = []
    var lineStart = 0
    var dropping = discarding
    buffer.withUnsafeBufferPointer { buf in
      guard let base = buf.baseAddress else { return }
      var from = scanned
      while from < buf.count, let hit = memchr(base + from, 0x0A, buf.count - from) {
        let nl = UnsafeRawPointer(base).distance(to: UnsafeRawPointer(hit))
        if dropping {
          dropping = false  // the over-long line ends here
        } else {
          var end = nl
          if end > lineStart, buf[end - 1] == 0x0D { end -= 1 }
          if end > lineStart { lines.append(Data(buf[lineStart..<end])) }
        }
        lineStart = nl + 1
        from = nl + 1
      }
    }
    discarding = dropping
    if lineStart > 0 { buffer.removeFirst(lineStart) }
    var tooLong = false
    if discarding {
      buffer.removeAll()
    } else if buffer.count > maxLine {
      buffer.removeAll()
      discarding = true
      tooLong = true
    }
    scanned = buffer.count
    return (lines, tooLong)
  }
}

enum ServerError: Error, CustomStringConvertible {
  case pathTooLong(String)
  case alreadyRunning(String)
  case system(String, Int32)

  var description: String {
    switch self {
    case .pathTooLong(let p): return "socket path is too long (max 103 bytes): \(p)"
    case .alreadyRunning(let p): return "another helper is already listening on \(p)"
    case .system(let what, let err): return "\(what) failed: \(String(cString: strerror(err)))"
    }
  }
}

/// Connections are lock-protected; callbacks are set before `start()`.
final class SocketServer: @unchecked Sendable {
  let path: String
  private var listenFd: Int32 = -1
  private let lock = NSLock()
  private var connections: [Int: Connection] = [:]
  private var nextId = 1
  var onLine: (@Sendable (Connection, Data) -> Void)?
  var onConnect: (@Sendable (Connection) -> Void)?

  init(path: String) { self.path = path }

  var connectionCount: Int {
    lock.lock()
    defer { lock.unlock() }
    return connections.count
  }

  func start() throws {
    guard path.utf8.count < 104 else { throw ServerError.pathTooLong(path) }
    let dir = (path as NSString).deletingLastPathComponent
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true,
                                            attributes: [.posixPermissions: 0o700])
    chmod(dir, 0o700)
    if FileManager.default.fileExists(atPath: path) {
      if SocketServer.isLive(path) { throw ServerError.alreadyRunning(path) }
      unlink(path)
    }
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { throw ServerError.system("socket", errno) }
    var addr = SocketServer.address(path)
    let len = socklen_t(MemoryLayout<sockaddr_un>.size)
    let bound = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) }
    }
    guard bound == 0 else {
      let err = errno
      Darwin.close(fd)
      throw ServerError.system("bind", err)
    }
    chmod(path, 0o600)
    guard listen(fd, 16) == 0 else {
      let err = errno
      Darwin.close(fd)
      throw ServerError.system("listen", err)
    }
    lock.lock()
    listenFd = fd
    lock.unlock()
    let thread = Thread { [weak self] in self?.acceptLoop() }
    thread.name = "helper.accept"
    thread.start()
  }

  func broadcast(_ line: Data) {
    lock.lock()
    let all = Array(connections.values)
    lock.unlock()
    for c in all { c.send(line) }
  }

  func stop() {
    lock.lock()
    let fd = listenFd
    listenFd = -1
    let all = Array(connections.values)
    connections.removeAll()
    lock.unlock()
    if fd >= 0 { Darwin.close(fd) }
    unlink(path)
    for c in all { c.close() }
  }

  /// The listening socket, or -1 once `stop()` ran.
  private var currentListenFd: Int32 {
    lock.lock()
    defer { lock.unlock() }
    return listenFd
  }

  private func acceptLoop() {
    while true {
      let listening = currentListenFd
      guard listening >= 0 else { return }
      let fd = accept(listening, nil, nil)
      if fd < 0 {
        let err = errno
        if currentListenFd < 0 { return }  // stopped while blocked in accept
        if err == EINTR || err == ECONNABORTED { continue }
        Log.warn("accept failed: \(String(cString: strerror(err)))")
        usleep(50_000)
        continue
      }
      var one: Int32 = 1
      setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
      var uid: uid_t = 0
      var gid: gid_t = 0
      guard getpeereid(fd, &uid, &gid) == 0, uid == getuid() else {
        Log.warn("rejected a socket peer running as another user")
        Darwin.close(fd)
        continue
      }
      var peer: pid_t = 0
      var plen = socklen_t(MemoryLayout<pid_t>.size)
      getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &peer, &plen)
      lock.lock()
      let conn = Connection(id: nextId, fd: fd, peerPid: peer)
      nextId += 1
      connections[conn.id] = conn
      lock.unlock()
      Log.debug("client \(conn.id) connected (pid \(peer))")
      onConnect?(conn)
      conn.startReading(
        onLine: { [weak self] c, line in self?.onLine?(c, line) },
        onClose: { [weak self] c in
          guard let self else { return }
          self.lock.lock()
          self.connections[c.id] = nil
          self.lock.unlock()
          Log.debug("client \(c.id) disconnected")
        })
    }
  }

  static func address(_ path: String) -> sockaddr_un {
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    withUnsafeMutableBytes(of: &addr.sun_path) { raw in
      for (i, b) in bytes.enumerated() where i < raw.count - 1 { raw[i] = b }
      raw[min(bytes.count, raw.count - 1)] = 0
    }
    return addr
  }

  /// True when something accepts connections on `path`.
  static func isLive(_ path: String) -> Bool {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { Darwin.close(fd) }
    var addr = address(path)
    let len = socklen_t(MemoryLayout<sockaddr_un>.size)
    let r = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, len) }
    }
    return r == 0
  }
}
