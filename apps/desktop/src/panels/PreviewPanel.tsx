import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/state/useAppStore";
import type { PreviewSnapshot, PreviewStatus, ProjectInspection } from "@/types/electron";

const EMPTY_INSPECTION: ProjectInspection = {
  rootPath: "",
  kind: "unknown",
  framework: "Unknown",
  confidence: "low",
  packageManager: "",
  scripts: [],
  runCommand: "",
  buildCommand: "",
  devUrl: "",
  staticRoot: "",
  entryFile: "",
  summary: "No project inspection available."
};

function scriptOverrideFromCommand(command: string) {
  return command.replace(/^(pnpm|npm|yarn)\s+/, "").trim();
}

function displayPath(workspaceRoot: string, targetPath: string) {
  if (!workspaceRoot || !targetPath) return targetPath || "none";
  if (!targetPath.startsWith(workspaceRoot)) return targetPath;
  return targetPath.slice(workspaceRoot.length).replace(/^[\\/]+/, "") || ".";
}

const EMPTY_STATUS: PreviewStatus = {
  running: false,
  mode: "idle",
  url: "",
  port: 0,
  rootPath: "",
  entryFile: "index.html",
  projectPath: "",
  projectCommand: "",
  terminalId: "",
  startedAt: "",
  lastDetectedUrl: "",
  inspection: EMPTY_INSPECTION,
  browser: {
    connected: false,
    url: "",
    title: "",
    executable: "",
    consoleErrors: 0,
    networkErrors: 0,
    lastConsoleError: "",
    lastNetworkError: ""
  }
};

const EMPTY_SNAPSHOT: PreviewSnapshot = {
  url: "",
  title: "",
  text: ""
};

