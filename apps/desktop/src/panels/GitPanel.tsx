import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/state/useAppStore";

type GitFile = {
  path: string;
  index: string;
  workingDir: string;
};

export function GitPanel() {
  const settings = useAppStore((state) => state.settings);
  const [isRepo, setIsRepo] = useState(false);
  const [branch, setBranch] = useState("");
  const [files, setFiles] = useState<GitFile[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [diffText, setDiffText] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const staged = files.filter((file) => file.index !== " ");
    const unstaged = files.filter((file) => file.workingDir !== " ");
    return { staged, unstaged };
  }, [files]);

  const loadStatus = async () => {
    setBusy(true);
    setError("");
    try {
      const status = await window.lumen.git.status();
      setIsRepo(status.isRepo);
      setBranch(status.branch);
      setFiles(status.files);
      if (status.files.length && !selectedPath) {
        setSelectedPath(status.files[0].path);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load git status");
    } finally {
      setBusy(false);
    }
  };

  const loadDiff = async (path: string, staged = false) => {
    setSelectedPath(path);
    const payload = await window.lumen.git.diff({ path, staged });
    setDiffText(payload.diff);
  };

  const stage = async (path: string) => {
    await window.lumen.git.stage({ paths: [path] });
    await loadStatus();
    await loadDiff(path, true);
  };

  const unstage = async (path: string) => {
    await window.lumen.git.unstage({ paths: [path] });
    await loadStatus();
    await loadDiff(path, false);
  };

  const commit = async () => {
    if (!commitMessage.trim()) return;
    await window.lumen.git.commit({ message: commitMessage.trim() });
    setCommitMessage("");
    await loadStatus();
    setDiffText("");
  };

  const push = async () => {
    if (!window.confirm("Push current branch to remote?")) return;
    try {
      await window.lumen.git.push();
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Push failed");
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  if (!isRepo) {
    return (
      <div className="flex h-full flex-col gap-2 p-3 text-xs">
        <div className="text-muted">No git repository detected in this workspace.</div>
        <Button onClick={() => void loadStatus()}>Refresh</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-muted">Branch: {branch || "(detached)"}</div>
        <div className="flex gap-1">
          <Button onClick={() => void loadStatus()} disabled={busy}>
            Refresh
          </Button>
          <Button onClick={() => void push()} className={settings.onlineMode ? "" : "border-warn text-warn"}>
            Push
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 border-b border-border">
        <div className="lumen-scroll overflow-auto border-r border-border p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Changes</div>
          {files.map((file) => (
            <div key={file.path} className="mb-1 rounded border border-border/40 p-1.5">
              <button className="w-full truncate text-left hover:text-accent" onClick={() => void loadDiff(file.path, false)}>
                {file.path}
              </button>
              <div className="mt-1 flex gap-1">
                <Button onClick={() => void stage(file.path)}>Stage</Button>
                <Button onClick={() => void unstage(file.path)}>Unstage</Button>
                <Button onClick={() => void loadDiff(file.path, true)}>Staged Diff</Button>
              </div>
            </div>
          ))}
        </div>

        <div className="lumen-scroll overflow-auto p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Diff {selectedPath ? `- ${selectedPath}` : ""}</div>
          <pre className="whitespace-pre-wrap break-words rounded border border-border bg-black/30 p-2 text-[11px]">
            {diffText || "Select a file to view diff."}
          </pre>
        </div>
      </div>

      <div className="space-y-2 border-t border-border p-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message" />
          <Button onClick={() => void commit()}>Commit</Button>
        </div>
        {!!error && <div className="text-[11px] text-bad">{error}</div>}
        <div className="text-[11px] text-muted">
          Staged: {grouped.staged.length} | Unstaged: {grouped.unstaged.length}
        </div>
      </div>
    </div>
  );
}
