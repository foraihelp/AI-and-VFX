import type { UpdateStatus } from '@shared/types'

export default function UpdatePill({ status }: { status: UpdateStatus }): JSX.Element | null {
  switch (status.state) {
    case 'unsupported':
      return null // dev build: never touch the network
    case 'idle':
      return <button className="pill" onClick={() => void window.api.update.check()}>Check for updates</button>
    case 'checking':
      return <span className="pill"><span className="spin" />Checking for updates…</span>
    case 'available':
      return <span className="pill"><span className="spin" />Update v{status.version} found…</span>
    case 'downloading':
      return <span className="pill">Downloading {Math.round(status.percent)}%</span>
    case 'downloaded':
      return <button className="pill go" onClick={() => void window.api.update.install()}>Update v{status.version} ready — Restart &amp; Install</button>
    case 'not-available':
      return <button className="pill" onClick={() => void window.api.update.check()}>You&rsquo;re up to date</button>
    case 'error':
      return <button className="pill bad" title={status.message} onClick={() => void window.api.update.check()}>Update check failed — Retry</button>
    default:
      return null
  }
}
