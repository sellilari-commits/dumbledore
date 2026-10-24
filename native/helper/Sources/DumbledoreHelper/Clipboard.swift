// Clipboard.swift — save / restore every pasteboard item and type around a paste.
//
// Our own text is marked org.nspasteboard.TransientType so clipboard managers skip it. Contents
// are never logged. Pasteboard calls run on the main thread.
import AppKit

enum Clipboard {
  typealias Saved = [[(NSPasteboard.PasteboardType, Data)]]

  static let transientType = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")

  static var changeCount: Int { onMain { NSPasteboard.general.changeCount } }

  static func save() -> Saved {
    onMain {
      let pb = NSPasteboard.general
      return (pb.pasteboardItems ?? []).map { item in
        item.types.compactMap { type in item.data(forType: type).map { (type, $0) } }
      }
    }
  }

  static func restore(_ saved: Saved) {
    onMain {
      let pb = NSPasteboard.general
      pb.clearContents()
      let items: [NSPasteboardItem] = saved.compactMap { pairs in
        guard !pairs.isEmpty else { return nil }
        let item = NSPasteboardItem()
        for (type, data) in pairs { item.setData(data, forType: type) }
        return item
      }
      if !items.isEmpty { pb.writeObjects(items) }
    }
  }

  /// Puts `text` on the pasteboard (marked transient) and returns the resulting change count.
  static func writeTransient(_ text: String) -> Int {
    onMain {
      let pb = NSPasteboard.general
      pb.clearContents()
      let item = NSPasteboardItem()
      item.setString(text, forType: .string)
      item.setData(Data(), forType: transientType)
      pb.writeObjects([item])
      return pb.changeCount
    }
  }
}
