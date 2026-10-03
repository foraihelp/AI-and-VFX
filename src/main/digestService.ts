import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DigestResult, EmailPayload, Video } from '../shared/types'
import { discover, httpGet } from './engine/discovery'
import { feedToVideos, parseFeed } from './engine/githubFeed'
import { buildEmail } from './engine/formatting'
import { select } from './engine/filtering'
import { loadSources } from './engine/sources'
import { sendEmail } from './mailer'
import { getRaw, getSecrets } from './settings'

export const FEED_URL = 'https://raw.githubusercontent.com/foraihelp/AI-and-VFX/main/state/feed.json'
const userSources = (): string => join(app.getPath('userData'), 'sources.yaml')
const emailedFile = (): string => join(app.getPath('userData'), 'emailed.json')
const bundledSources = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'sources.yaml') : join(app.getAppPath(), 'config', 'sources.yaml')

export function sourcesPath(): string {
  const p = userSources()
  if (!existsSync(p)) {
    mkdirSync(app.getPath('userData'), { recursive: true })
    copyFileSync(bundledSources(), p)
  }
  return p
}

function readEmailed(): Record<string, string> {
  try { return JSON.parse(readFileSync(emailedFile(), 'utf-8')) } catch { return {} }
}

let lastVideos: Video[] = []
let lastSoftware: DigestResult['software'] = []

export async function runDigest(windowDays: number): Promise<DigestResult> {
  const days = Math.min(60, Math.max(1, Math.round(windowDays)))
  if (getRaw().dataSource === 'github') return runFromGitHub(days)
  const sources = loadSources(sourcesPath())
  const s = getRaw()
  const apiKey = getSecrets().youtubeKey
  const now = new Date()
  const since = new Date(now.getTime() - days * 86_400_000)
  const { videos, warnings } = await discover(sources, { since, apiKey: apiKey || undefined })
  const chosen = select(videos, sources, { since, includeShorts: s.includeShorts })
  if (!apiKey && sources.searches.length) warnings.push('No YouTube API key: keyword searches were skipped (channel feeds only). Add a key in Settings for fuller results.')
  lastVideos = chosen
  lastSoftware = sources.software.map(({ id, name }) => ({ id, name }))
  return {
    videos: chosen, software: lastSoftware, warnings, generatedAt: now.toISOString(),
    windowDays: days, usedApi: !!apiKey, emailed: Object.keys(readEmailed()), source: 'live'
  }
}

/** Read the feed that the daily GitHub run publishes (no YouTube key needed on this PC). */
async function runFromGitHub(days: number): Promise<DigestResult> {
  let text: string
  try {
    text = await httpGet(FEED_URL)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(msg.includes('404')
      ? 'No feed on GitHub yet. Run the workflow with mode "refresh-feed" (Actions tab), then press Refresh.'
      : `Could not reach GitHub: ${msg}`)
  }
  const feed = parseFeed(text)
  const now = new Date()
  const videos = feedToVideos(feed, new Date(now.getTime() - days * 86_400_000))
  lastVideos = videos
  lastSoftware = feed.software
  const warnings: string[] = []
  const ageH = (now.getTime() - Date.parse(feed.generated_at)) / 3_600_000
  if (ageH > 36) warnings.push(`The GitHub feed is ${Math.round(ageH)} hours old. Run the workflow (mode "refresh-feed") to update it.`)
  if (days > feed.window_days) warnings.push(`The feed only covers the last ${feed.window_days} days.`)
  return {
    videos, software: feed.software, warnings, generatedAt: now.toISOString(), windowDays: days,
    usedApi: false, emailed: Object.keys(readEmailed()), source: 'github', feedGeneratedAt: feed.generated_at
  }
}

/** Build the same email as the daily GitHub digest from the videos currently on screen. */
export function buildDigestEmail(ids?: string[]): { payload: EmailPayload; videos: Video[] } {
  const s = getRaw()
  const pick = ids ? lastVideos.filter((v) => ids.includes(v.id)) : lastVideos
  const payload = buildEmail(pick, lastSoftware, { tz: s.timezone, summaries: s.summaries, maxPer: s.maxItemsPerSoftware, now: new Date() })
  return { payload, videos: pick }
}

export async function emailDigest(ids?: string[]): Promise<{ sent: number }> {
  const { payload, videos } = buildDigestEmail(ids)
  await sendEmail(payload)
  const emailed = readEmailed()
  const stamp = new Date().toISOString()
  for (const v of videos) emailed[v.id] = stamp
  writeFileSync(emailedFile(), JSON.stringify(emailed))
  return { sent: videos.length }
}

export async function emailTest(): Promise<void> {
  await sendEmail({
    subject: 'AI VFX Digest: test email',
    text: 'If you can read this, email delivery from the desktop app works.',
    html: '<p>If you can read this, email delivery from the desktop app works.</p>'
  })
}
