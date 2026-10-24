/**
 * Mock chat server (node:http, default 127.0.0.1:5199) for E2E checks of writing into a chat box.
 * Run it with `npx tsx tools/mock-chat/serve.ts`; tests call startMockChat({ port: 0 }).
 *
 *   GET  /          the ChatGPT look-alike page (./page.ts)
 *   GET  /state     { input, messages, sends, inputUpdates, pageConnected, closed }
 *   POST /api/reset clears messages and the composer
 *   POST /api/focus asks the page to focus its composer
 *   POST /api/close asks the page to close its window (window.close() works for a window that was
 *                   opened directly on this URL)
 * The page itself uses POST /api/input (on every composer change), POST /api/send, POST
 * /api/closed and GET /api/command. Sending appends the user message and a canned assistant
 * answer. Binds to localhost only.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MOCK_CHAT_HTML } from './page'

export const MOCK_CHAT_PORT = 5199

export interface MockChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface MockChatState {
  /** Text of the composer as the page last reported it. */
  input: string
  messages: MockChatMessage[]
  sends: number
  /** How many composer reports the page has made (changes only). */
  inputUpdates: number
  /** The page polled within the last 2 s. */
  pageConnected: boolean
  /** The page acknowledged a close request. */
  closed: boolean
}

export type MockChatCommand = 'close' | 'clear' | 'reset' | 'focus'

export interface MockChatServer {
  readonly url: string
  readonly port: number
  state(): MockChatState
  reset(): void
  requestFocus(): void
  requestClose(): void
  close(): Promise<void>
}

const ANSWERS = [
  'Good question. In short: break the idea into its parts, explain each one in plain words, and check yourself with a quick example.\n\nTry restating it in your own words, then ask me for a practice question.',
  'Here is a compact explanation. Start from the definition, look at why it matters, and finish with one worked example.\n\nWant a three-question quiz on this?',
  'Think of it as a process with inputs, a transformation and outputs. Name each of the three, then connect them.\n\nShall we go one level deeper?',
]

export function cannedAnswer(question: string, index: number): string {
  const topic = question.replace(/\s+/g, ' ').trim().slice(0, 60)
  return `You asked: “${topic}”. ${ANSWERS[index % ANSWERS.length]}`
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1_000_000) break
  }
  try {
    const parsed: unknown = JSON.parse(body || '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const text = type === 'application/json' ? JSON.stringify(body) : String(body)
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' })
  res.end(text)
}

export async function startMockChat(
  opts: { port?: number; host?: string } = {},
): Promise<MockChatServer> {
  const host = opts.host ?? '127.0.0.1'
  let input = ''
  let inputUpdates = 0
  let messages: MockChatMessage[] = []
  let sends = 0
  let lastPoll = 0
  let closed = false
  const commands: MockChatCommand[] = []

  const snapshot = (): MockChatState => ({
    input,
    messages: messages.map((m) => ({ ...m })),
    sends,
    inputUpdates,
    pageConnected: Date.now() - lastPoll < 2000,
    closed,
  })
  const push = (command: MockChatCommand): void => {
    if (commands.length < 20) commands.push(command)
  }
  const reset = (): void => {
    messages = []
    input = ''
    sends = 0
    push('reset')
  }

  const server = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    try {
      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        commands.length = 0 // a freshly loaded page must not act on stale commands
        return send(res, 200, MOCK_CHAT_HTML, 'text/html')
      }
      if (req.method === 'GET' && path === '/state') return send(res, 200, snapshot())
      if (req.method === 'GET' && path === '/api/command') {
        lastPoll = Date.now()
        return send(res, 200, { command: commands.shift() ?? null })
      }
      if (req.method === 'POST' && path === '/api/input') {
        const body = await readJson(req)
        input = typeof body.text === 'string' ? body.text : ''
        inputUpdates++
        return send(res, 200, { ok: true })
      }
      if (req.method === 'POST' && path === '/api/send') {
        const body = await readJson(req)
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (text) {
          messages.push(
            { role: 'user', text },
            { role: 'assistant', text: cannedAnswer(text, sends) },
          )
          sends++
          input = ''
        }
        return send(res, 200, snapshot())
      }
      if (req.method === 'POST' && path === '/api/reset') {
        reset()
        return send(res, 200, snapshot())
      }
      if (req.method === 'POST' && (path === '/api/close' || path === '/api/focus')) {
        push(path === '/api/close' ? 'close' : 'focus')
        return send(res, 200, { ok: true })
      }
      if (req.method === 'POST' && path === '/api/closed') {
        closed = true
        return send(res, 200, { ok: true })
      }
      return send(res, 404, { error: 'not found' })
    } catch (error) {
      return send(res, 500, { error: String(error) })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? MOCK_CHAT_PORT, host, () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://${host}:${port}`,
    port,
    state: snapshot,
    reset,
    requestFocus: () => push('focus'),
    requestClose: () => push('close'),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
