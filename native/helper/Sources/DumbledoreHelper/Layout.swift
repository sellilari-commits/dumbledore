// Layout.swift — reading order and line alignment for text boxes (pure geometry, no AppKit).
//
// Recursive XY-cut, tuned for both documents and chat UIs:
//   1. split at a vertical gutter when both sides really sit side by side (columns,
//      sidebar | content) — alternating left/right chat bubbles never qualify. Rows above the
//      narrower side's first line (a window title, a page header) are split off first, so a
//      sidebar is never sliced by a row cut and content below the sidebar stays in its column;
//   2. else split at wide horizontal gaps (≥ 1 line height) that span the whole group;
//   3. else it is a tight block (paragraph, bubble): split line by line at the widest gaps;
//   4. else it is one visual row: order left to right.
// Alignment is measured inside the current column. A column's edges are its dominant margins
// (text-weighted clusters of left / right edges), so a short header further out does not move
// them. A tight block that sits right in its column (a user bubble) is `right` as a whole, even
// when its text is left-aligned inside the bubble.
import CoreGraphics

enum Layout {
  struct Result {
    /// Indices of the input boxes in reading order.
    let order: [Int]
    /// Alignment of each input box (same indexing as the input).
    let align: [LineAlign]
  }

  static func analyze(_ boxes: [CGRect]) -> Result {
    let n = boxes.count
    guard n > 0 else { return Result(order: [], align: []) }
    let heights = boxes.map(\.height).sorted()
    let lineHeight = max(1, heights[n / 2])
    var order: [Int] = []
    order.reserveCapacity(n)
    var align = [LineAlign](repeating: .left, count: n)

    func extent(_ idx: [Int]) -> (CGFloat, CGFloat) {
      var lo = CGFloat.infinity
      var hi = -CGFloat.infinity
      for i in idx {
        lo = min(lo, boxes[i].minX)
        hi = max(hi, boxes[i].maxX)
      }
      return (lo, hi)
    }

    func block(_ idx: [Int]) -> CGRect {
      let (lo, hi) = extent(idx)
      let top = idx.map { boxes[$0].minY }.min() ?? 0
      return CGRect(x: lo, y: top, width: hi - lo, height: 1)
    }

    func assign(_ idx: [Int], column: (CGFloat, CGFloat), forced: LineAlign?) {
      for i in idx { align[i] = forced ?? alignment(of: boxes[i], in: column) }
    }

    func recurse(_ idx: [Int], column: (CGFloat, CGFloat), forced: LineAlign? = nil) {
      if idx.count <= 1 {
        assign(idx, column: column, forced: forced)
        order += idx
        return
      }
      if let cols = splitColumns(idx, minGap: lineHeight) {
        // A row above the narrower side's first line spans both sides (title bar, page header).
        let narrow = extent(cols[0]).1 - extent(cols[0]).0 <= extent(cols[1]).1 - extent(cols[1]).0 ? cols[0] : cols[1]
        let top = narrow.map { boxes[$0].minY }.min() ?? 0
        let header = idx.filter { boxes[$0].maxY <= top + 1 }
        if !header.isEmpty {
          let headerSet = Set(header)
          recurse(header.sorted { boxes[$0].minY < boxes[$1].minY }, column: column, forced: forced)
          recurse(idx.filter { !headerSet.contains($0) }, column: column, forced: forced)
          return
        }
        for c in cols { recurse(c, column: Layout.columnEdges(c.map { boxes[$0] })) }
        return
      }
      if let bands = splitRows(idx, minGap: lineHeight, tolerance: 0) {
        for b in bands { recurse(b, column: column, forced: forced) }
        return
      }
      // A tight block: a bubble sitting right in its column is right-aligned as a whole.
      let blockAlign = forced ?? (alignment(of: block(idx), in: column) == .right ? .right : nil)
      if let bands = splitRows(idx, minGap: 0.01, tolerance: 0.1) {
        for b in bands { recurse(b, column: column, forced: blockAlign) }
        return
      }
      let row = idx.sorted { boxes[$0].minX < boxes[$1].minX }
      assign(row, column: column, forced: blockAlign)
      order += row
    }

    /// Splits at horizontal gaps ≥ minGap. With tolerance t, splits at every gap within
    /// (1 - t) of the widest one (t = 0: all qualifying gaps).
    func splitRows(_ idx: [Int], minGap: CGFloat, tolerance: CGFloat) -> [[Int]]? {
      let sorted = idx.sorted { boxes[$0].minY < boxes[$1].minY }
      var gaps: [(at: Int, size: CGFloat)] = []
      var maxY = boxes[sorted[0]].maxY
      for k in 1..<sorted.count {
        let b = boxes[sorted[k]]
        let gap = b.minY - maxY
        if gap >= minGap { gaps.append((k, gap)) }
        maxY = max(maxY, b.maxY)
      }
      guard let widest = gaps.map(\.size).max() else { return nil }
      let cut = tolerance > 0 ? Set(gaps.filter { $0.size >= widest * (1 - tolerance) }.map(\.at)) : Set(gaps.map(\.at))
      var parts: [[Int]] = [[]]
      for (k, i) in sorted.enumerated() {
        if cut.contains(k) { parts.append([]) }
        parts[parts.count - 1].append(i)
      }
      return parts.count > 1 ? parts : nil
    }

    /// Splits at the widest vertical gutter ≥ minGap when the two sides sit side by side.
    func splitColumns(_ idx: [Int], minGap: CGFloat) -> [[Int]]? {
      let sorted = idx.sorted { boxes[$0].minX < boxes[$1].minX }
      var best: (at: Int, size: CGFloat)?
      var maxX = boxes[sorted[0]].maxX
      for k in 1..<sorted.count {
        let b = boxes[sorted[k]]
        let gap = b.minX - maxX
        if gap >= minGap, gap > (best?.size ?? 0) { best = (k, gap) }
        maxX = max(maxX, b.maxX)
      }
      guard let best else { return nil }
      let left = Array(sorted[..<best.at])
      let right = Array(sorted[best.at...])
      return sideBySide(left, right) ? [left, right] : nil
    }

    /// True when ≥ 30% of the smaller side's boxes share a vertical band with the other side.
    func sideBySide(_ a: [Int], _ b: [Int]) -> Bool {
      let (small, large) = a.count <= b.count ? (a, b) : (b, a)
      var hits = 0
      for i in small {
        let r = boxes[i]
        if large.contains(where: { j in
          let o = min(r.maxY, boxes[j].maxY) - max(r.minY, boxes[j].minY)
          return o > 0.3 * min(r.height, boxes[j].height)
        }) { hits += 1 }
      }
      return Double(hits) >= 0.3 * Double(small.count)
    }

    recurse(Array(0..<n), column: columnEdges(boxes))
    return Result(order: order, align: align)
  }

