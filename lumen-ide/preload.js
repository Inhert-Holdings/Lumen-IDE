const { contextBridge, ipcRenderer } = require("electron");

// Secure IPC surface for Nyx + settings (placeholder until full API hardening).
contextBridge.exposeInMainWorld("lumen", {
  nyx: {
    sendToNyx: (content) => ipcRenderer.invoke("nyx:send", { content })
  },
  settings: {
    load: () => ipcRenderer.invoke("settings:load"),
    save: (settings) => ipcRenderer.invoke("settings:save", settings)
  }
});
