// Protocol.swift — Codable mirrors of src/shared/helper-protocol.ts. Change both together.
//
// Every TS `.nullable()` field is `@Nullable` here so the key is always present.
// Coordinates are global screen points, origin top-left of the main display (Quartz convention).
import CoreGraphics
import Foundation

let helperProtocolVersion = 1

struct Rect: Codable, Equatable {
  var x: Double
  var y: Double
  var width: Double
  var height: Double

  init(x: Double, y: Double, width: Double, height: Double) {
    func f(_ v: Double) -> Double { v.isFinite ? (v * 100).rounded() / 100 : 0 }
    self.x = f(x)
    self.y = f(y)
    self.width = max(0, f(width))
    self.height = max(0, f(height))
  }

  init(_ r: CGRect) {
    self.init(x: Double(r.origin.x), y: Double(r.origin.y), width: Double(r.width), height: Double(r.height))
  }

  var cg: CGRect { CGRect(x: x, y: y, width: width, height: height) }
}

struct Point: Codable, Equatable {
  var x: Double
  var y: Double
  var cg: CGPoint { CGPoint(x: x, y: y) }
}

struct PermissionsSnapshot: Codable {
  let accessibility: Bool
  let screenRecording: Bool
}

struct AppRef: Codable, Equatable {
  let pid: Int
  let bundleId: String
  let appName: String
}

struct FrontmostInfo: Codable {
  let pid: Int
  let bundleId: String
  let appName: String
  @Nullable var windowId: Int?
  @Nullable var windowTitle: String?
  @Nullable var windowFrame: Rect?
  let isFullScreen: Bool
  @Nullable var url: String?
}

enum LineAlign: String, Codable {
  case left, center, right
}

struct TextLine: Codable {
  let text: String
  let conf: Double
  @Nullable var box: Rect?
  @Nullable var align: LineAlign?
}

enum TextSource: String, Codable {
  case ax, ocr
}

struct PerceivedWindow: Codable {
  let pid: Int
  let bundleId: String
  let appName: String
  @Nullable var windowId: Int?
  @Nullable var title: String?
  @Nullable var url: String?
  @Nullable var frame: Rect?
  let source: TextSource
  let changed: Bool
  let contentHash: String
  let lines: [TextLine]
  let capturedAt: String
}

struct FocusedElement: Codable {
  let pid: Int
  let bundleId: String
  let appName: String
  let role: String
  @Nullable var subrole: String?
  let editable: Bool
  let isSecure: Bool
  @Nullable var frame: Rect?
  @Nullable var caret: Rect?
  @Nullable var placeholder: String?
  @Nullable var valueLength: Int?
  @Nullable var ref: String?
}

struct Display: Codable {
  let id: Int
  let frame: Rect
  let visibleFrame: Rect
  let scale: Double
  let isMain: Bool
  let hasNotch: Bool
}

enum Gesture: String, Codable {
  case tap, doubleTap, holdStart, holdEnd
}

enum TriggerKey: String, Codable, CaseIterable {
  case rightOption, leftOption, rightCommand, rightShift, rightControl, fn
}

// MARK: - Params

/// `z.object({})`: accepts and ignores any object.
struct EmptyParams: Decodable {
  init(from decoder: Decoder) throws {}
}

enum PermissionKind: String, Codable { case accessibility, screenRecording }

struct PermissionsRequestParams: Decodable {
  let kind: PermissionKind
}

enum PerceiveScope: String, Codable { case frontmost, visible }

struct PerceiveParams: Decodable {
  let scope: PerceiveScope
  let minChange: Int
  let allowOcr: Bool
  let forceOcr: Bool
  let maxChars: Int
  let excludeBundleIds: [String]
  /// An explicit request (the outline): the lines on screen now (text scrolled out of view left
  /// out), even when the window is unchanged; perception's change state is left alone.
  let fresh: Bool
  /// With `fresh` (the outline's first read): all of the page's text, the lines out of view without
  /// a box, so the page is chosen from whole.
  let wholePage: Bool

  enum CodingKeys: String, CodingKey {
    case scope, minChange, allowOcr, forceOcr, maxChars, excludeBundleIds, fresh, wholePage
  }

  init(scope: PerceiveScope, minChange: Int = 6, allowOcr: Bool = true, forceOcr: Bool = false,
       maxChars: Int = 20000, excludeBundleIds: [String] = [], fresh: Bool = false, wholePage: Bool = false) {
    self.scope = scope
    self.minChange = minChange
    self.allowOcr = allowOcr
    self.forceOcr = forceOcr
    self.maxChars = maxChars
    self.excludeBundleIds = excludeBundleIds
    self.fresh = fresh
    self.wholePage = wholePage
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    scope = try c.decode(PerceiveScope.self, forKey: .scope)
    minChange = try c.decodeIfPresent(Int.self, forKey: .minChange) ?? 6
    allowOcr = try c.decodeIfPresent(Bool.self, forKey: .allowOcr) ?? true
    forceOcr = try c.decodeIfPresent(Bool.self, forKey: .forceOcr) ?? false
    maxChars = try c.decodeIfPresent(Int.self, forKey: .maxChars) ?? 20000
    excludeBundleIds = try c.decodeIfPresent([String].self, forKey: .excludeBundleIds) ?? []
    fresh = try c.decodeIfPresent(Bool.self, forKey: .fresh) ?? false
    wholePage = try c.decodeIfPresent(Bool.self, forKey: .wholePage) ?? false
  }
}

