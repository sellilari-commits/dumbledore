import { describe, expect, it } from 'vitest'
import { classify, encodeRequest, LineBuffer } from './framing'

describe('LineBuffer', () => {
  it('splits chunks into complete lines', () => {
    const b = new LineBuffer()
    expect(b.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(b.push(':2}\n\n')).toEqual(['{"b":2}'])
    expect(b.push('x\r\ny')).toEqual(['x'])
    expect(b.push('\n')).toEqual(['y'])
  })

  it('throws and recovers when a line is too long', () => {
    const b = new LineBuffer(8)
    expect(() => b.push('0123456789')).toThrow()
    expect(b.push('ok\n')).toEqual(['ok'])
  })
})

describe('classify', () => {
  it('recognises responses, errors and notifications', () => {
    expect(classify('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')).toEqual({
      kind: 'response',
      id: 1,
      result: { ok: true },
    })
    expect(classify('{"jsonrpc":"2.0","id":2,"error":{"code":-32004,"message":"secure"}}')).toEqual(
      {
        kind: 'error',
        id: 2,
        code: -32004,
        message: 'secure',
        data: null,
      },
    )
    expect(classify('{"jsonrpc":"2.0","method":"screen.locked","params":{}}')).toEqual({
      kind: 'notification',
      method: 'screen.locked',
      params: {},
    })
    expect(classify('{"jsonrpc":"2.0","id":3,"result":null}')).toEqual({
      kind: 'response',
      id: 3,
      result: null,
    })
  })

  it('rejects anything else', () => {
    expect(classify('nope').kind).toBe('invalid')
    expect(classify('[1]').kind).toBe('invalid')
    expect(classify('{"id":1,"result":1}').kind).toBe('invalid')
    expect(classify('{"jsonrpc":"2.0","id":{},"result":1}').kind).toBe('invalid')
    expect(classify('{"jsonrpc":"2.0","id":1}').kind).toBe('invalid')
  })

  it('encodes one request per line', () => {
    expect(encodeRequest(7, 'ping', {})).toBe(
      '{"jsonrpc":"2.0","id":7,"method":"ping","params":{}}\n',
    )
  })
})
