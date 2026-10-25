// TextJoin.swift — keeps the spaces between adjacent text runs (links, bold/italic runs).
//
// Chrome reports a paragraph as separate runs ("…analysis is ", link "linear regression", ", in
// which…"). Joining them without the space at the boundary gave "islinear"; joining every run
// with a space would split a word made of styled runs ("<b>Re</b>gression"). A space goes in only
// where the page has one: whitespace at the run's edge (or a whitespace-only run between two), or
// a visible horizontal gap between the runs' frames. Existing whitespace and punctuation are kept.
//
// The selection (ax.selectedText) comes back from Chrome as one string that can lose those
// spaces; `restoreSpaces` puts back the spaces the paragraph's own runs have around it.
import ApplicationServices
import CoreGraphics
import Foundation

enum TextJoin {
  /// A gap wider than this between two runs on one line is a space (a space glyph is ~3–5 pt).
  static let gapPt: CGFloat = 1

  /// Whether two runs on one line need a space between them.
  static func needsSpace(_ a: String, spaceAfter: Bool, _ b: String, spaceBefore: Bool,
                         gap: CGFloat? = nil) -> Bool {
    guard let last = a.last, let first = b.first, !last.isWhitespace, !first.isWhitespace else { return false }
    return spaceAfter || spaceBefore || (gap.map { $0 > gapPt } ?? false)
  }

  private static func skipped(_ c: Character) -> Bool { c.isWhitespace || c == "\u{200B}" }

  /// Puts back the spaces `reference` (the text the selection was made in) has between characters
  /// that `selection` runs together. Only inserts spaces; never removes or changes anything else.
  /// Returns the selection unchanged when it cannot be found in the reference.
  static func restoreSpaces(_ selection: String, from reference: String) -> String {
    let s = Array(selection)
    let r = Array(reference)
    let sIdx = s.indices.filter { !skipped(s[$0]) }
    let rIdx = r.indices.filter { !skipped(r[$0]) }
    guard sIdx.count > 1, rIdx.count >= sIdx.count else { return selection }
    let sc = sIdx.map { s[$0] }
    let rc = rIdx.map { r[$0] }
    var match: Int?
    var m = 0
    while m + sc.count <= rc.count {
      if rc[m] == sc[0], Array(rc[m..<(m + sc.count)]) == sc {
        match = m
        break
      }
      m += 1
    }
    guard let m0 = match else { return selection }
    var insertBefore = Set<Int>()
    for k in 0..<(sIdx.count - 1) {
      let hasSpaceInSel = s[(sIdx[k] + 1)..<sIdx[k + 1]].contains { $0.isWhitespace }
      let hasSpaceInRef = r[(rIdx[m0 + k] + 1)..<rIdx[m0 + k + 1]].contains { $0.isWhitespace }
      if hasSpaceInRef, !hasSpaceInSel { insertBefore.insert(sIdx[k + 1]) }
    }
    guard !insertBefore.isEmpty else { return selection }
    var out = ""
    out.reserveCapacity(selection.count + insertBefore.count)
    for (i, c) in s.enumerated() {
      if insertBefore.contains(i) { out.append(" ") }
      out.append(c)
    }
    return out
  }

  /// Roles that sit inside a paragraph; the paragraph is the first ancestor that is none of them.
  private static let inlineRoles: Set<String> = ["AXStaticText", "AXLink", "AXInlineTextBox"]

  /// The text of the paragraph(s) the selection marker range sits in, read run by run with the
  /// spaces kept (AXTextReader), to restore the selection's spaces from. Nil when the app has no
  /// text markers (then the selection is used as it is).
  static func selectionContext(_ web: AXUIElement, range: CFTypeRef) -> String? {
    guard let startMarker = AX.param(web, "AXStartTextMarkerForTextMarkerRange", range),
          let endMarker = AX.param(web, "AXEndTextMarkerForTextMarkerRange", range),
          let startEl = AX.uiElement(AX.param(web, "AXUIElementForTextMarker", startMarker)),
          let endEl = AX.uiElement(AX.param(web, "AXUIElementForTextMarker", endMarker)) else { return nil }
    func blockChain(_ el: AXUIElement) -> [AXUIElement] {
      var chain: [AXUIElement] = []
      var cur: AXUIElement? = el
      var started = false
      while let c = cur, chain.count < 40 {
        let role = AX.string(c, kAXRoleAttribute) ?? ""
        if !started, !inlineRoles.contains(role) { started = true }
        if started { chain.append(c) }
        if role == "AXWebArea" { break }
        cur = AX.element(c, kAXParentAttribute)
      }
      return chain
    }
    let startChain = blockChain(startEl)
    let endChain = blockChain(endEl)
    guard let scope = startChain.first(where: { a in endChain.contains { CFEqual($0, a) } }) else { return nil }
    let text = AXTextReader.read(window: scope, windowFrame: nil, focused: nil, maxChars: 60_000, budgetMs: 120)
    return text.lines.map(\.text).joined(separator: "\n")
  }
}
