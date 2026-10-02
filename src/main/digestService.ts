import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DigestResult, EmailPayload, Video } from '../shared/types'
import { discover } from './engine/discovery'
import { buildEmail } from './engine/formatting'
import { select } from './engine/filtering'
import { loadSources } from './engine/sources'
import { sendEmail } from './mailer'
import { getRaw, getSecrets } from './settings'

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
    windowDays: days, usedApi: !!apiKey, emailed: Object.keys(readEmailed())
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
