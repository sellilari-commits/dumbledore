/**
 * Concept name matching. Two names mean the same concept when their `conceptKey` is equal:
 * case, spacing, hyphens and punctuation, a possessive 's and simple English plurals are ignored
 * ("Leaving groups" = "leaving-Group", "nucleophiles" = "Nucleophile", "Hess's law" = "Hess law").
 *
 * Singularizing is deliberately conservative: words that only look plural (analysis, mass,
 * species, physics, gas, status …) stay as they are, and a missed match is preferred over merging
 * two different concepts. Symbols stay significant ("C++" ≠ "C", "Na+" ≠ "Na").
 */
import { normalizeName } from './codec'

/** Words ending in "s" that are singular or invariant. */
const INVARIANT = new Set([
  'alias',
  'atlas',
  'bias',
  'canvas',
  'chaos',
  'corps',
  'cosmos',
  'diabetes',
  'ethos',
  'herpes',
  'kudos',
  'lens',
  'logos',
  'means',
  'measles',
  'mumps',
  'news',
  'pancreas',
  'pathos',
  'rabies',
  'scabies',
  'series',
  'species',
])

/** Singular nouns ending in "s" whose plural adds "es" (gases, viruses, lenses). */
const ES_PLURAL_OF = new Set([
  'alias',
  'apparatus',
  'atlas',
  'bias',
  'bonus',
  'bus',
  'cactus',
  'campus',
  'canvas',
  'census',
  'chorus',
  'circus',
  'consensus',
  'fetus',
  'focus',
  'fungus',
  'gas',
  'genius',
  'hiatus',
  'iris',
  'lens',
  'nexus',
  'octopus',
  'plexus',
  'prospectus',
  'radius',
  'sinus',
  'status',
  'stimulus',
  'surplus',
  'syllabus',
  'uterus',
  'virus',
  'walrus',
])

/** Words ending in "oe" (their plural is "-oes" but the singular keeps the e). */
const OE_PLURALS = new Set([
  'aloes',
  'canoes',
  'floes',
  'foes',
  'hoes',
  'horseshoes',
  'oboes',
  'shoes',
  'sloes',
  'throes',
  'tiptoes',
  'toes',
  'woes',
])

const IRREGULAR = new Map<string, string>(
  Object.entries({
    algae: 'alga',
    antennae: 'antenna',
    formulae: 'formula',
    larvae: 'larva',
    nebulae: 'nebula',
    vertebrae: 'vertebra',
    bacteria: 'bacterium',
    criteria: 'criterion',
    mitochondria: 'mitochondrion',
    phenomena: 'phenomenon',
    appendices: 'appendix',
    apices: 'apex',
    cortices: 'cortex',
    helices: 'helix',
    indices: 'index',
    matrices: 'matrix',
    vertices: 'vertex',
    alumni: 'alumnus',
    bacilli: 'bacillus',
    cacti: 'cactus',
    calculi: 'calculus',
    foci: 'focus',
    fungi: 'fungus',
    loci: 'locus',
    nuclei: 'nucleus',
    radii: 'radius',
    stimuli: 'stimulus',
    axes: 'axis',
    crises: 'crisis',
    diagnoses: 'diagnosis',
    emphases: 'emphasis',
    meioses: 'meiosis',
    mitoses: 'mitosis',
    neuroses: 'neurosis',
    oases: 'oasis',
    prognoses: 'prognosis',
    psychoses: 'psychosis',
    calves: 'calf',
    halves: 'half',
    hooves: 'hoof',
    knives: 'knife',
    leaves: 'leaf',
    lives: 'life',
    loaves: 'loaf',
    selves: 'self',
    shelves: 'shelf',
    thieves: 'thief',
    wives: 'wife',
    wolves: 'wolf',
    calories: 'calorie',
    cookies: 'cookie',
    movies: 'movie',
    zombies: 'zombie',
    quizzes: 'quiz',
  }),
)

/** Singular form of one lower-case word (unchanged when unsure). */
export function singularize(word: string): string {
  const w = word.toLowerCase()
  const irregular = IRREGULAR.get(w)
  if (irregular) return irregular
  if (w.length <= 3 || INVARIANT.has(w) || !/\p{L}s$/u.test(w)) return w
  if (/(?:ss|us|is|ics)$/.test(w)) return w // mass, nucleus, analysis, physics
  const stem = w.slice(0, -2)
  if (w.endsWith('es') && ES_PLURAL_OF.has(stem)) return stem // gases, viruses
  if (w.endsWith('ies')) return w.length > 4 ? `${w.slice(0, -3)}y` : w.slice(0, -1) // properties
  if (/(?:sses|xes|ches|shes|zzes)$/.test(w)) return stem // processes, boxes, matches
  if (/[ey]ses$/.test(w)) return `${stem}is` // hypotheses, analyses
  if (w.endsWith('oes') && !OE_PLURALS.has(w)) return stem // volcanoes, heroes
  return w.slice(0, -1)
}

/** Acronym plurals keep their capitals: "APIs", "GPUs", "SN2s". */
const ACRONYM_PLURAL = /^[\p{Lu}\p{N}]*\p{Lu}[\p{Lu}\p{N}]*s$/u

function keyOfToken(token: string): string {
  if (token.length >= 3 && ACRONYM_PLURAL.test(token)) return token.slice(0, -1).toLowerCase()
  return /^[\p{L}\p{M}\p{N}]+$/u.test(token) ? singularize(token) : token.toLowerCase()
}

/** Matching key of a concept name (see the module comment). */
export function conceptKey(name: string): string {
  const tokens = name
    .normalize('NFKC')
    .replace(/&/g, ' and ')
    .replace(/[`´]/g, ' ') // Markdown code ticks, accents typed as quotes
    .replace(/(?<=[\p{L}\p{N}])['’ʼ]s(?![\p{L}\p{N}])/giu, '') // possessive 's
    .replace(/['’‘ʼ]/g, '')
    .split(/[^\p{L}\p{M}\p{N}\p{S}#]+/u)
    .filter((t) => t !== '')
  const key = tokens.map(keyOfToken).join('')
  return key || normalizeName(name)
}

/**
 * True when `candidate` (a name of the same concept) is clearly nicer than `current`: today
 * that means it has capitals where `current` has none ("nucleophiles" → "Nucleophile").
 */
export function isNicerName(current: string, candidate: string): boolean {
  const next = candidate.trim()
  return next !== '' && current === current.toLowerCase() && next !== next.toLowerCase()
}
