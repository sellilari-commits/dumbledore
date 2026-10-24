/**
 * Picks a fitting emoji for a new subject from its name (English, Finnish and Swedish keywords).
 * Keywords match at the start of a word, so "art" won't fire inside "particle". First rule wins.
 */

export const DEFAULT_SUBJECT_EMOJI = '📘'

const RULES: [emoji: string, keywords: string[]][] = [
  ['🧪', ['chem', 'kemi', 'organic', 'orgo', 'stoichiometr']],
  ['🧬', ['bio', 'genetic', 'genom', 'molecular', 'microbio', 'perinnöllisyys']],
  ['⚛️', ['physic', 'fysiik', 'fysik', 'quantum', 'mechanics', 'thermodynamic', 'electromagnet']],
  ['🔭', ['astronom', 'astrophys', 'cosmolog', 'tähtitie']],
  ['📊', ['statistic', 'tilasto', 'probabilit', 'data science', 'data analy', 'econometric']],
  [
    '💻',
    [
      'programm',
      'coding',
      'code',
      'computer',
      'software',
      'algorithm',
      'python',
      'java',
      'web dev',
      'machine learning',
      'deep learning',
      'artificial intelligence',
      'neural network',
      'ohjelmoin',
      'tietojenkäsittely',
      'datavetenskap',
    ],
  ],
  [
    '📐',
    [
      'math',
      'algebra',
      'calculus',
      'geometr',
      'trigonometr',
      'linear',
      'analysis',
      'differential',
      'matemati',
      'matematik',
      'discrete',
    ],
  ],
  ['🏛️', ['histor', 'ancient', 'civilization', 'civilisation', 'archaeolog', 'medieval']],
  ['🌍', ['geograph', 'maantie', 'geografi', 'climate', 'earth science']],
  ['🪨', ['geolog', 'mineral']],
  ['🌱', ['ecolog', 'environment', 'botan', 'sustainab', 'ympäristö']],
  ['🧠', ['psycholog', 'psykolog', 'neuro', 'cognitive']],
  ['🩺', ['medic', 'anatom', 'physiolog', 'nursing', 'pharmac', 'lääke', 'hälso']],
  [
    '📈',
    [
      'econom',
      'microecon',
      'macroecon',
      'finance',
      'accounting',
      'taloust',
      'kansantalous',
      'ekonomi',
    ],
  ],
  ['💼', ['business', 'management', 'marketing', 'entrepreneur', 'liiketal']],
  ['⚖️', ['law', 'legal', 'juridi', 'oikeus', 'rätt']],
  ['🤔', ['philosoph', 'filosofi', 'ethic', 'logic']],
  ['📚', ['literat', 'kirjallisuu', 'litteratur', 'poetry', 'novel']],
  [
    '🗣️',
    [
      'language',
      'linguist',
      'english',
      'finnish',
      'swedish',
      'german',
      'french',
      'spanish',
      'italian',
      'japanese',
      'chinese',
      'russian',
      'kieli',
      'suomi',
      'ruotsi',
      'englanti',
      'saksa',
      'ranska',
      'espanja',
      'språk',
      'svenska',
      'grammar',
      'vocabulary',
    ],
  ],
  ['🎵', ['music', 'musiik', 'musik', 'piano', 'guitar']],
  ['🎨', ['art', 'design', 'drawing', 'painting', 'taide', 'konst']],
  ['⚙️', ['engineer', 'tekniikka', 'electronic', 'circuit', 'robotic']],
  ['🗳️', ['politic', 'government', 'civics', 'sociolog', 'yhteiskunta']],
]

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const MATCHERS = RULES.map(
  ([emoji, keywords]) =>
    [
      emoji,
      new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${keywords.map(escapeRegExp).join('|')})`, 'iu'),
    ] as const,
)

export function pickSubjectEmoji(name: string): string {
  const text = name.trim()
  for (const [emoji, re] of MATCHERS) if (re.test(text)) return emoji
  return DEFAULT_SUBJECT_EMOJI
}
