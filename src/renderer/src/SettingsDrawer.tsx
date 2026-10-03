import { useState } from 'react'
import type { PublicSettings, SettingsUpdate } from '@shared/types'

interface Props {
  settings: PublicSettings
  onClose: () => void
  onSaved: (s: PublicSettings) => void
  onError: (m: string) => void
  onInfo: (m: string) => void
}

export default function SettingsDrawer({ settings, onClose, onSaved, onError, onInfo }: Props): JSX.Element {
  const [dataSource, setDataSource] = useState(settings.dataSource)
  const [timezone, setTimezone] = useState(settings.timezone)
  const [summaries, setSummaries] = useState(settings.summaries)
  const [maxItems, setMaxItems] = useState(settings.maxItemsPerSoftware)
  const [shorts, setShorts] = useState(settings.includeShorts)
  const [ytKey, setYtKey] = useState('')
  const [e, setE] = useState(settings.email)
  const [smtpPw, setSmtpPw] = useState('')
  const [resendKey, setResendKey] = useState('')
  const [busy, setBusy] = useState(false)

  const build = (): SettingsUpdate => ({
    dataSource, timezone, summaries, maxItemsPerSoftware: maxItems, includeShorts: shorts,
    ...(ytKey ? { youtubeKey: ytKey } : {}),
    email: {
      provider: e.provider, to: e.to.trim(), from: e.from.trim(), smtpHost: e.smtpHost.trim(), smtpPort: e.smtpPort,
      smtpUser: e.smtpUser.trim(), smtpSecurity: e.smtpSecurity,
      ...(smtpPw ? { smtpPassword: smtpPw } : {}), ...(resendKey ? { resendKey } : {})
    }
  })

  const save = async (): Promise<PublicSettings | null> => {
    const r = await window.api.saveSettings(build())
    if (!r.ok) { onError(r.error); return null }
    return r.data
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label="Settings">
        <h2>Settings</h2>
        <div className="hint">Keys and passwords are stored encrypted on this PC and are never shown again.</div>

        <h5>Where videos come from</h5>
        <div className="field">
          <select value={dataSource} onChange={(x) => setDataSource(x.target.value as 'github' | 'live')}>
            <option value="github">GitHub feed (no key needed)</option>
            <option value="live">Live from YouTube (needs your API key)</option>
          </select>
          <div className="hint">GitHub feed: the daily GitHub run does the searching with its own key and publishes the result; this app just reads it, so it is at most a day old. Live: this app searches YouTube itself using the key below.</div>
        </div>

        <h5>YouTube</h5>
        <div className="field">
          <label>YouTube Data API key {settings.hasYoutubeKey && '(saved — type to replace)'}</label>
          <input type="password" value={ytKey} onChange={(x) => setYtKey(x.target.value)} placeholder={settings.hasYoutubeKey ? '••••••••' : 'AIza…'} />
          <div className="hint">Optional. Enables keyword searches that find creators beyond the channels in your sources file. Free (about 1,000 of 10,000 daily units).</div>
        </div>

        <h5>Email</h5>
        <div className="field">
          <label>Provider</label>
          <select value={e.provider} onChange={(x) => setE({ ...e, provider: x.target.value as 'smtp' | 'resend' })}>
            <option value="smtp">SMTP (Gmail etc.)</option>
            <option value="resend">Resend</option>
          </select>
        </div>
        <div className="field"><label>Send to</label><input type="text" value={e.to} onChange={(x) => setE({ ...e, to: x.target.value })} placeholder="you@example.com" /></div>
        <div className="field"><label>From</label><input type="text" value={e.from} onChange={(x) => setE({ ...e, from: x.target.value })} placeholder="AI VFX Digest <you@gmail.com>" /></div>
        {e.provider === 'smtp' ? (
          <>
            <div className="row">
              <div className="field" style={{ flex: 2 }}><label>SMTP host</label><input type="text" value={e.smtpHost} onChange={(x) => setE({ ...e, smtpHost: x.target.value })} /></div>
              <div className="field" style={{ flex: 1 }}><label>Port</label><input type="number" value={e.smtpPort} onChange={(x) => setE({ ...e, smtpPort: Number(x.target.value) })} /></div>
            </div>
            <div className="field">
              <label>Security</label>
              <select value={e.smtpSecurity} onChange={(x) => setE({ ...e, smtpSecurity: x.target.value as PublicSettings['email']['smtpSecurity'] })}>
                <option value="starttls">STARTTLS (587)</option><option value="ssl">SSL (465)</option><option value="none">None</option>
              </select>
            </div>
            <div className="field"><label>SMTP user</label><input type="text" value={e.smtpUser} onChange={(x) => setE({ ...e, smtpUser: x.target.value })} /></div>
            <div className="field">
              <label>SMTP password {e.hasSmtpPassword && '(saved — type to replace)'}</label>
              <input type="password" value={smtpPw} onChange={(x) => setSmtpPw(x.target.value)} placeholder={e.hasSmtpPassword ? '••••••••' : 'Gmail App Password'} />
              <div className="hint">Gmail needs an App Password (Google Account → Security → 2-Step Verification → App passwords).</div>
            </div>
          </>
        ) : (
          <div className="field">
            <label>Resend API key {e.hasResendKey && '(saved — type to replace)'}</label>
            <input type="password" value={resendKey} onChange={(x) => setResendKey(x.target.value)} placeholder={e.hasResendKey ? '••••••••' : 're_…'} />
          </div>
        )}
        <button className="ghost" disabled={busy} onClick={async () => {
          setBusy(true)
          const s = await save()
          if (s) { const r = await window.api.testEmail(); r.ok ? onInfo('Test email sent — check your inbox') : onError(r.error) }
          setBusy(false)
        }}>Send test email</button>

        <h5>Display</h5>
        <div className="field"><label>Timezone for dates</label><input type="text" value={timezone} onChange={(x) => setTimezone(x.target.value)} placeholder="Europe/London" /></div>
        <div className="field">
          <label>Descriptions</label>
          <select value={summaries} onChange={(x) => setSummaries(x.target.value as 'description' | 'off')}>
            <option value="description">Show creator&rsquo;s description</option><option value="off">Hide</option>
          </select>
        </div>
        <div className="field"><label>Max videos per software</label><input type="number" min={1} max={100} value={maxItems} onChange={(x) => setMaxItems(Number(x.target.value))} /></div>
        <label className="check"><input type="checkbox" checked={shorts} onChange={(x) => setShorts(x.target.checked)} /> Include YouTube Shorts</label>

        <h5>Sources</h5>
        <div className="hint">Channels, search terms and matching rules live in one editable file. Save it, then press Refresh.</div>
        <button className="ghost" onClick={async () => { const r = await window.api.openSources(); if (!r.ok) onError(r.error) }}>Open sources.yaml</button>

        <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
          <button className="primary" disabled={busy} onClick={async () => { const s = await save(); if (s) { onSaved(s); onClose() } }}>Save</button>
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </aside>
    </>
  )
}
