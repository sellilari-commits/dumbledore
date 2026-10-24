/**
 * Contract between the engine (TypeScript) and the Swift helper app.
 *
 * Transport: JSON-RPC 2.0, one JSON object per line, over a Unix domain socket.
 *   request       {"jsonrpc":"2.0","id":1,"method":"perceive","params":{…}}
 *   response      {"jsonrpc":"2.0","id":1,"result":{…}}
 *   error         {"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"…","data":{…}}}
 *   notification  {"jsonrpc":"2.0","method":"focus.changed","params":{…}}   (helper → engine)
 *
 * The Swift side mirrors these shapes with Codable structs (native/helper). Change both together.
 * Images never cross this boundary — only text, boxes and hashes.
 */
import { z } from 'zod'
import { TriggerKey } from './domain'
import { Point, Rect } from './geometry'

export const HELPER_PROTOCOL_VERSION = 1

export const HelperErrorCode = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  permissionDenied: -32001,
  notFound: -32002,
  timeout: -32003,
  secureInput: -32004,
} as const

export const PermissionsSnapshot = z.object({
  accessibility: z.boolean(),
  screenRecording: z.boolean(),
})
export type PermissionsSnapshot = z.infer<typeof PermissionsSnapshot>

export const AppRef = z.object({ pid: z.number().int(), bundleId: z.string(), appName: z.string() })
export type AppRef = z.infer<typeof AppRef>

export const FrontmostInfo = AppRef.extend({
  windowId: z.number().int().nullable(),
  windowTitle: z.string().nullable(),
  windowFrame: Rect.nullable(),
  isFullScreen: z.boolean(),
  url: z.string().nullable(), // browsers: AXURL of the page, no Automation prompt
})
export type FrontmostInfo = z.infer<typeof FrontmostInfo>

export const TextLine = z.object({
  text: z.string(),
  conf: z.number().min(0).max(1), // 1 for Accessibility text
  box: Rect.nullable(), // screen coordinates when known
  align: z.enum(['left', 'center', 'right']).nullable(), // relative to the window
})
export type TextLine = z.infer<typeof TextLine>

