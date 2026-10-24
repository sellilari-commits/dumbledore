// RenderFixtures.swift — draws synthetic window screenshots with exact ground truth for the OCR
// integration test (tests/integration/helper-ocr.test.ts). Build + run: native/helper/build.sh fixtures
//
// Each fixture is <name>.png (rendered at 2× like a Retina capture) and <name>.json:
//   { width, height, scale, lines: [{ text, x, y, w, h, align, role }] }  — points, reading order.
// `align` is set where the expected alignment is unambiguous; `role` marks chat speakers.
import AppKit

struct GTLine: Encodable {
  let text: String
  let x: Double
  let y: Double
  let w: Double
  let h: Double
  let align: String?
  let role: String?
}

struct GTDoc: Encodable {
  let name: String
  let width: Double
  let height: Double
  let scale: Double
  let lines: [GTLine]
}

final class Canvas {
  let w: CGFloat, h: CGFloat, scale: CGFloat
  let ctx: CGContext
  private(set) var lines: [GTLine] = []

  init(w: CGFloat, h: CGFloat, scale: CGFloat = 2, background: NSColor) {
    self.w = w; self.h = h; self.scale = scale
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    ctx = CGContext(data: nil, width: Int(w * scale), height: Int(h * scale), bitsPerComponent: 8, bytesPerRow: 0,
                    space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.translateBy(x: 0, y: h * scale)
    ctx.scaleBy(x: scale, y: -scale)
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
    fill(CGRect(x: 0, y: 0, width: w, height: h), background)
  }

  func fill(_ r: CGRect, _ c: NSColor, radius: CGFloat = 0) {
    c.setFill()
    if radius > 0 { NSBezierPath(roundedRect: r, xRadius: radius, yRadius: radius).fill() } else { r.fill() }
  }

  func size(_ s: String, _ font: NSFont) -> CGSize { NSAttributedString(string: s, attributes: [.font: font]).size() }

  /// Draws one line. `x` is the left edge, or the right edge for align "right", or the centre for "center".
  @discardableResult
  func text(_ s: String, x: CGFloat, y: CGFloat, font: NSFont, color: NSColor, align: String = "left",
            expect: String? = nil, role: String? = nil) -> CGRect {
    let sz = size(s, font)
    let left = align == "right" ? x - sz.width : align == "center" ? x - sz.width / 2 : x
    NSAttributedString(string: s, attributes: [.font: font, .foregroundColor: color]).draw(at: CGPoint(x: left, y: y))
    let r = CGRect(x: left, y: y, width: sz.width, height: sz.height)
    lines.append(GTLine(text: s, x: Double(r.minX), y: Double(r.minY), w: Double(r.width), h: Double(r.height),
                        align: expect, role: role))
    return r
  }

  func wrap(_ s: String, _ font: NSFont, width: CGFloat) -> [String] {
    var out: [String] = []
    var cur = ""
    for word in s.split(separator: " ").map(String.init) {
      let cand = cur.isEmpty ? word : cur + " " + word
      if cur.isEmpty || size(cand, font).width <= width { cur = cand } else { out.append(cur); cur = word }
    }
    if !cur.isEmpty { out.append(cur) }
    return out
  }

  func save(_ name: String, to dir: String) {
    NSGraphicsContext.current = nil
    let img = ctx.makeImage()!
    let url = URL(fileURLWithPath: "\(dir)/\(name).png") as CFURL
    let dest = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, img, nil)
    precondition(CGImageDestinationFinalize(dest))
    let doc = GTDoc(name: name, width: Double(w), height: Double(h), scale: Double(scale), lines: lines)
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    try! enc.encode(doc).write(to: URL(fileURLWithPath: "\(dir)/\(name).json"))
    print("wrote \(name) (\(lines.count) lines)")
  }
}

let ui = NSFont.systemFont(ofSize: 13)
let body = NSFont.systemFont(ofSize: 16)
let small = NSFont.systemFont(ofSize: 12)
let semibold = NSFont.systemFont(ofSize: 14, weight: .semibold)
let ink = NSColor(srgbRed: 0.08, green: 0.08, blue: 0.09, alpha: 1)
let grey = NSColor(srgbRed: 0.45, green: 0.45, blue: 0.48, alpha: 1)

