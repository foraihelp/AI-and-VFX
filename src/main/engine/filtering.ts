import type { SoftwareDef, Sources, Video, VideoKind } from '../../shared/types'

const DESCRIPTION_WINDOW = 300
const SHORT_MAX_SECONDS = 60
const TYPE_SCORE: Record<VideoKind, number> = { release: 50, webinar: 25, workflow: 15, tutorial: 10, other: 0 }
const OFFICIAL_SCORE = 100

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** "mocha pro" also matches "mocha-pro" / "mochapro"; whole words only. */
export function termRegex(term: string): RegExp {
  const parts = term.trim().split(/[\s_-]+/).filter(Boolean).map(esc)
  return new RegExp(`(?<![\\p{L}\\p{N}_])${parts.join('[\\s_-]*')}(?![\\p{L}\\p{N}_])`, 'iu')
}

const anyTerm = (terms: string[], text: string): boolean =>
  terms.some((t) => t.trim() && termRegex(t).test(text))

export function isShort(v: Video): boolean {
  return (
    (v.durationSeconds !== undefined && v.durationSeconds <= SHORT_MAX_SECONDS) ||
    v.url.includes('/shorts/') ||
    /#shorts?\b/i.test(v.title)
  )
}

export function matchSoftware(v: Video, sw: SoftwareDef): boolean {
  const text = `${v.title}\n${v.description.slice(0, DESCRIPTION_WINDOW)}`
  if (anyTerm(sw.exclude, text)) return false
  if (v.trustHint && v.hint.includes(sw.id)) return true
  if (anyTerm(sw.strong, text)) return true
  return anyTerm(sw.weak, text) && anyTerm(sw.context, text)
}

export function classify(v: Video, rules: Record<string, string[]>): VideoKind {
  for (const kind of ['release', 'webinar', 'workflow', 'tutorial'] as const) {
    if (anyTerm(rules[kind] ?? [], v.title)) return kind
  }
  return 'other'
}

const normTitle = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function merge(a: Video, b: Video): Video {
  const [best, other] = a.description.length >= b.description.length ? [a, b] : [b, a]
  best.official = a.official || b.official
  best.durationSeconds ??= other.durationSeconds
  best.isLive = a.isLive || b.isLive
  best.trustHint = best.trustHint || other.trustHint
  best.hint = [...new Set([...best.hint, ...other.hint])]
  return best
}

export function dedupe(videos: Video[]): Video[] {
  const byId = new Map<string, Video>()
  for (const v of videos) {
    const old = byId.get(v.id)
    byId.set(v.id, old ? merge(old, v) : v)
  }
  const byTitle = new Map<string, Video>()
  for (const v of byId.values()) {
    const key = `${normTitle(v.title)}|${v.channel.toLowerCase()}`
    const old = byTitle.get(key)
    if (!old) {
      byTitle.set(key, v)
      continue
    }
    // Re-upload: keep the official one, otherwise the original (earliest) upload.
    const [first, second] = [old, v].sort(
      (x, y) => Number(!x.official) - Number(!y.official) || Date.parse(x.published) - Date.parse(y.published)
    )
    first.official = first.official || second.official
    byTitle.set(key, first)
  }
  return [...byTitle.values()]
}

export function select(
  videos: Video[],
  sources: Sources,
  opts: { since: Date; includeShorts: boolean }
): Video[] {
  const out: Video[] = []
  for (const v of dedupe(videos)) {
    if (Date.parse(v.published) < opts.since.getTime() || v.isLive) continue
    if (!opts.includeShorts && isShort(v)) continue
    if (anyTerm(sources.excludeTitleTerms, v.title)) continue
    v.software = sources.software.filter((s) => matchSoftware(v, s)).map((s) => s.id)
    if (!v.software.length) continue
    v.kind = classify(v, sources.typeRules)
    v.score = (v.official ? OFFICIAL_SCORE : 0) + TYPE_SCORE[v.kind]
    out.push(v)
  }
  // Highest tier first (official / release news), then newest first.
  return out.sort((a, b) => b.score - a.score || Date.parse(b.published) - Date.parse(a.published))
}
