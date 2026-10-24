// AXText.swift — window text through Accessibility: a bounded depth-first walk.
//
// Budget: 150 ms and a depth limit. Reads static text and multi-line text areas; never reads the
// focused field, single-line form fields (search boxes, logins) or secure fields — what the user
// is typing is only read on an explicit request (ax.readFocusedValue). Off-window subtrees are
// pruned, so the result is the visible text, like OCR would see it.
import ApplicationServices
import CoreGraphics
import Foundation

struct AXTextResult {
  var lines: [TextLine] = []
  var chars = 0
  var visited = 0
  var timedOut = false
}

enum AXTextReader {
  private static let skipRoles: Set<String> = [
    "AXMenuBar", "AXMenu", "AXMenuItem", "AXScrollBar", "AXImage", "AXToolbar", "AXSlider", "AXProgressIndicator",
  ]
  private static let attrs = [
    kAXRoleAttribute, kAXSubroleAttribute, kAXValueAttribute, kAXChildrenAttribute, kAXPositionAttribute, kAXSizeAttribute,
  ]

  static func read(window: AXUIElement, windowFrame: CGRect?, focused: AXUIElement?, maxChars: Int,
                   budgetMs: Double = 150, maxDepth: Int = 64) -> AXTextResult {
    let deadline = monoMs() + budgetMs
    var result = AXTextResult()
    var frags: [(text: String, frame: CGRect?)] = []

    func add(_ text: String, _ frame: CGRect?) {
      var remaining = maxChars - result.chars
      for raw in text.split(whereSeparator: \.isNewline) {
        guard remaining > 0 else { return }
        var t = clean(String(raw))
        guard !t.isEmpty else { continue }
        if t.count > remaining { t = String(t.prefix(remaining)) }
        remaining -= t.count
        result.chars += t.count
        frags.append((t, frame))
      }
    }

    func visit(_ el: AXUIElement, depth: Int) -> Bool {
      if result.chars >= maxChars { return false }
      if monoMs() > deadline {
        result.timedOut = true
        return false
      }
      result.visited += 1
      let v = AX.multiple(el, attrs)
      let role = AX.str(v[kAXRoleAttribute]) ?? ""
      if skipRoles.contains(role) { return true }
      let frame = AX.frame(position: v[kAXPositionAttribute], size: v[kAXSizeAttribute])
      if let f = frame, let wf = windowFrame, f.width > 0, f.height > 0, !f.intersects(wf) { return true }
      let subrole = AX.str(v[kAXSubroleAttribute])
      switch role {
      case "AXStaticText":
        if let s = AX.str(v[kAXValueAttribute]) { add(s, frame) }
        return true
      case "AXTextArea":
        let isFocused = focused.map { CFEqual($0, el) } ?? false
        if !isFocused, !FocusReader.isSecure(role: role, subrole: subrole), let s = AX.str(v[kAXValueAttribute]) {
          add(s, frame)
        }
        return true  // children repeat the value (or the user's draft): never descend
      case "AXTextField", "AXSearchField", "AXComboBox", "AXSecureTextField":
        return true
      default:
        break
      }
      guard depth < maxDepth else { return true }
      for child in AX.uiElements(v[kAXChildrenAttribute]) {
        if !visit(child, depth: depth + 1) { return false }
      }
      return true
    }

    _ = visit(window, depth: 0)
    result.lines = merge(frags)
    return result
  }

  /// Joins inline fragments (links, bold runs) that sit on the same visual line.
  private static func merge(_ frags: [(text: String, frame: CGRect?)]) -> [TextLine] {
    var out: [(text: String, frame: CGRect?)] = []
    for f in frags {
      if let last = out.last, let lf = last.frame, let ff = f.frame, ff.height > 0,
         ff.midY >= lf.minY, ff.midY <= lf.maxY, ff.minX >= lf.minX - 1, ff.height <= lf.height * 1.6 {
        let needsSpace = !(last.text.last?.isWhitespace ?? true) && !(f.text.first?.isWhitespace ?? true)
          && ff.minX > lf.maxX + 1
        out[out.count - 1] = (last.text + (needsSpace ? " " : "") + f.text, lf.union(ff))
      } else {
        out.append(f)
      }
    }
    let boxed = out.enumerated().compactMap { i, f in f.frame.map { (i, $0) } }
    let layout = Layout.analyze(boxed.map(\.1))
    var align = [LineAlign?](repeating: nil, count: out.count)
    for (k, pair) in boxed.enumerated() { align[pair.0] = layout.align[k] }
    return out.enumerated().map { i, f in
      TextLine(text: f.text, conf: 1, box: f.frame.map(Rect.init), align: align[i])
    }
  }

  private static func clean(_ s: String) -> String {
    let replaced = s.replacingOccurrences(of: "\u{00A0}", with: " ").replacingOccurrences(of: "\u{200B}", with: "")
    return replaced.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
  }

  /// Finds the page element (AXWebArea) of a browser/Electron window: bounded breadth-first search.
  static func webArea(in window: AXUIElement, budgetMs: Double = 60, maxDepth: Int = 16) -> AXUIElement? {
    let containers: Set<String> = ["AXGroup", "AXSplitGroup", "AXTabGroup", "AXScrollArea", "AXLayoutArea",
                                   "AXUnknown", "AXWindow", "AXSheet", "AXBrowser"]
    let deadline = monoMs() + budgetMs
    var queue: [(AXUIElement, Int)] = [(window, 0)]
    var head = 0
    while head < queue.count, head < 600, monoMs() < deadline {
      let (el, depth) = queue[head]
      head += 1
      let v = AX.multiple(el, [kAXRoleAttribute, kAXChildrenAttribute])
      let role = AX.str(v[kAXRoleAttribute]) ?? ""
      if role == "AXWebArea" { return el }
      guard depth < maxDepth, containers.contains(role) else { continue }
      for c in AX.uiElements(v[kAXChildrenAttribute]) { queue.append((c, depth + 1)) }
    }
    return nil
  }

  static func url(of window: AXUIElement) -> String? {
    guard let web = webArea(in: window) else { return nil }
    return AX.url(AX.attr(web, "AXURL"))
  }
}
