import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DATA_DIR_ENV, defaultDataRoot, ensureDataDirs, resolveDataPaths } from './paths'

describe('data paths', () => {
  const made: string[] = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('defaults to ~/Library/Application Support/Dumbledore', () => {
    const p = resolveDataPaths({ home: '/Users/ann', env: {} })
    expect(p).toEqual({
      root: '/Users/ann/Library/Application Support/Dumbledore',
      dbFile: '/Users/ann/Library/Application Support/Dumbledore/dumbledore.db',
      memoryDir: '/Users/ann/Library/Application Support/Dumbledore/memory',
      runDir: '/Users/ann/Library/Application Support/Dumbledore/run',
      helperSocket: '/Users/ann/Library/Application Support/Dumbledore/run/helper.sock',
    })
    expect(defaultDataRoot('/h')).toBe('/h/Library/Application Support/Dumbledore')
  })

  it('takes an explicit root over the environment, and the environment over the default', () => {
    expect(resolveDataPaths({ root: '/tmp/x', env: { [DATA_DIR_ENV]: '/tmp/y' } }).dbFile).toBe(
      '/tmp/x/dumbledore.db',
    )
    expect(resolveDataPaths({ env: { [DATA_DIR_ENV]: '/tmp/y' } }).memoryDir).toBe('/tmp/y/memory')
  })

  it('creates the folders, with run/ private to the user', () => {
    const root = mkdtempSync(join(tmpdir(), 'dumbledore-paths-'))
    made.push(root)
    const p = ensureDataDirs(resolveDataPaths({ root: join(root, 'data') }))
    expect(statSync(p.memoryDir).isDirectory()).toBe(true)
    expect(statSync(p.runDir).mode & 0o777).toBe(0o700)
    expect(() => ensureDataDirs(p)).not.toThrow()
  })
})
