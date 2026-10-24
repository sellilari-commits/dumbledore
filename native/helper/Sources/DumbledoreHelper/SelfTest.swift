// SelfTest.swift — `selftest` command: pure-logic checks here, OS-level ones in SelfTestIO.swift.
// Needs no screen and no permissions; never types, clicks or touches the user's clipboard.
// Run by tests/integration/helper-selftest.test.ts; prints one line per failure, exit 1 if any.
import CoreGraphics
import Foundation

enum SelfTest {
  nonisolated(unsafe) private static var failures: [String] = []
  nonisolated(unsafe) private static var checks = 0

  static func expect(_ ok: Bool, _ what: String) {
    checks += 1
    if !ok { failures.append(what) }
  }

  static func run() -> Int32 {
    gestures()
    layout()
    combos()
    text()
    json()
    schema()
    SelfTestIO.runAll()
    for f in failures { print("FAIL \(f)") }
    print("selftest: \(checks - failures.count)/\(checks) passed")
    return failures.isEmpty ? 0 : 1
  }

  /// Feeds a press timeline [(t, down)] polled every 10 ms; returns emitted gestures.
  private static func simulate(_ presses: [(from: Double, to: Double)], until end: Double,
                               interruptAt: Double? = nil, othersFrom: Double? = nil) -> [Gesture] {
    var c = GestureClassifier(config: .defaults)
    var out: [Gesture] = []
    var t = 0.0
    while t <= end {
      let down = presses.contains { t >= $0.from && t < $0.to }
      let interrupted = interruptAt.map { t >= $0 } ?? false
      let others = othersFrom.map { t >= $0 } ?? false
      if let g = c.step(now: t, keyDown: down, othersDown: others, interrupted: interrupted) { out.append(g) }
      t += 10
    }
    return out
  }

  private static func gestures() {
    expect(simulate([(100, 200)], until: 1000) == [.tap], "tap")
    expect(simulate([(100, 200), (350, 420)], until: 1000) == [.tap, .doubleTap], "double tap")
    expect(simulate([(100, 200), (700, 780)], until: 1200) == [.tap, .tap], "two separate taps")
    expect(simulate([(100, 800)], until: 1000) == [.holdStart, .holdEnd], "hold")
    expect(simulate([(100, 520)], until: 1000) == [], "between tap and hold: nothing")
    expect(simulate([(100, 200)], until: 1000, interruptAt: 150) == [], "key pressed while held cancels the tap")
    expect(simulate([(100, 200)], until: 1000, othersFrom: 0) == [], "other modifier held cancels")
    expect(simulate([(100, 900)], until: 1000, interruptAt: 700) == [.holdStart, .holdEnd], "keys during a hold keep it")
    expect(simulate([(100, 200), (350, 420), (500, 560)], until: 1200) == [.tap, .doubleTap, .tap], "third tap is a tap")
    expect(simulate([(100, 200), (520, 600)], until: 1200) == [.tap, .tap], "second press after doubleTapMs is a tap")
    expect(simulate([(100, 200), (350, 420)], until: 1000, interruptAt: 360) == [.tap], "interrupted second tap")
    expect(simulate([(100, 200), (350, 900)], until: 1200) == [.tap, .holdStart, .holdEnd], "tap then hold")
  }

  private static func order(_ boxes: [CGRect]) -> [Int] { Layout.analyze(boxes).order }

