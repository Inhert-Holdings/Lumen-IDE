function createRuntimeManager(deps) {
  const {
    loadSettings,
    saveSettings,
    audit,
    syncWorkspaceWatcher,
    scheduleWorkspaceIndex,
    getManagedRuntime,
    getPreviewState,
    getWorkspaceWatcherState,
    getWorkspaceIndexState
  } = deps;

  function getRuntimeHealth() {
    const settings = loadSettings();
    const managedRuntime = getManagedRuntime();
    const previewState = getPreviewState();
    const workspaceWatcherState = getWorkspaceWatcherState();
    const workspaceIndexState = getWorkspaceIndexState();
    return {
      lowResourceMode: Boolean(settings.lowResourceMode),
      managedRuntime: {
        active: Boolean(managedRuntime?.process && !managedRuntime.process.killed),
        name: managedRuntime?.name || "",
        modelsPath: managedRuntime?.modelsPath || ""
      },
      preview: {
        staticRunning: Boolean(previewState.staticRuntime),
        projectRunning: Boolean(previewState.projectRuntime),
        browserConnected: Boolean(previewState.browserRuntime?.page)
      },
      workspaceWatcher: {
        active: workspaceWatcherState.active,
        eventCount: workspaceWatcherState.eventCount,
        lastEventAt: workspaceWatcherState.lastEventAt,
        reason: workspaceWatcherState.lastReason
      },
      workspaceIndex: {
        status: workspaceIndexState.status,
        queued: workspaceIndexState.queued,
        running: workspaceIndexState.running,
        filesIndexed: workspaceIndexState.filesIndexed,
        dirsIndexed: workspaceIndexState.dirsIndexed,
        truncated: workspaceIndexState.truncated,
        lastIndexedAt: workspaceIndexState.lastIndexedAt,
        lastDurationMs: workspaceIndexState.lastDurationMs,
        maxDepth: workspaceIndexState.maxDepth,
        maxEntries: workspaceIndexState.maxEntries,
        lastReason: workspaceIndexState.lastReason,
        error: workspaceIndexState.error
      },
      process: {
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        memoryRss: process.memoryUsage().rss
      }
    };
  }

  function setLowResourceMode(enabled) {
    const settings = loadSettings();
    const next = saveSettings({
      ...settings,
      lowResourceMode: Boolean(enabled),
      helperEnabled: enabled ? false : settings.helperEnabled
    });
    audit("runtime.low_resource_mode", { enabled: next.lowResourceMode, helperEnabled: next.helperEnabled });
    syncWorkspaceWatcher("low_resource_mode_change");
    scheduleWorkspaceIndex("low_resource_mode_change");
    return getRuntimeHealth();
  }

  return {
    getRuntimeHealth,
    setLowResourceMode
  };
}

module.exports = { createRuntimeManager };

