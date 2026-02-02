import { contextBridge, ipcRenderer } from 'electron'

/**
 * Expose safe APIs to the renderer process via contextBridge
 * This keeps the main process secure while allowing necessary IPC
 */

// Type definitions for the exposed API
export interface ElectronAPI {
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<boolean>
    delete: (key: string) => Promise<boolean>
  }
  credentials: {
    encrypt: (plaintext: string) => Promise<string>
    decrypt: (encrypted: string) => Promise<string>
    isEncryptionAvailable: () => Promise<boolean>
  }
  platform: {
    info: () => Promise<{
      platform: string
      arch: string
      version: string
    }>
  }
}

const electronAPI: ElectronAPI = {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('store:delete', key),
  },
  credentials: {
    encrypt: (plaintext: string) => ipcRenderer.invoke('credentials:encrypt', plaintext),
    decrypt: (encrypted: string) => ipcRenderer.invoke('credentials:decrypt', encrypted),
    isEncryptionAvailable: () => ipcRenderer.invoke('credentials:isEncryptionAvailable'),
  },
  platform: {
    info: () => ipcRenderer.invoke('platform:info'),
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Declare the global type for TypeScript
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
