// AXUtil.swift — thin, typed wrappers over the Accessibility C API.
//
// All reads go through `AX.attr`/`AX.multiple`, which return nil on any AXError. Calls are
// thread-safe IPC to the target app, bounded by the global messaging timeout set at startup.
import ApplicationServices
import CoreGraphics
import Foundation

/// Private but long-stable SPI (used by most window managers): AX window element → CGWindowID.
@_silgen_name("_AXUIElementGetWindow")
private func _AXUIElementGetWindow(_ element: AXUIElement, _ wid: UnsafeMutablePointer<CGWindowID>) -> AXError

enum AX {
  /// AXUIElement is an immutable handle; AX calls on it are thread-safe IPC.
  nonisolated(unsafe) static let systemWide = AXUIElementCreateSystemWide()

  static func app(_ pid: pid_t) -> AXUIElement { AXUIElementCreateApplication(pid) }

  static func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(el, name as CFString, &value)
    return err == .success ? value : nil
  }

  /// Fetches several attributes in one IPC round trip; missing ones are absent from the result.
  static func multiple(_ el: AXUIElement, _ names: [String]) -> [String: CFTypeRef] {
    var values: CFArray?
    let err = AXUIElementCopyMultipleAttributeValues(el, names as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &values)
    guard err == .success, let arr = values as? [AnyObject], arr.count == names.count else { return [:] }
    var out: [String: CFTypeRef] = [:]
    for (i, v) in arr.enumerated() {
      if CFGetTypeID(v) == AXValueGetTypeID(), AXValueGetType(v as! AXValue) == .axError { continue }
      out[names[i]] = v
    }
    return out
  }

  static func string(_ el: AXUIElement, _ name: String) -> String? { str(attr(el, name)) }
  static func bool(_ el: AXUIElement, _ name: String) -> Bool? { boolean(attr(el, name)) }
  static func int(_ el: AXUIElement, _ name: String) -> Int? { integer(attr(el, name)) }
  static func element(_ el: AXUIElement, _ name: String) -> AXUIElement? { uiElement(attr(el, name)) }
  static func elements(_ el: AXUIElement, _ name: String) -> [AXUIElement] { uiElements(attr(el, name)) }

  static func str(_ v: CFTypeRef?) -> String? {
    guard let v else { return nil }
    if CFGetTypeID(v) == CFStringGetTypeID() { return (v as! CFString) as String }
    if CFGetTypeID(v) == CFAttributedStringGetTypeID() { return CFAttributedStringGetString((v as! CFAttributedString)) as String }
    return nil
  }

  static func boolean(_ v: CFTypeRef?) -> Bool? {
    guard let v else { return nil }
    if CFGetTypeID(v) == CFBooleanGetTypeID() { return CFBooleanGetValue((v as! CFBoolean)) }
    if CFGetTypeID(v) == CFNumberGetTypeID() { return ((v as! NSNumber).intValue) != 0 }
    return nil
  }

  static func integer(_ v: CFTypeRef?) -> Int? {
    guard let v, CFGetTypeID(v) == CFNumberGetTypeID() else { return nil }
    return (v as! NSNumber).intValue
  }

  static func uiElement(_ v: CFTypeRef?) -> AXUIElement? {
    guard let v, CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
    return (v as! AXUIElement)
  }

  static func uiElements(_ v: CFTypeRef?) -> [AXUIElement] {
    guard let v, CFGetTypeID(v) == CFArrayGetTypeID() else { return [] }
    let arr = v as! [AnyObject]
    return arr.compactMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? ($0 as! AXUIElement) : nil }
  }

  static func url(_ v: CFTypeRef?) -> String? {
    guard let v else { return nil }
    if CFGetTypeID(v) == CFURLGetTypeID() { return (v as! URL).absoluteString }
    return str(v)
  }

  static func point(_ v: CFTypeRef?) -> CGPoint? {
    guard let v, CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
    var p = CGPoint.zero
    return AXValueGetValue(v as! AXValue, .cgPoint, &p) ? p : nil
  }

  static func size(_ v: CFTypeRef?) -> CGSize? {
    guard let v, CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
    var s = CGSize.zero
    return AXValueGetValue(v as! AXValue, .cgSize, &s) ? s : nil
  }

  static func rect(_ v: CFTypeRef?) -> CGRect? {
    guard let v, CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
    var r = CGRect.zero
    return AXValueGetValue(v as! AXValue, .cgRect, &r) ? r : nil
  }

  static func range(_ v: CFTypeRef?) -> CFRange? {
    guard let v, CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
    var r = CFRange()
    return AXValueGetValue(v as! AXValue, .cfRange, &r) ? r : nil
  }

  static func rangeValue(_ location: Int, _ length: Int) -> AXValue? {
    var r = CFRange(location: location, length: length)
    return AXValueCreate(.cfRange, &r)
  }

  /// Frame from AXPosition + AXSize; nil when either is missing or not finite.
  static func frame(_ el: AXUIElement) -> CGRect? {
    let v = multiple(el, [kAXPositionAttribute, kAXSizeAttribute])
    return frame(position: v[kAXPositionAttribute], size: v[kAXSizeAttribute])
  }

  static func frame(position: CFTypeRef?, size: CFTypeRef?) -> CGRect? {
    guard let p = AX.point(position), let s = AX.size(size) else { return nil }
    guard p.x.isFinite, p.y.isFinite, s.width.isFinite, s.height.isFinite else { return nil }
    return CGRect(origin: p, size: s)
  }

  static func param(_ el: AXUIElement, _ name: String, _ arg: CFTypeRef) -> CFTypeRef? {
    var value: CFTypeRef?
    let err = AXUIElementCopyParameterizedAttributeValue(el, name as CFString, arg, &value)
    return err == .success ? value : nil
  }

  @discardableResult
  static func set(_ el: AXUIElement, _ name: String, _ value: CFTypeRef) -> AXError {
    AXUIElementSetAttributeValue(el, name as CFString, value)
  }

  static func isSettable(_ el: AXUIElement, _ name: String) -> Bool {
    var settable: DarwinBoolean = false
    return AXUIElementIsAttributeSettable(el, name as CFString, &settable) == .success && settable.boolValue
  }

  static func pid(_ el: AXUIElement) -> pid_t? {
    var pid: pid_t = 0
    return AXUIElementGetPid(el, &pid) == .success ? pid : nil
  }

  static func windowId(_ el: AXUIElement) -> CGWindowID? {
    var wid: CGWindowID = 0
    return _AXUIElementGetWindow(el, &wid) == .success && wid != 0 ? wid : nil
  }

  /// The element is still alive (its role can be read).
  static func isAlive(_ el: AXUIElement) -> Bool { attr(el, kAXRoleAttribute) != nil }

  /// Walks up AXParent until `match` returns true (max `limit` levels).
  static func ancestor(_ el: AXUIElement, limit: Int = 40, where match: (AXUIElement, String) -> Bool) -> AXUIElement? {
    var cur: AXUIElement? = el
    var n = 0
    while let c = cur, n < limit {
      if let role = string(c, kAXRoleAttribute), match(c, role) { return c }
      cur = element(c, kAXParentAttribute)
      n += 1
    }
    return nil
  }
}

/// Roles whose value is user-editable text.
let textInputRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]
