/**
 * Persistent state manager for the wizard
 * Uses Electron's secure storage when available, falls back to localStorage
 */

export interface WizardState {
  currentStep: number
  selectedProfile: string
  currentRelease: string
  deployInProgress: boolean
  dependenciesReady: boolean
}

const DEFAULT_STATE: WizardState = {
  currentStep: 0,
  selectedProfile: '',
  currentRelease: '',
  deployInProgress: false,
  dependenciesReady: false,
}

// Check if we're running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined

/**
 * Get a value from persistent storage
 */
export async function getState<K extends keyof WizardState>(key: K): Promise<WizardState[K]> {
  if (isElectron && window.electronAPI) {
    const value = await window.electronAPI.store.get(`wizard:${key}`)
    return (value as WizardState[K]) ?? DEFAULT_STATE[key]
  }

  const stored = localStorage.getItem(`wizard:${key}`)
  if (stored === null) {
    return DEFAULT_STATE[key]
  }

  try {
    return JSON.parse(stored) as WizardState[K]
  } catch {
    return stored as WizardState[K]
  }
}

/**
 * Set a value in persistent storage
 */
export async function setState<K extends keyof WizardState>(key: K, value: WizardState[K]): Promise<void> {
  if (isElectron && window.electronAPI) {
    await window.electronAPI.store.set(`wizard:${key}`, value)
    return
  }

  localStorage.setItem(`wizard:${key}`, JSON.stringify(value))
}

/**
 * Clear a value from persistent storage
 */
export async function clearState<K extends keyof WizardState>(key: K): Promise<void> {
  if (isElectron && window.electronAPI) {
    await window.electronAPI.store.delete(`wizard:${key}`)
    return
  }

  localStorage.removeItem(`wizard:${key}`)
}

/**
 * Get the full wizard state
 */
export async function getFullState(): Promise<WizardState> {
  return {
    currentStep: await getState('currentStep'),
    selectedProfile: await getState('selectedProfile'),
    currentRelease: await getState('currentRelease'),
    deployInProgress: await getState('deployInProgress'),
    dependenciesReady: await getState('dependenciesReady'),
  }
}

/**
 * Reset all wizard state
 */
export async function resetState(): Promise<void> {
  await setState('currentStep', 0)
  await setState('selectedProfile', '')
  await setState('currentRelease', '')
  await setState('deployInProgress', false)
  await setState('dependenciesReady', false)
}

/**
 * Encrypt a credential using OS keychain (Electron only)
 */
export async function encryptCredential(plaintext: string): Promise<string> {
  if (isElectron && window.electronAPI) {
    return window.electronAPI.credentials.encrypt(plaintext)
  }
  // In browser, return base64 encoded (NOT secure - for dev only)
  console.warn('Credential encryption not available in browser mode')
  return btoa(plaintext)
}

/**
 * Decrypt a credential using OS keychain (Electron only)
 */
export async function decryptCredential(encrypted: string): Promise<string> {
  if (isElectron && window.electronAPI) {
    return window.electronAPI.credentials.decrypt(encrypted)
  }
  return atob(encrypted)
}

/**
 * Check if encryption is available
 */
export async function isEncryptionAvailable(): Promise<boolean> {
  if (isElectron && window.electronAPI) {
    return window.electronAPI.credentials.isEncryptionAvailable()
  }
  return false
}
