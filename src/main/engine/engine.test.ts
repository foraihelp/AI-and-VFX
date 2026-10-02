import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Video } from '../../shared/types'
import { canonicalId, discover, parseDuration, parseFeed, redact } from './discovery'
import { classify, dedupe, isShort, select } from './filtering'
import { buildEmail, fmtDate } from './formatting'
import { parseSources } from './sources'

const sources = parseSources(readFileSync('config/sources.yaml', 'utf-8'))
const NOW = new Date('2026-10-02T07:00:00Z')
const since = new Date(NOW.getTime() - 30 * 86_400_000)

let n = 0
function make(title: string, o: Partial<Video> = {}): Video {
  const id = o.id ?? `yt:v${n++}`
  return {
    id, platform: 'YouTube', title, channel: 'Chan', url: `https://www.youtube.com/watch?v=${id.slice(3)}`,
    published: new Date(NOW.getTime() - 5 * 3600_000).toISOString(), description: '', official: false, source: '',
    isLive: false, software: [], kind: 'other', score: 0, hint: [], trustHint: false, ...o
  }
}
const pick = (...v: Video[]): Video[] => select(v, sources, { since, includeShorts: false })

describe('filtering', () => {
  it('matches relevant Nuke videos and rejects ambiguous ones', () => {
    expect(pick(make('Nuke compositing tutorial: keying'))[0].software).toEqual(['nuke'])
    expect(pick(make('Tactical nuke compilation', { description: 'Warzone fun' }))).toEqual([])
    expect(pick(make('Best mocha latte recipe'))).toEqual([])
    expect(pick(make('Nuke is great'))).toEqual([])
    expect(pick(make('Nuke is great for VFX comp work'))).toHaveLength(1)
  })
  it('handles Mocha Pro and ComfyUI spelling variants', () => {
    expect(pick(make('Boris FX Mocha Pro 2026 tour'))[0].software).toEqual(['mocha'])
    expect(pick(make('My Comfy UI setup'))[0].software).toEqual(['comfyui'])
  })
  it('trusts single-product channel hints only when asked', () => {
    expect(pick(make('Community call', { hint: ['comfyui'], trustHint: true }))[0].software).toEqual(['comfyui'])
    expect(pick(make('Community call', { hint: ['comfyui'], trustHint: false }))).toEqual([])
  })
  it('drops Shorts, live, old, noise', () => {
    expect(isShort(make('x #Shorts'))).toBe(true)
    expect(isShort(make('x', { durationSeconds: 45 }))).toBe(true)
    expect(pick(make('Nuke vfx tip #shorts'))).toEqual([])
    expect(pick(make('Nuke vfx stream', { isLive: true }))).toEqual([])
    expect(pick(make('Nuke vfx news', { published: '2026-01-01T00:00:00Z' }))).toEqual([])
    expect(pick(make('Nuke vfx reaction video'))).toEqual([])
  })
  it('ranks official/release first, then newest', () => {
    const a = make('Nuke vfx tutorial old', { id: 'yt:a', published: new Date(NOW.getTime() - 30 * 3600_000).toISOString() })
    const b = make('Nuke vfx tutorial new', { id: 'yt:b', published: new Date(NOW.getTime() - 2 * 3600_000).toISOString() })
    const c = make('Nuke 17 release notes', { id: 'yt:c', official: true })
    expect(pick(a, b, c).map((v) => v.id)).toEqual(['yt:c', 'yt:b', 'yt:a'])
  })
  it('dedupes by id and same-channel re-uploads', () => {
    const a = make('ComfyUI workflow', { id: 'yt:a', description: 'short' })
    const a2 = make('ComfyUI workflow', { id: 'yt:a', description: 'a longer description', official: true })
    const merged = dedupe([a, a2])
    expect(merged).toHaveLength(1)
    expect(merged[0].official).toBe(true)
    const r1 = make('ComfyUI Workflow!', { id: 'yt:1', published: new Date(NOW.getTime() - 10 * 3600_000).toISOString() })
    const r2 = make('comfyui workflow', { id: 'yt:2' })
    expect(dedupe([r1, r2]).map((v) => v.id)).toEqual(['yt:1'])
    expect(dedupe([r1, make('comfyui workflow', { channel: 'Other' })])).toHaveLength(2)
  })
  it('labels types', () => {
    const r = sources.typeRules
    expect(classify(make('Mocha Pro 2026 release notes'), r)).toBe('release')
    expect(classify(make('Foundry webinar on deep comp'), r)).toBe('webinar')
    expect(classify(make('How to roto in Silhouette'), r)).toBe('tutorial')
    expect(classify(make('My ComfyUI workflow'), r)).toBe('workflow')
    expect(classify(make('Random chat'), r)).toBe('other')
  })
})

