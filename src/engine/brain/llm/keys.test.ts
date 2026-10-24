import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createKeyGetter, parseDotenv, parseFileList } from './keys'

let dir: string | null = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

const tempDir = () => {
  dir = mkdtempSync(join(tmpdir(), 'keys-'))
  return dir
}

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

  it('keeps only the allowed names when filtering', () => {
    const env = parseDotenv(
      'DATABASE_URL=postgres://x\nGEMINI_API_KEY="g-1"\nSECRET=s\n',
      new Set(['GEMINI_API_KEY']),
    )
    expect(env).toEqual({ GEMINI_API_KEY: 'g-1' })
  })
})

describe('parseFileList', () => {
  it('splits on commas, expands ~ and resolves relative paths', () => {
    expect(parseFileList(' /a/.env , ~/b.env,c.env,, ', '/base')).toEqual([
      '/a/.env',
      join(homedir(), 'b.env'),
      '/base/c.env',
    ])
    expect(parseFileList(undefined, '/base')).toEqual([])
  })
})

describe('createKeyGetter', () => {
  it('prefers the environment, falls back to the file and ignores blanks', () => {
    const file = join(tempDir(), '.env.local')
    writeFileSync(file, 'GROQ_API_KEY=from-file\nMISTRAL_API_KEY=\n')
    const get = createKeyGetter({ env: { GROQ_API_KEY: 'from-env' }, envFile: file })
    expect(get('GROQ_API_KEY')).toBe('from-env')
    expect(get('MISTRAL_API_KEY')).toBeUndefined()
    const fileOnly = createKeyGetter({ env: {}, envFile: file })
    expect(fileOnly('GROQ_API_KEY')).toBe('from-file')
  })

  it('picks up a key added to the file later', () => {
    const file = join(tempDir(), '.env.local')
    const get = createKeyGetter({ env: {}, envFile: file })
    expect(get('GROQ_API_KEY')).toBeUndefined() // file missing
    writeFileSync(file, 'GROQ_API_KEY=new\n')
    const later = new Date(Date.now() + 5000)
    utimesSync(file, later, later)
    expect(get('GROQ_API_KEY')).toBe('new')
  })

  it('can disable the file', () => {
    expect(
      createKeyGetter({ env: {}, envFile: null, envFiles: null })('GROQ_API_KEY'),
    ).toBeUndefined()
  })

  it('reads DUMBLEDORE_ENV_FILES named in .env.local, importing only the known keys', () => {
    const d = tempDir()
    const hugo = join(d, 'hugo.env')
    const other = join(d, 'other.env')
    writeFileSync(
      hugo,
      'DATABASE_URL=postgres://secret\nGEMINI_API_KEY=g-from-hugo\nAWS_SECRET=x\n',
    )
    writeFileSync(other, 'GROQ_API_KEY=gsk-other\nGEMINI_API_KEY=g-second\n')
    const local = join(d, '.env.local')
    writeFileSync(local, `DUMBLEDORE_ENV_FILES=${hugo}, other.env\nMISTRAL_API_KEY=m-local\n`)
    const get = createKeyGetter({ env: {}, envFile: local, cwd: d })
    expect(get('GEMINI_API_KEY')).toBe('g-from-hugo') // first file wins
    expect(get('GROQ_API_KEY')).toBe('gsk-other') // relative path resolved against cwd
    expect(get('MISTRAL_API_KEY')).toBe('m-local') // .env.local before the extra files
    expect(get('OVH_AI_ENDPOINTS_TOKEN')).toBeUndefined()
    // Unknown names are never served, even if a caller asks for one.
    expect(get('DATABASE_URL' as never)).toBeUndefined()
  })

  it('takes DUMBLEDORE_ENV_FILES from the environment and lets env keys win', () => {
    const d = tempDir()
    const keys = join(d, 'keys.env')
    writeFileSync(keys, 'GEMINI_API_KEY=g-file\nGROQ_API_KEY=gsk-file\n')
    const get = createKeyGetter({
      env: { DUMBLEDORE_ENV_FILES: keys, GROQ_API_KEY: 'gsk-env' },
      envFile: null,
    })
    expect(get('GEMINI_API_KEY')).toBe('g-file')
    expect(get('GROQ_API_KEY')).toBe('gsk-env')
  })

  it('tolerates missing extra files and picks them up once they exist', () => {
    const d = tempDir()
    const later = join(d, 'later.env')
    const get = createKeyGetter({ env: {}, envFile: null, envFiles: [later] })
    expect(get('GEMINI_API_KEY')).toBeUndefined()
    writeFileSync(later, 'GEMINI_API_KEY=g-late\n')
    expect(get('GEMINI_API_KEY')).toBe('g-late')
  })
})
