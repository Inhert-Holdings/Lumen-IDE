import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { PreviewBrowserDiagnostics } from "@/types/electron";

type RuntimeHealth = {
  lowResourceMode: boolean;
  managedRuntime: { active: boolean; name: string; modelsPath: string };
  preview: { staticRunning: boolean; projectRunning: boolean; browserConnected: boolean };
  workspaceWatcher: { active: boolean; eventCount: number; lastEventAt: string; reason: string };
  workspaceIndex: {
    status: string;
    queued: boolean;
    running: boolean;
    filesIndexed: number;
    dirsIndexed: number;
    truncated: boolean;
    lastIndexedAt: string;
    lastDurationMs: number;
    maxDepth: number;
    maxEntries: number;
    lastReason: string;
    error: string;
  };
  process: { pid: number; uptimeSec: number; memoryRss: number };
};

export function DiagnosticsPanel() {
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [agentMode, setAgentMode] = useState<"manual" | "live_build">("manual");
  const [taskCount, setTaskCount] = useState(0);
  const [previewDiagnostics, setPreviewDiagnostics] = useState<PreviewBrowserDiagnostics | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      const [runtimeHealth, taskGraph, previewStatus] = await Promise.all([
        window.lumen.runtime.getHealth(),
        window.lumen.agent.getTaskGraph(),
        window.lumen.preview.browserDiagnostics({ limit: 80, includeDom: true }).catch(() => null)
      ]);
      setHealth(runtimeHealth);
      setAgentMode(taskGraph.mode);
      setTaskCount(Array.isArray(taskGraph.taskGraph) ? taskGraph.taskGraph.length : 0);
      setPreviewDiagnostics(previewStatus);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load diagnostics.");
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="lumen-scroll h-full overflow-auto p-2 text-[11px]">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-muted">Diagnostics</div>
        <Button onClick={() => void load()}>Refresh</Button>
      </div>

      <div className="space-y-2">
        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-1 text-[10px] uppercase text-muted">Runtime</div>
          <div>Low resource mode: {health?.lowResourceMode ? "on" : "off"}</div>
          <div>Managed runtime: {health?.managedRuntime.active ? `${health.managedRuntime.name} active` : "inactive"}</div>
          <div>Preview: {health?.preview.projectRunning ? "project" : health?.preview.staticRunning ? "static" : "idle"}</div>
          <div>Browser connected: {health?.preview.browserConnected ? "yes" : "no"}</div>
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-1 text-[10px] uppercase text-muted">Workspace Watch/Index</div>
          <div>Watcher: {health?.workspaceWatcher.active ? "active" : "paused"}</div>
          <div>Watch events: {health?.workspaceWatcher.eventCount || 0}</div>
          <div>Watch reason: {health?.workspaceWatcher.reason || "n/a"}</div>
          <div>Index status: {health?.workspaceIndex.status || "idle"}</div>
          <div>Indexed: {health?.workspaceIndex.filesIndexed || 0} files / {health?.workspaceIndex.dirsIndexed || 0} dirs</div>
          <div>Depth/limit: {health?.workspaceIndex.maxDepth || 0} / {health?.workspaceIndex.maxEntries || 0}</div>
          <div>Last index: {health?.workspaceIndex.lastIndexedAt ? new Date(health.workspaceIndex.lastIndexedAt).toLocaleTimeString() : "never"}</div>
          <div>Index duration: {health?.workspaceIndex.lastDurationMs || 0}ms</div>
          {health?.workspaceIndex.error ? <div className="text-bad">Index error: {health.workspaceIndex.error}</div> : null}
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-1 text-[10px] uppercase text-muted">Agent</div>
          <div>Mode: {agentMode}</div>
          <div>Task graph nodes: {taskCount}</div>
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-1 text-[10px] uppercase text-muted">Process</div>
          <div>PID: {health?.process.pid || "-"}</div>
          <div>Uptime: {health?.process.uptimeSec || 0}s</div>
          <div>RSS: {health?.process.memoryRss || 0}</div>
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-1 text-[10px] uppercase text-muted">Preview DOM Summary</div>
          {previewDiagnostics?.domSummary ? (
            <>
              <div>Title: {previewDiagnostics.domSummary.title || "(untitled)"}</div>
              <div>URL: {previewDiagnostics.domSummary.url}</div>
              <div>
                Interactive: {previewDiagnostics.domSummary.counts.interactive} | Links: {previewDiagnostics.domSummary.counts.links} | Buttons:{" "}
                {previewDiagnostics.domSummary.counts.buttons} | Inputs: {previewDiagnostics.domSummary.counts.inputs}
              </div>
            </>
          ) : (
            <div className="text-muted">No browser diagnostics yet.</div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          <div className="rounded border border-border bg-black/20 p-2">
            <div className="mb-1 text-[10px] uppercase text-muted">Console Events ({previewDiagnostics?.consoleEvents.length || 0})</div>
            <pre className="lumen-scroll max-h-44 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted">
              {previewDiagnostics?.consoleEvents?.length
                ? previewDiagnostics.consoleEvents
                    .slice(-60)
                    .map((event) => `[${event.type}] ${event.text}`)
                    .join("\n")
                : "No console events"}
            </pre>
          </div>
          <div className="rounded border border-border bg-black/20 p-2">
            <div className="mb-1 text-[10px] uppercase text-muted">Network Events ({previewDiagnostics?.networkEvents.length || 0})</div>
            <pre className="lumen-scroll max-h-44 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted">
              {previewDiagnostics?.networkEvents?.length
                ? previewDiagnostics.networkEvents
                    .slice(-60)
                    .map((event) => `${event.method} ${event.url} -> ${event.status}${event.error ? ` (${event.error})` : ""}`)
                    .join("\n")
                : "No network events"}
            </pre>
          </div>
        </div>
      </div>

      {error && <div className="mt-2 text-bad">{error}</div>}
    </div>
  );
}