export const PerceivedWindow = AppRef.extend({
  windowId: z.number().int().nullable(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  frame: Rect.nullable(),
  source: z.enum(['ax', 'ocr']),
  changed: z.boolean(), // false → lines is empty and contentHash equals the previous one
  contentHash: z.string(),
  lines: z.array(TextLine), // reading order
  capturedAt: z.string(),
})
export type PerceivedWindow = z.infer<typeof PerceivedWindow>

export const FocusedElement = AppRef.extend({
  role: z.string(), // AXTextArea, AXTextField, AXComboBox, AXWebArea, …
  subrole: z.string().nullable(),
  editable: z.boolean(),
  isSecure: z.boolean(), // password fields: never read, never written
  frame: Rect.nullable(),
  caret: Rect.nullable(),
  placeholder: z.string().nullable(),
  valueLength: z.number().int().nullable(),
  ref: z.string().nullable(), // opaque handle the helper can resolve again (input.write target)
})
export type FocusedElement = z.infer<typeof FocusedElement>

export const Display = z.object({
  id: z.number().int(),
  frame: Rect,
  visibleFrame: Rect,
  scale: z.number(),
  isMain: z.boolean(),
  hasNotch: z.boolean(),
})
export type Display = z.infer<typeof Display>

export const Gesture = z.enum(['tap', 'doubleTap', 'holdStart', 'holdEnd'])
export type Gesture = z.infer<typeof Gesture>

const Empty = z.object({})

export const helperMethods = {
  ping: {
    params: Empty,
    result: z.object({
      version: z.number().int(),
      pid: z.number().int(),
      permissions: PermissionsSnapshot,
    }),
  },
  'permissions.status': { params: Empty, result: PermissionsSnapshot },
  /** Opens the right System Settings pane (and triggers the system prompt where one exists). */
  'permissions.request': {
    params: z.object({ kind: z.enum(['accessibility', 'screenRecording']) }),
    result: z.object({ opened: z.boolean() }),
  },
  frontmost: { params: Empty, result: FrontmostInfo.nullable() },
  /**
   * Read window text. Accessibility text first; screenshot + Vision OCR only when the window has
   * too little readable text (or forceOcr). Windows of `excludeBundleIds` are never read.
   */
  perceive: {
    params: z.object({
      scope: z.enum(['frontmost', 'visible']),
      minChange: z.number().int().default(6), // dHash Hamming distance that counts as changed
      allowOcr: z.boolean().default(true),
      forceOcr: z.boolean().default(false),
      maxChars: z.number().int().default(20000),
      excludeBundleIds: z.array(z.string()).default([]),
    }),
    result: z.object({ windows: z.array(PerceivedWindow) }),
  },
  /** Text of a PDF the student added as study material (PDFKit). Empty for a scanned PDF. */
  'file.pdfText': {
    params: z.object({ path: z.string(), maxChars: z.number().int().default(200_000) }),
    result: z.object({ text: z.string(), pages: z.number().int(), truncated: z.boolean() }),
  },
  'ax.focused': { params: Empty, result: FocusedElement.nullable() },
  /** Only on an explicit user action (key tap / Improve). Refuses secure fields. */
  'ax.readFocusedValue': { params: Empty, result: z.object({ text: z.string().nullable() }) },
  /** Only on an explicit user action (key tap). */
  'ax.selectedText': { params: Empty, result: z.object({ text: z.string().nullable() }) },
  /** Locate the chat input of an AI chat window: focused element → AX search → OCR placeholder. */
  'ax.findChatInput': {
    params: z.object({
      pid: z.number().int().nullable(),
      placeholders: z.array(z.string()).default([]),
    }),
    result: z.object({
      found: z.boolean(),
      frame: Rect.nullable(),
      ref: z.string().nullable(),
      method: z.enum(['focused', 'ax_search', 'ocr_placeholder']).nullable(),
    }),
  },
  /**
   * Write text into a field without sending it. `auto` picks Accessibility insertion for native
   * fields and ⌘V for Chrome/Electron, verifies the result, and restores the clipboard. Aborts
   * when the frontmost pid is no longer `expectPid`.
   */
  'input.write': {
    params: z.object({
      text: z.string(),
      mode: z.enum(['insert', 'replaceAll']),
      target: z.object({ ref: z.string().nullable(), point: Point.nullable() }).nullable(),
      method: z.enum(['auto', 'ax', 'paste']).default('auto'),
      expectPid: z.number().int().nullable(),
      restoreClipboard: z.boolean().default(true),
    }),
    result: z.object({
      ok: z.boolean(),
      method: z.enum(['ax', 'paste']).nullable(),
      verified: z.boolean(),
      reason: z.string().nullable(),
    }),
  },
  'input.click': { params: Point, result: z.object({ ok: z.boolean() }) },
  /** e.g. "cmd+a", "escape", "enter" — keycodes resolved for the current keyboard layout. */
  'input.key': { params: z.object({ combo: z.string() }), result: z.object({ ok: z.boolean() }) },
  /** Hand focus back to an app (after typing in one of Dumbledore's panels). */
  'app.activate': {
    params: z.object({ pid: z.number().int() }),
    result: z.object({ ok: z.boolean() }),
  },
  'system.idle': { params: Empty, result: z.object({ seconds: z.number() }) },
  'system.displays': { params: Empty, result: z.object({ displays: z.array(Display) }) },
  /** Configure the trigger key gestures. The helper polls modifier state (no Input Monitoring). */
  'shortcut.configure': {
    params: z.object({
      key: TriggerKey,
      tapMaxMs: z.number().int(),
      holdMinMs: z.number().int(),
      doubleTapMs: z.number().int(),
      enabled: z.boolean(),
    }),
    result: z.object({ ok: z.boolean() }),
  },
  'llm.onDevice.status': {
    params: Empty,
    result: z.object({
      available: z.boolean(),
      reason: z.string().nullable(), // deviceNotEligible | appleIntelligenceNotEnabled | modelNotReady | …
      contextSize: z.number().int().nullable(),
    }),
  },
  /** Apple's on-device model with schema-guided output. `schema` is a JSON Schema object. */
  'llm.onDevice.generate': {
    params: z.object({
      instructions: z.string(),
      prompt: z.string(),
      schema: z.record(z.string(), z.unknown()),
      maxTokens: z.number().int().nullable(),
      temperature: z.number().nullable(),
    }),
    result: z.object({
      json: z.unknown(),
      tokensIn: z.number().int().nullable(),
      tokensOut: z.number().int().nullable(),
    }),
  },
} as const

export const helperEvents = {
  'focus.changed': z.object({ app: AppRef.nullable(), element: FocusedElement.nullable() }),
  'app.activated': AppRef,
  'key.trigger': z.object({ gesture: Gesture, key: TriggerKey, secureInput: z.boolean() }),
  'screen.locked': Empty,
  'screen.unlocked': Empty,
  'display.changed': z.object({ displays: z.array(Display) }),
  'helper.log': z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
  }),
} as const

export type HelperMethod = keyof typeof helperMethods
export type HelperParams<M extends HelperMethod> = z.input<(typeof helperMethods)[M]['params']>
export type HelperResult<M extends HelperMethod> = z.output<(typeof helperMethods)[M]['result']>
export type HelperEvent = keyof typeof helperEvents
export type HelperEventPayload<E extends HelperEvent> = z.output<(typeof helperEvents)[E]>
