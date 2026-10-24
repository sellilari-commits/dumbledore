// OnDevice.swift — Apple's on-device model (FoundationModels, macOS 26+) with schema-guided output.
//
// FoundationModels is weak-linked, so the helper still launches on macOS 15. Status mirrors
// SystemLanguageModel.availability; generation builds a DynamicGenerationSchema from the request's
// JSON Schema (key order preserved) and returns the generated JSON.
import Foundation
import FoundationModels

enum OnDevice {
  static func status() -> OnDeviceStatus {
    guard #available(macOS 26.0, *) else {
      return OnDeviceStatus(available: false, reason: "osTooOld", contextSize: nil)
    }
    let model = SystemLanguageModel.default
    switch model.availability {
    case .available:
      return OnDeviceStatus(available: true, reason: nil, contextSize: model.contextSize)
    case .unavailable(let why):
      return OnDeviceStatus(available: false, reason: reasonName(why), contextSize: nil)
    }
  }

  @available(macOS 26.0, *)
  private static func reasonName(_ r: SystemLanguageModel.Availability.UnavailableReason) -> String {
    switch r {
    case .deviceNotEligible: return "deviceNotEligible"
    case .appleIntelligenceNotEnabled: return "appleIntelligenceNotEnabled"
    case .modelNotReady: return "modelNotReady"
    @unknown default: return "unavailable"
    }
  }

  /// `line` is the raw request (re-parsed with key order for the schema).
  static func generate(_ p: GenerateParams, line: Data, timeoutSeconds: Double = 120) throws -> GenerateResult {
    guard #available(macOS 26.0, *) else { throw RPCError.internalError("the on-device model needs macOS 26") }
    let st = status()
    guard st.available else { throw RPCError.internalError("on-device model unavailable: \(st.reason ?? "unknown")") }
    let ordered = (try? OJSON.parse(line))?["params"]?["schema"] ?? .object([])
    let schema: GenerationSchema
    do {
      schema = try JSONSchemaConverter.generationSchema(ordered)
    } catch {
      throw RPCError.invalidParams("schema: \(error)")
    }
    let defs = (ordered["$defs"] ?? ordered["definitions"])?.pairs ?? []
    let box = Box<Result<GenerateResult, Error>>()
    let sem = DispatchSemaphore(value: 0)
    let instructions = p.instructions
    let prompt = p.prompt
    let options = GenerationOptions(temperature: p.temperature, maximumResponseTokens: p.maxTokens)
    let task = Task.detached {
      do {
        let session = LanguageModelSession(instructions: instructions)
        let response = try await session.respond(to: prompt, schema: schema, options: options)
        let text = response.content.jsonString
        let json = JSONSchemaConverter.fillNulls((try? JSONValue.parse(text)) ?? .string(text), schema: ordered, defs: defs)
        var tokensIn: Int?
        var tokensOut: Int?
        if #available(macOS 26.4, *) {
          let model = SystemLanguageModel.default
          tokensIn = try? await model.tokenCount(for: instructions + "\n" + prompt)
          tokensOut = try? await model.tokenCount(for: text)
        }
        box.value = .success(GenerateResult(json: json, tokensIn: tokensIn, tokensOut: tokensOut))
      } catch {
        box.value = .failure(error)
      }
      sem.signal()
    }
    guard sem.wait(timeout: .now() + timeoutSeconds) == .success else {
      task.cancel()
      throw RPCError(code: RPCCode.timeout, message: "on-device generation timed out")
    }
    switch box.value {
    case .success(let r): return r
    case .failure(let e): throw RPCError.internalError("on-device generation failed: \(e)")
    case nil: throw RPCError.internalError("on-device generation returned nothing")
    }
  }
}
