// FileText.swift — the text of a PDF the student added as study material (PDFKit), page by page
// up to maxChars. A scanned PDF has no text layer and comes back empty: the app says so.
import Foundation
import PDFKit

struct FileTextParams: Decodable {
  let path: String
  let maxChars: Int
}

struct FileTextResult: Encodable {
  let text: String
  let pages: Int
  let truncated: Bool
}

enum FileText {
  static func pdf(_ p: FileTextParams) throws -> FileTextResult {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: p.path)) else {
      throw RPCError.invalidParams("not a readable PDF")
    }
    var out = ""
    var truncated = false
    for i in 0..<doc.pageCount {
      guard let s = doc.page(at: i)?.string, !s.isEmpty else { continue }
      out += s + "\n\n"
      if out.count >= p.maxChars {
        truncated = true
        break
      }
    }
    return FileTextResult(text: String(out.prefix(p.maxChars)), pages: doc.pageCount, truncated: truncated)
  }
}
