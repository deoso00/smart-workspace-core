const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zantoDesktop", {
  isDesktop: true,
  probeOllama: () => ipcRenderer.invoke("zanto:probe-ollama"),
  openExternal: (url) => ipcRenderer.invoke("zanto:open-external", url),
});
