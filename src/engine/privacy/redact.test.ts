import { describe, expect, it } from 'vitest'
import { ibanChecksumValid, luhnValid } from './checksums'
import { redact, redactDetailed } from './redact'

describe('checksums', () => {
  it('validates Luhn numbers', () => {
    expect(luhnValid('4111111111111111')).toBe(true)
    expect(luhnValid('4111111111111112')).toBe(false)
    expect(luhnValid('5555555555554444')).toBe(true)
  })

  it('validates IBANs with mod 97', () => {
    expect(ibanChecksumValid('FI21 1234 5600 0007 85')).toBe(true)
    expect(ibanChecksumValid('GB82 WEST 1234 5698 7654 32')).toBe(true)
    expect(ibanChecksumValid('FI21 1234 5600 0007 86')).toBe(false)
  })
})

describe('redact', () => {
  it('masks e-mail addresses', () => {
    expect(redact('Mail me at maija.meikalainen@aalto.fi today')).toBe('Mail me at [email] today')
  })

  it('masks phone numbers in common formats', () => {
    expect(redact('Call +358 40 123 4567 now')).toBe('Call [phone] now')
    expect(redact('Soita 040 123 4567')).toBe('Soita [phone]')
    expect(redact('US: (555) 123-4567 or 555.123.4567')).toBe('US: [phone] or [phone]')
  })

  it('leaves dates, times, years, decimals and small numbers alone', () => {
    const text =
      'Due 05.11.2026 klo 23:59. In 1905 Einstein wrote E = mc^2; pi ≈ 3.14159265358979, n = 42, ISBN 0-306-40615-2'
    expect(redact(text)).toBe(text)
  })

  it('masks IBANs, also when an OCR error breaks the checksum', () => {
    expect(redact('IBAN: FI21 1234 5600 0007 85.')).toBe('IBAN: [iban].')
    expect(redact('Tilinumero FI21 1234 5600 0007 86')).toBe('Tilinumero [iban]')
    expect(redact('GB82WEST12345698765432')).toBe('[iban]')
  })

  it('masks Luhn-valid card numbers but not other 16-digit groups', () => {
    expect(redact('Card 4111 1111 1111 1111 exp 12/29')).toBe('Card [card] exp 12/29')
    expect(redact('5555-5555-5555-4444')).toBe('[card]')
    // not Luhn-valid → caught as a long digit run instead
    expect(redact('ref 4111111111111112')).toBe('ref [number]')
  })

  it('masks national identity numbers', () => {
    expect(redact('Hetu 131052-308T')).toBe('Hetu [id]')
    expect(redact('Hetu 010594Y9032')).toBe('Hetu [id]')
    expect(redact('personnummer 19811218-9876')).toBe('personnummer [id]')
    expect(redact('SSN 078-05-1120')).toBe('SSN [id]')
  })

  it('masks long digit runs', () => {
    expect(redact('Account 12345678901 closed')).toBe('Account [number] closed')
  })

  it('masks key=value secrets but keeps the key name', () => {
    expect(redact('password=hunter2!')).toBe('password=[secret]')
    expect(redact('API_KEY: "abcd1234efgh"')).toBe('API_KEY: "[secret]"')
    expect(redact('salasana: Kissa123')).toBe('salasana: [secret]')
    expect(redact("client_secret='s3cr3tvalue'")).toBe("client_secret='[secret]'")
  })

  it('masks well-known token formats', () => {
    const cases = [
      'sk-proj-abcdefghijklmnopqrstuvwx123456',
      'sk-ant-api03-abcdefghijklmnopqrstuv',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'github_pat_11ABCDEFG0abcdefghijklmnop',
      'gsk_abcdefghijklmnopqrstuvwxyz01',
      'AKIAIOSFODNN7EXAMPLE',
      'AIzaSyA-abcdefghijklmnopqrstuvwxyz012345',
      'xoxb-1234567890-abcdefghij',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    ]
    for (const token of cases) expect(redact(`key ${token} end`)).toBe('key [secret] end')
  })

  it('masks Bearer tokens, URL credentials and private keys', () => {
    expect(redact('Authorization: Bearer abc.def.ghi-123456')).toBe(
      'Authorization: Bearer [secret]',
    )
    expect(redact('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: Basic [secret]')
    expect(redact('git clone https://ilari:t0ken@github.com/x/y')).toBe(
      'git clone https://[secret]@github.com/x/y',
    )
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----'
    expect(redact(`before\n${pem}\nafter`)).toBe('before\n[secret]\nafter')
  })

  it('does not mangle ordinary study text', () => {
    const text = [
      'The SN1 reaction is a substitution reaction; rate = k[R–X].',
      'Authorization: the process of granting permissions to a user.',
      'A token is the smallest unit a lexer produces.',
      'Basic understanding of calculus is assumed.',
      'Tertiary carbocations are more stable than secondary ones (hyperconjugation).',
    ].join('\n')
    expect(redact(text)).toBe(text)
  })

  it('is idempotent and counts what it masked', () => {
    const once = redactDetailed('a@b.fi, +358 40 123 4567, password=abcd1234')
    expect(once.counts).toMatchObject({ email: 1, phone: 1, secret: 1 })
    expect(redact(once.text)).toBe(once.text)
  })
})