let userTurns = [
  "Can you explain how photosynthesis turns light into chemical energy?",
  "So the Calvin cycle does not need light directly? Quiz me on it.",
]
let assistantTurns = [
  ["Photosynthesis happens in two stages. In the light-dependent reactions, chlorophyll in the thylakoid membranes",
   "absorbs light and splits water, releasing oxygen and storing energy in ATP and NADPH.",
   "In the Calvin cycle, the enzyme RuBisCO fixes carbon dioxide, and the cell uses ATP and NADPH to build",
   "glucose. Plants in Sweden and Finland, from Åland to Lappland, slow this down in the cold winter months."],
  ["Right: the Calvin cycle runs on the ATP and NADPH made in the light reactions, so it only needs light indirectly.",
   "Question 1: Which enzyme fixes carbon dioxide? Question 2: Where do the light reactions take place?"],
]

func chat(name: String, dark: Bool, placeholder: String, out: String) {
  let bg = dark ? NSColor(srgbRed: 0.13, green: 0.13, blue: 0.14, alpha: 1) : .white
  let fg = dark ? NSColor(srgbRed: 0.93, green: 0.93, blue: 0.94, alpha: 1) : ink
  let dim = dark ? NSColor(srgbRed: 0.62, green: 0.62, blue: 0.65, alpha: 1) : grey
  let c = Canvas(w: 1100, h: 760, background: bg)
  c.fill(CGRect(x: 0, y: 0, width: 240, height: 760), dark ? NSColor(white: 0.09, alpha: 1) : NSColor(white: 0.975, alpha: 1))
  var y: CGFloat = 20
  for (i, item) in ["New chat", "Today", "Photosynthesis basics", "SN1 vs SN2 reactions", "Previous 7 days",
                    "Eigenvalues and eigenvectors", "French Revolution essay plan", "Mitosis vs meiosis"].enumerated() {
    let header = i == 1 || i == 4
    c.text(item, x: 16, y: y, font: header ? small : ui, color: header ? dim : fg)
    y += header ? 26 : 32
  }
  c.text("ChatGPT 4o", x: 264, y: 18, font: semibold, color: fg)
  let colL: CGFloat = 340, colR: CGFloat = 1020
  y = 70
  for turn in 0..<2 {
    let wrapped = c.wrap(userTurns[turn], body, width: 380)
    let bubbleW = wrapped.map { c.size($0, body).width }.max()! + 36
    c.fill(CGRect(x: colR - bubbleW, y: y - 8, width: bubbleW, height: CGFloat(wrapped.count) * 24 + 16),
           dark ? NSColor(white: 0.22, alpha: 1) : NSColor(white: 0.955, alpha: 1), radius: 18)
    for line in wrapped {
      c.text(line, x: colR - 18, y: y, font: body, color: fg, align: "right", expect: "right", role: "user")
      y += 24
    }
    y += 26
    for (k, line) in assistantTurns[turn].enumerated() {
      let parts = c.wrap(line, body, width: colR - colL)
      for p in parts {
        c.text(p, x: colL, y: y, font: body, color: fg, expect: "left", role: "assistant")
        y += 24
      }
      if k % 2 == 1 { y += 12 }
    }
    y += 30
  }
  c.fill(CGRect(x: colL - 10, y: 668, width: colR - colL + 20, height: 52), dark ? NSColor(white: 0.19, alpha: 1) : .white,
         radius: 26)
  c.text(placeholder, x: colL + 14, y: 684, font: body, color: dim)
  c.text("ChatGPT can make mistakes. Check important info.", x: (colL + colR) / 2, y: 732, font: small, color: dim,
         align: "center", expect: "center")
  c.save(name, to: out)
}

