/** Find candidate videos: YouTube Data API v3, YouTube channel RSS, generic RSS/Atom feeds. No scraping. */
import { XMLParser } from 'fast-xml-parser'
import type { Sources, Video } from '../../shared/types'

const API = 'https://www.googleapis.com/youtube/v3'
const YT_FEED = (id: string): string => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504])

export type Fetcher = (url: string) => Promise<string>

export const redact = (s: unknown): string => String(s).replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1REDACTED')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class HttpError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
  }
}

export async function httpGet(url: string, retries = 3): Promise<string> {
  let last: HttpError | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    let delay = 2 ** attempt * 1000
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'ai-vfx-digest' }, signal: AbortSignal.timeout(30000) })
      if (res.ok) return await res.text()
      last = new HttpError(`HTTP ${res.status} for ${redact(url)}`, res.status)
      if (!TRANSIENT.has(res.status)) throw last
      const ra = Number(res.headers.get('retry-after'))
      if (ra > 0) delay = Math.min(ra, 60) * 1000
    } catch (e) {
      if (e instanceof HttpError && !TRANSIENT.has(e.status ?? 0)) throw e
      last = e instanceof HttpError ? e : new HttpError(`Network error for ${redact(url)}: ${redact((e as Error).message)}`)
    }
    if (attempt < retries) await sleep(delay)
  }
  throw last ?? new HttpError('request failed')
}

export function parseDuration(text: string | undefined): number | undefined {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(text ?? '')
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : undefined
}

export function youtubeIdFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|m)\./, '')
    if (host === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0]
    if (host === 'youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v') ?? undefined
      return /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname)?.[1]
    }
  } catch {
    /* not a URL */
  }
  return undefined
}

export function canonicalId(url: string): string {
  const yt = youtubeIdFromUrl(url)
  if (yt) return `yt:${yt}`
  try {
    const u = new URL(url)
    return `url:${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, '')}`
  } catch {
    return `url:${url}`
  }
}

const blank = (): Pick<Video, 'isLive' | 'software' | 'kind' | 'score' | 'hint' | 'trustHint'> => ({
  isLive: false, software: [], kind: 'other', score: 0, hint: [], trustHint: false
})

type Node = any // eslint-disable-line @typescript-eslint/no-explicit-any
const text = (n: Node): string => (typeof n === 'string' ? n : n && typeof n === 'object' ? String(n['#text'] ?? '') : n != null ? String(n) : '').trim()
const list = (n: Node): Node[] => (n === undefined ? [] : Array.isArray(n) ? n : [n])

/** Parse Atom (YouTube, Vimeo, PeerTube...) or RSS 2.0. */
export function parseFeed(xml: string, o: { platform: string; official: boolean; source: string }): Video[] {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true }).parse(xml)
  const feed = doc.feed ?? doc.rss?.channel ?? {}
  const feedTitle = text(feed.title)
  const out: Video[] = []
  for (const e of [...list(feed.entry), ...list(feed.item)]) {
    const title = text(e.title)
    let link = ''
    for (const l of list(e.link)) {
      const href = typeof l === 'string' ? l : (l['@_href'] ?? text(l))
      if (href && (typeof l === 'string' || !l['@_rel'] || l['@_rel'] === 'alternate')) { link = href; break }
    }
    const dateText = text(e.published) || text(e.updated) || text(e.pubDate)
    const ms = Date.parse(dateText)
    if (!title || !link || Number.isNaN(ms)) continue
    const author = text(e.author?.name ?? e.author) || text(e.creator)
    const desc = text(e.group?.description) || text(e.summary) || text(e.description) || text(e.content)
    out.push({
      id: canonicalId(link), platform: o.platform, title, channel: author || feedTitle, url: link,
      published: new Date(ms).toISOString(), description: desc, official: o.official, source: o.source, ...blank()
    })
  }
  return out
}

// ----------------------------------------------------------------- YouTube API
export class YouTubeApi {
  constructor(private key: string, private get: Fetcher = httpGet) {}

