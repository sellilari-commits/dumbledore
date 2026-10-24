/**
 * Study material: files the student adds to a subject (PDF, Word, RTF, HTML, text, Markdown).
 * Each file is read to text (PDFKit in the helper for PDFs, macOS textutil for documents, as-is
 * for text), cut into page-sized parts and sent through the normal extraction (P1) as if the
 * student had read them, with only this subject on offer — so the topics and notes land in its
 * memory exactly like captured pages. Nothing here edits extraction; it only feeds it.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { promisify } from 'node:util'
import type { Brain, ExtractInput, ExtractOutput } from '@engine/brain-contract'
import type { Clock } from '@engine/clock'
import type { HelperClient, Repos } from '@engine/contracts'
import { newId } from '@engine/ids'
import { applyExtraction, PromptMemory } from '@engine/perception/extraction/apply'
import { conceptTree } from '@engine/perception/extraction/worker'
import { redact } from '@engine/privacy/redact'
import type { Episode } from '@shared/domain'
import type { MaterialResult } from '@shared/ipc'

const run = promisify(execFile)

/** About two pages of text per part; a file is read up to MAX_PARTS parts (~30 pages). */
export const PART_CHARS = 6000
export const MAX_PARTS = 10
/** Parts sent per extraction call. */
const PER_CALL = 2
const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv'])
const DOC_EXT = new Set(['.doc', '.docx', '.rtf', '.rtfd', '.html', '.htm', '.odt', '.webarchive'])
export const MATERIAL_EXTENSIONS = ['pdf', ...[...TEXT_EXT, ...DOC_EXT].map((e) => e.slice(1))]

export interface MaterialsDeps {
  repos: Repos
  brain: Brain
  clock: Clock
  helper: HelperClient
  /** Tells the windows that this subject's memory changed. */
  changed: (subjectId: string) => void
  /** Reads a non-PDF file to text; tests swap it. */
  readDocument?: (path: string) => Promise<string>
}

async function readDocument(path: string): Promise<string> {
  const ext = extname(path).toLowerCase()
  if (TEXT_EXT.has(ext)) return readFile(path, 'utf8')
  if (DOC_EXT.has(ext)) {
    const { stdout } = await run('/usr/bin/textutil', ['-convert', 'txt', '-stdout', path], {
      maxBuffer: 32 * 1024 * 1024,
    })
    return stdout
  }
  throw new Error('That file type isn’t supported yet. Use PDF, Word, RTF, HTML, text or Markdown.')
}

/** Cuts text into parts at paragraph breaks, each at most PART_CHARS. */
export function splitParts(text: string, max = PART_CHARS, limit = MAX_PARTS): string[] {
  const parts: string[] = []
  let current = ''
  for (const para of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const p = para.trim()
    if (!p) continue
    if (current && current.length + p.length + 2 > max) {
      parts.push(current)
      current = ''
      if (parts.length === limit) return parts
    }
    current = current ? `${current}\n\n${p}` : p.slice(0, max)
  }
  if (current && parts.length < limit) parts.push(current)
  return parts
}

export class MaterialsFlow {
  constructor(private readonly deps: MaterialsDeps) {}

  async add(subjectId: string, paths: readonly string[]): Promise<MaterialResult[]> {
    const out: MaterialResult[] = []
    for (const path of paths) out.push(await this.addOne(subjectId, path))
    if (out.some((r) => r.ok)) this.deps.changed(subjectId)
    return out
  }

  private async read(path: string): Promise<{ text: string; truncated: boolean }> {
    if (extname(path).toLowerCase() === '.pdf') {
      const r = await this.deps.helper.call('file.pdfText', {
        path,
        maxChars: PART_CHARS * MAX_PARTS,
      })
      return { text: r.text, truncated: r.truncated }
    }
    const text = await (this.deps.readDocument ?? readDocument)(path)
    return { text, truncated: text.length > PART_CHARS * MAX_PARTS }
  }

  private async addOne(subjectId: string, path: string): Promise<MaterialResult> {
    const name = basename(path)
    const fail = (error: string): MaterialResult => ({
      name,
      ok: false,
      notes: 0,
      truncated: false,
      error,
    })
    const { repos } = this.deps
    const subject = repos.subjects.get(subjectId)
    if (!subject) return fail('That subject no longer exists.')
    let read: { text: string; truncated: boolean }
    try {
      read = await this.read(path)
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
    const parts = splitParts(read.text)
    if (parts.length === 0)
      return fail('No text found. A scanned PDF needs text recognition, which isn’t supported yet.')

    const now = this.deps.clock.nowIso()
    const episodes: Episode[] = parts.map((text, i) => ({
      id: newId('epi'),
      bundleId: 'dumbledore.material',
      app: 'Study material',
      title: parts.length > 1 ? `${name} (part ${i + 1} of ${parts.length})` : name,
      url: null,
      kind: 'reading',
      aiProvider: null,
      startedAt: now,
      endedAt: now,
      dwellSeconds: 600,
      text,
      source: 'ax',
      signals: {
        readingWpm: null,
        baselineWpm: null,
        scrollBacks: 0,
        revisitsToday: 0,
        searches: [],
        aiQuestions: [],
        highlights: [],
      },
      extracted: false,
    }))

    let notes = 0
    try {
      for (let i = 0; i < episodes.length; i += PER_CALL) {
        const batch = episodes.slice(i, i + PER_CALL)
        const output = forSubject(
          await this.deps.brain.extract(this.input(subjectId, batch)),
          subjectId,
        )
        const outcome = applyExtraction(output, batch, repos, {
          prompts: new PromptMemory(),
          nowIso: this.deps.clock.nowIso(),
        })
        notes += outcome.noteIds.length
      }
    } catch (err) {
      if (notes === 0) return fail(err instanceof Error ? err.message : String(err))
    }
    return { name, ok: true, notes, truncated: read.truncated, error: null }
  }

  private input(subjectId: string, episodes: readonly Episode[]): ExtractInput {
    const { repos } = this.deps
    const subject = repos.subjects.get(subjectId)
    const all = repos.concepts.listBySubject(subjectId)
    const tree = conceptTree(repos, subjectId, all, 60)
    const profile = repos.profile.get()
    const mask = repos.settings.get().privacy.redact
    return {
      student: { aboutMe: profile.aboutMe, language: profile.promptLanguage },
      subjects: [
        {
          id: subjectId,
          name: subject?.name ?? '',
          topConcepts: all.slice(0, 6).map((c) => c.name),
          ...(tree.length ? { concepts: tree } : {}),
        },
      ],
      episodes: episodes.map((e) => ({
        id: e.id,
        app: e.app,
        url: e.url,
        title: e.title,
        kind: e.kind,
        aiProvider: e.aiProvider,
        dwellSeconds: e.dwellSeconds,
        signals: e.signals,
        text: mask ? redact(e.text) : e.text,
      })),
      context: [
        `The student added this file as study material for ${subject?.name ?? 'a subject'}.`,
      ],
    }
  }
}

/** Material the student chose for a subject is learning material of that subject. */
function forSubject(output: ExtractOutput, subjectId: string): ExtractOutput {
  return {
    ...output,
    results: output.results.map((r) => ({
      ...r,
      isLearning: r.isLearning || r.items.length > 0,
      items: r.items.map((item) => ({ ...item, subject: { matchId: subjectId, newName: null } })),
    })),
  }
}