struct FindChatInputParams: Decodable {
  let pid: Int?
  let placeholders: [String]

  enum CodingKeys: String, CodingKey { case pid, placeholders }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    pid = try c.decodeIfPresent(Int.self, forKey: .pid)
    placeholders = try c.decodeIfPresent([String].self, forKey: .placeholders) ?? []
  }
}

enum WriteMode: String, Codable { case insert, replaceAll }
enum WriteMethod: String, Codable { case auto, ax, paste }

struct WriteTarget: Codable {
  @Nullable var ref: String?
  @Nullable var point: Point?
}

struct InputWriteParams: Decodable {
  let text: String
  let mode: WriteMode
  let target: WriteTarget?
  let method: WriteMethod
  let expectPid: Int?
  let restoreClipboard: Bool

  enum CodingKeys: String, CodingKey { case text, mode, target, method, expectPid, restoreClipboard }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    text = try c.decode(String.self, forKey: .text)
    mode = try c.decode(WriteMode.self, forKey: .mode)
    target = try c.decodeIfPresent(WriteTarget.self, forKey: .target)
    method = try c.decodeIfPresent(WriteMethod.self, forKey: .method) ?? .auto
    expectPid = try c.decodeIfPresent(Int.self, forKey: .expectPid)
    restoreClipboard = try c.decodeIfPresent(Bool.self, forKey: .restoreClipboard) ?? true
  }
}

struct KeyParams: Decodable { let combo: String }
struct PidParams: Decodable { let pid: Int }

struct ShortcutParams: Decodable {
  let key: TriggerKey
  let tapMaxMs: Int
  let holdMinMs: Int
  let doubleTapMs: Int
  let enabled: Bool
}

struct GenerateParams: Decodable {
  let instructions: String
  let prompt: String
  let schema: [String: JSONValue]
  let maxTokens: Int?
  let temperature: Double?

  enum CodingKeys: String, CodingKey { case instructions, prompt, schema, maxTokens, temperature }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    instructions = try c.decode(String.self, forKey: .instructions)
    prompt = try c.decode(String.self, forKey: .prompt)
    schema = try c.decode([String: JSONValue].self, forKey: .schema)
    maxTokens = try c.decodeIfPresent(Int.self, forKey: .maxTokens)
    temperature = try c.decodeIfPresent(Double.self, forKey: .temperature)
  }
}

// MARK: - Results

struct PingResult: Codable {
  let version: Int
  let pid: Int
  let permissions: PermissionsSnapshot
}

struct OpenedResult: Codable { let opened: Bool }
struct OkResult: Codable { let ok: Bool }
struct PerceiveResult: Codable { let windows: [PerceivedWindow] }
struct TextResult: Codable { @Nullable var text: String? }
struct IdleResult: Codable { let seconds: Double }
struct DisplaysResult: Codable { let displays: [Display] }

enum ChatInputMethod: String, Codable { case focused, ax_search, ocr_placeholder }

struct FindChatInputResult: Codable {
  let found: Bool
  @Nullable var frame: Rect?
  @Nullable var ref: String?
  @Nullable var method: ChatInputMethod?

  static let none = FindChatInputResult(found: false, frame: nil, ref: nil, method: nil)
}

enum UsedWriteMethod: String, Codable { case ax, paste }

struct WriteResult: Codable {
  let ok: Bool
  @Nullable var method: UsedWriteMethod?
  let verified: Bool
  @Nullable var reason: String?

  static func fail(_ reason: String, method: UsedWriteMethod? = nil) -> WriteResult {
    WriteResult(ok: false, method: method, verified: false, reason: reason)
  }
}

struct OnDeviceStatus: Codable {
  let available: Bool
  @Nullable var reason: String?
  @Nullable var contextSize: Int?
}

struct GenerateResult: Codable {
  let json: JSONValue
  @Nullable var tokensIn: Int?
  @Nullable var tokensOut: Int?
}

// MARK: - Events (helper → engine notifications)

struct FocusChangedEvent: Codable {
  @Nullable var app: AppRef?
  @Nullable var element: FocusedElement?
}

struct KeyTriggerEvent: Codable {
  let gesture: Gesture
  let key: TriggerKey
  let secureInput: Bool
}

struct EmptyEvent: Codable {}

struct DisplayChangedEvent: Codable { let displays: [Display] }

enum LogLevel: String, Codable { case debug, info, warn, error }

struct LogEvent: Codable {
  let level: LogLevel
  let message: String
}
