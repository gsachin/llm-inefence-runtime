/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
  readonly BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Electron API typings
interface ElectronStoreAPI {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

interface ElectronCredentialsAPI {
  encrypt: (plaintext: string) => Promise<string>
  decrypt: (encrypted: string) => Promise<string>
  isEncryptionAvailable: () => Promise<boolean>
}

interface ElectronAPI {
  store: ElectronStoreAPI
  credentials: ElectronCredentialsAPI
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
