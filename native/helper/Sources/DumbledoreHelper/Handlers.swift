// Handlers.swift — the method table: one entry per method of src/shared/helper-protocol.ts.
import ApplicationServices
import Carbon
import Foundation

enum Handlers {
  static func makeRouter() -> Router {
    let r = Router()
    r.register("ping") { (_: EmptyParams, _) in
      PingResult(version: helperProtocolVersion, pid: Int(getpid()), permissions: Permissions.status())
    }
    r.register("permissions.status") { (_: EmptyParams, _) in Permissions.status() }
    r.register("permissions.request") { (p: PermissionsRequestParams, _) in
      OpenedResult(opened: Permissions.request(p.kind))
    }
    r.register("frontmost") { (_: EmptyParams, _) -> FrontmostInfo? in Perceiver.frontmost() }
    r.register("perceive", on: Queues.perceive) { (p: PerceiveParams, ctx) in
      Perceiver.perceive(p, session: ctx.connection.session)
    }
    r.register("ax.focused") { (_: EmptyParams, _) -> FocusedElement? in
      try Permissions.requireAccessibility()
      guard let f = FocusReader.focused() else { return nil }
      return FocusReader.describe(f.element, app: f.app)
    }
    r.register("ax.readFocusedValue") { (_: EmptyParams, _) in try readFocusedValue() }
    r.register("ax.selectedText") { (_: EmptyParams, _) in try selectedText() }
    r.register("ax.findChatInput") { (p: FindChatInputParams, _) in ChatInputFinder.find(p) }
    r.register("input.write", on: Queues.input) { (p: InputWriteParams, _) in try InputService.shared.write(p) }
    r.register("input.click", on: Queues.input) { (p: Point, _) in
      OkResult(ok: try InputService.shared.clickChecked(p.cg))
    }
    r.register("input.key", on: Queues.input) { (p: KeyParams, _) in OkResult(ok: try InputService.shared.key(p.combo)) }
    r.register("app.activate", on: Queues.input) { (p: PidParams, _) in
      OkResult(ok: InputService.shared.activate(pid: pid_t(p.pid)))
    }
    r.register("system.idle") { (_: EmptyParams, _) in IdleResult(seconds: SystemInfo.idleSeconds()) }
    r.register("system.displays") { (_: EmptyParams, _) in DisplaysResult(displays: SystemInfo.displays()) }
    r.register("shortcut.configure") { (p: ShortcutParams, _) in
      guard p.tapMaxMs > 0, p.holdMinMs > 0, p.doubleTapMs >= 0 else {
        throw RPCError.invalidParams("durations must be positive")
      }
      TriggerPoller.shared.configure(p)
      return OkResult(ok: true)
    }
    r.register("file.pdfText") { (p: FileTextParams, _) in try FileText.pdf(p) }
    r.register("llm.onDevice.status") { (_: EmptyParams, _) in OnDevice.status() }
    r.register("llm.onDevice.generate", on: Queues.llm) { (p: GenerateParams, ctx) in
      try OnDevice.generate(p, line: ctx.line)
    }
    return r
  }

  /// Focused field text — only on an explicit user action. Refuses secure fields and secure input.
  static func readFocusedValue() throws -> TextResult {
    try Permissions.requireAccessibility()
    guard let f = FocusReader.focused() else { return TextResult(text: nil) }
    try refuseSecure(f.element)
    return TextResult(text: AX.string(f.element, kAXValueAttribute))
  }

  /// Current selection — AXSelectedText, else WebKit/Chromium text markers on the page element.
  /// On a page, Chrome's selection string can run words together where a link or inline element
  /// starts or ends ("islinear regression"): the spaces are put back from the paragraph's own runs.
  static func selectedText() throws -> TextResult {
    try Permissions.requireAccessibility()
    guard let f = FocusReader.focused() else { return TextResult(text: nil) }
    try refuseSecure(f.element)
    let web = AX.ancestor(f.element, where: { _, role in role == "AXWebArea" })
    var candidates = [f.element]
    if let web, !CFEqual(web, f.element) { candidates.append(web) }
    func withSpaces(_ s: String) -> String {
      guard let web, let range = AX.attr(web, "AXSelectedTextMarkerRange"),
            let context = TextJoin.selectionContext(web, range: range) else { return s }
      return TextJoin.restoreSpaces(s, from: context)
    }
    for el in candidates {
      if let s = AX.string(el, kAXSelectedTextAttribute), !s.isEmpty { return TextResult(text: withSpaces(s)) }
      if let range = AX.attr(el, "AXSelectedTextMarkerRange"),
         let s = AX.str(AX.param(el, "AXStringForTextMarkerRange", range)), !s.isEmpty {
        return TextResult(text: withSpaces(s))
      }
    }
    return TextResult(text: nil)
  }

  private static func refuseSecure(_ el: AXUIElement) throws {
    let v = AX.multiple(el, [kAXRoleAttribute, kAXSubroleAttribute])
    if FocusReader.isSecure(role: AX.str(v[kAXRoleAttribute]), subrole: AX.str(v[kAXSubroleAttribute])) {
      throw RPCError.secure("the focused field is a password field")
    }
    if IsSecureEventInputEnabled() { throw RPCError.secure("secure keyboard input is active") }
  }
}
