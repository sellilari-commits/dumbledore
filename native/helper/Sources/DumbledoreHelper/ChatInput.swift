// ChatInput.swift — `ax.findChatInput`: locate the message box of an AI chat window.
//
//   1. the app's focused element, when it is an editable (non-secure, non-search) text field —
//      inside the page for browsers/Electron, so the address bar never counts;
//   2. an AX search for the bottom-most large editable text area of the focused window;
//   3. OCR of the window for one of the given placeholders ("Ask anything", …).
import ApplicationServices
import CoreGraphics
import Foundation

enum ChatInputFinder {
  static func find(_ p: FindChatInputParams) -> FindChatInputResult {
    guard let pid = p.pid.map({ pid_t($0) }) ?? Apps.frontmostPid, let app = Apps.info(pid: pid),
          Apps.isReadable(app.bundleId) else { return .none }
    var webScope: AXUIElement?
    if Permissions.accessibility {
      let window = Windows.focusedAXWindow(pid: pid)
      webScope = window.flatMap { AXTextReader.webArea(in: $0) }
      if let (el, _) = FocusReader.focused(pid: pid), let frame = candidateFrame(el),
         webScope == nil || AX.ancestor(el, where: { _, role in role == "AXWebArea" }) != nil {
        return FindChatInputResult(found: true, frame: Rect(frame), ref: RefRegistry.shared.register(el, pid: pid),
                                   method: .focused)
      }
      if let root = webScope ?? window, let (el, frame) = searchEditable(root) {
        return FindChatInputResult(found: true, frame: Rect(frame), ref: RefRegistry.shared.register(el, pid: pid),
                                   method: .ax_search)
      }
    }
    if !p.placeholders.isEmpty, let frame = ocrPlaceholder(pid: pid, placeholders: p.placeholders) {
      return FindChatInputResult(found: true, frame: Rect(frame), ref: nil, method: .ocr_placeholder)
    }
    return .none
  }

  /// Frame of `el` when it is a usable chat input (editable text, not secure, not a search field).
  private static func candidateFrame(_ el: AXUIElement) -> CGRect? {
    let v = AX.multiple(el, [kAXRoleAttribute, kAXSubroleAttribute, kAXPositionAttribute, kAXSizeAttribute])
    let role = AX.str(v[kAXRoleAttribute]) ?? ""
    let subrole = AX.str(v[kAXSubroleAttribute])
    guard role == "AXTextArea" || role == "AXTextField" || role == "AXComboBox" else { return nil }
    guard !FocusReader.isSecure(role: role, subrole: subrole), subrole != "AXSearchField" else { return nil }
    guard role == "AXTextArea" || AX.isSettable(el, kAXValueAttribute) else { return nil }
    guard let f = AX.frame(position: v[kAXPositionAttribute], size: v[kAXSizeAttribute]), f.width >= 80, f.height >= 12
    else { return nil }
    return f
  }

  /// Bottom-most (then largest) editable text element under `root`, 200 ms budget.
  private static func searchEditable(_ root: AXUIElement) -> (AXUIElement, CGRect)? {
    let deadline = monoMs() + 200
    var best: (AXUIElement, CGRect)?
    var stack: [(AXUIElement, Int)] = [(root, 0)]
    var visited = 0
    while let (el, depth) = stack.popLast(), monoMs() < deadline, visited < 4000 {
      visited += 1
      let v = AX.multiple(el, [kAXRoleAttribute, kAXChildrenAttribute])
      let role = AX.str(v[kAXRoleAttribute]) ?? ""
      if textInputRoles.contains(role) || role == "AXSecureTextField" {
        if let f = candidateFrame(el), f.width >= 160 {
          if let b = best {
            if f.maxY > b.1.maxY + 4 || (abs(f.maxY - b.1.maxY) <= 4 && f.width * f.height > b.1.width * b.1.height) {
              best = (el, f)
            }
          } else {
            best = (el, f)
          }
        }
        continue
      }
      if ["AXMenuBar", "AXToolbar", "AXStaticText", "AXImage"].contains(role) || depth > 64 { continue }
      for c in AX.uiElements(v[kAXChildrenAttribute]).reversed() { stack.append((c, depth + 1)) }
    }
    return best
  }

  /// OCR the app's front window and return the box of the bottom-most placeholder match.
  private static func ocrPlaceholder(pid: pid_t, placeholders: [String]) -> CGRect? {
    guard Permissions.screenRecording, let win = Windows.frontWindow(pid: pid), let image = Capture.window(id: win.id),
          let raw = try? OCR.recognize(image) else { return nil }
    let lines = OCR.textLines(raw, frame: win.bounds)
    let wanted = placeholders.map(normalize).filter { !$0.isEmpty }
    let hits = lines.filter { line in
      let t = normalize(line.text)
      return wanted.contains { w in t == w || (t.count >= 4 && (t.contains(w) || w.contains(t))) || fuzzyEqual(t, w) }
    }
    return hits.compactMap { $0.box?.cg }.max { $0.maxY < $1.maxY }
  }

  static func normalize(_ s: String) -> String {
    let lowered = s.lowercased().replacingOccurrences(of: "…", with: "").replacingOccurrences(of: "...", with: "")
    return lowered.filter { $0.isLetter || $0.isNumber || $0 == " " }.trimmingCharacters(in: .whitespaces)
  }

  /// Edit distance ≤ 15% of the longer string (OCR slips like "Ask anythinq").
  static func fuzzyEqual(_ a: String, _ b: String) -> Bool {
    let x = Array(a)
    let y = Array(b)
    guard !x.isEmpty, !y.isEmpty, abs(x.count - y.count) <= 3 else { return false }
    var prev = Array(0...y.count)
    var cur = [Int](repeating: 0, count: y.count + 1)
    for i in 1...x.count {
      cur[0] = i
      for j in 1...y.count {
        cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] == y[j - 1] ? 0 : 1))
      }
      swap(&prev, &cur)
    }
    return Double(prev[y.count]) <= max(1, 0.15 * Double(max(x.count, y.count)))
  }
}
