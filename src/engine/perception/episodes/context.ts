/**
 * Text handed to prompt writing (PerceptionService.chatExcerpt / pageContext): the visible AI chat
 * with roles tagged where the layout shows them, and the page the student is reading, centred on
 * what is on screen. Both are already masked at capture.
 */
import type { EpisodeEnv, OpenEpisode } from './open-episode'

const BLOCK_SEP = '\n\n'

/** The chat transcript, newest last, trimmed from the start to fit `maxChars`. */
export function chatExcerptOf(
  ep: OpenEpisode | null,
  env: EpisodeEnv,
  assistantName: string | null,
  maxChars: number,
): string {
  if (!ep || maxChars <= 0) return ''
  const groups: { role: 'student' | 'assistant' | null; lines: string[] }[] = []
  for (const line of ep.contentLines(env, false)) {
    const role = ep.userAlign ? (line.align === ep.userAlign ? 'student' : 'assistant') : null
    const last = groups.at(-1)
    if (last && last.role === role) last.lines.push(line.text)
    else groups.push({ role, lines: [line.text] })
  }
  const name = assistantName ?? 'Assistant'
  const blocks = groups.map((g) => {
    const body = g.lines.join('\n')
    if (g.role === 'student') return `Student: ${body}`
    if (g.role === 'assistant') return `${name}: ${body}`
    return body
  })
  return tailWithin(blocks, maxChars)
}

/** "Title — url" plus the page text starting at what is on screen, within `maxChars`. */
export function pageContextOf(ep: OpenEpisode | null, env: EpisodeEnv, maxChars: number): string {
  if (!ep || maxChars <= 0) return ''
  const header = [ep.title, ep.url ?? ep.app].filter(Boolean).join(' — ')
  const lines = ep.contentLines(env, false).map((l) => ({ key: l.key, text: l.text }))
  const viewport = new Set(ep.viewport)
  const first = lines.findIndex((l) => viewport.has(l.key))
  const start = first === -1 ? 0 : first
  let budget = maxChars - header.length - 1
  const after: string[] = []
  for (let i = start; i < lines.length && budget > 0; i++) {
    const text = (lines[i] as { text: string }).text
    if (text.length + 1 > budget) break
    after.push(text)
    budget -= text.length + 1
  }
  const before: string[] = []
  for (let i = start - 1; i >= 0 && budget > 0; i--) {
    const text = (lines[i] as { text: string }).text
    if (text.length + 1 > budget) break
    before.unshift(text)
    budget -= text.length + 1
  }
  const body = [...before, ...after].join('\n')
  return `${header}\n${body}`.slice(0, maxChars).trim()
}

function tailWithin(blocks: readonly string[], maxChars: number): string {
  const out: string[] = []
  let total = 0
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i] as string
    const sep = out.length > 0 ? BLOCK_SEP.length : 0
    if (total + block.length + sep > maxChars) {
      const room = maxChars - total - sep - 1
      if (room > 40) out.unshift(`…${block.slice(block.length - room)}`)
      break
    }
    out.unshift(block)
    total += block.length + sep
  }
  return out.join(BLOCK_SEP)
}
