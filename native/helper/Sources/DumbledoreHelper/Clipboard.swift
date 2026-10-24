// Clipboard.swift — save / restore every pasteboard item and type around a paste.
//
// Our own text is marked org.nspasteboard.TransientType so clipboard managers skip it. Contents
// are never logged. Pasteboard calls run on the main thread. Every function takes a pasteboard
// name (default: the general clipboard) so selftest can exercise them on a private pasteboard.
import AppKit

enum Clipboard {
  typealias Saved = [[(NSPasteboard.PasteboardType, Data)]]

  static let transientType = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")

  static func changeCount(_ name: NSPasteboard.Name = .general) -> Int {
    onMain { NSPasteboard(name: name).changeCount }
  }

  /// Every item with every type it offers, in order.
  static func save(_ name: NSPasteboard.Name = .general) -> Saved {
    onMain {
      let pb = NSPasteboard(name: name)
      return (pb.pasteboardItems ?? []).map { item in
        item.types.compactMap { type in item.data(forType: type).map { (type, $0) } }
      }
    }
  }

  static func restore(_ saved: Saved, _ name: NSPasteboard.Name = .general) {
    onMain {
      let pb = NSPasteboard(name: name)
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
  static func writeTransient(_ text: String, _ name: NSPasteboard.Name = .general) -> Int {
    onMain {
      let pb = NSPasteboard(name: name)
      pb.clearContents()
      let item = NSPasteboardItem()
      item.setString(text, forType: .string)
      item.setData(Data(), forType: transientType)
      pb.writeObjects([item])
      return pb.changeCount
    }
  }
}
