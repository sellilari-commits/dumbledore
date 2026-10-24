import type { AiChatInfo } from '@engine/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeHelperClient } from '../fakes/fake-helper'
import type { ToastSpec } from '../overlay/toasts'
import { CHATGPT, chatInput, FakePlatform, NOTES } from '../testing/harness'
import { ChatWriter, sameField, snapshotOf } from './chat-writer'
import { FocusKeeper } from './focus-keeper'

const CHAT: AiChatInfo = {
  key: 'chatgpt',
  assistant: 'ChatGPT',
  pid: CHATGPT.pid,
  bundleId: CHATGPT.bundleId,
  url: CHATGPT.url,
  windowTitle: CHATGPT.windowTitle,
}

function setup() {
  const helper = new FakeHelperClient()
  const platform = new FakePlatform()
  const toasts: ToastSpec[] = []
  const focus = new FocusKeeper(helper, platform)
  let chat: AiChatInfo | null = CHAT
  const writer = new ChatWriter({
    helper,
    focus,
    platform,
    perception: { aiChat: () => chat },
    notify: (t) => void toasts.push(t),
  })
  helper.state.apps.set(NOTES.pid, NOTES)
  helper.activateApp(CHATGPT)
  helper.state.focused = chatInput()
  helper.state.fieldValue = ''
  helper.state.writeResult = { ok: true, method: 'paste', verified: true, reason: null }
  return { helper, platform, toasts, focus, writer, setChat: (c: AiChatInfo | null) => (chat = c) }
}

describe('ChatWriter', () => {
  let t: ReturnType<typeof setup>
  beforeEach(async () => {
    t = setup()
    await t.helper.start()
  })

  it('finds the chat input and writes with expectPid, without touching the clipboard', async () => {
    const out = await t.writer.write({ text: 'Explain SN1', mode: 'insert', target: 'chat' })
    expect(out).toEqual({ ok: true, method: 'paste', reason: null })
    expect(t.helper.state.fieldValue).toBe('Explain SN1')
    const find = t.helper.callsTo('ax.findChatInput')[0] as { pid: number; placeholders: string[] }
    expect(find.pid).toBe(CHATGPT.pid)
    expect(find.placeholders).toContain('ask anything')
    const write = t.helper.callsTo('input.write')[0] as Record<string, unknown>
    expect(write).toMatchObject({ expectPid: CHATGPT.pid, mode: 'insert', restoreClipboard: true })
    expect(write.target).toEqual({ ref: 'ax-chatgpt-input', point: { x: 750, y: 848 } })
    expect(t.platform.clipboard).toBeNull()
    expect(t.platform.hides).toBe(0)
  })

  it('hands focus back first when Dumbledore is the active app', async () => {
    t.platform.active = true
    t.helper.state.frontmost = { ...CHATGPT, pid: 999, bundleId: 'org.stuhi.dumbledore' }
    const out = await t.writer.write({ text: 'Next step', mode: 'insert', target: 'chat' })
    expect(out.ok).toBe(true)
    expect(t.platform.hides).toBe(1)
    expect(t.platform.restores).toBe(1)
    expect(t.helper.callsTo('app.activate')).toEqual([{ pid: CHATGPT.pid }])
    expect(t.helper.state.frontmost?.pid).toBe(CHATGPT.pid)
  })

  it('copies with a "Copied — press ⌘V" toast when focus cannot be handed back', async () => {
    t.platform.active = true
    t.helper.respond('app.activate', () => ({ ok: false }))
    t.helper.state.frontmost = NOTES
    const out = await t.writer.write({ text: 'Next step', mode: 'insert', target: 'chat' })
    expect(out).toMatchObject({ ok: false, method: 'clipboard' })
    expect(t.platform.clipboard).toBe('Next step')
    expect(t.toasts[0]?.title).toBe('Copied — press ⌘V')
    expect(t.helper.callsTo('input.write')).toHaveLength(0)
  })

  it('writes nothing when the user switched apps meanwhile', async () => {
    const expect_ = snapshotOf(chatInput())
    t.helper.activateApp(NOTES)
    const out = await t.writer.write({
      text: 'Improved prompt',
      mode: 'replaceAll',
      target: 'focused',
      expect: expect_,
    })
    expect(out.ok).toBe(false)
    expect(out.method).toBeNull()
    expect(t.helper.callsTo('input.write')).toHaveLength(0)
    expect(t.platform.clipboard).toBeNull()
    expect(t.toasts[0]?.title).toBe('Nothing written')
    await t.toasts[0]?.actions?.[0]?.run?.()
    expect(t.platform.clipboard).toBe('Improved prompt')
  })

  it('writes nothing when the focused field changed meanwhile', async () => {
    const expect_ = snapshotOf(chatInput())
    t.helper.state.focused = { ...chatInput(), ref: 'ax-other-field', role: 'AXTextField' }
    const out = await t.writer.write({
      text: 'x',
      mode: 'insert',
      target: 'focused',
      expect: expect_,
    })
    expect(out.reason).toBe('The text field changed')
    expect(t.helper.callsTo('input.write')).toHaveLength(0)
  })

  it('replaces the focused field for improve, targeting the snapshot ref', async () => {
    t.helper.state.fieldValue = 'what is osmosis'
    const out = await t.writer.write({
      text: 'Better prompt',
      mode: 'replaceAll',
      target: 'focused',
      expect: snapshotOf(chatInput('what is osmosis')),
    })
    expect(out.ok).toBe(true)
    expect(t.helper.state.fieldValue).toBe('Better prompt')
    expect(t.helper.callsTo('ax.findChatInput')).toHaveLength(0)
  })

  it('falls back to the clipboard when the chat input cannot be found', async () => {
    t.helper.state.focused = null
    const out = await t.writer.write({ text: 'Prompt', mode: 'insert', target: 'chat' })
    expect(out).toMatchObject({
      ok: false,
      method: 'clipboard',
      reason: 'Could not find the chat box',
    })
    expect(t.platform.clipboard).toBe('Prompt')
  })

  it('falls back to the clipboard when the helper cannot write', async () => {
    t.helper.state.writeResult = {
      ok: false,
      method: null,
      verified: false,
      reason: 'secure input',
    }
    const out = await t.writer.write({ text: 'Prompt', mode: 'insert', target: 'chat' })
    expect(out).toMatchObject({ ok: false, method: 'clipboard', reason: 'secure input' })
  })

  it('falls back to the clipboard when no chat is open', async () => {
    t.setChat(null)
    const out = await t.writer.write({ text: 'Prompt', mode: 'insert', target: 'chat' })
    expect(out.method).toBe('clipboard')
    expect(t.helper.callsTo('input.write')).toHaveLength(0)
  })

  it('stops before writing when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const out = await t.writer.write({
      text: 'x',
      mode: 'insert',
      target: 'chat',
      signal: controller.signal,
    })
    expect(out.reason).toBe('cancelled')
    expect(t.helper.calls).toHaveLength(0)
  })

  it('falls back when the helper is down', async () => {
    await t.helper.stop()
    const out = await t.writer.write({ text: 'Prompt', mode: 'insert', target: 'chat' })
    expect(out.method).toBe('clipboard')
  })
})

