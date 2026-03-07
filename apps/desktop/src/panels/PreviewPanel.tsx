import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/state/useAppStore";

type PreviewStatus = {
  running: boolean;
  url: string;
  port: number;
  rootPath: string;
  entryFile: string;
};

const EMPTY_STATUS: PreviewStatus = {
  running: false,
  url: "",
  port: 0,
  rootPath: "",
  entryFile: "index.html"
};

export function PreviewPanel() {
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const [status, setStatus] = useState<PreviewStatus>(EMPTY_STATUS);
  const [pathInput, setPathInput] = useState(".");
  const [entryInput, setEntryInput] = useState("index.html");
  const [customUrl, setCustomUrl] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeUrl = customUrl.trim() || status.url;

  const loadStatus = async () => {
    try {
      const next = await window.lumen.preview.status();
      setStatus(next);
      if (next.entryFile) setEntryInput(next.entryFile);
      if (next.rootPath && workspaceRoot && next.rootPath.startsWith(workspaceRoot)) {
        const relative = next.rootPath.slice(workspaceRoot.length).replace(/^[\\/]+/, "");
        setPathInput(relative || ".");
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
    }, 5000);
    return () => clearInterval(timer);
  }, [workspaceRoot]);

  const startPreview = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await window.lumen.preview.start({
        path: pathInput.trim() || ".",
        entry: entryInput.trim() || "index.html"
      });
      setStatus(next);
      setRefreshKey((current) => current + 1);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to start preview.");
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
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to stop preview.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-2 text-[11px]">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Live Preview</div>
        <div className="grid grid-cols-1 gap-2">
          <label className="block">
            <div className="mb-1 text-muted">Path in workspace</div>
            <Input value={pathInput} onChange={(event) => setPathInput(event.target.value)} placeholder="., dist, lumen-website" />
          </label>
          <label className="block">
            <div className="mb-1 text-muted">Entry file</div>
            <Input value={entryInput} onChange={(event) => setEntryInput(event.target.value)} placeholder="index.html" />
          </label>
          <label className="block">
            <div className="mb-1 text-muted">Custom URL (optional)</div>
            <Input
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
              placeholder="http://localhost:5173"
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={() => void startPreview()} disabled={busy}>
            {status.running ? "Restart Preview" : "Start Preview"}
          </Button>
          <Button onClick={() => void stopPreview()} disabled={busy || !status.running}>
            Stop
          </Button>
          <Button onClick={() => setRefreshKey((current) => current + 1)} disabled={!activeUrl}>
            Reload Frame
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-muted">
          {activeUrl ? (
            <>
              <span className="text-good">Previewing</span> at{" "}
              <a className="text-accent underline" href={activeUrl} target="_blank" rel="noreferrer">
                {activeUrl}
              </a>
              {status.running && <span> · Live reload enabled</span>}
            </>
          ) : (
            "Preview is stopped."
          )}
        </div>
        {error && <div className="mt-1 text-[11px] text-bad">{error}</div>}
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
            Start Preview to test your built app/site inside Lumen IDE.
          </div>
        )}
      </div>
    </div>
  );
}
