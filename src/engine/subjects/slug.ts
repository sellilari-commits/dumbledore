/** File-name slugs for memory files: "Organic Chemistry" → "organic-chemistry". */
import type { Subject } from '@shared/domain'

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'subject'
}

/**
 * Unique slug per subject. The oldest subject keeps the plain slug; later ones with the same
 * slug get a short id suffix, so a file name never jumps between subjects. Ties in creation time
 * keep the input order (Repos.subjects.list() order).
 */
export function slugsFor(subjects: readonly Subject[]): Map<string, string> {
  const out = new Map<string, string>()
  const taken = new Set<string>()
  const ordered = [...subjects].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const s of ordered) {
    let slug = slugify(s.name)
    if (taken.has(slug)) slug = `${slug}-${s.id.slice(-6)}`
    taken.add(slug)
    out.set(s.id, slug)
  }
  return out
}
