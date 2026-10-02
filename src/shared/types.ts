export type VideoKind = 'release' | 'webinar' | 'workflow' | 'tutorial' | 'other'

export interface Video {
  id: string // canonical, e.g. "yt:abc123"
  platform: string
  title: string
  channel: string
  url: string
  published: string // ISO, UTC
  description: string
  official: boolean
  source: string
  durationSeconds?: number
  isLive: boolean
  software: string[]
  kind: VideoKind
  score: number
  hint: string[]
  trustHint: boolean
}

export interface SoftwareDef {
  id: string
  name: string
  strong: string[]
  weak: string[]
  context: string[]
  exclude: string[]
  enabled: boolean
}

export interface Sources {
  software: SoftwareDef[]
  channels: Record<string, unknown>[]
  searches: Record<string, unknown>[]
  feeds: Record<string, unknown>[]
  excludeTitleTerms: string[]
  typeRules: Record<string, string[]>
}

export interface DigestResult {
  videos: Video[]
  software: { id: string; name: string }[]
  warnings: string[]
  generatedAt: string
  windowDays: number
  usedApi: boolean
  emailed: string[] // ids already emailed
}

export interface PublicSettings {
  timezone: string
  summaries: 'description' | 'off'
  maxItemsPerSoftware: number
  includeShorts: boolean
  hasYoutubeKey: boolean
  email: {
    provider: 'smtp' | 'resend'
    to: string
    from: string
    smtpHost: string
    smtpPort: number
    smtpUser: string
    smtpSecurity: 'starttls' | 'ssl' | 'none'
    hasSmtpPassword: boolean
    hasResendKey: boolean
  }
}

/** Fields the user can change. Secrets are write-only: undefined = keep, '' = clear. */
export interface SettingsUpdate {
  timezone?: string
  summaries?: 'description' | 'off'
  maxItemsPerSoftware?: number
  includeShorts?: boolean
  youtubeKey?: string
  email?: Partial<Omit<PublicSettings['email'], 'hasSmtpPassword' | 'hasResendKey'>> & {
    smtpPassword?: string
    resendKey?: string
  }
}

export type UpdateStatus =
  | { state: 'unsupported' }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'not-available' }
  | { state: 'error'; message: string }

export interface EmailPayload {
  subject: string
  text: string
  html: string
}
