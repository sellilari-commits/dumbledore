// SelfTestIO.swift — selftest groups that need the OS but not the screen: the socket server and
// router end to end, protocol encoding, params defaults, a private pasteboard, key maps, dHash and
// OCR on rendered images, and the system probes. Nothing here types, clicks, reads other apps or
// touches the user's clipboard.
import AppKit
import CoreGraphics
import CoreText
import Darwin
import Foundation

enum SelfTestIO {
  private static func expect(_ ok: Bool, _ what: String) { SelfTest.expect(ok, what) }

  static func runAll() {
    protocolShapes()
    params()
    logic()
    lines()
    router()
    socket()
    clipboard()
    keys()
    imaging()
    ocr()
    system()
  }

  // MARK: helpers

  /// Reads one newline-terminated line from `fd` within `timeoutMs`.
  static func readLine(_ fd: Int32, timeoutMs: Double = 3000) -> String? {
    var buf = [UInt8]()
    var byte: UInt8 = 0
    let deadline = monoMs() + timeoutMs
    while monoMs() < deadline {
      var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
      guard poll(&pfd, 1, Int32(max(1, deadline - monoMs()))) > 0 else { return nil }
      guard Darwin.read(fd, &byte, 1) == 1 else { return nil }
      if byte == 0x0A { return String(decoding: buf, as: UTF8.self) }
      buf.append(byte)
    }
    return nil
  }

