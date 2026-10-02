import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { SettingsUpdate } from '../shared/types'
import { buildDigestEmail, emailDigest, emailTest, runDigest, sourcesPath } from './digestService'
import { getPublicSettings, updateSettings } from './settings'
import { setupAutoUpdater } from './updater'

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 880, minHeight: 600,
    icon: join(__dirname, '../../build/icon.png'), backgroundColor: '#f4efe4', title: 'AI VFX Digest', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), contextIsolation: true, sandbox: false }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') && !url.startsWith('http://localhost')) e.preventDefault() })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const wrap = <A extends unknown[], T>(fn: (...a: A) => T | Promise<T>) =>
  async (_e: unknown, ...a: A): Promise<Result<T>> => {
    try { return { ok: true, data: await fn(...a) } } catch (e) { return { ok: false, error: errText(e) } }
  }

app.whenReady().then(() => {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('digest:run', wrap((days: number) => runDigest(days)))
  ipcMain.handle('digest:preview', wrap((ids?: string[]) => buildDigestEmail(ids).payload))
  ipcMain.handle('email:send', wrap((ids?: string[]) => emailDigest(ids)))
  ipcMain.handle('email:test', wrap(() => emailTest()))
  ipcMain.handle('settings:get', () => getPublicSettings())
  ipcMain.handle('settings:save', wrap((u: SettingsUpdate) => updateSettings(u)))
  ipcMain.handle('sources:open', wrap(() => shell.openPath(sourcesPath())))
  ipcMain.handle('open:external', (_e, url: string) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url) })
  const win = createWindow()
  setupAutoUpdater(win)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
