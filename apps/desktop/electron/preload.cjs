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
    search: (payload) => ipcRenderer.invoke("files:search", payload),
    inspect: (payload) => ipcRenderer.invoke("workspace:inspect", payload)
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
    push: (payload) => ipcRenderer.invoke("git:push", payload),
    merge: (payload) => ipcRenderer.invoke("git:merge", payload),
    rebase: (payload) => ipcRenderer.invoke("git:rebase", payload),
    cherryPick: (payload) => ipcRenderer.invoke("git:cherryPick", payload),
    branches: () => ipcRenderer.invoke("git:branches"),
    checkout: (payload) => ipcRenderer.invoke("git:checkout", payload),
    history: (payload) => ipcRenderer.invoke("git:history", payload),
    restore: (payload) => ipcRenderer.invoke("git:restore", payload),
    conflicts: () => ipcRenderer.invoke("git:conflicts"),
    resolveConflict: (payload) => ipcRenderer.invoke("git:resolveConflict", payload)
  },
  policy: {
    get: () => ipcRenderer.invoke("policy:get"),
    setPreset: (payload) => ipcRenderer.invoke("policy:setPreset", payload),
    evaluate: (payload) => ipcRenderer.invoke("policy:evaluate", payload)
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
    runCmd: (payload) => ipcRenderer.invoke("agent:runCmd", payload),
    setMode: (payload) => ipcRenderer.invoke("agent:setMode", payload),
    getTaskGraph: () => ipcRenderer.invoke("agent:getTaskGraph")
  },
  preview: {
    status: () => ipcRenderer.invoke("preview:status"),
    start: (payload) => ipcRenderer.invoke("preview:start", payload),
    startProject: (payload) => ipcRenderer.invoke("preview:startProject", payload),
    stop: () => ipcRenderer.invoke("preview:stop"),
    browserConnect: (payload) => ipcRenderer.invoke("preview:browserConnect", payload),
    browserSnapshot: (payload) => ipcRenderer.invoke("preview:browserSnapshot", payload),
    browserDiagnostics: (payload) => ipcRenderer.invoke("preview:browserDiagnostics", payload),
    browserScreenshot: (payload) => ipcRenderer.invoke("preview:browserScreenshot", payload),
    browserClick: (payload) => ipcRenderer.invoke("preview:browserClick", payload),
    browserType: (payload) => ipcRenderer.invoke("preview:browserType", payload),
    browserPress: (payload) => ipcRenderer.invoke("preview:browserPress", payload),
    browserPick: (payload) => ipcRenderer.invoke("preview:browserPick", payload),
    browserClose: () => ipcRenderer.invoke("preview:browserClose")
  },
  runtime: {
    setLowResourceMode: (payload) => ipcRenderer.invoke("runtime:setLowResourceMode", payload),
    getHealth: () => ipcRenderer.invoke("runtime:getHealth")
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
