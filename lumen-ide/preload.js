const { contextBridge, ipcRenderer } = require("electron");

// Secure IPC surface for Nyx + settings (placeholder until full API hardening).
contextBridge.exposeInMainWorld("lumen", {
  nyx: {
    send: (payload) => ipcRenderer.invoke("nyx:send", payload),
    suggestions: () => ipcRenderer.invoke("nyx:suggestions"),
    // Back-compat for older renderer calls.
    sendToNyx: (content) => ipcRenderer.invoke("nyx:send", { fileContent: content })
  },
  settings: {
    load: () => ipcRenderer.invoke("settings:load"),
    save: (settings) => ipcRenderer.invoke("settings:save", settings)
  },
  explorer: {
    list: (options) => ipcRenderer.invoke("explorer:list", options),
    selectRoot: () => ipcRenderer.invoke("explorer:selectRoot"),
    read: (filePath) => ipcRenderer.invoke("explorer:read", { path: filePath })
  }
});
