// Router.swift — parses JSON-RPC requests, validates params and dispatches to handlers.
//
// Handlers never run on the main thread. Each method names the queue it runs on: `general`
// (concurrent) for quick reads, and serial queues for perception, input and the on-device model so
// heavy work is bounded and input actions never interleave.
import Foundation

struct RequestContext {
  let connection: Connection
  let id: RPCId
  /// The raw request line (for handlers that need more than the decoded params).
  let line: Data
}

enum Queues {
  static let general = DispatchQueue(label: "helper.general", qos: .userInitiated, attributes: .concurrent)
  static let perceive = DispatchQueue(label: "helper.perceive", qos: .utility)
  static let input = DispatchQueue(label: "helper.input", qos: .userInteractive)
  static let llm = DispatchQueue(label: "helper.llm", qos: .userInitiated)
}

/// The handler table is filled before serving starts and only read afterwards.
final class Router: @unchecked Sendable {
  private typealias Handler = @Sendable (Data, RequestContext) throws -> Data
  private var handlers: [String: (queue: DispatchQueue, run: Handler)] = [:]

  /// Registers `method` with typed params and result.
  func register<P: Decodable, R: Encodable>(
    _ method: String, on queue: DispatchQueue = Queues.general, _ fn: @escaping @Sendable (P, RequestContext) throws -> R
  ) {
    handlers[method] = (queue, { line, ctx in
      let params = try RPC.decodeParams(P.self, from: line)
      let result = try fn(params, ctx)
      return try RPC.resultLine(id: ctx.id, result: result)
    })
  }

  var methods: [String] { handlers.keys.sorted() }

  /// Handles one raw line from a connection. Responses are written asynchronously.
  func handle(line: Data, connection: Connection) {
    let parsed: Any
    do {
      parsed = try JSONSerialization.jsonObject(with: line, options: [])
    } catch {
      connection.send(RPC.errorLine(id: .null, RPCError(code: RPCCode.parse, message: "parse error")))
      return
    }
    guard let obj = parsed as? [String: Any] else {
      let msg = parsed is [Any] ? "batch requests are not supported" : "request must be an object"
      connection.send(RPC.errorLine(id: .null, RPCError(code: RPCCode.invalidRequest, message: msg)))
      return
    }
    let hasId = obj.keys.contains("id")
    let id = RPCId(any: obj["id"])
    guard obj["jsonrpc"] as? String == "2.0", let method = obj["method"] as? String, !method.isEmpty else {
      connection.send(RPC.errorLine(id: id, RPCError(code: RPCCode.invalidRequest, message: "invalid request")))
      return
    }
    guard let handler = handlers[method] else {
      if hasId {
        connection.send(RPC.errorLine(
          id: id, RPCError(code: RPCCode.methodNotFound, message: "method not found: \(method)")))
      }
      return
    }
    let ctx = RequestContext(connection: connection, id: id, line: line)
    handler.queue.async {
      let started = monoMs()
      let response: Data
      do {
        response = try handler.run(line, ctx)
      } catch let e as RPCError {
        response = RPC.errorLine(id: id, e)
      } catch {
        response = RPC.errorLine(id: id, RPCError.internalError(String(describing: error)))
      }
      Log.debug("\(method) took \(Int(monoMs() - started)) ms")
      if hasId { connection.send(response) }
    }
  }
}
