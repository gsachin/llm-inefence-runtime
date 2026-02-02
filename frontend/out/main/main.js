import { app, ipcMain, safeStorage, BrowserWindow } from "electron";
import { join } from "path";
import { spawn } from "child_process";
import log from "electron-log";
import Store from "electron-store";
import __cjs_url__ from "node:url";
import __cjs_path__ from "node:path";
import __cjs_mod__ from "node:module";
const __filename = __cjs_url__.fileURLToPath(import.meta.url);
const __dirname = __cjs_path__.dirname(__filename);
const require2 = __cjs_mod__.createRequire(import.meta.url);
log.transports.file.level = "info";
log.transports.console.level = "debug";
const store = new Store({
  name: "mlops-wizard-state",
  schema: {
    "wizard:currentStep": { type: "number", default: 0 },
    "wizard:selectedProfile": { type: "string", default: "" },
    "wizard:currentRelease": { type: "string", default: "" },
    "wizard:deployInProgress": { type: "boolean", default: false },
    "credentials:hfTokenEncrypted": { type: "string", default: "" }
  }
});
let mainWindow = null;
let backendProcess = null;
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
function startBackend() {
  if (backendProcess) {
    log.info("Backend already running");
    return;
  }
  const pythonPath = isDev ? join(process.cwd(), "..", ".venv", "bin", "python") : join(process.resourcesPath, "backend", ".venv", "bin", "python");
  const backendDir = isDev ? join(process.cwd(), "..") : join(process.resourcesPath, "backend");
  log.info(`Starting backend from: ${backendDir}`);
  backendProcess = spawn(
    pythonPath,
    ["-m", "uvicorn", "orchestrator.api.main:create_app", "--factory", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: backendDir,
      env: { ...process.env, PYTHONUNBUFFERED: "1" }
    }
  );
  backendProcess.stdout?.on("data", (data) => {
    log.info(`[Backend] ${data.toString().trim()}`);
  });
  backendProcess.stderr?.on("data", (data) => {
    log.warn(`[Backend] ${data.toString().trim()}`);
  });
  backendProcess.on("error", (err) => {
    log.error(`Backend failed to start: ${err.message}`);
  });
  backendProcess.on("close", (code) => {
    log.info(`Backend exited with code ${code}`);
    backendProcess = null;
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "MLOps Wizard",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:8000 ws://localhost:8000 ws://localhost:5173 ws://localhost:5174; img-src 'self' data: https:;" : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:8000 ws://localhost:8000; img-src 'self' data: https:;";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp]
      }
    });
  });
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
ipcMain.handle("store:get", (_event, key) => {
  return store.get(key);
});
ipcMain.handle("store:set", (_event, key, value) => {
  store.set(key, value);
  return true;
});
ipcMain.handle("store:delete", (_event, key) => {
  store.delete(key);
  return true;
});
ipcMain.handle("credentials:encrypt", (_event, plaintext) => {
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn("Encryption not available, falling back to base64");
    return Buffer.from(plaintext).toString("base64");
  }
  return safeStorage.encryptString(plaintext).toString("base64");
});
ipcMain.handle("credentials:decrypt", (_event, encrypted) => {
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(encrypted, "base64").toString("utf-8");
  }
  return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
});
ipcMain.handle("credentials:isEncryptionAvailable", () => {
  return safeStorage.isEncryptionAvailable();
});
ipcMain.handle("platform:info", () => {
  return {
    platform: process.platform,
    arch: process.arch,
    version: process.getSystemVersion()
  };
});
app.whenReady().then(() => {
  startBackend();
  setTimeout(() => {
    createWindow();
  }, 1500);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("before-quit", () => {
  if (backendProcess) {
    log.info("Stopping backend...");
    backendProcess.kill("SIGTERM");
  }
});
