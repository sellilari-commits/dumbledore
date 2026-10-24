/**
 * Newline-delimited JSON-RPC framing for the helper socket (pure: no I/O).
 *
 * `LineBuffer` turns arbitrary string chunks into complete lines; `classify` sorts a parsed line
 * into a response (has an id) or a notification (has a method). Anything else is `invalid`.
 */

export class LineBuffer {
  private pending = ''

  constructor(private readonly maxLineBytes = 16 * 1024 * 1024) {}

  /** Appends a chunk and returns the complete lines it finished (without the newline). */
  push(chunk: string): string[] {
    this.pending += chunk
    const lines: string[] = []
    let start = 0
    for (;;) {
      const nl = this.pending.indexOf('\n', start)
      if (nl < 0) break
      let line = this.pending.slice(start, nl)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line.length > 0) lines.push(line)
      start = nl + 1
    }
    this.pending = this.pending.slice(start)
    if (this.pending.length > this.maxLineBytes) {
      this.pending = ''
      throw new Error('helper sent a line longer than the limit')
    }
    return lines
  }

  reset(): void {
    this.pending = ''
  }
}

export type RpcId = number | string | null

export type Incoming =
  | { kind: 'response'; id: RpcId; result: unknown }
  | { kind: 'error'; id: RpcId; code: number; message: string; data: unknown }
  | { kind: 'notification'; method: string; params: unknown }
  | { kind: 'invalid'; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function classify(line: string): Incoming {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return { kind: 'invalid', reason: 'not JSON' }
  }
  if (!isRecord(parsed) || parsed.jsonrpc !== '2.0')
    return { kind: 'invalid', reason: 'not JSON-RPC 2.0' }
  if ('id' in parsed) {
    const id = parsed.id
    if (typeof id !== 'number' && typeof id !== 'string' && id !== null) {
      return { kind: 'invalid', reason: 'bad id' }
    }
    if (isRecord(parsed.error)) {
      const { code, message, data } = parsed.error
      return {
        kind: 'error',
        id,
        code: typeof code === 'number' ? code : -32603,
        message: typeof message === 'string' ? message : 'helper error',
        data: data ?? null,
      }
    }
    if ('result' in parsed) return { kind: 'response', id, result: parsed.result }
    return { kind: 'invalid', reason: 'response without result or error' }
  }
  if (typeof parsed.method === 'string') {
    return { kind: 'notification', method: parsed.method, params: parsed.params ?? {} }
  }
  return { kind: 'invalid', reason: 'neither response nor notification' }
}

export function encodeRequest(id: number, method: string, params: unknown): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
}