export function PreviewPanel() {
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const terminalTabs = useAppStore((state) => state.terminalTabs);
  const terminalVisible = useAppStore((state) => state.terminalVisible);
  const projectInspection = useAppStore((state) => state.projectInspection);
  const addTerminalTab = useAppStore((state) => state.addTerminalTab);
  const setActiveTerminal = useAppStore((state) => state.setActiveTerminal);
  const setProjectInspection = useAppStore((state) => state.setProjectInspection);
  const patchSessionMemory = useAppStore((state) => state.patchSessionMemory);
  const toggleTerminal = useAppStore((state) => state.toggleTerminal);

  const [status, setStatus] = useState<PreviewStatus>(EMPTY_STATUS);
  const [projectPath, setProjectPath] = useState(".");
  const [projectCommand, setProjectCommand] = useState("");
  const [projectUrl, setProjectUrl] = useState("");
  const [staticPath, setStaticPath] = useState(".");
  const [entryInput, setEntryInput] = useState("index.html");
  const [customUrl, setCustomUrl] = useState("");
  const [selector, setSelector] = useState("");
  const [browserText, setBrowserText] = useState("");
  const [browserKey, setBrowserKey] = useState("Enter");
  const [snapshot, setSnapshot] = useState<PreviewSnapshot>(EMPTY_SNAPSHOT);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeUrl = useMemo(() => customUrl.trim() || status.url, [customUrl, status.url]);
  const inspection = status.inspection || projectInspection || EMPTY_INSPECTION;

  const syncInspection = (nextInspection: ProjectInspection) => {
    setProjectInspection(nextInspection);
    patchSessionMemory({
      projectType: nextInspection.framework,
      detectedScripts: nextInspection.scripts.map((script) => script.name)
    });
  };

  const ensurePreviewTerminal = async () => {
    const existing = terminalTabs.find((tab) => tab.title === "Preview");
    if (existing) {
      setActiveTerminal(existing.id);
      if (!terminalVisible) toggleTerminal();
      return existing.id;
    }

    const created = await window.lumen.terminal.create({ cols: 120, rows: 30 });
    addTerminalTab({ id: created.id, title: "Preview" });
    setActiveTerminal(created.id);
    if (!terminalVisible) toggleTerminal();
    return created.id;
  };

  const loadStatus = async () => {
    try {
      const next = await window.lumen.preview.status();
      setStatus(next);
      syncInspection(next.inspection);
      patchSessionMemory({
        activePreviewUrl: next.url,
        previewMode: next.mode
      });
      if (next.mode === "project") {
        if (next.projectPath && workspaceRoot && next.projectPath.startsWith(workspaceRoot)) {
          const relative = next.projectPath.slice(workspaceRoot.length).replace(/^[\\/]+/, "");
          setProjectPath(relative || ".");
        }
        setProjectCommand(scriptOverrideFromCommand(next.projectCommand));
      } else if (next.rootPath && workspaceRoot && next.rootPath.startsWith(workspaceRoot)) {
        const relative = next.rootPath.slice(workspaceRoot.length).replace(/^[\\/]+/, "");
        setStaticPath(relative || ".");
        if (next.entryFile) setEntryInput(next.entryFile);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load preview status.");
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [workspaceRoot]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadStatus();
    }, 2500);
    return () => clearInterval(timer);
  }, [workspaceRoot]);

  const runCurrentProject = async () => {
    setBusy(true);
    setError("");
    try {
      const terminalId = await ensurePreviewTerminal();
      const inspectionResult = await window.lumen.workspace.inspect({ path: projectPath.trim() || "." });
      syncInspection(inspectionResult);
      const next = await window.lumen.preview.startProject({
        path: projectPath.trim() || ".",
        command: projectCommand.trim() || undefined,
        url: projectUrl.trim() || undefined,
        terminalId
      });
      setCustomUrl("");
      setStatus(next);
      patchSessionMemory({ activePreviewUrl: next.url, previewMode: next.mode });
      setRefreshKey((current) => current + 1);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to run current project.");
    } finally {
      setBusy(false);
    }
  };

  const serveStaticFolder = async () => {
    setBusy(true);
    setError("");
    try {
      const inspectionResult = await window.lumen.workspace.inspect({ path: staticPath.trim() || "." });
      syncInspection(inspectionResult);
      const next = await window.lumen.preview.start({
        path: staticPath.trim() || ".",
        entry: entryInput.trim() || "index.html"
      });
      setCustomUrl("");
      setStatus(next);
      patchSessionMemory({ activePreviewUrl: next.url, previewMode: next.mode });
      setRefreshKey((current) => current + 1);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to serve static preview.");
    } finally {
      setBusy(false);
    }
  };

  const stopPreview = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await window.lumen.preview.stop();
      setStatus(next);
      patchSessionMemory({ activePreviewUrl: "", previewMode: "idle" });
      setSnapshot(EMPTY_SNAPSHOT);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to stop preview.");
    } finally {
      setBusy(false);
    }
  };

  const connectBrowser = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await window.lumen.preview.browserConnect({ url: activeUrl || undefined });
      setSnapshot(result.snapshot);
      await loadStatus();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to connect browser.");
    } finally {
      setBusy(false);
    }
  };

  const captureSnapshot = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await window.lumen.preview.browserSnapshot();
      setSnapshot(result);
      await loadStatus();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to inspect preview.");
    } finally {
      setBusy(false);
    }
  };

  const browserClick = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await window.lumen.preview.browserClick({ selector, url: activeUrl || undefined });
      setSnapshot(result);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Click failed.");
    } finally {
      setBusy(false);
    }
  };

  const browserType = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await window.lumen.preview.browserType({
        selector,
        text: browserText,
        url: activeUrl || undefined
      });
      setSnapshot(result);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Type failed.");
    } finally {
      setBusy(false);
    }
  };

  const browserPress = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await window.lumen.preview.browserPress({ key: browserKey.trim() || "Enter", url: activeUrl || undefined });
      setSnapshot(result);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Key press failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-2 text-[11px]">
        <div className="rounded border border-border bg-black/20 p-2 text-muted">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-text">Mission Control</div>
          <div>Framework: {inspection.framework} ({inspection.confidence})</div>
          <div>Summary: {inspection.summary}</div>
          <div>Suggested run: {inspection.runCommand || "none"}</div>
          <div>Suggested build: {inspection.buildCommand || "none"}</div>
          <div>Static root: {displayPath(workspaceRoot, inspection.staticRoot) || "none"}</div>
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wide text-muted">Current Target</div>
            <div className="text-[10px] uppercase text-accent">{status.mode}</div>
          </div>
          <div className="space-y-1 text-muted">
            <div>
              URL:{" "}
              {activeUrl ? (
                <a className="text-accent underline" href={activeUrl} target="_blank" rel="noreferrer">
                  {activeUrl}
                </a>
              ) : (
                "not running"
              )}
            </div>
            <div>Root: {status.projectPath || status.rootPath || workspaceRoot || "none"}</div>
            <div>Command: {status.projectCommand || "static preview"}</div>
            <div>Terminal: {status.terminalId || "none"}</div>
            <div>Detected URL: {status.lastDetectedUrl || "none"}</div>
            <div>Started: {status.startedAt ? new Date(status.startedAt).toLocaleTimeString() : "not running"}</div>
            <div>Browser: {status.browser.connected ? `${status.browser.title || "connected"} (${status.browser.url})` : "disconnected"}</div>
            <div>Console errors: {status.browser.consoleErrors}</div>
            <div>Network errors: {status.browser.networkErrors}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="rounded border border-border bg-black/20 p-2">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Run Current Project</div>
            <div className="space-y-2">
              <label className="block">
                <div className="mb-1 text-muted">Project path in workspace</div>
                <Input value={projectPath} onChange={(event) => setProjectPath(event.target.value)} placeholder="." />
              </label>
              <label className="block">
                <div className="mb-1 text-muted">Script override (optional)</div>
                <Input
                  value={projectCommand}
                  onChange={(event) => setProjectCommand(event.target.value)}
                  placeholder={scriptOverrideFromCommand(inspection.runCommand) || "dev"}
                />
              </label>
              <label className="block">
                <div className="mb-1 text-muted">URL override (optional)</div>
                <Input
                  value={projectUrl}
                  onChange={(event) => setProjectUrl(event.target.value)}
                  placeholder={inspection.devUrl || "http://127.0.0.1:5173"}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void runCurrentProject()} disabled={busy}>
                  Run Current Project
                </Button>
                <Button
                  onClick={() => {
                    setProjectCommand(scriptOverrideFromCommand(inspection.runCommand));
                    setProjectUrl(inspection.devUrl);
                  }}
                  disabled={!inspection.runCommand}
                >
                  Use Suggested Run
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded border border-border bg-black/20 p-2">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Serve Static Folder</div>
            <div className="space-y-2">
              <label className="block">
                <div className="mb-1 text-muted">Folder or file path</div>
                <Input
                  value={staticPath}
                  onChange={(event) => setStaticPath(event.target.value)}
                  placeholder={displayPath(workspaceRoot, inspection.staticRoot) || "dist or index.html"}
                />
              </label>
              <label className="block">
                <div className="mb-1 text-muted">Entry file</div>
                <Input value={entryInput} onChange={(event) => setEntryInput(event.target.value)} placeholder={inspection.entryFile || "index.html"} />
              </label>
              <label className="block">
                <div className="mb-1 text-muted">Custom URL attach (optional)</div>
                <Input value={customUrl} onChange={(event) => setCustomUrl(event.target.value)} placeholder="http://127.0.0.1:3000" />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void serveStaticFolder()} disabled={busy}>
                  Serve Static
                </Button>
                <Button
                  onClick={() => {
                    if (inspection.staticRoot) {
                      setStaticPath(displayPath(workspaceRoot, inspection.staticRoot));
                    }
                    if (inspection.entryFile) {
                      setEntryInput(inspection.entryFile);
                    }
                  }}
                  disabled={!inspection.staticRoot}
                >
                  Use Static Root
                </Button>
                <Button onClick={() => void stopPreview()} disabled={busy || (!status.running && !status.browser.connected)}>
                  Stop
                </Button>
                <Button onClick={() => setRefreshKey((current) => current + 1)} disabled={!activeUrl}>
                  Reload Frame
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Browser Controls</div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Button onClick={() => void connectBrowser()} disabled={busy || !activeUrl}>
              Connect Browser
            </Button>
            <Button onClick={() => void captureSnapshot()} disabled={busy || !status.browser.connected}>
              Snapshot
            </Button>
            <Button
              onClick={() => {
                void window.lumen.preview.browserClose().then(() => loadStatus());
              }}
              disabled={busy || !status.browser.connected}
            >
              Close Browser
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-[1fr,auto]">
            <Input value={selector} onChange={(event) => setSelector(event.target.value)} placeholder="CSS selector, for example #submit" />
            <Button onClick={() => void browserClick()} disabled={busy || !selector.trim()}>
              Click
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[1fr,1fr,auto]">
            <Input value={selector} onChange={(event) => setSelector(event.target.value)} placeholder="CSS selector" />
            <Input value={browserText} onChange={(event) => setBrowserText(event.target.value)} placeholder="Text to type" />
            <Button onClick={() => void browserType()} disabled={busy || !selector.trim()}>
              Type
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[1fr,auto]">
            <Input value={browserKey} onChange={(event) => setBrowserKey(event.target.value)} placeholder="Enter" />
            <Button onClick={() => void browserPress()} disabled={busy || !status.browser.connected}>
              Press Key
            </Button>
          </div>
          {snapshot.text && (
            <div className="mt-2 rounded border border-border bg-black/30 p-2">
              <div className="mb-1 text-[10px] uppercase text-muted">{snapshot.title || "Snapshot"}</div>
              <pre className="lumen-scroll max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted">
                {snapshot.text}
              </pre>
            </div>
          )}
          {(status.browser.lastConsoleError || status.browser.lastNetworkError) && (
            <div className="mt-2 rounded border border-border bg-black/30 p-2 text-[11px] text-muted">
              {status.browser.lastConsoleError && <div>Last console error: {status.browser.lastConsoleError}</div>}
              {status.browser.lastNetworkError && <div>Last network error: {status.browser.lastNetworkError}</div>}
            </div>
          )}
        </div>

        {error && <div className="text-[11px] text-bad">{error}</div>}
      </div>

      <div className="min-h-0 flex-1 p-2">
        {activeUrl ? (
          <iframe
            key={`${activeUrl}-${refreshKey}`}
            title="Lumen Live Preview"
            src={activeUrl}
            className="h-full w-full rounded border border-border bg-black"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded border border-dashed border-border bg-black/20 text-xs text-muted">
            Run the current project or serve a static folder to preview it inside Lumen.
          </div>
        )}
      </div>
    </div>
  );
}
