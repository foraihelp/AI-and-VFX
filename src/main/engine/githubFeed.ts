import type { Video, VideoKind } from '../../shared/types'

export interface FeedFile {
  version: number
  generated_at: string
  window_days: number
  software: { id: string; name: string }[]
  videos: {
    id: string; platform: string; title: string; channel: string; url: string; published: string
    description: string; official: boolean; kind: VideoKind; software: string[]; score: number
  }[]
}

export function parseFeed(text: string): FeedFile {
  let data: FeedFile
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('The GitHub feed file is not valid JSON.')
  }
  if (data.version !== 1 || !Array.isArray(data.videos) || !Array.isArray(data.software)) {
    throw new Error('The GitHub feed has an unexpected format. Update the app to the latest version.')
  }
  return data
}

/** Keep only videos inside the window, ranked like the digest (official/release first, then newest). */
export function feedToVideos(feed: FeedFile, since: Date): Video[] {
  return feed.videos
    .filter((v) => Date.parse(v.published) >= since.getTime() && v.software.length > 0)
    .map((v): Video => ({
      ...v, source: 'github feed', isLive: false, hint: [], trustHint: false
    }))
    .sort((a, b) => b.score - a.score || Date.parse(b.published) - Date.parse(a.published))
}
