// JSON.swift — a JSON value type, an explicit-null Codable wrapper and JSON-RPC 2.0 envelopes.
//
// The TypeScript side validates with zod, where `.nullable()` fields must be present (as null).
// Swift's synthesized Codable omits nil optionals, so every optional protocol field is wrapped in
// `@Nullable`, which always writes the key.
import Foundation

/// Any JSON value. Used for request ids, `llm.onDevice.generate` schemas and results.
enum JSONValue: Codable, Equatable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let b = try? c.decode(Bool.self) {
      self = .bool(b)
    } else if let n = try? c.decode(Double.self) {
      self = .number(n)
    } else if let s = try? c.decode(String.self) {
      self = .string(s)
    } else if let a = try? c.decode([JSONValue].self) {
      self = .array(a)
    } else if let o = try? c.decode([String: JSONValue].self) {
      self = .object(o)
    } else {
      throw DecodingError.dataCorruptedError(in: c, debugDescription: "not a JSON value")
    }
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let b): try c.encode(b)
    case .number(let n):
      if !n.isFinite {
        try c.encodeNil()
      } else if n == n.rounded(), abs(n) < 9e15 {
        try c.encode(Int64(n))
      } else {
        try c.encode(n)
      }
    case .string(let s): try c.encode(s)
    case .array(let a): try c.encode(a)
    case .object(let o): try c.encode(o)
    }
  }

  /// Converts JSONSerialization output into a JSONValue.
  init(any: Any?) {
    switch any {
    case nil, is NSNull: self = .null
    case let n as NSNumber:
      if CFGetTypeID(n) == CFBooleanGetTypeID() { self = .bool(n.boolValue) } else { self = .number(n.doubleValue) }
    case let s as String: self = .string(s)
    case let a as [Any]: self = .array(a.map { JSONValue(any: $0) })
    case let o as [String: Any]: self = .object(o.mapValues { JSONValue(any: $0) })
    default: self = .null
    }
  }

  subscript(key: String) -> JSONValue? {
    if case .object(let o) = self { return o[key] }
    return nil
  }

  var string: String? { if case .string(let s) = self { return s }; return nil }
  var double: Double? { if case .number(let n) = self { return n }; return nil }
  var int: Int? {
    if case .number(let n) = self, n.isFinite, n == n.rounded() { return Int(n) }
    return nil
  }
  var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
  var array: [JSONValue]? { if case .array(let a) = self { return a }; return nil }
  var object: [String: JSONValue]? { if case .object(let o) = self { return o }; return nil }

  /// Parses JSON text (any top-level value).
  static func parse(_ text: String) throws -> JSONValue {
    let obj = try JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed])
    return JSONValue(any: obj)
  }
}

/// Optional that always encodes its key (`null` when nil) and decodes a missing key as nil.
@propertyWrapper
struct Nullable<T: Codable>: Codable {
  var wrappedValue: T?

  init(wrappedValue: T?) { self.wrappedValue = wrappedValue }

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    wrappedValue = c.decodeNil() ? nil : try c.decode(T.self)
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    if let v = wrappedValue { try c.encode(v) } else { try c.encodeNil() }
  }
}

extension Nullable: Sendable where T: Sendable {}
extension Nullable: Equatable where T: Equatable {}

extension KeyedDecodingContainer {
  func decode<T>(_ type: Nullable<T>.Type, forKey key: Key) throws -> Nullable<T> {
    try decodeIfPresent(type, forKey: key) ?? Nullable(wrappedValue: nil)
  }
}

// MARK: - JSON-RPC

enum RPCCode {
  static let parse = -32700
  static let invalidRequest = -32600
  static let methodNotFound = -32601
  static let invalidParams = -32602
  static let internalError = -32603
  static let permissionDenied = -32001
  static let notFound = -32002
  static let timeout = -32003
  static let secureInput = -32004
}

/// An error a handler throws to produce a JSON-RPC error response.
struct RPCError: Error {
  let code: Int
  let message: String
  var data: JSONValue? = nil

