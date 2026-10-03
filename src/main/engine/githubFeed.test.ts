import { describe, expect, it } from 'vitest'
import { feedToVideos, parseFeed } from './githubFeed'

const feed = {
  version: 1, generated_at: '2026-10-03T09:00:00+00:00', window_days: 30,
  software: [{ id: 'nuke', name: 'Foundry Nuke' }],
  videos: [
    { id: 'yt:a', platform: 'YouTube', title: 'old', channel: 'C', url: 'https://youtu.be/a', published: '2026-08-01T00:00:00+00:00', description: '', official: false, kind: 'tutorial', software: ['nuke'], score: 10 },
    { id: 'yt:b', platform: 'YouTube', title: 'new tutorial', channel: 'C', url: 'https://youtu.be/b', published: '2026-10-02T00:00:00+00:00', description: 'd', official: false, kind: 'tutorial', software: ['nuke'], score: 10 },
    { id: 'yt:c', platform: 'YouTube', title: 'official release', channel: 'F', url: 'https://youtu.be/c', published: '2026-10-01T00:00:00+00:00', description: '', official: true, kind: 'release', software: ['nuke'], score: 150 }
  ]
}

describe('GitHub feed', () => {
  it('parses and validates', () => {
    expect(parseFeed(JSON.stringify(feed)).videos).toHaveLength(3)
    expect(() => parseFeed('{not json')).toThrow(/valid JSON/)
    expect(() => parseFeed(JSON.stringify({ version: 2 }))).toThrow(/unexpected format/)
  })
  it('applies the window and ranks official/release first, then newest', () => {
    const v = feedToVideos(parseFeed(JSON.stringify(feed)), new Date('2026-09-25T00:00:00Z'))
    expect(v.map((x) => x.id)).toEqual(['yt:c', 'yt:b'])
    expect(v[0].isLive).toBe(false)
  })
})
