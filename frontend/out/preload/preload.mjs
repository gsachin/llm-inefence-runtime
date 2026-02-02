import { contextBridge, ipcRenderer } from "electron";
const electronAPI = {
  store: {
    get: (key) => ipcRenderer.invoke("store:get", key),
    set: (key, value) => ipcRenderer.invoke("store:set", key, value),
    delete: (key) => ipcRenderer.invoke("store:delete", key)
  },
  credentials: {
    encrypt: (plaintext) => ipcRenderer.invoke("credentials:encrypt", plaintext),
    decrypt: (encrypted) => ipcRenderer.invoke("credentials:decrypt", encrypted),
    isEncryptionAvailable: () => ipcRenderer.invoke("credentials:isEncryptionAvailable")
  },
  platform: {
    info: () => ipcRenderer.invoke("platform:info")
  }
};
contextBridge.exposeInMainWorld("electronAPI", electronAPI);
