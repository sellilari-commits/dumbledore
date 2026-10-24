// SelfTest.swift — `selftest` command: checks of the pure logic (no screen, no permissions).
// Run by tests/integration/helper-selftest.test.ts; prints one line per failure, exit 1 if any.
import CoreGraphics
import Foundation

enum SelfTest {
  nonisolated(unsafe) private static var failures: [String] = []
  nonisolated(unsafe) private static var checks = 0

  private static func expect(_ ok: Bool, _ what: String) {
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
    expect(Layout.analyze([CGRect(x: 0, y: 0, width: 10, height: 10)]).order == [0], "single box")
    expect(Layout.analyze([]).order.isEmpty, "no boxes")
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