describe('feeds and discovery', () => {
  it('parses the shared sample feed and filters it like the Python digest', () => {
    const vids = [
      ...parseFeed(readFileSync('sample_data/sample_feed.xml', 'utf-8'), { platform: 'YouTube', official: false, source: 's' }),
      ...parseFeed(readFileSync('sample_data/sample_official_feed.xml', 'utf-8'), { platform: 'YouTube', official: true, source: 'o' }).map((v) => ({ ...v, hint: ['comfyui'], trustHint: true }))
    ]
    const out = select(vids, sources, { since: new Date('2000-01-01'), includeShorts: false })
    expect(out).toHaveLength(6) // same count the Python sample digest produces
    expect(out.find((v) => v.title.includes('mocha latte'))).toBeUndefined()
  })
  it('helpers', () => {
    expect(canonicalId('https://youtu.be/ABCDEFGHIJK?t=3')).toBe('yt:ABCDEFGHIJK')
    expect(canonicalId('https://www.youtube.com/shorts/ABCDEFGHIJK')).toBe('yt:ABCDEFGHIJK')
    expect(canonicalId('https://vimeo.com/123/')).toBe('url:vimeo.com/123')
    expect(parseDuration('PT1H2M3S')).toBe(3723)
    expect(redact('https://x.test?a=1&key=SECRET')).not.toContain('SECRET')
  })
  it('one failing source does not stop others and RSS fallback works', async () => {
    const atom = readFileSync('sample_data/sample_feed.xml', 'utf-8')
    const src = { ...sources, searches: [], feeds: [], channels: [{ name: 'bad', channel_id: 'UCbad' }, { name: 'good', channel_id: 'UCgood', software: ['nuke'] }] }
    const get = async (url: string): Promise<string> => { if (url.includes('UCbad')) throw new Error('HTTP 500'); return atom }
    const r = await discover(src, { since: new Date('2000-01-01'), get })
    expect(r.videos.length).toBeGreaterThan(0)
    expect(r.warnings).toHaveLength(1)
    const viaApi = await discover({ ...src, channels: [{ name: 'c', channel_id: 'UCgood' }] }, {
      since: new Date('2000-01-01'), apiKey: 'K',
      get: async (url) => { if (url.includes('googleapis')) throw new Error('HTTP 404'); return atom }
    })
    expect(viaApi.warnings).toEqual([])
    expect(viaApi.videos.length).toBeGreaterThan(0)
  })
})

describe('email format (same pattern as the GitHub digest)', () => {
  const vids = pick(make('Nuke vfx tutorial', { id: 'yt:n1' }), make('ComfyUI workflow tour', { id: 'yt:c1', official: true, description: 'Real words. https://x.io' }))
  const email = buildEmail(vids, sources.software, { tz: 'UTC', summaries: 'description', maxPer: 15, now: NOW })
  it('has subject, grouped sections, links, description without URLs', () => {
    expect(email.subject).toBe('AI & VFX video digest - 02 Oct 2026: 2 new videos')
    expect(email.text.indexOf('Foundry Nuke')).toBeLessThan(email.text.indexOf('ComfyUI'))
    expect(email.text).toContain('https://www.youtube.com/watch?v=n1')
    expect(email.html).toContain('href="https://www.youtube.com/watch?v=c1"')
    expect(email.text).toContain('Description: Real words.')
    expect(email.text).not.toContain('x.io')
  })
  it('escapes untrusted text and handles empty / capped lists', () => {
    const bad = buildEmail(pick(make('Nuke vfx <script>alert(1)</script> tutorial')), sources.software, { tz: 'UTC', summaries: 'off', maxPer: 15, now: NOW })
    expect(bad.html).not.toContain('<script>')
    expect(buildEmail([], sources.software, { tz: 'UTC', summaries: 'off', maxPer: 15, now: NOW }).subject).toContain('no new videos')
    const many = Array.from({ length: 5 }, (_, i) => make(`Nuke vfx tutorial ${i}`, { channel: `c${i}` }))
    expect(buildEmail(pick(...many), sources.software, { tz: 'UTC', summaries: 'off', maxPer: 2, now: NOW }).text).toContain('and 3 more')
  })
  it('formats dates in the chosen timezone', () => {
    expect(fmtDate('2026-10-02T07:00:00Z', 'UTC')).toBe('02 Oct 2026, 07:00 UTC')
    expect(fmtDate('2026-10-02T07:00:00Z', 'Asia/Tokyo')).toContain('16:00')
  })
})
