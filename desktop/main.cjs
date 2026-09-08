const { app, BrowserWindow, dialog, shell, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const PORT = Number(process.env.ZANTO_PORT || 8787);
const HOST = "127.0.0.1";
const APP_URL = `http://${HOST}:${PORT}/`;

/** @type {import('child_process').ChildProcess | null} */
let serverProc = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

function isDev() {
  return !app.isPackaged;
}

function serverRoot() {
  if (isDev()) {
    // Prefer desktop/.output (node-server build), else repo .output
    const desktopOut = path.join(__dirname, ".output");
    const repoOut = path.join(__dirname, "..", ".output");
    if (fs.existsSync(path.join(desktopOut, "server", "index.mjs"))) return desktopOut;
    return repoOut;
  }
  return path.join(process.resourcesPath, "app-server");
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function collectEnv() {
  const root = serverRoot();
  const fromServer = loadEnvFile(path.join(root, ".env"));
  const fromDesktop = loadEnvFile(path.join(__dirname, ".env"));
  const fromRepo = loadEnvFile(path.join(__dirname, "..", ".env"));
  const fromUser = loadEnvFile(path.join(app.getPath("userData"), "zanto.env"));
  return {
    ...process.env,
    ...fromRepo,
    ...fromDesktop,
    ...fromServer,
    ...fromUser,
    PORT: String(PORT),
    NITRO_PORT: String(PORT),
    HOST: HOST,
    ZANTO_DESKTOP: "1",
    VITE_ZANTO_DESKTOP: "1",
    ELECTRON_RUN_AS_NODE: "1",
  };
}

function waitForServer(timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(APP_URL, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error("Timeout: il server ZAnto non è partito."));
          return;
        }
        setTimeout(tick, 400);
      });
    };
    tick();
  });
}

function startServer() {
  const root = serverRoot();
  const entry = path.join(root, "server", "index.mjs");
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Server non trovato:\n${entry}\n\nEsegui prima: bun run desktop:build`,
    );
  }

  const env = collectEnv();
  // Use Electron binary as Node (ELECTRON_RUN_AS_NODE=1)
  serverProc = spawn(process.execPath, [entry], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  serverProc.stdout?.on("data", (buf) => {
    console.log(`[zanto-server] ${buf}`);
  });
  serverProc.stderr?.on("data", (buf) => {
    console.error(`[zanto-server] ${buf}`);
  });
  serverProc.on("exit", (code) => {
    console.log(`[zanto-server] exit ${code}`);
    serverProc = null;
  });
}

function stopServer() {
  if (!serverProc) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(serverProc.pid), "/f", "/t"], {
        windowsHide: true,
      });
    } else {
      serverProc.kill("SIGTERM");
    }
  } catch {
    /* ignore */
  }
  serverProc = null;
}

function probeOllama() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:11434/api/tags", { timeout: 2500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function showOllamaGuideIfNeeded() {
  const ok = await probeOllama();
  if (ok) return;
  const result = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: "warning",
    title: "Ollama non rilevato",
    message: "ZAnto Desktop usa Ollama in locale, ma non risponde su http://127.0.0.1:11434",
    detail:
      "1) Installa Ollama da https://ollama.com\n" +
      "2) Apri un terminale e lancia:\n   ollama pull llama3.2:1b\n" +
      "3) Assicurati che Ollama sia in esecuzione (icona nella system tray)\n" +
      "4) In ZAnto: Providers → Ollama → http://localhost:11434\n\n" +
      "Puoi comunque usare OpenRouter/Gemini se hai le chiavi.",
    buttons: ["Apri ollama.com", "Continua comunque", "Esci"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) {
    await shell.openExternal("https://ollama.com/download");
  } else if (result.response === 2) {
    app.quit();
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "ZAnto.AI Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  try {
    startServer();
    await waitForServer();
    await createWindow();
    await showOllamaGuideIfNeeded();
  } catch (error) {
    dialog.showErrorBox(
      "ZAnto Desktop — errore avvio",
      error instanceof Error ? error.message : String(error),
    );
    stopServer();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopServer();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

ipcMain.handle("zanto:probe-ollama", async () => probeOllama());
ipcMain.handle("zanto:open-external", async (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    await shell.openExternal(url);
  }
});
