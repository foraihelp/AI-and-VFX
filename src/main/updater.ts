import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

const { autoUpdater } = electronUpdater

let latestStatus: UpdateStatus = { state: 'idle' }

function broadcast(mainWindow: BrowserWindow, status: UpdateStatus): void {
  latestStatus = status
  mainWindow.webContents.send('update:status', status)
}

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) {
    latestStatus = { state: 'unsupported' }
    ipcMain.handle('update:check', async () => {
      broadcast(mainWindow, { state: 'unsupported' })
    })
    ipcMain.handle('update:install', () => {})
    ipcMain.handle('update:getStatus', () => latestStatus)
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    broadcast(mainWindow, { state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    broadcast(mainWindow, { state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    broadcast(mainWindow, { state: 'not-available' })
  })
  autoUpdater.on('download-progress', (progress) => {
    broadcast(mainWindow, { state: 'downloading', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    broadcast(mainWindow, { state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    broadcast(mainWindow, { state: 'error', message: err.message })
  })

  ipcMain.handle('update:check', async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      broadcast(mainWindow, { state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('update:getStatus', () => latestStatus)

  // Silent check shortly after launch; failures are surfaced via the 'error' event, not thrown.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 3000)
}
