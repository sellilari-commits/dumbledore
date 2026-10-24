/**
 * App and domain hints for the prefilter: study sites (LMS such as Moodle/MyCourses/Canvas,
 * Wikipedia, docs, papers/arXiv, PDFs, reading apps) push an episode up; entertainment, social
 * and shopping push it down. News is neutral: an article with real facts is learnable content, so
 * its text decides. Weights are added to the prefilter score.
 */
import { hostMatches, parseUrl } from '../../privacy/url'
import { isPdf, isReadingApp } from '../episodes/keys'

export type HintKind =
  | 'lms'
  | 'paper'
  | 'reference'
  | 'docs'
  | 'pdf'
  | 'reading_app'
  | 'entertainment'
  | 'social'
  | 'news'
  | 'shopping'
  | 'mail'

export interface SiteHint {
  kind: HintKind
  weight: number
}

const HOSTS: readonly { kind: HintKind; weight: number; patterns: readonly string[] }[] = [
  {
    kind: 'lms',
    weight: 0.45,
    patterns: [
      'mycourses.aalto.fi',
      'moodle.*',
      '*moodle*',
      'instructure.com', // Canvas
      'canvas.*',
      'blackboard.com',
      'brightspace.com',
      'd2l.com',
      'itslearning.com',
      'schoology.com',
      'classroom.google.com',
      'sisu.*',
      'peppi.*',
      'opintoni.*',
      'lms.*',
      'learn.*',
      'courses.*',
      'mooc.fi',
      'coursera.org',
      'edx.org',
      'khanacademy.org',
      'udemy.com',
      'brilliant.org',
      'codecademy.com',
      'quizlet.com',
      'ankiweb.net',
      'studocu.com',
      'chegg.com',
      'overleaf.com',
    ],
  },
  {
    kind: 'paper',
    weight: 0.4,
    patterns: [
      'arxiv.org',
      'biorxiv.org',
      'medrxiv.org',
      'scholar.google.com',
      'semanticscholar.org',
      'jstor.org',
      'sciencedirect.com',
      'springer.com',
      'nature.com',
      'science.org',
      'ncbi.nlm.nih.gov',
      'wiley.com',
      'tandfonline.com',
      'ieeexplore.ieee.org',
      'dl.acm.org',
      'researchgate.net',
      'ssrn.com',
      'plos.org',
      'frontiersin.org',
      'mdpi.com',
      'cell.com',
      'pnas.org',
      'aps.org',
    ],
  },
  {
    kind: 'reference',
    weight: 0.35,
    patterns: [
      'wikipedia.org',
      'wikibooks.org',
      'wiktionary.org',
      'britannica.com',
      'libretexts.org',
      'openstax.org',
      'mathworld.wolfram.com',
      'wolframalpha.com',
      'plato.stanford.edu',
      'hyperphysics.phy-astr.gsu.edu',
      'mathsisfun.com',
      'investopedia.com',
      '.edu',
      '.ac.uk',
      'aalto.fi',
      'helsinki.fi',
      'tuni.fi',
      'utu.fi',
      'jyu.fi',
      'oulu.fi',
      'lut.fi',
      'abo.fi',
    ],
  },
  {
    kind: 'docs',
    weight: 0.3,
    patterns: [
      'docs.*',
      'developer.*',
      'developers.*',
      'readthedocs.io',
      'learn.microsoft.com',
      'developer.mozilla.org',
      'w3schools.com',
      'geeksforgeeks.org',
      'stackoverflow.com',
      'stackexchange.com',
      'cppreference.com',
      'rust-lang.org',
      'python.org',
    ],
  },
  {
    kind: 'entertainment',
    weight: -0.5,
    patterns: [
      'open.spotify.com',
      'netflix.com',
      'twitch.tv',
      'disneyplus.com',
      'max.com',
      'hbomax.com',
      'primevideo.com',
      'music.apple.com',
      'soundcloud.com',
      'areena.yle.fi',
      'ruutu.fi',
      '9gag.com',
      'store.steampowered.com',
    ],
  },
  {
    kind: 'social',
    weight: -0.4,
    patterns: [
      'facebook.com',
      'instagram.com',
      'x.com',
      'twitter.com',
      'tiktok.com',
      'linkedin.com',
      'snapchat.com',
      'threads.net',
      'bsky.app',
      'pinterest.com',
      'tumblr.com',
    ],
  },
  {
    kind: 'news',
    weight: 0,
    patterns: [
      'yle.fi',
      'hs.fi',
      'is.fi',
      'iltalehti.fi',
      'mtvuutiset.fi',
      'kauppalehti.fi',
      'bbc.com',
      'bbc.co.uk',
      'cnn.com',
      'nytimes.com',
      'theguardian.com',
      'reuters.com',
      'apnews.com',
      'foxnews.com',
      'washingtonpost.com',
      'aljazeera.com',
      'news.*',
      'svt.se',
      'dn.se',
      'aftonbladet.se',
    ],
  },
  {
    kind: 'shopping',
    weight: -0.4,
    patterns: [
      'amazon.com',
      'amazon.de',
      'amazon.se',
      'ebay.com',
      'zalando.fi',
      'zalando.com',
      'tori.fi',
      'verkkokauppa.com',
      'gigantti.fi',
      'jimms.fi',
      'prisma.fi',
      'k-ruoka.fi',
      's-kaupat.fi',
      'etsy.com',
      'aliexpress.com',
      'temu.com',
      'ikea.com',
      'booking.com',
    ],
  },
  {
    kind: 'mail',
    weight: -0.1,
    patterns: [
      'mail.google.com',
      'outlook.live.com',
      'outlook.office.com',
      'outlook.office365.com',
    ],
  },
]

const APPS: Readonly<Record<string, SiteHint>> = {
  'com.spotify.client': { kind: 'entertainment', weight: -0.5 },
  'com.apple.music': { kind: 'entertainment', weight: -0.5 },
  'com.apple.tv': { kind: 'entertainment', weight: -0.5 },
  'com.valvesoftware.steam': { kind: 'entertainment', weight: -0.5 },
  'com.hnc.discord': { kind: 'social', weight: -0.3 },
  'com.apple.mail': { kind: 'mail', weight: -0.1 },
  'com.microsoft.outlook': { kind: 'mail', weight: -0.1 },
  'net.ankiweb.dtop': { kind: 'lms', weight: 0.45 },
}

/** Every hint that applies: the app, PDF/reading-app, and the first matching site group. */
export function siteHints(bundleId: string, url: string | null, title: string | null): SiteHint[] {
  const hints: SiteHint[] = []
  const app = APPS[bundleId.toLowerCase()]
  if (app) hints.push(app)
  if (isReadingApp(bundleId)) hints.push({ kind: 'reading_app', weight: 0.3 })
  if (isPdf(url, title)) hints.push({ kind: 'pdf', weight: 0.3 })
  const host = parseUrl(url)?.host
  if (host) {
    for (const group of HOSTS) {
      if (group.patterns.some((p) => hostMatches(host, p))) {
        hints.push({ kind: group.kind, weight: group.weight })
        break
      }
    }
  }
  return hints
}