  private static func layout() {
    // Two columns with a full-width header: header, then left column, then right column.
    var boxes = [CGRect(x: 0, y: 0, width: 600, height: 20)]
    for i in 0..<5 { boxes.append(CGRect(x: 0, y: 40 + Double(i) * 22, width: 280, height: 16)) }
    for i in 0..<5 { boxes.append(CGRect(x: 320, y: 40 + Double(i) * 22, width: 280, height: 16)) }
    expect(order(boxes) == Array(0..<11), "two columns read column by column")
    // Chat bubbles alternate left / right: chronological order, alignment left/right.
    let chat = [CGRect(x: 400, y: 0, width: 180, height: 16), CGRect(x: 20, y: 40, width: 300, height: 16),
                CGRect(x: 20, y: 60, width: 520, height: 16), CGRect(x: 450, y: 100, width: 130, height: 16),
                CGRect(x: 20, y: 140, width: 100, height: 16)]
    let r = Layout.analyze(chat)
    expect(r.order == [0, 1, 2, 3, 4], "chat order")
    expect(r.align == [.right, .left, .left, .right, .left], "chat alignment \(r.align)")
    // Sidebar | content: sidebar first.
    var side: [CGRect] = []
    for i in 0..<6 { side.append(CGRect(x: 10, y: Double(i) * 30, width: 150, height: 16)) }
    for i in 0..<4 { side.append(CGRect(x: 260, y: 5 + Double(i) * 40, width: 400, height: 16)) }
    expect(order(side) == Array(0..<10), "sidebar before content")
    // Centered title over left-aligned bullets.
    let slide = [CGRect(x: 200, y: 0, width: 400, height: 40), CGRect(x: 50, y: 100, width: 600, height: 20),
                 CGRect(x: 50, y: 140, width: 500, height: 20)]
    expect(Layout.analyze(slide).align[0] == .center, "centered title")
    chatWithSidebar()
    expect(Layout.analyze([CGRect(x: 0, y: 0, width: 10, height: 10)]).order == [0], "single box")
    expect(Layout.analyze([]).order.isEmpty, "no boxes")
    // Real-screen shapes that overflowed the perceive thread's stack: a header group that is
    // the whole input (near-zero-height frames), and a very long row of separate items.
    let flat = [CGRect(x: 0, y: 0, width: 300, height: 10), CGRect(x: 0, y: 12, width: 300, height: 10.9),
                CGRect(x: 400, y: 22.5, width: 50, height: 0.5), CGRect(x: 400, y: 22.5, width: 50, height: 0.5)]
    expect(Layout.analyze(flat).order.count == flat.count, "whole-group header terminates")
    let toolbar = (0..<600).map { CGRect(x: CGFloat($0 * $0) / 10, y: 0, width: 4, height: 10) }
    expect(Layout.analyze(toolbar).order.count == toolbar.count, "long row stays under the depth cap")
  }

  /// ChatGPT-like window: sidebar, model name, bubbles, composer and a centred footer.
  private static func chatWithSidebar() {
    var b: [CGRect] = []
    for i in 0..<8 { b.append(CGRect(x: 16, y: 22 + Double(i) * 30, width: 120 + Double(i % 3) * 30, height: 12)) }  // 0–7
    b.append(CGRect(x: 262, y: 21, width: 85, height: 14))     // 8  model name, left of the conversation
    b.append(CGRect(x: 630, y: 72, width: 372, height: 17))    // 9  user, right-aligned text
    b.append(CGRect(x: 873, y: 97, width: 129, height: 16))    // 10 user
    for i in 0..<3 { b.append(CGRect(x: 339, y: 147 + Double(i) * 24, width: 650 - Double(i) * 200, height: 19)) }  // 11–13
    b.append(CGRect(x: 600, y: 300, width: 402, height: 17))   // 14 user bubble, text left-aligned inside
    b.append(CGRect(x: 600, y: 324, width: 90, height: 17))    // 15 user, short last line
    b.append(CGRect(x: 339, y: 380, width: 640, height: 19))   // 16 assistant, nearly full width
    b.append(CGRect(x: 339, y: 404, width: 681, height: 19))   // 17 assistant, the widest line
    b.append(CGRect(x: 353, y: 685, width: 94, height: 18))    // 18 composer placeholder
    b.append(CGRect(x: 532, y: 733, width: 294, height: 13))   // 19 footer, centred on the conversation
    let r = Layout.analyze(b)
    expect(Array(r.order.prefix(8)) == Array(0..<8), "sidebar read first: \(r.order)")
    let roles: [(Int, LineAlign)] = [(9, .right), (10, .right), (11, .left), (12, .left), (13, .left), (14, .right),
                                     (15, .right), (16, .left), (17, .left), (19, .center)]
    let wrong = roles.filter { r.align[$0.0] != $0.1 }.map { "\($0.0)=\(r.align[$0.0])" }
    expect(wrong.isEmpty, "chat roles by alignment, sidebar excluded: \(wrong)")
    // A window title above the sidebar stays centred on the whole window.
    var settings = [CGRect(x: 313, y: 11, width: 134, height: 16)]
    for i in 0..<7 { settings.append(CGRect(x: 18, y: 56 + Double(i) * 28, width: 60 + Double(i % 4) * 15, height: 16)) }
    for i in 0..<5 { settings.append(CGRect(x: 222, y: 104 + Double(i) * 34, width: 110, height: 15)) }
    for i in 0..<5 { settings.append(CGRect(x: 680, y: 105 + Double(i) * 34, width: 48, height: 14)) }
    settings.append(CGRect(x: 214, y: 296, width: 513, height: 14))
    let t = Layout.analyze(settings)
    expect(t.order.first == 0 && t.align[0] == .center, "window title first and centred")
  }