  /// A column's left and right edges: the outermost clusters of left (right) box edges that carry
  /// at least 10 % of the text width of the heaviest cluster. One short line further out (a chat
  /// title beside the conversation) does not move the edge; a sidebar is split off before this.
  static func columnEdges(_ boxes: [CGRect]) -> (CGFloat, CGFloat) {
    guard let first = boxes.first else { return (0, 0) }
    let span = (boxes.map(\.maxX).max() ?? first.maxX) - (boxes.map(\.minX).min() ?? first.minX)
    let tol = max(6, 0.01 * span)
    func edge(_ value: (CGRect) -> CGFloat, outermostIsMin: Bool) -> CGFloat {
      let sorted = boxes.sorted { value($0) < value($1) }
      var clusters: [(lo: CGFloat, hi: CGFloat, weight: CGFloat)] = []
      for b in sorted {
        let v = value(b)
        if let last = clusters.last, v - last.hi <= tol {
          clusters[clusters.count - 1] = (last.lo, v, last.weight + b.width)
        } else {
          clusters.append((v, v, b.width))
        }
      }
      let heaviest = clusters.map(\.weight).max() ?? 0
      let kept = clusters.filter { $0.weight >= 0.1 * heaviest }
      return outermostIsMin ? (kept.first?.lo ?? value(first)) : (kept.last?.hi ?? value(first))
    }
    return (edge({ $0.minX }, outermostIsMin: true), edge({ $0.maxX }, outermostIsMin: false))
  }

  /// Alignment of a box inside a column [lo, hi]: flush with the left edge → left, flush right →
  /// right, otherwise centered when its middle is near the column's middle.
  static func alignment(of b: CGRect, in column: (CGFloat, CGFloat)) -> LineAlign {
    let width = column.1 - column.0
    guard width > 1 else { return .left }
    let tol = max(6, 0.02 * width)
    let left = b.minX - column.0
    let right = column.1 - b.maxX
    if left <= tol { return .left }
    if right <= tol { return .right }
    if abs(b.midX - (column.0 + column.1) / 2) <= 0.1 * width { return .center }
    return left <= right ? .left : .right
  }
}
