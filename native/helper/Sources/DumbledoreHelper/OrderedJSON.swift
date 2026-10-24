// OrderedJSON.swift — a small JSON parser that keeps object key order.
//
// Used for JSON Schemas given to the on-device model: property order is generation order (e.g.
// "reasoning" before "answer"), and Foundation's parsers lose it.
import Foundation

indirect enum OJSON: Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([OJSON])
  case object([(String, OJSON)])

  subscript(key: String) -> OJSON? {
    if case .object(let pairs) = self { return pairs.first { $0.0 == key }?.1 }
    return nil
  }

  var string: String? { if case .string(let s) = self { return s }; return nil }
  var number: Double? { if case .number(let n) = self { return n }; return nil }
  var int: Int? { number.flatMap { $0 == $0.rounded() && abs($0) < 1e15 ? Int($0) : nil } }
  var array: [OJSON]? { if case .array(let a) = self { return a }; return nil }
  var pairs: [(String, OJSON)]? { if case .object(let o) = self { return o }; return nil }

  struct ParseError: Error { let offset: Int }

  static func parse(_ data: Data) throws -> OJSON {
    var p = Parser(bytes: [UInt8](data))
    p.skipWS()
    let v = try p.value(depth: 0)
    p.skipWS()
    guard p.i == p.bytes.count else { throw ParseError(offset: p.i) }
    return v
  }

  private struct Parser {
    let bytes: [UInt8]
    var i = 0

    mutating func skipWS() {
      while i < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[i]) { i += 1 }
    }

    mutating func value(depth: Int) throws -> OJSON {
      guard depth < 200, i < bytes.count else { throw ParseError(offset: i) }
      switch bytes[i] {
      case UInt8(ascii: "{"): return try object(depth: depth)
      case UInt8(ascii: "["): return try array(depth: depth)
      case UInt8(ascii: "\""): return .string(try string())
      case UInt8(ascii: "t"): try literal("true"); return .bool(true)
      case UInt8(ascii: "f"): try literal("false"); return .bool(false)
      case UInt8(ascii: "n"): try literal("null"); return .null
      default: return .number(try number())
      }
    }

    mutating func literal(_ word: String) throws {
      let w = Array(word.utf8)
      guard i + w.count <= bytes.count, Array(bytes[i..<(i + w.count)]) == w else { throw ParseError(offset: i) }
      i += w.count
    }

    mutating func number() throws -> Double {
      let start = i
      while i < bytes.count, "+-0123456789.eE".utf8.contains(bytes[i]) { i += 1 }
      guard let s = String(bytes: bytes[start..<i], encoding: .utf8), let d = Double(s) else { throw ParseError(offset: start) }
      return d
    }

    mutating func string() throws -> String {
      i += 1
      var out = [UInt8]()
      while i < bytes.count {
        let c = bytes[i]
        if c == UInt8(ascii: "\"") {
          i += 1
          return String(decoding: out, as: UTF8.self)
        }
        if c == UInt8(ascii: "\\") {
          i += 1
          guard i < bytes.count else { break }
          let e = bytes[i]
          i += 1
          switch e {
          case UInt8(ascii: "n"): out.append(0x0A)
          case UInt8(ascii: "t"): out.append(0x09)
          case UInt8(ascii: "r"): out.append(0x0D)
          case UInt8(ascii: "b"): out.append(0x08)
          case UInt8(ascii: "f"): out.append(0x0C)
          case UInt8(ascii: "u"):
            var scalar = try hex4()
            if (0xD800..<0xDC00).contains(scalar), i + 6 <= bytes.count, bytes[i] == UInt8(ascii: "\\"),
               bytes[i + 1] == UInt8(ascii: "u") {
              i += 2
              let low = try hex4()
              scalar = 0x10000 + ((scalar - 0xD800) << 10) + (low - 0xDC00)
            }
            out.append(contentsOf: Array(String(UnicodeScalar(scalar).map(Character.init) ?? "\u{FFFD}").utf8))
          default: out.append(e)
          }
          continue
        }
        out.append(c)
        i += 1
      }
      throw ParseError(offset: i)
    }

    mutating func hex4() throws -> UInt32 {
      guard i + 4 <= bytes.count, let s = String(bytes: bytes[i..<(i + 4)], encoding: .ascii),
            let v = UInt32(s, radix: 16) else { throw ParseError(offset: i) }
      i += 4
      return v
    }

    mutating func array(depth: Int) throws -> OJSON {
      i += 1
      var items: [OJSON] = []
      skipWS()
      if i < bytes.count, bytes[i] == UInt8(ascii: "]") {
        i += 1
        return .array(items)
      }
      while true {
        skipWS()
        items.append(try value(depth: depth + 1))
        skipWS()
        guard i < bytes.count else { throw ParseError(offset: i) }
        if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
        if bytes[i] == UInt8(ascii: "]") { i += 1; return .array(items) }
        throw ParseError(offset: i)
      }
    }

    mutating func object(depth: Int) throws -> OJSON {
      i += 1
      var pairs: [(String, OJSON)] = []
      skipWS()
      if i < bytes.count, bytes[i] == UInt8(ascii: "}") {
        i += 1
        return .object(pairs)
      }
      while true {
        skipWS()
        guard i < bytes.count, bytes[i] == UInt8(ascii: "\"") else { throw ParseError(offset: i) }
        let key = try string()
        skipWS()
        guard i < bytes.count, bytes[i] == UInt8(ascii: ":") else { throw ParseError(offset: i) }
        i += 1
        skipWS()
        pairs.append((key, try value(depth: depth + 1)))
        skipWS()
        guard i < bytes.count else { throw ParseError(offset: i) }
        if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
        if bytes[i] == UInt8(ascii: "}") { i += 1; return .object(pairs) }
        throw ParseError(offset: i)
      }
    }
  }
}
