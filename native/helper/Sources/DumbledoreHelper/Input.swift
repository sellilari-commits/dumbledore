// Input.swift — input.write / input.click / input.key / app.activate. All run on Queues.input.
//
// input.write: refuses secure fields and secure input; aborts when the frontmost app is not
// `expectPid`; `auto` = Accessibility insertion for native fields, ⌘V for Chromium/Electron and
// web content. AX writes are read back; an AX call that changes nothing falls back to paste (auto).
// Pastes save every clipboard item first and restore them ~400 ms later if the clipboard still
// holds our text.
import AppKit
import ApplicationServices
import Carbon

/// `pending` is only touched on Queues.input (serial), hence @unchecked.
final class InputService: @unchecked Sendable {
  static let shared = InputService()
  /// Clipboard to restore after the last paste (touched only on Queues.input).
  private var pending: (saved: Clipboard.Saved, changeCount: Int, work: DispatchWorkItem)?

  func write(_ p: InputWriteParams) throws -> WriteResult {
    try Permissions.requireAccessibility()
    if let expect = p.expectPid, Apps.frontmostPid != pid_t(expect) { return .fail("frontmostChanged") }
    if IsSecureEventInputEnabled() { throw RPCError.secure("secure keyboard input is active") }

    var element: AXUIElement?
    var fromRef = false
    if let ref = p.target?.ref {
      element = RefRegistry.shared.resolve(ref)
      fromRef = element != nil
    }
    if element == nil, let point = p.target?.point {
      guard click(point.cg) else { return .fail("clickFailed") }
      usleep(150_000)
    } else if element == nil, p.target?.ref != nil {
      // A stale handle must not silently redirect the text into whatever has focus now.
      return .fail("targetGone")
    }
    if element == nil { element = FocusReader.focused()?.element }
    guard let el = element, let pid = AX.pid(el), let app = Apps.info(pid: pid) else { return .fail("noTarget") }
    guard pid == Apps.frontmostPid else { return .fail("targetNotFrontmost") }
    if let expect = p.expectPid, pid != pid_t(expect) { return .fail("frontmostChanged") }
    let v = AX.multiple(el, [kAXRoleAttribute, kAXSubroleAttribute, kAXFocusedAttribute])
    if FocusReader.isSecure(role: AX.str(v[kAXRoleAttribute]), subrole: AX.str(v[kAXSubroleAttribute])) {
      throw RPCError.secure("refusing to write into a password field")
    }
    if fromRef, AX.boolean(v[kAXFocusedAttribute]) != true {
      AX.set(el, kAXFocusedAttribute, kCFBooleanTrue)
      usleep(60_000)
    }

    let web = Apps.isChromiumLike(app) || AX.ancestor(el, where: { _, role in role == "AXWebArea" }) != nil
    let method: WriteMethod = p.method == .auto ? (web ? .paste : .ax) : p.method
    if method == .ax {
      let r = writeAX(el, p)
      if r.ok || p.method == .ax { return r }
      Log.debug("AX write did not apply (\(r.reason ?? "?")); falling back to paste")
    }
    return try writePaste(el, p, expectPid: pid)
  }

  private func writeAX(_ el: AXUIElement, _ p: InputWriteParams) -> WriteResult {
    let before = AX.string(el, kAXValueAttribute)
    let err: AXError
    switch p.mode {
    case .insert: err = AX.set(el, kAXSelectedTextAttribute, p.text as CFString)
    case .replaceAll: err = AX.set(el, kAXValueAttribute, p.text as CFString)
    }
    guard err == .success else { return .fail("axError\(err.rawValue)", method: .ax) }
    usleep(30_000)
    let after = AX.string(el, kAXValueAttribute)
    let verified = InputService.verify(mode: p.mode, text: p.text, after: after)
    if !verified, after == before, !(p.mode == .replaceAll && before.map(InputService.norm) == InputService.norm(p.text)) {
      return .fail("axUnchanged", method: .ax)
    }
    return WriteResult(ok: true, method: .ax, verified: verified, reason: verified ? nil : "readBackDiffers")
  }

