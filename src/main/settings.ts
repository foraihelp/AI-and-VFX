import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PublicSettings, SettingsUpdate } from '../shared/types'

interface Stored {
  timezone: string
  summaries: 'description' | 'off'
  maxItemsPerSoftware: number
  includeShorts: boolean
  youtubeKey: string // encrypted, base64
  email: {
    provider: 'smtp' | 'resend'
    to: string
    from: string
    smtpHost: string
    smtpPort: number
    smtpUser: string
    smtpSecurity: 'starttls' | 'ssl' | 'none'
    smtpPassword: string // encrypted
    resendKey: string // encrypted
  }
}

const DEFAULTS: Stored = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  summaries: 'description',
  maxItemsPerSoftware: 15,
  includeShorts: false,
  youtubeKey: '',
  email: {
    provider: 'smtp', to: '', from: '', smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpUser: '',
    smtpSecurity: 'starttls', smtpPassword: '', resendKey: ''
  }
}

const file = (): string => join(app.getPath('userData'), 'settings.json')

/** Secrets are encrypted with the OS keychain (Windows DPAPI) via Electron safeStorage. */
const enc = (plain: string): string =>
  !plain ? '' : safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(plain).toString('base64') : 'raw:' + Buffer.from(plain).toString('base64')
const dec = (stored: string): string => {
  if (!stored) return ''
  try {
    const [kind, data] = [stored.slice(0, 3), stored.slice(4)]
    return kind === 'enc' ? safeStorage.decryptString(Buffer.from(data, 'base64')) : Buffer.from(data, 'base64').toString()
  } catch {
    return ''
  }
}

function load(): Stored {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf-8'))
    return { ...DEFAULTS, ...raw, email: { ...DEFAULTS.email, ...(raw.email ?? {}) } }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

function save(s: Stored): void {
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(s, null, 2))
}

export function getPublicSettings(): PublicSettings {
  const s = load()
  const { smtpPassword, resendKey, ...email } = s.email
  return {
    timezone: s.timezone, summaries: s.summaries, maxItemsPerSoftware: s.maxItemsPerSoftware,
    includeShorts: s.includeShorts, hasYoutubeKey: !!s.youtubeKey,
    email: { ...email, hasSmtpPassword: !!smtpPassword, hasResendKey: !!resendKey }
  }
}

export function getSecrets(): { youtubeKey: string; smtpPassword: string; resendKey: string } {
  const s = load()
  return { youtubeKey: dec(s.youtubeKey), smtpPassword: dec(s.email.smtpPassword), resendKey: dec(s.email.resendKey) }
}

export function getRaw(): Stored {
  return load()
}

export function updateSettings(u: SettingsUpdate): PublicSettings {
  const s = load()
  if (u.timezone !== undefined) {
    try { new Intl.DateTimeFormat('en-GB', { timeZone: u.timezone }); s.timezone = u.timezone } catch { throw new Error(`"${u.timezone}" is not a valid timezone name`) }
  }
  if (u.summaries) s.summaries = u.summaries
  if (u.maxItemsPerSoftware !== undefined) s.maxItemsPerSoftware = Math.min(100, Math.max(1, Math.round(u.maxItemsPerSoftware)))
  if (u.includeShorts !== undefined) s.includeShorts = u.includeShorts
  if (u.youtubeKey !== undefined) s.youtubeKey = enc(u.youtubeKey.trim())
  if (u.email) {
    const { smtpPassword, resendKey, ...rest } = u.email
    Object.assign(s.email, rest)
    if (smtpPassword !== undefined) s.email.smtpPassword = enc(smtpPassword)
    if (resendKey !== undefined) s.email.resendKey = enc(resendKey.trim())
  }
  save(s)
  return getPublicSettings()
}

export const settingsFileExists = (): boolean => existsSync(file())
