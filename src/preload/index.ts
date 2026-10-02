import { contextBridge, ipcRenderer } from 'electron'
import type { DigestResult, EmailPayload, PublicSettings, SettingsUpdate, UpdateStatus } from '../shared/types'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const call = <T>(ch: string, ...a: unknown[]): Promise<Result<T>> => ipcRenderer.invoke(ch, ...a)

const api = {
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  runDigest: (days: number) => call<DigestResult>('digest:run', days),
  previewEmail: (ids?: string[]) => call<EmailPayload>('digest:preview', ids),
  sendEmail: (ids?: string[]) => call<{ sent: number }>('email:send', ids),
  testEmail: () => call<void>('email:test'),
  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (u: SettingsUpdate) => call<PublicSettings>('settings:save', u),
  openSources: () => call<string>('sources:open'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open:external', url),
  update: {
    check: (): Promise<void> => ipcRenderer.invoke('update:check'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    getStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:getStatus'),
    onStatus: (cb: (s: UpdateStatus) => void): (() => void) => {
      const h = (_: unknown, s: UpdateStatus): void => cb(s)
      ipcRenderer.on('update:status', h)
      return () => ipcRenderer.removeListener('update:status', h)
    }
  }
}
contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
