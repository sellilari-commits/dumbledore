import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createKeyGetter, parseDotenv } from './keys'

let dir: string | null = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('parseDotenv', () => {
  it('handles comments, quotes, export and inline comments', () => {
    const env = parseDotenv(
      '# comment\nGROQ_API_KEY=gsk_abc\nexport MISTRAL_API_KEY="m 1"\nOVH_AI_ENDPOINTS_TOKEN= tok # note\nEMPTY=\n',
    )
    expect(env).toEqual({
      GROQ_API_KEY: 'gsk_abc',
      MISTRAL_API_KEY: 'm 1',
      OVH_AI_ENDPOINTS_TOKEN: 'tok',
      EMPTY: '',
    })
  })
})

describe('createKeyGetter', () => {
  it('prefers the environment, falls back to the file and ignores blanks', () => {
    dir = mkdtempSync(join(tmpdir(), 'keys-'))
    const file = join(dir, '.env.local')
    writeFileSync(file, 'GROQ_API_KEY=from-file\nMISTRAL_API_KEY=\n')
    const get = createKeyGetter({ env: { GROQ_API_KEY: 'from-env' }, envFile: file })
    expect(get('GROQ_API_KEY')).toBe('from-env')
    expect(get('MISTRAL_API_KEY')).toBeUndefined()
    const fileOnly = createKeyGetter({ env: {}, envFile: file })
    expect(fileOnly('GROQ_API_KEY')).toBe('from-file')
  })

  it('picks up a key added to the file later', () => {
    dir = mkdtempSync(join(tmpdir(), 'keys-'))
    const file = join(dir, '.env.local')
    const get = createKeyGetter({ env: {}, envFile: file })
    expect(get('GROQ_API_KEY')).toBeUndefined() // file missing
    writeFileSync(file, 'GROQ_API_KEY=new\n')
    const later = new Date(Date.now() + 5000)
    utimesSync(file, later, later)
    expect(get('GROQ_API_KEY')).toBe('new')
  })

  it('can disable the file', () => {
    expect(createKeyGetter({ env: {}, envFile: null })('GROQ_API_KEY')).toBeUndefined()
  })
})