  private func writePaste(_ el: AXUIElement, _ p: InputWriteParams, expectPid: pid_t) throws -> WriteResult {
    guard let vCode = KeyMap.shared.commandKeyCode(for: "v") else { return .fail("noKeyForV", method: .paste) }
    // If a restore is still pending, the clipboard holds our previous text: keep the user's original.
    let saved: Clipboard.Saved
    if let pend = pending {
      pend.work.cancel()
      saved = pend.saved
    } else {
      saved = Clipboard.save()
    }
    pending = nil
    let changeCount = Clipboard.writeTransient(p.text)
    defer { scheduleRestore(saved, changeCount: changeCount, restore: p.restoreClipboard) }

    if p.mode == .replaceAll, let a = KeyCombo(flags: .maskCommand, key: "a").resolve() {
      _ = KeyPoster.post(code: a.code, flags: .maskCommand)
      usleep(40_000)
    }
    guard Apps.frontmostPid == expectPid else { return .fail("frontmostChanged", method: .paste) }
    guard KeyPoster.post(code: vCode, flags: .maskCommand) else { return .fail("postFailed", method: .paste) }
    var after: String?
    for _ in 0..<4 {
      usleep(80_000)
      after = AX.string(el, kAXValueAttribute)
      if InputService.verify(mode: p.mode, text: p.text, after: after) {
        return WriteResult(ok: true, method: .paste, verified: true, reason: nil)
      }
    }
    return WriteResult(ok: true, method: .paste, verified: false, reason: after == nil ? "unverifiable" : "readBackDiffers")
  }

  private func scheduleRestore(_ saved: Clipboard.Saved, changeCount: Int, restore: Bool) {
    guard restore else { return }
    let work = DispatchWorkItem { [weak self] in
      if Clipboard.changeCount() == changeCount { Clipboard.restore(saved) }
      self?.pending = nil
    }
    pending = (saved, changeCount, work)
    Queues.input.asyncAfter(deadline: .now() + 0.4, execute: work)
  }

  static func norm(_ s: String) -> String {
    s.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\u{00A0}", with: " ")
      .replacingOccurrences(of: "\u{200B}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  static func verify(mode: WriteMode, text: String, after: String?) -> Bool {
    guard let after else { return false }
    let a = norm(after)
    let t = norm(text)
    return mode == .replaceAll ? a == t : (t.isEmpty || a.contains(t))
  }

  // MARK: click / key / activate

  func click(_ point: CGPoint) -> Bool {
    guard Permissions.accessibility, let src = CGEventSource(stateID: .privateState),
          let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
          let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
    else { return false }
    let original = CGEvent(source: nil)?.location
    down.post(tap: .cghidEventTap)
    usleep(20_000)
    up.post(tap: .cghidEventTap)
    if let original {
      usleep(30_000)
      CGWarpMouseCursorPosition(original)
      CGAssociateMouseAndMouseCursorPosition(1)
    }
    return true
  }

  func clickChecked(_ point: CGPoint) throws -> Bool {
    try Permissions.requireAccessibility()
    return click(point)
  }

  func key(_ combo: String) throws -> Bool {
    try Permissions.requireAccessibility()
    guard let parsed = KeyCombo.parse(combo), let (code, flags) = parsed.resolve() else {
      throw RPCError.invalidParams("unknown key combo: \(combo)")
    }
    return KeyPoster.post(code: code, flags: flags)
  }

  func activate(pid: pid_t) -> Bool {
    guard let app = NSRunningApplication(processIdentifier: pid) else { return false }
    if Apps.frontmostPid == pid { return true }
    if Permissions.accessibility { AX.set(AX.app(pid), kAXFrontmostAttribute, kCFBooleanTrue) }
    for i in 0..<15 {
      if Apps.frontmostPid == pid { return true }
      if i == 3 { _ = onMain { app.activate(options: [.activateAllWindows]) } }
      usleep(20_000)
    }
    return Apps.frontmostPid == pid
  }
}