  static func invalidParams(_ m: String) -> RPCError { RPCError(code: RPCCode.invalidParams, message: m) }
  static func permission(_ m: String) -> RPCError { RPCError(code: RPCCode.permissionDenied, message: m) }
  static func notFound(_ m: String) -> RPCError { RPCError(code: RPCCode.notFound, message: m) }
  static func secure(_ m: String) -> RPCError { RPCError(code: RPCCode.secureInput, message: m) }
  static func internalError(_ m: String) -> RPCError { RPCError(code: RPCCode.internalError, message: m) }
}

/// Request id: number, string or null (JSON-RPC 2.0 §4).
enum RPCId: Encodable, Equatable {
  case int(Int)
  case string(String)
  case null

  init(any: Any?) {
    switch any {
    case let n as NSNumber where CFGetTypeID(n) != CFBooleanGetTypeID(): self = .int(n.intValue)
    case let s as String: self = .string(s)
    default: self = .null
    }
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .int(let i): try c.encode(i)
    case .string(let s): try c.encode(s)
    case .null: try c.encodeNil()
    }
  }
}

private struct ResultEnvelope<R: Encodable>: Encodable {
  let jsonrpc = "2.0"
  let id: RPCId
  let result: R
}

private struct ErrorBody: Encodable {
  let code: Int
  let message: String
  @Nullable var data: JSONValue?
}

private struct ErrorEnvelope: Encodable {
  let jsonrpc = "2.0"
  let id: RPCId
  let error: ErrorBody
}

private struct NotificationEnvelope<P: Encodable>: Encodable {
  let jsonrpc = "2.0"
  let method: String
  let params: P
}

private struct ParamsEnvelope<P: Decodable>: Decodable {
  let params: P?
}

enum RPC {
  static func encoder() -> JSONEncoder {
    let e = JSONEncoder()
    e.outputFormatting = [.withoutEscapingSlashes]
    e.nonConformingFloatEncodingStrategy = .convertToString(positiveInfinity: "0", negativeInfinity: "0", nan: "0")
    return e
  }

  static func resultLine<R: Encodable>(id: RPCId, result: R) throws -> Data {
    try encoder().encode(ResultEnvelope(id: id, result: result))
  }

  static func errorLine(id: RPCId, _ err: RPCError) -> Data {
    let body = ErrorBody(code: err.code, message: err.message, data: err.data)
    // Encoding plain ints and strings cannot fail.
    return (try? encoder().encode(ErrorEnvelope(id: id, error: body))) ?? Data()
  }

  static func notificationLine<P: Encodable>(method: String, params: P) throws -> Data {
    try encoder().encode(NotificationEnvelope(method: method, params: params))
  }

  /// Decodes `params` of a request line into `P`; a missing `params` decodes from `{}`.
  static func decodeParams<P: Decodable>(_ type: P.Type, from line: Data) throws -> P {
    do {
      let env = try JSONDecoder().decode(ParamsEnvelope<P>.self, from: line)
      if let p = env.params { return p }
      return try JSONDecoder().decode(P.self, from: Data("{}".utf8))
    } catch let e as DecodingError {
      throw RPCError.invalidParams(describe(e))
    }
  }

  static func describe(_ e: DecodingError) -> String {
    func path(_ ctx: DecodingError.Context) -> String {
      var keys = ctx.codingPath.map { $0.intValue.map(String.init) ?? $0.stringValue }
      if keys.first == "params" { keys.removeFirst() }
      return (["params"] + keys).joined(separator: ".")
    }
    switch e {
    case .keyNotFound(let key, let ctx):
      let base = path(ctx)
      return "\(base).\(key.stringValue) is required"
    case .typeMismatch(_, let ctx), .valueNotFound(_, let ctx), .dataCorrupted(let ctx):
      return "\(path(ctx)): \(ctx.debugDescription)"
    @unknown default:
      return "invalid params"
    }
  }
}
