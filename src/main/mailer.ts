import nodemailer from 'nodemailer'
import type { EmailPayload } from '../shared/types'
import { getRaw, getSecrets } from './settings'

export async function sendEmail(p: EmailPayload): Promise<void> {
  const { email } = getRaw()
  const secrets = getSecrets()
  const missing: string[] = []
  if (!email.to) missing.push('recipient')
  if (!email.from) missing.push('sender')
  if (email.provider === 'resend' && !secrets.resendKey) missing.push('Resend API key')
  if (email.provider === 'smtp') {
    if (!email.smtpHost) missing.push('SMTP host')
    if (!email.smtpUser) missing.push('SMTP user')
    if (!secrets.smtpPassword) missing.push('SMTP password')
  }
  if (missing.length) throw new Error(`Email is not set up yet. Missing: ${missing.join(', ')}.`)
  const to = email.to.split(',').map((a) => a.trim()).filter(Boolean)

  if (email.provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secrets.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: email.from, to, subject: p.subject, text: p.text, html: p.html })
    })
    if (!res.ok) throw new Error(`Resend rejected the email (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`)
    return
  }
  const transport = nodemailer.createTransport({
    host: email.smtpHost, port: email.smtpPort, secure: email.smtpSecurity === 'ssl',
    requireTLS: email.smtpSecurity === 'starttls', ignoreTLS: email.smtpSecurity === 'none',
    auth: { user: email.smtpUser, pass: secrets.smtpPassword }
  })
  try {
    await transport.sendMail({ from: email.from, to, subject: p.subject, text: p.text, html: p.html })
  } catch (e) {
    const err = e as { code?: string; message: string }
    if (err.code === 'EAUTH') throw new Error('SMTP login failed. For Gmail, use an App Password, not your normal password.')
    throw new Error(`Email failed: ${err.message.replace(secrets.smtpPassword, '***')}`)
  }
}
