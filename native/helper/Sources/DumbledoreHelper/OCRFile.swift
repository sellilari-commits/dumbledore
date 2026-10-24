// OCRFile.swift — `ocr-file` dev/test command: OCR an image file with the exact perceive pipeline
// (Vision settings, Å fix, reading order, alignment) and print one JSON object.
//
//   dumbledore-helper ocr-file --image screen.png [--scale 2]
// Boxes are in points of an imaginary window at (0,0): pixel / scale.
import CoreGraphics
import Foundation
import ImageIO

enum OCRFileCommand {
  private struct Output: Encodable {
    let width: Int
    let height: Int
    let scale: Double
    let ms: Double
    let dhash: String
    let lines: [TextLine]
  }

  static func run(_ cli: CLIOptions) -> Int32 {
    guard let path = cli.string("image") else {
      FileHandle.standardError.write(Data("usage: ocr-file --image <png> [--scale 2]\n".utf8))
      return 2
    }
    let scale = Double(cli.string("scale") ?? "2") ?? 2
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
      FileHandle.standardError.write(Data("cannot read image \(path)\n".utf8))
      return 1
    }
    let started = monoMs()
    do {
      let raw = try OCR.recognize(image)
      let frame = CGRect(x: 0, y: 0, width: Double(image.width) / scale, height: Double(image.height) / scale)
      let lines = OCR.textLines(raw, frame: frame)
      let out = Output(width: image.width, height: image.height, scale: scale, ms: (monoMs() - started).rounded(),
                       dhash: String(format: "%016llx", DHash.compute(image)), lines: lines)
      let data = try RPC.encoder().encode(out)
      FileHandle.standardOutput.write(data)
      FileHandle.standardOutput.write(Data("\n".utf8))
      return 0
    } catch {
      FileHandle.standardError.write(Data("ocr failed: \(error)\n".utf8))
      return 1
    }
  }
}
