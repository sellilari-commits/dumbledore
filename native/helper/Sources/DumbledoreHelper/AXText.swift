// AXText.swift — window text through Accessibility: a bounded depth-first walk.
//
// Budget: 150 ms and a depth limit. Reads static text and multi-line text areas; never reads the
// focused field, single-line form fields (search boxes, logins) or secure fields — what the user
// is typing is only read on an explicit request (ax.readFocusedValue). Off-window subtrees are
// pruned, so the result is the visible text, like OCR would see it.
//
// Region trimming: web content (browsers, Electron apps) labels its landmarks (main, navigation,
// sidebar, header, footer). When the main region holds the page's real text, only that is kept;
// otherwise navigation, sidebars, banners and footers are dropped. Pages without landmarks keep
// everything. `chars` stays the untrimmed count, so the OCR fallback decision is unchanged.
import ApplicationServices
import CoreGraphics
import Foundation

/// Where a fragment sits on the page, from the nearest landmark around it.
enum PageRegion: Equatable {
  case none, main, chrome
}

/// What region trimming kept: only the main region, everything but chrome, or all text.
enum RegionTrim: String {
  case main, noChrome = "no-chrome", all
}

struct AXFragment {
  var text: String
  var frame: CGRect?
  var region: PageRegion = .none
}

struct AXTextResult {
  var lines: [TextLine] = []
  var chars = 0
  var trim: RegionTrim = .all
  var droppedChars = 0
  var visited = 0
  var timedOut = false
  /// AXURL of the first page element (AXWebArea) met during the walk: the browser tab's address.
  var url: String?
  /// The walk saw a page element, so a missing `url` is not worth a second search.
  var sawWebArea = false
}

enum AXTextReader {
  private static let skipRoles: Set<String> = [
    "AXMenuBar", "AXMenu", "AXMenuItem", "AXScrollBar", "AXImage", "AXToolbar", "AXSlider", "AXProgressIndicator",
  ]
  /// Navigation, sidebars, banners, footers and site search: never the page's content.
  private static let chromeSubroles: Set<String> = [
    "AXLandmarkNavigation", "AXLandmarkComplementary", "AXLandmarkBanner", "AXLandmarkContentInfo", "AXLandmarkSearch",
  ]
  /// The main region needs this much text, and this share of the text outside chrome, to stand alone.
  static let minContentChars = 80
  static let minMainShare = 0.2
  private static let attrs = [
    kAXRoleAttribute, kAXSubroleAttribute, kAXValueAttribute, kAXChildrenAttribute, kAXPositionAttribute, kAXSizeAttribute,
  ]

  static func read(window: AXUIElement, windowFrame: CGRect?, focused: AXUIElement?, maxChars: Int,
                   budgetMs: Double = 150, maxDepth: Int = 64) -> AXTextResult {
    let deadline = monoMs() + budgetMs
    var result = AXTextResult()
    var frags: [AXFragment] = []

    func add(_ text: String, _ frame: CGRect?, _ region: PageRegion) {
      var remaining = maxChars - result.chars
      for raw in text.split(whereSeparator: \.isNewline) {
        guard remaining > 0 else { return }
        var t = clean(String(raw))
        guard !t.isEmpty else { continue }
        if t.count > remaining { t = String(t.prefix(remaining)) }
        remaining -= t.count
        result.chars += t.count
        frags.append(AXFragment(text: t, frame: frame, region: region))
      }
    }

    func visit(_ el: AXUIElement, depth: Int, region parent: PageRegion) -> Bool {
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
      let region: PageRegion = subrole == "AXLandmarkMain" ? .main
        : subrole.map(chromeSubroles.contains) == true ? .chrome : parent
      if role == "AXWebArea", !result.sawWebArea {
        result.sawWebArea = true
        result.url = AX.url(AX.attr(el, "AXURL"))
      }
      switch role {
      case "AXStaticText":
        if let s = AX.str(v[kAXValueAttribute]) { add(s, frame, region) }
        return true
      case "AXTextArea":
        let isFocused = focused.map { CFEqual($0, el) } ?? false
        if !isFocused, !FocusReader.isSecure(role: role, subrole: subrole), let s = AX.str(v[kAXValueAttribute]) {
          add(s, frame, region)
        }
        return true  // children repeat the value (or the user's draft): never descend
      case "AXTextField", "AXSearchField", "AXComboBox", "AXSecureTextField":
        return true
      default:
        break
      }
      guard depth < maxDepth else { return true }
      for child in AX.uiElements(v[kAXChildrenAttribute]) {
        if !visit(child, depth: depth + 1, region: region) { return false }
      }
      return true
    }

    _ = visit(window, depth: 0, region: .none)
    let trimmed = trimToContent(frags)
    result.trim = trimmed.trim
    result.droppedChars = frags.reduce(0) { $0 + $1.text.count } - trimmed.frags.reduce(0) { $0 + $1.text.count }
    result.lines = merge(trimmed.frags)
    return result
  }

  /// Keeps the page's content: the main region when it holds the real text, else everything but
  /// chrome (navigation, sidebars, banners, footers) when enough is left, else all fragments.
  static func trimToContent(_ frags: [AXFragment]) -> (frags: [AXFragment], trim: RegionTrim) {
    func chars(_ region: PageRegion) -> Int {
      frags.reduce(0) { $1.region == region ? $0 + $1.text.count : $0 }
    }
    let main = chars(.main)
    let outside = chars(.none)
    if main >= minContentChars, Double(main) >= minMainShare * Double(main + outside) {
      return (frags.filter { $0.region == .main }, .main)
    }
    if chars(.chrome) > 0, main + outside >= minContentChars {
      return (frags.filter { $0.region != .chrome }, .noChrome)
    }
    return (frags, .all)
  }

  /// Joins inline fragments (links, bold runs) that sit on the same visual line.
  static func merge(_ frags: [AXFragment]) -> [TextLine] {
    var out: [(text: String, frame: CGRect?)] = []
    for f in frags {
      if let last = out.last, let lf = last.frame, let ff = f.frame, ff.height > 0,
         ff.midY >= lf.minY, ff.midY <= lf.maxY, ff.minX >= lf.minX - 1, ff.height <= lf.height * 1.6 {
        let needsSpace = !(last.text.last?.isWhitespace ?? true) && !(f.text.first?.isWhitespace ?? true)
          && ff.minX > lf.maxX + 1
        out[out.count - 1] = (last.text + (needsSpace ? " " : "") + f.text, lf.union(ff))
      } else {
        out.append((f.text, f.frame))
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

  static func clean(_ s: String) -> String {
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