  private static func combos() {
    expect(KeyCombo.parse("cmd+a") == KeyCombo(flags: .maskCommand, key: "a"), "cmd+a")
    expect(KeyCombo.parse("Escape") == KeyCombo(flags: [], key: "escape"), "escape")
    expect(KeyCombo.parse("ctrl+alt+cmd+d") == KeyCombo(flags: [.maskControl, .maskAlternate, .maskCommand], key: "d"),
           "ctrl+alt+cmd+d")
    expect(KeyCombo.parse("shift+enter") == KeyCombo(flags: .maskShift, key: "enter"), "shift+enter")
    expect(KeyCombo.parse("cmd++") == KeyCombo(flags: .maskCommand, key: "+"), "cmd++")
    expect(KeyCombo.parse("hyper+a") == nil, "unknown modifier")
    expect(KeyCombo.parse("cmd+notakey") == nil, "unknown key")
    expect(KeyCombo.parse("") == nil, "empty combo")
  }

  private static func text() {
    expect(OCR.fix("Ăsa och Ăland") == "Åsa och Åland", "Å fix")
    expect(OCR.fix("plain") == "plain", "no-op fix")
    expect(fnv1a64("") == "cbf29ce484222325", "fnv empty")
    expect(fnv1a64("a") != fnv1a64("b"), "fnv differs")
    expect(ChatInputFinder.normalize("Ask anything…") == "ask anything", "placeholder normalize")
    expect(ChatInputFinder.fuzzyEqual("ask anythinq", "ask anything"), "fuzzy placeholder")
    expect(!ChatInputFinder.fuzzyEqual("send a message", "ask anything"), "fuzzy rejects")
    expect(InputService.verify(mode: .insert, text: "hi", after: "say hi there"), "verify insert")
    expect(InputService.verify(mode: .replaceAll, text: "x\r\ny", after: "x\ny\n"), "verify replaceAll")
    expect(!InputService.verify(mode: .replaceAll, text: "x", after: "xy"), "verify replaceAll differs")
    expect(DHash.distance(0b1011, 0b0001) == 2, "hamming")
  }

  private static func schema() {
    guard #available(macOS 26.0, *) else { return }
    let text = #"""
      {"type":"object","properties":{"answer":{"type":"string","description":"short"},
      "score":{"type":"integer","minimum":0,"maximum":10},
      "tags":{"type":"array","items":{"type":"string","enum":["a","b"]},"maxItems":3},
      "note":{"type":["string","null"]},
      "kind":{"anyOf":[{"$ref":"#/$defs/Kind"},{"type":"null"}]}},
      "required":["answer","score","tags","note","kind"],
      "$defs":{"Kind":{"type":"object","properties":{"x":{"type":"number"}},"required":["x"]}}}
      """#
    guard let s = try? OJSON.parse(Data(text.utf8)) else { return expect(false, "schema parses") }
    do {
      _ = try JSONSchemaConverter.generationSchema(s)
      expect(true, "schema converts")
    } catch {
      expect(false, "schema converts: \(error)")
    }
    let defs = s["$defs"]?.pairs ?? []
    let filled = JSONSchemaConverter.fillNulls(.object(["answer": .string("x")]), schema: s, defs: defs)
    expect(filled["note"] == .null && filled["kind"] == .null, "fillNulls adds missing nullable keys")
    let nested = JSONSchemaConverter.fillNulls(.object(["kind": .object([:])]), schema: s, defs: defs)
    expect(nested["kind"]?["x"] == .null, "fillNulls follows $ref")
    let bad = try? OJSON.parse(Data(#"{"type":"object","properties":{"f":{"type":"function"}}}"#.utf8))
    expect(bad.map { (try? JSONSchemaConverter.generationSchema($0)) == nil } ?? false, "unsupported type rejected")
  }

  private static func json() {
    let schema = try? OJSON.parse(Data(#"{"type":"object","properties":{"z":{"type":"string"},"a":{"type":"number"}}}"#.utf8))
    expect(schema?["properties"]?.pairs?.map(\.0) == ["z", "a"], "ordered keys kept")
    expect((try? OJSON.parse(Data(#"{"s":"å😀\n"}"#.utf8)))?["s"]?.string == "å😀\n", "unicode escapes")
    expect((try? OJSON.parse(Data("{\"a\":}".utf8))) == nil, "rejects bad json")
    let encoded = try? RPC.encoder().encode(TextResult(text: nil))
    expect(encoded.map { String(decoding: $0, as: UTF8.self) } == #"{"text":null}"#, "nullable keys encode as null")
    let err = String(decoding: RPC.errorLine(id: .int(3), RPCError.notFound("x")), as: UTF8.self)
    expect(err.contains(#""code":-32002"#) && err.contains(#""id":3"#), "error line")
    let parsed = try? JSONValue.parse(#"{"a":[1,true,null,"x"]}"#)
    expect(parsed == .object(["a": .array([.number(1), .bool(true), .null, .string("x")])]), "JSONValue parse")
  }
}
