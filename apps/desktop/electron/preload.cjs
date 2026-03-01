const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lumen", {
  workspace: {
    getRoot: () => ipcRenderer.invoke("workspace:getRoot"),
    openFolder: () => ipcRenderer.invoke("workspace:openFolder"),
    list: (payload) => ipcRenderer.invoke("files:list", payload),
    read: (payload) => ipcRenderer.invoke("files:read", payload),
    write: (payload) => ipcRenderer.invoke("files:write", payload),
    create: (payload) => ipcRenderer.invoke("files:create", payload),
    mkdir: (payload) => ipcRenderer.invoke("files:mkdir", payload),
    rename: (payload) => ipcRenderer.invoke("files:rename", payload),
    delete: (payload) => ipcRenderer.invoke("files:delete", payload),
    search: (payload) => ipcRenderer.invoke("files:search", payload)
  },
  terminal: {
    create: (payload) => ipcRenderer.invoke("terminal:create", payload),
    list: () => ipcRenderer.invoke("terminal:list"),
    write: (payload) => ipcRenderer.invoke("terminal:write", payload),
    resize: (payload) => ipcRenderer.invoke("terminal:resize", payload),
    kill: (payload) => ipcRenderer.invoke("terminal:kill", payload),
    onData: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on("terminal:data", wrapped);
      return () => ipcRenderer.removeListener("terminal:data", wrapped);
    },
    onExit: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on("terminal:exit", wrapped);
      return () => ipcRenderer.removeListener("terminal:exit", wrapped);
    }
  },
  git: {
    status: () => ipcRenderer.invoke("git:status"),
    diff: (payload) => ipcRenderer.invoke("git:diff", payload),
    stage: (payload) => ipcRenderer.invoke("git:stage", payload),
    unstage: (payload) => ipcRenderer.invoke("git:unstage", payload),
    commit: (payload) => ipcRenderer.invoke("git:commit", payload),
    push: () => ipcRenderer.invoke("git:push")
  },
  settings: {
    load: () => ipcRenderer.invoke("settings:load"),
    save: (payload) => ipcRenderer.invoke("settings:save", payload)
  },
  llm: {
    test: (payload) => ipcRenderer.invoke("llm:test", payload),
    listModels: (payload) => ipcRenderer.invoke("llm:listModels", payload),
    installModel: (payload) => ipcRenderer.invoke("llm:installModel", payload),
    startStream: (payload) => ipcRenderer.invoke("llm:startStream", payload),
    abortStream: (payload) => ipcRenderer.invoke("llm:abortStream", payload),
    onChunk: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on("llm:chunk", wrapped);
      return () => ipcRenderer.removeListener("llm:chunk", wrapped);
    },
    onDone: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on("llm:done", wrapped);
      return () => ipcRenderer.removeListener("llm:done", wrapped);
    },
    onError: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on("llm:error", wrapped);
      return () => ipcRenderer.removeListener("llm:error", wrapped);
    },
    onStatus: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on("llm:status", wrapped);
      return () => ipcRenderer.removeListener("llm:status", wrapped);
    }
  },
  agent: {
    runCmd: (payload) => ipcRenderer.invoke("agent:runCmd", payload)
  },
  preview: {
    status: () => ipcRenderer.invoke("preview:status"),
    start: (payload) => ipcRenderer.invoke("preview:start", payload),
    stop: () => ipcRenderer.invoke("preview:stop")
  },
  audit: {
    list: () => ipcRenderer.invoke("audit:list"),
    clear: () => ipcRenderer.invoke("audit:clear"),
    onEntry: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on("audit:entry", wrapped);
      return () => ipcRenderer.removeListener("audit:entry", wrapped);
    }
  }
});
