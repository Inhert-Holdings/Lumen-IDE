function registerIpcHandlers(deps) {
  const {
    ipcMain,
    dialog,
    fs,
    path,
    getWorkspaceRoot,
    setWorkspaceRoot,
    saveWorkspaceRoot,
    stopPreview,
    syncWorkspaceWatcher,
    scheduleWorkspaceIndex,
    audit,
    terminals,
    killTerminal,
    listDir,
    readFile,
    writeFile,
    createFile,
    createDirectory,
    renamePath,
    deletePath,
    searchFiles,
    inspectProject,
    createTerminal,
    listTerminals,
    writeTerminal,
    resizeTerminal,
    loadSettings,
    saveSettings,
    getPolicyState,
    setPolicyPreset,
    evaluatePolicyDecision,
    agentRuntimeState,
    testLlmConnection,
    listLlmModels,
    installLlmModel,
    startLlmStream,
    stopLlmStream,
    runCommand,
    getPreviewStatus,
    enforceAgentPolicy,
    startPreviewServer,
    startPreviewProject,
    connectPreviewBrowser,
    snapshotPreviewBrowser,
    getPreviewBrowserDiagnostics,
    screenshotPreviewBrowser,
    clickPreviewBrowser,
    typePreviewBrowser,
    pressPreviewBrowser,
    pickPreviewBrowserSelector,
    closePreviewBrowser,
    setLowResourceMode,
    getRuntimeHealth,
    gitStatus,
    gitDiff,
    gitStage,
    gitUnstage,
    gitCommit,
    gitPush,
    gitMerge,
    gitRebase,
    gitCherryPick,
    gitBranches,
    gitCheckoutBranch,
    gitHistory,
    gitRestore,
    gitConflicts,
    gitResolveConflict,
    loadAudit,
    getUserDataPath,
    AUDIT_FILE
  } = deps;

  async function switchWorkspaceRoot(nextRoot, source = "manual") {
    setWorkspaceRoot(nextRoot);
    saveWorkspaceRoot(nextRoot);
    await stopPreview("workspace_changed");
    syncWorkspaceWatcher("workspace_changed");
    scheduleWorkspaceIndex("workspace_changed");
    audit("workspace.open", { root: nextRoot, source });

    for (const terminalId of Array.from(terminals.keys())) {
      killTerminal(terminalId);
    }
  }

  ipcMain.handle("workspace:getRoot", async () => ({ root: getWorkspaceRoot() }));
  ipcMain.handle("workspace:openFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select workspace folder"
    });

    if (result.canceled || !result.filePaths?.length) return { cancelled: true, root: getWorkspaceRoot() };

    const nextRoot = path.resolve(result.filePaths[0]);
    await switchWorkspaceRoot(nextRoot, "dialog");

    return { cancelled: false, root: nextRoot };
  });
  ipcMain.handle("workspace:setRoot", async (_event, payload) => {
    const rawRoot = String(payload?.root || "").trim();
    if (!rawRoot) {
      throw new Error("Workspace path is required.");
    }
    const nextRoot = path.resolve(rawRoot);
    if (!fs.existsSync(nextRoot)) {
      throw new Error("Workspace path does not exist.");
    }
    if (!fs.statSync(nextRoot).isDirectory()) {
      throw new Error("Workspace path must be a directory.");
    }
    await switchWorkspaceRoot(nextRoot, String(payload?.source || "command_palette"));
    return { ok: true, root: nextRoot };
  });

  ipcMain.handle("files:list", async (_event, payload) => {
    return listDir(payload?.path);
  });
  ipcMain.handle("files:read", async (_event, payload) => readFile(payload.path));
  ipcMain.handle("files:write", async (_event, payload) => writeFile(payload.path, payload.content, payload));
  ipcMain.handle("files:create", async (_event, payload) => createFile(payload.path));
  ipcMain.handle("files:mkdir", async (_event, payload) => createDirectory(payload.path));
  ipcMain.handle("files:rename", async (_event, payload) => renamePath(payload.path, payload.nextPath));
  ipcMain.handle("files:delete", async (_event, payload) => deletePath(payload.path, payload));
  ipcMain.handle("files:search", async (_event, payload) => ({ results: searchFiles(payload.query, payload.maxResults) }));
  ipcMain.handle("workspace:inspect", async (_event, payload) => inspectProject(payload || {}));

  ipcMain.handle("terminal:create", async (_event, payload) => createTerminal(payload || {}));
  ipcMain.handle("terminal:list", async () => ({ terminals: listTerminals() }));
  ipcMain.handle("terminal:write", async (_event, payload) => {
    writeTerminal(payload.id, payload.data);
    return { ok: true };
  });
  ipcMain.handle("terminal:resize", async (_event, payload) => {
    resizeTerminal(payload.id, payload.cols, payload.rows);
    return { ok: true };
  });
  ipcMain.handle("terminal:kill", async (_event, payload) => killTerminal(payload.id));

  ipcMain.handle("settings:load", async () => loadSettings());
  ipcMain.handle("settings:save", async (_event, payload) => saveSettings(payload));
  ipcMain.handle("policy:get", async () => getPolicyState());
  ipcMain.handle("policy:setPreset", async (_event, payload) => setPolicyPreset(payload?.preset));
  ipcMain.handle("policy:evaluate", async (_event, payload) => {
    const decision = evaluatePolicyDecision(payload || {});
    audit("policy.evaluate", {
      actionType: payload?.actionType || "",
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      risk: decision.risk,
      preset: decision.preset,
      mode: agentRuntimeState.mode
    });
    return decision;
  });

  ipcMain.handle("llm:test", async (_event, payload) => testLlmConnection(payload));
  ipcMain.handle("llm:listModels", async (_event, payload) => listLlmModels(payload));
  ipcMain.handle("llm:installModel", async (_event, payload) => installLlmModel(payload));
  ipcMain.handle("llm:startStream", async (event, payload) => {
    startLlmStream(event, payload);
    return { ok: true };
  });
  ipcMain.handle("llm:abortStream", async (_event, payload) => stopLlmStream(payload.requestId));

  ipcMain.handle("agent:setMode", async (_event, payload) => {
    const nextMode = String(payload?.mode || "").trim() === "live_build" ? "live_build" : "manual";
    agentRuntimeState.mode = nextMode;
    if (Array.isArray(payload?.taskGraph)) {
      agentRuntimeState.taskGraph = payload.taskGraph;
    }
    audit("agent.mode", { mode: agentRuntimeState.mode });
    return { mode: agentRuntimeState.mode };
  });
  ipcMain.handle("agent:getTaskGraph", async () => ({
    mode: agentRuntimeState.mode,
    taskGraph: agentRuntimeState.taskGraph
  }));
  ipcMain.handle("agent:runCmd", async (_event, payload) =>
    runCommand(payload.command, {
      terminalId: payload?.terminalId || "",
      approved: Boolean(payload?.approved),
      source: payload?.source || "agent",
      preset: payload?.preset || ""
    })
  );
  ipcMain.handle("preview:status", async () => getPreviewStatus());
  ipcMain.handle("preview:start", async (_event, payload) => {
    const normalized = payload || {};
    enforceAgentPolicy(normalized, "preview_start", normalized.command || "");
    return startPreviewServer(normalized);
  });
  ipcMain.handle("preview:startProject", async (_event, payload) => {
    const normalized = payload || {};
    enforceAgentPolicy(normalized, "preview_start", normalized.command || "");
    return startPreviewProject(normalized);
  });
  ipcMain.handle("preview:stop", async () => stopPreview("manual"));
  ipcMain.handle("preview:browserConnect", async (_event, payload) => {
    const normalized = payload || {};
    enforceAgentPolicy(normalized, "preview_snapshot");
    return connectPreviewBrowser(normalized.url || "");
  });
  ipcMain.handle("preview:browserSnapshot", async (_event, payload) => {
    const normalized = payload || {};
    enforceAgentPolicy(normalized, "preview_snapshot");
    return snapshotPreviewBrowser();
  });
  ipcMain.handle("preview:browserDiagnostics", async (_event, payload) => {
    const normalized = payload || {};
    enforceAgentPolicy(normalized, "preview_snapshot");
    return getPreviewBrowserDiagnostics(normalized);
  });
  ipcMain.handle("preview:browserScreenshot", async (_event, payload) => {
    const normalized = payload || {};
    enforceAgentPolicy(normalized, "preview_screenshot");
    return screenshotPreviewBrowser(normalized);
  });
  ipcMain.handle("preview:browserClick", async (_event, payload) => {
    const normalized = payload || {};
    enforceAgentPolicy(normalized, "preview_click");
    return clickPreviewBrowser(normalized);
  });
  ipcMain.handle("preview:browserType", async (_event, payload) => {
    const normalized = payload || {};
    enforceAgentPolicy(normalized, "preview_type");
    return typePreviewBrowser(normalized);
  });
  ipcMain.handle("preview:browserPress", async (_event, payload) => {
    const normalized = payload || {};
    enforceAgentPolicy(normalized, "preview_press");
    return pressPreviewBrowser(normalized);
  });
  ipcMain.handle("preview:browserPick", async (_event, payload) => {
    const normalized = payload || {};
    enforceAgentPolicy(normalized, "preview_click");
    return pickPreviewBrowserSelector(normalized);
  });
  ipcMain.handle("preview:browserClose", async () => closePreviewBrowser("manual"));
  ipcMain.handle("runtime:setLowResourceMode", async (_event, payload) => setLowResourceMode(Boolean(payload?.enabled)));
  ipcMain.handle("runtime:getHealth", async () => getRuntimeHealth());

  ipcMain.handle("git:status", async () => gitStatus());
  ipcMain.handle("git:diff", async (_event, payload) => gitDiff(payload?.path || "", Boolean(payload?.staged)));
  ipcMain.handle("git:stage", async (_event, payload) => gitStage(payload.paths));
  ipcMain.handle("git:unstage", async (_event, payload) => gitUnstage(payload.paths));
  ipcMain.handle("git:commit", async (_event, payload) => gitCommit(payload.message, { approved: Boolean(payload?.approved ?? true) }));
  ipcMain.handle("git:push", async (_event, payload) => gitPush({ approved: Boolean(payload?.approved ?? true) }));
  ipcMain.handle("git:merge", async (_event, payload) => gitMerge({ ...(payload || {}), approved: Boolean(payload?.approved ?? true) }));
  ipcMain.handle("git:rebase", async (_event, payload) => gitRebase({ ...(payload || {}), approved: Boolean(payload?.approved ?? true) }));
  ipcMain.handle("git:cherryPick", async (_event, payload) =>
    gitCherryPick({ ...(payload || {}), approved: Boolean(payload?.approved ?? true) })
  );
  ipcMain.handle("git:branches", async () => gitBranches());
  ipcMain.handle("git:checkout", async (_event, payload) => gitCheckoutBranch(payload || {}));
  ipcMain.handle("git:history", async (_event, payload) => gitHistory(payload?.limit));
  ipcMain.handle("git:restore", async (_event, payload) => gitRestore(payload?.paths || [], payload || {}));
  ipcMain.handle("git:conflicts", async () => gitConflicts());
  ipcMain.handle("git:resolveConflict", async (_event, payload) => gitResolveConflict(payload || {}));

  ipcMain.handle("audit:list", async () => ({ entries: loadAudit() }));
  ipcMain.handle("audit:clear", async () => {
    const auditPath = getUserDataPath(AUDIT_FILE);
    if (fs.existsSync(auditPath)) fs.rmSync(auditPath, { force: true });
    audit("audit.clear", {});
    return { ok: true };
  });
}

module.exports = { registerIpcHandlers };