  private static func writeLine(_ fd: Int32, _ s: String) {
    let bytes = Array((s + "\n").utf8)
    _ = bytes.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, $0.count) }
  }

  private static func encode<T: Encodable>(_ v: T) -> String {
    (try? RPC.encoder().encode(v)).map { String(decoding: $0, as: UTF8.self) } ?? ""
  }

  private static func errorCode(_ v: JSONValue?) -> Int? { v?["error"]?["code"]?.int }

  /// Encodes `v` and compares it with `json` as values (key order is not guaranteed).
  private static func same<T: Encodable>(_ v: T, _ json: String) -> Bool {
    guard let a = try? JSONValue.parse(encode(v)), let b = try? JSONValue.parse(json) else { return false }
    return a == b
  }

  // MARK: groups

  /// Every `.nullable()` key of the TS protocol is present (as null) in what we send.
  private static func protocolShapes() {
    let el = FocusedElement(pid: 1, bundleId: "b", appName: "a", role: "AXTextArea", subrole: nil, editable: true,
                            isSecure: false, frame: nil, caret: nil, placeholder: nil, valueLength: nil, ref: nil)
    let e = encode(el)
    expect(["subrole", "frame", "caret", "placeholder", "valueLength", "ref"].allSatisfy { e.contains("\"\($0)\":null") },
           "FocusedElement null keys")
    let w = encode(PerceivedWindow(pid: 1, bundleId: "b", appName: "a", windowId: nil, title: nil, url: nil, frame: nil,
                                   source: .ax, changed: false, contentHash: "ax:0", lines: [], capturedAt: isoNow()))
    expect(["windowId", "title", "url", "frame"].allSatisfy { w.contains("\"\($0)\":null") }, "PerceivedWindow null keys")
    expect(same(FindChatInputResult.none, #"{"found":false,"frame":null,"ref":null,"method":null}"#),
           "findChatInput none")
    expect(encode(WriteResult.fail("x")).contains(#""method":null"#), "write result null method")
    expect(same(FocusChangedEvent(app: nil, element: nil), #"{"app":null,"element":null}"#), "focus.changed nulls")
    let line = TextLine(text: "t", conf: 1, box: nil, align: nil)
    expect(same(line, #"{"text":"t","conf":1,"box":null,"align":null}"#), "text line nulls")
    let r = Rect(x: 1.23456, y: .nan, width: -5, height: 2.005)
    expect(r.x == 1.23 && r.y == 0 && r.width == 0 && r.height >= 2 && r.height <= 2.01, "rect rounding")
    expect(same(KeyTriggerEvent(gesture: .doubleTap, key: .rightOption, secureInput: false),
                #"{"gesture":"doubleTap","key":"rightOption","secureInput":false}"#), "key.trigger shape")
    let urlish = encode(FrontmostInfo(pid: 1, bundleId: "b", appName: "a", windowId: nil, windowTitle: nil,
                                      windowFrame: nil, isFullScreen: false, url: "https://x.org/a"))
    expect(urlish.contains(#""url":"https://x.org/a""#), "slashes stay unescaped")
  }

  /// Zod defaults are applied when keys are missing; bad params name the offending key.
  private static func params() {
    func decode<P: Decodable>(_ t: P.Type, _ params: String) throws -> P {
      try RPC.decodeParams(t, from: Data(#"{"jsonrpc":"2.0","id":1,"method":"m","params":\#(params)}"#.utf8))
    }
    if let p = try? decode(PerceiveParams.self, #"{"scope":"frontmost"}"#) {
      expect(p.minChange == 6 && p.allowOcr && !p.forceOcr && p.maxChars == 20000 && p.excludeBundleIds.isEmpty,
             "perceive defaults")
    } else {
      expect(false, "perceive params decode")
    }
    do {
      _ = try decode(PerceiveParams.self, "{}")
      expect(false, "missing scope rejected")
    } catch let e as RPCError {
      expect(e.code == RPCCode.invalidParams && e.message.contains("params.scope"), "missing scope message: \(e.message)")
    } catch {
      expect(false, "missing scope error type")
    }
    let w = try? decode(InputWriteParams.self, #"{"text":"hi","mode":"insert","target":null,"expectPid":null}"#)
    expect(w?.method == .auto && w?.restoreClipboard == true && w?.target == nil, "input.write defaults")
    let t = try? decode(InputWriteParams.self, #"{"text":"","mode":"replaceAll","target":{"ref":"ax:1:1","point":null},"expectPid":7}"#)
    expect(t?.target?.ref == "ax:1:1" && t?.target?.point == nil && t?.expectPid == 7, "write target decode")
    expect((try? decode(ShortcutParams.self, #"{"key":"fn","tapMaxMs":1,"holdMinMs":2,"doubleTapMs":3,"enabled":true}"#))?.key == .fn,
           "shortcut params")
    expect((try? decode(ShortcutParams.self, #"{"key":"capsLock","tapMaxMs":1,"holdMinMs":2,"doubleTapMs":3,"enabled":true}"#)) == nil,
           "unknown trigger key rejected")
    let empty = try? RPC.decodeParams(EmptyParams.self, from: Data(#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#.utf8))
    expect(empty != nil, "missing params decode as {}")
    let chat = try? decode(FindChatInputParams.self, #"{"pid":null}"#)
    expect(chat?.pid == nil && chat?.placeholders == [], "findChatInput defaults")
    let gen = try? decode(GenerateParams.self, #"{"instructions":"i","prompt":"p","schema":{"type":"object"},"maxTokens":null,"temperature":0.2}"#)
    expect(gen?.schema["type"] == .string("object") && gen?.temperature == 0.2, "generate params")
  }

  /// Pure helpers used by perceive, focus and the trigger.
  private static func logic() {
    expect(Apps.isOwn("org.stuhi.dumbledore") && Apps.isOwn("org.stuhi.dumbledore.helper") && Apps.isOwn("com.github.Electron"),
           "own bundle ids")
    expect(!Apps.isReadable("org.stuhi.dumbledore.dev") && !Apps.isReadable("com.apple.loginwindow")
      && Apps.isReadable("com.google.Chrome"), "readable apps")
    let s = Session()
    expect(s.update("k", hash: "a"), "session first hash is a change")
    expect(!s.update("k", hash: "a"), "session same hash")
    expect(s.update("k", hash: "b", dhash: 5, ocrAt: 10), "session new hash")
    _ = s.update("k", hash: "b")
    expect(s.state("k")?.dhash == 5 && s.state("k")?.ocrAt == 10, "session keeps dhash and OCR time")
    let win = WindowInfo(id: 1, pid: 1, bounds: CGRect(x: 0, y: 0, width: 100, height: 100), layer: 0, alpha: 1)
    let half = WindowInfo(id: 2, pid: 2, bounds: CGRect(x: 0, y: 0, width: 50, height: 100), layer: 0, alpha: 1)
    let full = WindowInfo(id: 3, pid: 3, bounds: CGRect(x: -10, y: -10, width: 200, height: 200), layer: 0, alpha: 1)
    expect(Windows.visibleFraction(win, above: []) == 1, "visible: nothing above")
    expect(abs(Windows.visibleFraction(win, above: [half]) - 0.5) < 0.01, "visible: half covered")
    expect(Windows.visibleFraction(win, above: [full]) == 0, "visible: covered")
    // Inline runs on one visual line join; the next line stays separate.
    let merged = AXTextReader.merge([AXFragment(text: "Hello", frame: CGRect(x: 0, y: 0, width: 40, height: 16)),
                                     AXFragment(text: "world", frame: CGRect(x: 45, y: 0, width: 40, height: 16)),
                                     AXFragment(text: "Next line", frame: CGRect(x: 0, y: 20, width: 70, height: 16))])
    expect(merged.map(\.text) == ["Hello world", "Next line"], "AX fragments merge: \(merged.map(\.text))")
    expect(merged.first?.box?.width == 85 && merged.first?.align == .left, "merged box and alignment")
    expect(AXTextReader.clean("a\u{00A0} b\u{200B}c  d") == "a bc d", "AX text clean")
    regionTrim()
    let cli = CLIOptions(["serve", "--socket", "/x.sock", "--verbose", "--parent-pid", "42"])
    expect(cli.command == "serve" && cli.string("socket") == "/x.sock" && cli.bool("verbose") && cli.int("parent-pid") == 42,
           "cli options")
    expect(CLIOptions(["-psn_0_1234"]).command == "serve", "Finder launch defaults to serve")
    let masks = TriggerKey.allCases.map(ModifierBits.mask)
    expect(Set(masks).count == masks.count && masks.allSatisfy { $0 & ModifierBits.all == $0 }, "modifier masks")
    expect(InputService.norm(" a\u{00A0}b\r\n") == "a b", "write verify normalization")
    let a = AX.app(getpid())
    let r1 = RefRegistry.shared.register(a, pid: getpid())
    expect(RefRegistry.shared.register(AX.app(getpid()), pid: getpid()) == r1 && r1.hasPrefix("ax:\(getpid()):"),
           "refs reuse handles")
    expect(RefRegistry.shared.resolve("ax:0:999999") == nil, "unknown ref")
  }

  /// The connection's line splitter: CRLF, empty lines, split chunks, over-long lines, linear time.
  private static func lines() {
    func feed(_ sp: inout LineSplitter, _ bytes: [UInt8]) -> (lines: [String], tooLong: Bool) {
      let r = bytes.withUnsafeBufferPointer { sp.feed($0) }
      return (r.lines.map { String(decoding: $0, as: UTF8.self) }, r.tooLong)
    }
    var sp = LineSplitter()
    expect(feed(&sp, Array("a\nb\r\n\n\nc".utf8)).lines == ["a", "b"] && sp.pending == 1, "split lines, CRLF, empties")
    expect(feed(&sp, Array("d".utf8)).lines.isEmpty, "partial line held")
    expect(feed(&sp, Array("\n".utf8)).lines == ["cd"] && sp.pending == 0, "line completed across chunks")
    var small = LineSplitter(maxLine: 10)
    let long = feed(&small, Array(repeating: UInt8(ascii: "x"), count: 25))
    expect(long.tooLong && long.lines.isEmpty, "over-long line reported")
    let more = feed(&small, Array("xxxx".utf8))
    expect(!more.tooLong && more.lines.isEmpty, "over-long line reported once")
    expect(feed(&small, Array("yy\nok\n".utf8)).lines == ["ok"], "rest of the over-long line skipped")
    // 8 MB in 64 KB chunks: linear time (the old reader took ~14 s).
    var big = LineSplitter()
    let chunk = [UInt8](repeating: UInt8(ascii: "a"), count: 65536)
    let started = monoMs()
    for _ in 0..<128 { _ = chunk.withUnsafeBufferPointer { big.feed($0) } }
    let done = feed(&big, Array("\n".utf8))
    expect(done.lines.first?.count == 8 * 1024 * 1024 && monoMs() - started < 1000,
           "8 MB line in linear time (\(Int(monoMs() - started)) ms)")
  }

  /// The real method table over a socketpair: JSON-RPC error codes and notifications.
  private static func router() {
    var fds: [Int32] = [0, 0]
    guard socketpair(AF_UNIX, SOCK_STREAM, 0, &fds) == 0 else { return expect(false, "socketpair") }
    let conn = Connection(id: 9999, fd: fds[0], peerPid: getpid())
    defer {
      conn.close()
      Darwin.close(fds[1])
    }
    let r = Handlers.makeRouter()
    func call(_ line: String) -> JSONValue? {
      r.handle(line: Data(line.utf8), connection: conn)
      return readLine(fds[1]).flatMap { try? JSONValue.parse($0) }
    }
    let parse = call("not json")
    expect(errorCode(parse) == RPCCode.parse && parse?["id"] == .null, "parse error")
    expect(errorCode(call("[1,2]")) == RPCCode.invalidRequest, "batch rejected")
    expect(errorCode(call(#"{"jsonrpc":"2.0","id":1}"#)) == RPCCode.invalidRequest, "missing method")
    let unknown = call(#"{"jsonrpc":"2.0","id":2,"method":"nope"}"#)
    expect(errorCode(unknown) == RPCCode.methodNotFound && unknown?["id"]?.int == 2, "method not found")
    // A notification (no id) gets no answer: the next line must be the ping's.
    r.handle(line: Data(#"{"jsonrpc":"2.0","method":"nope"}"#.utf8), connection: conn)
    let ping = call(#"{"jsonrpc":"2.0","id":"s1","method":"ping"}"#)
    expect(ping?["id"]?.string == "s1" && ping?["result"]?["version"]?.int == helperProtocolVersion
      && ping?["result"]?["pid"]?.int == Int(getpid()), "ping over the router")
    expect(errorCode(call(#"{"jsonrpc":"2.0","id":4,"method":"perceive","params":{"scope":"everything"}}"#))
      == RPCCode.invalidParams, "bad enum value")
    let missing = call(#"{"jsonrpc":"2.0","id":5,"method":"perceive","params":{}}"#)
    expect(missing?["error"]?["message"]?.string?.contains("params.scope") == true, "missing param named")
    let durations = #"{"key":"rightOption","tapMaxMs":0,"holdMinMs":500,"doubleTapMs":300,"enabled":false}"#
    expect(errorCode(call(#"{"jsonrpc":"2.0","id":6,"method":"shortcut.configure","params":\#(durations)}"#))
      == RPCCode.invalidParams, "shortcut durations validated")
    let protocolMethods = [
      "app.activate", "ax.findChatInput", "ax.focused", "ax.readFocusedValue", "ax.selectedText", "file.pdfText",
      "frontmost",
      "input.click", "input.key", "input.write", "llm.onDevice.generate", "llm.onDevice.status", "perceive",
      "permissions.request", "permissions.status", "ping", "shortcut.configure", "system.displays", "system.idle",
    ]
    expect(r.methods == protocolMethods, "method table matches helper-protocol.ts: \(r.methods)")
  }

  /// A real server on a temporary socket: liveness, single instance, permissions, cleanup.
  private static func socket() {
    let dir = (NSTemporaryDirectory() as NSString).appendingPathComponent("dh-st-\(getpid())")
    let path = (dir as NSString).appendingPathComponent("h.sock")
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let server = SocketServer(path: path)
    let r = Handlers.makeRouter()
    server.onLine = { c, line in r.handle(line: line, connection: c) }
    do { try server.start() } catch { return expect(false, "server starts: \(error)") }
    expect(SocketServer.isLive(path), "socket is live")
    do {
      try SocketServer(path: path).start()
      expect(false, "second server refused")
    } catch ServerError.alreadyRunning {
      expect(true, "second server refused")
    } catch {
      expect(false, "second server error: \(error)")
    }
    let mode = (try? FileManager.default.attributesOfItem(atPath: path))?[.posixPermissions] as? NSNumber
    expect(mode?.intValue == 0o600, "socket mode 0600")
    let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    var addr = SocketServer.address(path)
    let ok = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    expect(ok == 0, "client connects")
    writeLine(fd, #"{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}"#)
    writeLine(fd, #"{"jsonrpc":"2.0","id":2,"method":"system.idle","params":{}}"#)
    let first = readLine(fd).flatMap { try? JSONValue.parse($0) }
    let second = readLine(fd).flatMap { try? JSONValue.parse($0) }
    let ids = Set([first?["id"]?.int, second?["id"]?.int].compactMap { $0 })
    expect(ids == [1, 2], "two pipelined requests answered")
    expect(server.connectionCount == 1, "one connection tracked")
    Darwin.close(fd)
    server.stop()
    expect(!FileManager.default.fileExists(atPath: path), "socket removed on stop")
    do {
      try SocketServer(path: "/" + String(repeating: "x", count: 120)).start()
      expect(false, "long path rejected")
    } catch ServerError.pathTooLong {
      expect(true, "long path rejected")
    } catch {
      expect(false, "long path error: \(error)")
    }
  }

  /// Save → transient write → restore on a private pasteboard (never the user's clipboard).
  private static func clipboard() {
    let name = NSPasteboard.Name("org.stuhi.dumbledore.selftest.\(getpid())")
    let binary = NSPasteboard.PasteboardType("org.stuhi.dumbledore.selftest.binary")
    onMain {
      let pb = NSPasteboard(name: name)
      pb.clearContents()
      let a = NSPasteboardItem()
      a.setString("first", forType: .string)
      a.setData(Data([1, 2, 3]), forType: binary)
      let b = NSPasteboardItem()
      b.setString("second", forType: .string)
      pb.writeObjects([a, b])
    }
    let saved = Clipboard.save(name)
    expect(saved.count == 2 && saved[0].count >= 2, "clipboard saves every item and type")
    let count = Clipboard.writeTransient("ours", name)
    let during = onMain { () -> (String?, Bool) in
      let pb = NSPasteboard(name: name)
      return (pb.string(forType: .string), pb.types?.contains(Clipboard.transientType) ?? false)
    }
    expect(during.0 == "ours" && during.1, "transient text written")
    expect(Clipboard.changeCount(name) == count, "change count reported")
    Clipboard.restore(saved, name)
    let after = onMain { () -> [String] in
      let pb = NSPasteboard(name: name)
      defer { pb.releaseGlobally() }
      let items = pb.pasteboardItems ?? []
      let marks = items.map { item in
        "\(item.string(forType: .string) ?? "-")|\(item.data(forType: binary) == Data([1, 2, 3]))"
          + "|\(item.types.contains(Clipboard.transientType))"
      }
      return marks
    }
    expect(after == ["first|true|false", "second|false|false"], "clipboard restored: \(after)")
  }

  /// Layout-resolved key codes for the combos input.key and the paste path use.
  private static func keys() {
    expect(KeyMap.shared.commandKeyCode(for: "v") != nil, "⌘V key code resolves")
    expect(KeyCombo.parse("escape")?.resolve()?.code == 53, "escape key code")
    expect(KeyCombo.parse("cmd+a")?.resolve()?.flags == .maskCommand, "cmd+a resolves with ⌘ only")
    expect(KeyCombo.parse("shift+tab")?.resolve()?.flags == .maskShift, "shift+tab flags")
  }

  private static func image(_ w: Int, _ h: Int, draw: (CGContext) -> Void) -> CGImage? {
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    draw(ctx)
    return ctx.makeImage()
  }

  private static func gradient(inverted: Bool, mark: Bool = false) -> CGImage? {
    image(360, 320) { ctx in
      for x in 0..<360 {
        let v = CGFloat(x) / 359
        ctx.setFillColor(gray: inverted ? 1 - v : v, alpha: 1)
        ctx.fill(CGRect(x: x, y: 0, width: 1, height: 320))
      }
      if mark {
        ctx.setFillColor(gray: 0, alpha: 1)
        ctx.fill(CGRect(x: 200, y: 100, width: 60, height: 60))
      }
    }
  }

  /// dHash: identical → 0, a local change → a few bits, an inverted image → every bit.
  private static func imaging() {
    guard let up = gradient(inverted: false), let down = gradient(inverted: true), let marked = gradient(inverted: false, mark: true)
    else { return expect(false, "test images") }
    let h = DHash.compute(up)
    expect(DHash.distance(h, DHash.compute(up)) == 0, "dHash stable")
    expect(DHash.distance(h, DHash.compute(down)) == 64, "dHash inverted differs fully")
    let local = DHash.distance(h, DHash.compute(marked))
    expect(local > 0 && local < 20, "dHash local change: \(local) bits")
  }

  /// The exact perceive OCR pipeline on a rendered two-column-free page: text, order, alignment.
  private static func ocr() {
    let size = CGSize(width: 640, height: 220)
    let scale: CGFloat = 2
    let font = CTFontCreateWithName("Helvetica" as CFString, 22, nil)
    func ctLine(_ s: String) -> CTLine {
      let attrs: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1),
      ]
      return CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
    }
    let rows: [(String, Bool, CGFloat)] = [
      ("Photosynthesis converts light into chemical energy", false, 24),
      ("Åsa läser kemi på kvällen", false, 84),
      ("Hello there", true, 150),
    ]
    let img = image(Int(size.width * scale), Int(size.height * scale)) { ctx in
      ctx.setFillColor(CGColor(gray: 1, alpha: 1))
      ctx.fill(CGRect(x: 0, y: 0, width: size.width * scale, height: size.height * scale))
      ctx.scaleBy(x: scale, y: scale)
      for (text, right, top) in rows {
        let line = ctLine(text)
        let width = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
        ctx.textPosition = CGPoint(x: right ? size.width - 24 - width : 24, y: size.height - top - 22)
        CTLineDraw(line, ctx)
      }
    }
    guard let img else { return expect(false, "rendered OCR image") }
    let started = monoMs()
    guard let raw = try? OCR.recognize(img) else { return expect(false, "OCR runs") }
    let lines = OCR.textLines(raw, frame: CGRect(origin: CGPoint(x: 100, y: 50), size: size))
    let texts = lines.map(\.text)
    expect(lines.count == 3, "OCR finds 3 lines: \(texts)")
    expect(texts.first?.contains("Photosynthesis") == true, "OCR reading order starts at the top")
    expect(texts.count == 3 && texts[1].contains("kemi") && texts[2].contains("Hello there"), "OCR text: \(texts)")
    expect(lines.last?.align == .right && lines.first?.align == .left, "OCR alignment")
    if let box = lines.first?.box { expect(box.x >= 100 && box.y >= 50 && box.y < 100, "OCR boxes in screen points") }
    if texts.count == 3, !texts[1].hasPrefix("Å") { print("note: OCR read \"\(texts[1])\" (Å not recovered)") }
    if Log.verbose { print("ocr selftest: \(Int(monoMs() - started)) ms") }
  }

  /// Read-only probes: never prompt, never change anything.
  private static func system() {
    _ = Permissions.status()  // must not prompt
    expect(SystemInfo.idleSeconds() >= 0, "idle seconds")
    _ = SystemInfo.isScreenLocked()
    let displays = SystemInfo.displays()
    if !displays.isEmpty {
      expect(displays.filter(\.isMain).count == 1, "exactly one main display")
      expect(displays.allSatisfy { $0.frame.width > 0 && $0.scale >= 1 && $0.visibleFrame.height <= $0.frame.height },
             "display frames")
    }
    let st = OnDevice.status()
    expect(st.available ? st.contextSize != nil : st.reason != nil, "on-device status has a reason when unavailable")
  }

  /// Region trimming: keep the main region, else drop chrome, else keep everything.
  private static func regionTrim() {
    func frag(_ text: String, _ region: PageRegion) -> AXFragment { AXFragment(text: text, frame: nil, region: region) }
    let article = String(repeating: "Tampere was founded in 1779 by King Gustav III. ", count: 3)
    let page = [frag("Home · History · Search", .chrome), frag("Tampere", .none), frag(article, .main),
                frag("Related: Helsinki · Turku", .chrome), frag("© 2026 · Privacy", .chrome)]
    let kept = AXTextReader.trimToContent(page)
    expect(kept.trim == .main && kept.frags.map(\.text) == [article], "region trim keeps main only")
    let noMain = [frag("Chats · New chat · Settings", .chrome), frag(article, .none)]
    let noChrome = AXTextReader.trimToContent(noMain)
    expect(noChrome.trim == .noChrome && noChrome.frags.map(\.text) == [article], "region trim drops chrome without main")
    let tinyMain = [frag("Skip", .main), frag(article, .none), frag("Menu", .chrome)]
    let fallback = AXTextReader.trimToContent(tinyMain)
    expect(fallback.trim == .noChrome && fallback.frags.map(\.text) == ["Skip", article], "tiny main: drop chrome only")
    let sidebarOnly = [frag("Chats · New chat", .chrome), frag("Hi", .none)]
    expect(AXTextReader.trimToContent(sidebarOnly).trim == .all, "too little left: keep everything")
    let plain = [frag(article, .none)]
    expect(AXTextReader.trimToContent(plain).trim == .all, "no landmarks: keep everything")
  }
}