describe('FocusKeeper', () => {
  it('remembers the frontmost app but never Dumbledore itself', async () => {
    const t = setup()
    await t.helper.start()
    expect(await t.focus.remember()).toBe(CHATGPT.pid)
    t.helper.state.frontmost = { ...CHATGPT, pid: 999 }
    expect(await t.focus.remember()).toBe(CHATGPT.pid)
  })

  it('hands back to the remembered app and verifies it', async () => {
    const t = setup()
    await t.helper.start()
    await t.focus.remember()
    t.platform.active = true
    t.helper.state.frontmost = { ...CHATGPT, pid: 999 }
    expect(await t.focus.handBack()).toBe(true)
    expect(t.platform.hides).toBe(1)
    expect(t.helper.state.frontmost?.pid).toBe(CHATGPT.pid)
  })

  it('reports failure when the app never comes to the front', async () => {
    const t = setup()
    await t.helper.start()
    t.helper.respond('app.activate', () => ({ ok: true }))
    t.helper.state.frontmost = NOTES
    expect(await t.focus.handBack(CHATGPT.pid)).toBe(false)
  })
})

describe('sameField', () => {
  it('compares refs when both have one, else role and position', () => {
    const snap = snapshotOf(chatInput())
    expect(sameField(chatInput('typed'), snap)).toBe(true)
    expect(sameField({ ...chatInput(), ref: 'other' }, snap)).toBe(false)
    expect(sameField({ ...chatInput(), pid: 1 }, snap)).toBe(false)
    const noRef = { ...snap, ref: null }
    expect(sameField({ ...chatInput(), ref: null }, noRef)).toBe(true)
    expect(
      sameField({ ...chatInput(), ref: null, frame: { x: 0, y: 0, width: 1, height: 1 } }, noRef),
    ).toBe(false)
    expect(sameField(null, snap)).toBe(false)
  })
})
