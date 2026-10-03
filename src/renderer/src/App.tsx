import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DigestResult, EmailPayload, PublicSettings, UpdateStatus, Video, VideoKind } from '@shared/types'
import SettingsDrawer from './SettingsDrawer'
import UpdatePill from './UpdatePill'

const KIND_LABEL: Record<VideoKind, string> = {
  release: 'Release / News', tutorial: 'Tutorial', workflow: 'Workflow', webinar: 'Webinar', other: 'Other'
}
const WINDOWS = [
  { days: 1, label: 'Last 24 hours' }, { days: 2, label: 'Last 2 days' }, { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' }, { days: 30, label: 'Last 30 days' }
]
const colorVar = (id: string): CSSProperties =>
  ({ '--c': ['nuke', 'silhouette', 'mocha', 'comfyui'].includes(id) ? `var(--${id})` : 'var(--ink)' }) as CSSProperties

function fmt(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(new Date(iso))
  } catch { return iso }
}

const snippet = (v: Video, n = 180): string => {
  const t = v.description.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t
}

export default function App(): JSX.Element {
  const [version, setVersion] = useState('')
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [days, setDays] = useState(2)
  const [data, setData] = useState<DigestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [swFilter, setSwFilter] = useState<string>('all')
  const [kindFilter, setKindFilter] = useState<'all' | VideoKind>('all')
  const [hideEmailed, setHideEmailed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [preview, setPreview] = useState<EmailPayload | null>(null)
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null)
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  const [sending, setSending] = useState(false)

  const say = useCallback((msg: string, err = false) => {
    setToast({ msg, err })
    setTimeout(() => setToast(null), err ? 7000 : 3500)
  }, [])

  const refresh = useCallback(async (d: number) => {
    setLoading(true)
    const r = await window.api.runDigest(d)
    setLoading(false)
    if (r.ok) setData(r.data)
    else say(r.error, true)
  }, [say])

  useEffect(() => {
    void window.api.version().then(setVersion)
    void window.api.getSettings().then(setSettings)
    void window.api.update.getStatus().then(setUpdate)
    return window.api.update.onStatus(setUpdate)
  }, [])
  useEffect(() => { void refresh(days) }, [days, refresh])

  const tz = settings?.timezone ?? 'UTC'
  const emailed = useMemo(() => new Set(data?.emailed ?? []), [data])
  const visible = useMemo(
    () => (data?.videos ?? []).filter(
      (v) => (swFilter === 'all' || v.software.includes(swFilter)) &&
        (kindFilter === 'all' || v.kind === kindFilter) && !(hideEmailed && emailed.has(v.id))
    ),
    [data, swFilter, kindFilter, hideEmailed, emailed]
  )
  const names = useMemo(() => Object.fromEntries((data?.software ?? []).map((s) => [s.id, s.name])), [data])
  const lead = visible[0]
  const rest = lead ? visible.slice(1) : []
  const sections = (data?.software ?? [])
    .map((s) => ({ sw: s, items: rest.filter((v) => v.software[0] === s.id) }))
    .filter((g) => g.items.length)
  const max = settings?.maxItemsPerSoftware ?? 15

  const sendNow = async (): Promise<void> => {
    setSending(true)
    const r = await window.api.sendEmail(visible.map((v) => v.id))
    setSending(false)
    if (r.ok) { say(`Emailed ${r.data.sent} videos`); setPreview(null); void refresh(days) }
    else say(r.error, true)
  }
  const openPreview = async (): Promise<void> => {
    const r = await window.api.previewEmail(visible.map((v) => v.id))
    if (r.ok) setPreview(r.data)
    else say(r.error, true)
  }
  const open = (url: string): void => { void window.api.openExternal(url) }
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full' }).format(new Date())
  const synced = data?.feedGeneratedAt
    ? `synced from GitHub · feed built ${new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(new Date(data.feedGeneratedAt))}`
    : data ? 'live from YouTube' : ''

  const Story = ({ v, big }: { v: Video; big?: boolean }): JSX.Element => {
    const d = snippet(v, big ? 320 : 180)
    return (
      <article className={`story${emailed.has(v.id) ? ' dim' : ''}`} style={colorVar(v.software[0])}>
        <div className="meta">
          {v.official && <span className="tag official">Official</span>}
          <span className="tag">{KIND_LABEL[v.kind]}</span>
          <span>{v.channel}</span><span>{fmt(v.published, tz)}</span>
          {emailed.has(v.id) && <span>· emailed</span>}
        </div>
        <h4><a href={v.url} onClick={(e) => { e.preventDefault(); open(v.url) }}>{v.title}</a></h4>
        {settings?.summaries !== 'off' && d && <p className="desc">{d}</p>}
        {v.software.length > 1 && <div className="meta">Also covers: {v.software.slice(1).map((s) => names[s]).join(', ')}</div>}
        <button className="watch" onClick={() => open(v.url)}>Watch on {v.platform} →</button>
      </article>
    )
  }

  return (
    <div className="page">
      <div className="wrap">
        <header className="masthead">
          <div className="corner">
            {version && <span className="pill">v{version}</span>}
            <UpdatePill status={update} />
            <button className="ghost" onClick={() => setShowSettings(true)}>Settings</button>
          </div>
          <div className="kicker">Nuke · Silhouette · Mocha · ComfyUI</div>
          <h1>The AI &amp; VFX Digest</h1>
          <div className="dateline">{today} · {loading ? 'gathering…' : `${visible.length} video${visible.length === 1 ? '' : 's'}`}{synced && !loading ? ` · ${synced}` : ''}</div>
        </header>

        <div className="toolbar">
          <div className="group">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time window">
              {WINDOWS.map((w) => <option key={w.days} value={w.days}>{w.label}</option>)}
            </select>
          </div>
          <div className="group">
            <button className={`chip${swFilter === 'all' ? ' on' : ''}`} onClick={() => setSwFilter('all')}>All software</button>
            {(data?.software ?? []).map((s) => (
              <button key={s.id} className={`chip${swFilter === s.id ? ' on' : ''}`} onClick={() => setSwFilter(s.id)}>{s.name.replace(/^(Foundry|Boris FX) /, '')}</button>
            ))}
          </div>
          <div className="group">
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as 'all' | VideoKind)} aria-label="Type">
              <option value="all">All types</option>
              {(Object.keys(KIND_LABEL) as VideoKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={hideEmailed} onChange={(e) => setHideEmailed(e.target.checked)} /> Hide emailed</label>
          </div>
          <div className="spacer" />
          <button className="ghost" onClick={() => void refresh(days)} disabled={loading}>{loading ? <><span className="spin" />Refreshing</> : 'Refresh'}</button>
          <button className="primary" onClick={() => void openPreview()} disabled={!visible.length}>Email this digest…</button>
        </div>

        {loading && !data && <div className="empty"><span className="spin" />Gathering today&rsquo;s videos…</div>}
        {data && !visible.length && !loading && <div className="empty">No videos match. Try a longer window or clear a filter.</div>}

        {lead && (
          <section className="lead" style={colorVar(lead.software[0])}>
            <div className="meta">
              <span className="tag">Top story · {names[lead.software[0]]}</span>
              {lead.official && <span className="tag official">Official</span>}
              <span className="tag">{KIND_LABEL[lead.kind]}</span><span>{lead.channel}</span><span>{fmt(lead.published, tz)}</span>
            </div>
            <h2><a href={lead.url} onClick={(e) => { e.preventDefault(); open(lead.url) }}>{lead.title}</a></h2>
            {settings?.summaries !== 'off' && snippet(lead, 320) && <p>{snippet(lead, 320)}</p>}
            <button className="watch" style={{ marginTop: 10 }} onClick={() => open(lead.url)}>Watch on {lead.platform} →</button>
          </section>
        )}

        {sections.map(({ sw, items }) => (
          <section className="section" key={sw.id} style={colorVar(sw.id)}>
            <h3>{sw.name}<span className="count">{items.length} more</span></h3>
            <div className="grid">{items.slice(0, max).map((v) => <Story key={v.id} v={v} />)}</div>
            {items.length > max && <div className="more">…and {items.length - max} more (raise the limit in Settings).</div>}
          </section>
        ))}

        {data && data.warnings.length > 0 && (
          <ul className="warn">{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        )}
      </div>

      {showSettings && settings && (
        <SettingsDrawer
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => { setSettings(s); say('Settings saved'); void refresh(days) }}
          onError={(m) => say(m, true)}
          onInfo={(m) => say(m)}
        />
      )}
      {preview && (
        <>
          <div className="scrim" onClick={() => setPreview(null)} />
          <div className="modal" role="dialog" aria-label="Email preview">
            <header>
              <b>{preview.subject}</b>
              <button className="ghost" onClick={() => setPreview(null)}>Close</button>
              <button className="primary" onClick={() => void sendNow()} disabled={sending}>{sending ? 'Sending…' : `Send to ${settings?.email.to || 'your email'}`}</button>
            </header>
            <iframe title="preview" sandbox="" srcDoc={preview.html} />
          </div>
        </>
      )}
      {toast && <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
    </div>
  )
}
