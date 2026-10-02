/** Same email layout as the Python/GitHub digest (video_digest/formatting.py). */
import type { EmailPayload, SoftwareDef, Video } from '../../shared/types'

const KIND_LABEL: Record<string, string> = {
  release: 'Release / News', tutorial: 'Tutorial', workflow: 'Workflow', webinar: 'Webinar', other: 'Other'
}
const SNIPPET_CHARS = 200

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

/** e.g. "01 Oct 2026, 09:00 UTC" */
export function fmtDate(iso: string, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23', timeZoneName: 'short'
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value])
  )
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.timeZoneName}`
}

const fmtDay = (d: Date, tz: string): string => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' })
      .formatToParts(d).map((x) => [x.type, x.value])
  )
  return `${p.day} ${p.month} ${p.year}`
}

/** First part of the creator's own description (never generated text). */
export function snippet(v: Video): string {
  let t = v.description.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  if (t.length > SNIPPET_CHARS) t = t.slice(0, SNIPPET_CHARS).replace(/\s+\S*$/, '') + '…'
  return t
}

export function groupBySoftware(videos: Video[], software: { id: string; name: string }[], maxPer: number) {
  return software
    .map((sw) => {
      const items = videos.filter((v) => v.software[0] === sw.id)
      return { sw, shown: items.slice(0, maxPer), hidden: Math.max(0, items.length - maxPer), total: items.length }
    })
    .filter((g) => g.total > 0)
}

export function buildEmail(
  videos: Video[],
  software: Pick<SoftwareDef, 'id' | 'name'>[],
  o: { tz: string; summaries: 'description' | 'off'; maxPer: number; now: Date }
): EmailPayload {
  const names = Object.fromEntries(software.map((s) => [s.id, s.name]))
  const day = fmtDay(o.now, o.tz)
  const n = videos.length
  if (!n) {
    const body = 'No new videos today for Nuke, Silhouette, Mocha or ComfyUI.'
    return { subject: `AI & VFX video digest - ${day}: no new videos`, text: body, html: `<p>${escapeHtml(body)}</p>` }
  }
  const plural = n !== 1 ? 's' : ''
  const lines = [`AI & VFX video digest - ${day}`, `${n} new video${plural}`, '']
  const h = [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;color:#222">',
    '<h2 style="margin-bottom:0">AI &amp; VFX video digest</h2>',
    `<p style="color:#666;margin-top:4px">${escapeHtml(day)} &middot; ${n} new video${plural}</p>`
  ]
  for (const g of groupBySoftware(videos, software, o.maxPer)) {
    lines.push(`== ${g.sw.name} (${g.total}) ==`, '')
    h.push(
      `<h3 style="border-bottom:2px solid #ddd;padding-bottom:4px">${escapeHtml(g.sw.name)} <span style="color:#888;font-weight:normal">(${g.total})</span></h3>`
    )
    for (const v of g.shown) {
      const label = (KIND_LABEL[v.kind] ?? 'Other') + (v.official ? ' - Official' : '')
      const also = v.software.slice(1).map((s) => names[s]).filter(Boolean)
      const meta = `${v.channel} | ${fmtDate(v.published, o.tz)} | ${v.platform} | ${label}`
      lines.push(v.title, `  ${meta}`)
      h.push(
        `<div style="margin:0 0 14px 0"><a href="${escapeHtml(v.url)}" style="font-size:15px;font-weight:bold;color:#1a56c4;text-decoration:none">${escapeHtml(v.title)}</a><br><span style="color:#555;font-size:13px">${escapeHtml(meta)}</span>`
      )
      if (also.length) {
        lines.push(`  Also covers: ${also.join(', ')}`)
        h.push(`<br><span style="color:#555;font-size:13px">Also covers: ${escapeHtml(also.join(', '))}</span>`)
      }
      if (o.summaries === 'description' && snippet(v)) {
        lines.push(`  Description: ${snippet(v)}`)
        h.push(`<br><span style="font-size:13px;color:#333">${escapeHtml(snippet(v))}</span>`)
      }
      lines.push(`  ${v.url}`, '')
      h.push('</div>')
    }
    if (g.hidden) {
      lines.push(`  ...and ${g.hidden} more`, '')
      h.push(`<p style="color:#888">...and ${g.hidden} more.</p>`)
    }
  }
  h.push('<p style="color:#999;font-size:12px">Titles, channels and descriptions are shown as published by the creators.</p></div>')
  return { subject: `AI & VFX video digest - ${day}: ${n} new video${plural}`, text: lines.join('\n'), html: h.join('\n') }
}
