// OCR.swift — Vision text recognition tuned on this Mac (see docs/PLAN.md §3.4).
//
// `.accurate`, en-US + sv-SE, language correction and auto-detect off (they misread small grey UI
// labels). One recognition at a time: a Retina window peaks at ~260 MB for under a second.
// Vision returns Romanian "Ă" for "Å"; it is corrected here.
import CoreGraphics
import Foundation
import Vision

struct OCRLine {
  let text: String
  /// Normalized box, Vision convention (origin bottom-left, 0…1).
  let box: CGRect
  let confidence: Float
}

enum OCR {
  private static let lock = NSLock()

  static func recognize(_ image: CGImage) throws -> [OCRLine] {
    lock.lock()
    defer { lock.unlock() }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US", "sv-SE"]
    request.usesLanguageCorrection = false
    request.automaticallyDetectsLanguage = false
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    return (request.results ?? []).compactMap { obs in
      guard let top = obs.topCandidates(1).first else { return nil }
      let text = fix(top.string).trimmingCharacters(in: .whitespaces)
      guard !text.isEmpty else { return nil }
      return OCRLine(text: text, box: obs.boundingBox, confidence: top.confidence)
    }
  }

  /// Post-corrections for known Vision confusions in our languages.
  static func fix(_ s: String) -> String {
    guard s.contains("Ă") || s.contains("ă") else { return s }
    return s.replacingOccurrences(of: "Ă", with: "Å").replacingOccurrences(of: "ă", with: "å")
  }

  /// Converts OCR lines to protocol lines in reading order. `frame` is where the image sits on
  /// screen (points); boxes come back in global screen points.
  static func textLines(_ lines: [OCRLine], frame: CGRect) -> [TextLine] {
    let boxes = lines.map { l in
      CGRect(x: frame.minX + l.box.minX * frame.width, y: frame.minY + (1 - l.box.maxY) * frame.height,
             width: l.box.width * frame.width, height: l.box.height * frame.height)
    }
    let layout = Layout.analyze(boxes)
    return layout.order.map { i in
      TextLine(text: lines[i].text, conf: (Double(lines[i].confidence) * 1000).rounded() / 1000,
               box: Rect(boxes[i]), align: layout.align[i])
    }
  }
}