func document(out: String) {
  let c = Canvas(w: 900, h: 720, background: .white)
  c.text("Chapter 4: Thermodynamics of Living Systems", x: 60, y: 40, font: NSFont.boldSystemFont(ofSize: 26), color: ink)
  c.text("Lecture notes · Biology 101 · Week 6", x: 60, y: 82, font: ui, color: grey)
  var y: CGFloat = 120
  let paragraphs = [
    "Living cells obey the same laws of energy as engines. The first law says energy is conserved; the second law says every energy transfer increases the entropy of the universe. Cells stay ordered by releasing heat.",
    "Free energy tells us which reactions can run on their own. A reaction with a negative change in Gibbs free energy (written as delta G < 0) is spontaneous, while ATP hydrolysis drives reactions that are not.",
    "Svenska: Cellerna använder energi från maten. Kväve och syre är viktiga ämnen, och växterna på Åland växer långsamt på vintern.",
    "Suomeksi: Solut käyttävät energiaa ruoasta. Kasvit Ahvenanmaalla kasvavat hitaasti talvella, ja yöt ovat pitkiä.",
    "Key terms: enthalpy (H), entropy (S), Gibbs free energy (G), exergonic, endergonic, coupled reactions, activation energy.",
  ]
  for p in paragraphs {
    for line in c.wrap(p, body, width: 780) {
      c.text(line, x: 60, y: y, font: body, color: ink, expect: "left")
      y += 25
    }
    y += 16
  }
  c.text("Figure 4.2 — Energy diagram of an exergonic reaction", x: 450, y: y + 10, font: small, color: grey,
         align: "center", expect: "center")
  c.save("document", to: out)
}

func slide(out: String) {
  let bg = NSColor(srgbRed: 0.10, green: 0.18, blue: 0.32, alpha: 1)
  let c = Canvas(w: 1024, h: 640, background: bg)
  c.text("Mitosis in Four Phases", x: 512, y: 70, font: NSFont.boldSystemFont(ofSize: 44), color: .white, align: "center",
         expect: "center")
  var y: CGFloat = 190
  for b in ["• Prophase: chromosomes condense and the spindle forms",
            "• Metaphase: chromosomes line up at the cell's equator",
            "• Anaphase: sister chromatids are pulled to opposite poles",
            "• Telophase: two nuclei form and the cell divides"] {
    c.text(b, x: 120, y: y, font: NSFont.systemFont(ofSize: 26), color: .white, expect: "left")
    y += 62
  }
  c.text("Biology 101 · Lecture 7", x: 512, y: 590, font: NSFont.systemFont(ofSize: 16), color: NSColor(white: 0.8, alpha: 1),
         align: "center", expect: "center")
  c.save("slide", to: out)
}

func twoColumn(out: String) {
  let c = Canvas(w: 1000, h: 700, background: .white)
  c.text("Spaced Repetition and Long-Term Memory", x: 500, y: 36, font: NSFont.boldSystemFont(ofSize: 24), color: ink,
         align: "center")
  c.text("A. Student, B. Teacher · Journal of Study Skills, 2026", x: 500, y: 74, font: ui, color: grey, align: "center")
  let left = "Abstract. Reviewing material at growing intervals improves recall compared with massed practice. We tested 120 students over eight weeks. Those who used a spaced schedule remembered 31 percent more on the final test, and the benefit was largest for difficult concepts."
  let right = "Methods. Students were split into two groups. The spaced group reviewed after one, three and seven days; the massed group reviewed everything the evening before. Both groups studied for the same total time and took the same quizzes."
  var y: CGFloat = 120
  for line in c.wrap(left, body, width: 420) {
    c.text(line, x: 50, y: y, font: body, color: ink)
    y += 25
  }
  y = 120
  for line in c.wrap(right, body, width: 420) {
    c.text(line, x: 530, y: y, font: body, color: ink)
    y += 25
  }
  c.save("two-column", to: out)
}

var outDir = "tests/fixtures/screens"
if let i = CommandLine.arguments.firstIndex(of: "--out"), i + 1 < CommandLine.arguments.count {
  outDir = CommandLine.arguments[i + 1]
}
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
document(out: outDir)
chat(name: "chat-light", dark: false, placeholder: "Ask anything", out: outDir)
chat(name: "chat-dark", dark: true, placeholder: "Reply to Claude…", out: outDir)
slide(out: outDir)
twoColumn(out: outDir)