  private async call(endpoint: string, params: Record<string, string | number>): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), key: this.key })
    return JSON.parse(await this.get(`${API}/${endpoint}?${qs}`))
  }

  async resolveHandle(handle: string): Promise<{ id: string; title: string } | undefined> {
    const d = await this.call('channels', { part: 'snippet', forHandle: handle.replace(/^@/, '') })
    const i = d.items?.[0]
    return i ? { id: i.id, title: i.snippet.title } : undefined
  }

  async channelUploads(channelId: string, limit = 15): Promise<string[]> {
    const info = await this.call('channels', { part: 'contentDetails', id: channelId })
    const playlist = info.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? `UU${channelId.slice(2)}`
    const d = await this.call('playlistItems', { part: 'contentDetails', playlistId: playlist, maxResults: limit })
    return (d.items ?? []).map((i: Node) => i.contentDetails.videoId)
  }

  async search(query: string, after: Date, limit = 25): Promise<string[]> {
    const d = await this.call('search', {
      part: 'id', q: query, type: 'video', order: 'date', maxResults: limit,
      publishedAfter: after.toISOString().replace(/\.\d+Z$/, 'Z'), relevanceLanguage: 'en'
    })
    return (d.items ?? []).map((i: Node) => i.id?.videoId).filter(Boolean)
  }

  async details(ids: string[]): Promise<Node[]> {
    const uniq = [...new Set(ids)]
    const out: Node[] = []
    for (let i = 0; i < uniq.length; i += 50) {
      const d = await this.call('videos', { part: 'snippet,contentDetails', id: uniq.slice(i, i + 50).join(',') })
      out.push(...(d.items ?? []))
    }
    return out
  }
}

export function videoFromApiItem(item: Node, official: boolean, source: string): Video {
  const sn = item.snippet
  return {
    id: `yt:${item.id}`, platform: 'YouTube', title: sn.title ?? '', channel: sn.channelTitle ?? '',
    url: `https://www.youtube.com/watch?v=${item.id}`, published: new Date(sn.publishedAt).toISOString(),
    description: sn.description ?? '', official, source,
    durationSeconds: parseDuration(item.contentDetails?.duration), ...blank(),
    isLive: ['live', 'upcoming'].includes(sn.liveBroadcastContent)
  }
}

// ---------------------------------------------------------------- orchestration
export async function discover(
  sources: Sources,
  o: { since: Date; apiKey?: string; get?: Fetcher }
): Promise<{ videos: Video[]; warnings: string[] }> {
  const get = o.get ?? httpGet
  const api = o.apiKey ? new YouTubeApi(o.apiKey, get) : undefined
  const videos: Video[] = []
  const warnings: string[] = []
  const add = (found: Video[], entry: Record<string, any>): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const v of found) {
      if (Date.parse(v.published) >= o.since.getTime()) {
        v.hint = [...((entry.software as string[]) ?? [])]
        v.trustHint = entry.trust_all === true
        videos.push(v)
      }
    }
  }

  await Promise.all(sources.channels.map(async (ch: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const name = String(ch.name ?? 'channel')
    try {
      let cid = String(ch.channel_id ?? '')
      if (!cid && api && ch.handle) cid = (await api.resolveHandle(String(ch.handle)))?.id ?? ''
      if (!cid) { warnings.push(`Channel '${name}' skipped: no channel_id in sources.yaml.`); return }
      const official = ch.official === true
      let found: Video[] | undefined
      if (api) {
        try {
          found = (await api.details(await api.channelUploads(cid))).map((i) => videoFromApiItem(i, official, name))
        } catch { /* fall back to RSS */ }
      }
      found ??= parseFeed(await get(YT_FEED(cid)), { platform: 'YouTube', official, source: name })
      add(found, ch)
    } catch (e) {
      warnings.push(`Channel '${name}' failed: ${redact((e as Error).message)}`)
    }
  }))

  if (api) {
    await Promise.all(sources.searches.map(async (q: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        const items = await api.details(await api.search(String(q.query), o.since))
        add(items.map((i) => videoFromApiItem(i, false, `search: ${q.query}`)), q)
      } catch (e) {
        warnings.push(`Search '${q.query}' failed: ${redact((e as Error).message)}`)
      }
    }))
  }

  await Promise.all(sources.feeds.map(async (f: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const name = String(f.name ?? f.url)
    try {
      add(parseFeed(await get(String(f.url)), { platform: String(f.platform ?? 'Web'), official: f.official === true, source: name }), f)
    } catch (e) {
      warnings.push(`Feed '${name}' failed: ${redact((e as Error).message)}`)
    }
  }))
  return { videos, warnings }
}
