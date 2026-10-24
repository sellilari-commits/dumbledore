// JSONSchema.swift — JSON Schema (the subset zod emits) → FoundationModels DynamicGenerationSchema.
//
// Supported: object (properties, required), string (+ enum / const), integer and number (+ minimum,
// maximum), boolean, array (items, minItems, maxItems), anyOf/oneOf, nullable types, $ref into
// $defs/definitions. Unsupported keywords are ignored. Nullable properties are generated as
// optional and filled with explicit nulls afterwards (zod's `.nullable()` needs the key present).
import Foundation
import FoundationModels

@available(macOS 26.0, *)
enum JSONSchemaConverter {
  struct Unsupported: Error, CustomStringConvertible {
    let description: String
  }

  static func generationSchema(_ root: OJSON) throws -> GenerationSchema {
    let defs = (root["$defs"] ?? root["definitions"])?.pairs ?? []
    let deps = try defs.map { name, def in try convert(def, path: name) }
    let rootSchema = try convert(root, path: root["title"]?.string ?? "Response")
    return try GenerationSchema(root: rootSchema, dependencies: deps)
  }

  /// True when the schema admits null (type: [..., "null"], or anyOf/oneOf with a null branch).
  static func isNullable(_ s: OJSON) -> Bool {
    if let types = s["type"]?.array, types.contains(where: { $0.string == "null" }) { return true }
    if let choices = (s["anyOf"] ?? s["oneOf"])?.array, choices.contains(where: { $0["type"]?.string == "null" }) {
      return true
    }
    return false
  }

  private static func typeName(_ s: OJSON) -> String? {
    if let t = s["type"]?.string { return t }
    if let ts = s["type"]?.array { return ts.compactMap(\.string).first { $0 != "null" } }
    if s["properties"] != nil { return "object" }
    if s["items"] != nil { return "array" }
    return nil
  }

  static func convert(_ s: OJSON, path: String) throws -> DynamicGenerationSchema {
    let description = s["description"]?.string
    if let ref = s["$ref"]?.string {
      return DynamicGenerationSchema(referenceTo: String(ref.split(separator: "/").last ?? Substring(ref)))
    }
    if let choices = (s["anyOf"] ?? s["oneOf"])?.array {
      let real = choices.filter { $0["type"]?.string != "null" }
      if real.count == 1, let only = real.first { return try convert(only, path: path) }
      let converted = try real.enumerated().map { i, c in try convert(c, path: "\(path)_\(i)") }
      return DynamicGenerationSchema(name: path, description: description, anyOf: converted)
    }
    if let values = s["enum"]?.array {
      let strings = values.compactMap(\.string)
      if !strings.isEmpty, strings.count == values.count {
        return DynamicGenerationSchema(name: path, description: description, anyOf: strings)
      }
    }
    if let c = s["const"]?.string {
      return DynamicGenerationSchema(type: String.self, guides: [.constant(c)])
    }
    switch typeName(s) {
    case "object":
      let required = Set(s["required"]?.array?.compactMap(\.string) ?? [])
      let props = try (s["properties"]?.pairs ?? []).map { name, sub in
        DynamicGenerationSchema.Property(
          name: name, description: sub["description"]?.string, schema: try convert(sub, path: "\(path)_\(name)"),
          isOptional: !required.contains(name) || isNullable(sub))
      }
      return DynamicGenerationSchema(name: path, description: description, properties: props)
    case "array":
      let item = try s["items"].map { try convert($0, path: "\(path)_item") }
        ?? DynamicGenerationSchema(type: String.self)
      return DynamicGenerationSchema(arrayOf: item, minimumElements: s["minItems"]?.int, maximumElements: s["maxItems"]?.int)
    case "string":
      return DynamicGenerationSchema(type: String.self)
    case "integer":
      var guides: [GenerationGuide<Int>] = []
      let lo = s["minimum"]?.int
      let hi = s["maximum"]?.int
      if let lo, let hi, lo <= hi { guides.append(.range(lo...hi)) } else {
        if let lo { guides.append(.minimum(lo)) }
        if let hi { guides.append(.maximum(hi)) }
      }
      return DynamicGenerationSchema(type: Int.self, guides: guides)
    case "number":
      var guides: [GenerationGuide<Double>] = []
      let lo = s["minimum"]?.number
      let hi = s["maximum"]?.number
      if let lo, let hi, lo <= hi { guides.append(.range(lo...hi)) } else {
        if let lo { guides.append(.minimum(lo)) }
        if let hi { guides.append(.maximum(hi)) }
      }
      return DynamicGenerationSchema(type: Double.self, guides: guides)
    case "boolean":
      return DynamicGenerationSchema(type: Bool.self)
    case let other:
      throw Unsupported(description: "unsupported schema at \(path): type \(other ?? "missing")")
    }
  }

  /// Adds explicit nulls for nullable/optional properties the model left out.
  static func fillNulls(_ value: JSONValue, schema: OJSON, defs: [(String, OJSON)]) -> JSONValue {
    var s = schema
    for _ in 0..<4 {
      if let ref = s["$ref"]?.string, let name = ref.split(separator: "/").last,
         let def = defs.first(where: { $0.0 == String(name) })?.1 {
        s = def
      } else if let choices = (s["anyOf"] ?? s["oneOf"])?.array,
                case let real = choices.filter({ $0["type"]?.string != "null" }), real.count == 1, let only = real.first {
        s = only
      } else {
        break
      }
    }
    switch value {
    case .object(var obj):
      for (name, sub) in s["properties"]?.pairs ?? [] {
        if let v = obj[name] { obj[name] = fillNulls(v, schema: sub, defs: defs) } else { obj[name] = .null }
      }
      return .object(obj)
    case .array(let items):
      guard let itemSchema = s["items"] else { return value }
      return .array(items.map { fillNulls($0, schema: itemSchema, defs: defs) })
    default:
      return value
    }
  }
}
