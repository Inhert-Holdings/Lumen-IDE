import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/state/useAppStore";

type GitFile = {
  path: string;
  index: string;
  workingDir: string;
};

type GitBranch = {
  name: string;
  current: boolean;
  remote: boolean;
};

type GitCommit = {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
};

type GitConflicts = {
  hasConflicts: boolean;
  files: string[];
  hints: string[];
};

export function GitPanel() {
  const settings = useAppStore((state) => state.settings);
  const [isRepo, setIsRepo] = useState(false);
  const [branch, setBranch] = useState("");
  const [files, setFiles] = useState<GitFile[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [diffText, setDiffText] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [targetBranch, setTargetBranch] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [mergeBranch, setMergeBranch] = useState("");
  const [rebaseUpstream, setRebaseUpstream] = useState("");
  const [cherryCommit, setCherryCommit] = useState("");
  const [history, setHistory] = useState<GitCommit[]>([]);
  const [historyLimit, setHistoryLimit] = useState(25);
  const [conflicts, setConflicts] = useState<GitConflicts>({ hasConflicts: false, files: [], hints: [] });
  const [operationStatus, setOperationStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const staged = files.filter((file) => file.index !== " ");
    const unstaged = files.filter((file) => file.workingDir !== " ");
    return { staged, unstaged };
  }, [files]);

  const loadDiff = useCallback(async (path: string, staged = false) => {
    setSelectedPath(path);
    const payload = await window.lumen.git.diff({ path, staged });
    setDiffText(payload.diff);
  }, []);

  const refreshAll = useCallback(async (keepPath = "") => {
    setBusy(true);
    setError("");
    try {
      const [status, branchState, historyState, conflictState] = await Promise.all([
        window.lumen.git.status(),
        window.lumen.git.branches(),
        window.lumen.git.history({ limit: historyLimit }),
        window.lumen.git.conflicts()
      ]);
      setIsRepo(status.isRepo);
      setBranch(status.branch);
      setFiles(status.files);
      setBranches(branchState.branches);
      setTargetBranch(branchState.current || status.branch || "");
      setHistory(historyState.commits);
      setConflicts({
        hasConflicts: conflictState.hasConflicts,
        files: conflictState.files,
        hints: conflictState.hints
      });

      const preferred = keepPath || selectedPath || status.files[0]?.path || "";
      if (preferred) {
        await loadDiff(preferred, false);
      } else {
        setDiffText("");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load git panel data");
    } finally {
      setBusy(false);
    }
  }, [historyLimit, loadDiff, selectedPath]);

  const stage = async (path: string) => {
    try {
      await window.lumen.git.stage({ paths: [path] });
      await refreshAll(path);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Stage failed");
    }
  };

  const unstage = async (path: string) => {
    try {
      await window.lumen.git.unstage({ paths: [path] });
      await refreshAll(path);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unstage failed");
    }
  };

  const restoreWorking = async (path: string) => {
    if (!window.confirm(`Restore working tree changes for ${path}?`)) return;
    try {
      await window.lumen.git.restore({ paths: [path], workingTree: true, staged: false });
      await refreshAll(path);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Restore failed");
    }
  };

  const restoreStaged = async (path: string) => {
    if (!window.confirm(`Unstage and restore ${path} to HEAD?`)) return;
    try {
      await window.lumen.git.restore({ paths: [path], workingTree: true, staged: true });
      await refreshAll(path);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Restore staged failed");
    }
  };

  const commit = async () => {
    if (!commitMessage.trim()) return;
    try {
      await window.lumen.git.commit({ message: commitMessage.trim() });
      setCommitMessage("");
      await refreshAll();
      setDiffText("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Commit failed");
    }
  };

  const push = async () => {
    if (!window.confirm("Push current branch to remote?")) return;
    try {
      await window.lumen.git.push();
      setError("");
      await refreshAll();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Push failed");
    }
  };

  const checkoutBranch = async () => {
    if (!targetBranch.trim()) return;
    try {
      await window.lumen.git.checkout({ name: targetBranch.trim(), create: false });
      await refreshAll();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Checkout failed");
    }
  };

  const createBranch = async () => {
    if (!newBranch.trim()) return;
    try {
      await window.lumen.git.checkout({ name: newBranch.trim(), create: true });
      setNewBranch("");
      await refreshAll();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Create branch failed");
    }
  };

  const mergeCurrent = async () => {
    const nextBranch = (mergeBranch.trim() || targetBranch.trim());
    if (!nextBranch) return;
    if (!window.confirm(`Merge "${nextBranch}" into "${branch || "current"}"?`)) return;
    try {
      const result = await window.lumen.git.merge({ branch: nextBranch });
      const summary = result.summary
        ? `${result.summary.changes} file(s), +${result.summary.insertions}/-${result.summary.deletions}`
        : "merge complete";
      setOperationStatus(`Merge completed: ${nextBranch} (${summary}).`);
      await refreshAll();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Merge failed");
    }
  };

  const rebaseCurrent = async () => {
    const upstream = (rebaseUpstream.trim() || targetBranch.trim());
    if (!upstream) return;
    if (!window.confirm(`Rebase "${branch || "current"}" onto "${upstream}"?`)) return;
    try {
      await window.lumen.git.rebase({ upstream });
      setOperationStatus(`Rebase completed: ${branch || "current"} on ${upstream}.`);
      await refreshAll();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Rebase failed");
    }
  };

  const cherryPickCommit = async () => {
    const commit = cherryCommit.trim();
    if (!commit) return;
    if (!window.confirm(`Cherry-pick commit "${commit}" onto "${branch || "current"}"?`)) return;
    try {
      await window.lumen.git.cherryPick({ commit });
      setOperationStatus(`Cherry-pick completed: ${commit}.`);
      setCherryCommit("");
      await refreshAll();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Cherry-pick failed");
    }
  };

  const resolveConflict = async (path: string, strategy: "ours" | "theirs") => {
    try {
      await window.lumen.git.resolveConflict({ path, strategy });
      await refreshAll(path);
      await loadDiff(path, true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Conflict resolution failed");
    }
  };

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  if (!isRepo) {
    return (
      <div className="flex h-full flex-col gap-2 p-3 text-xs">
        <div className="text-muted">No git repository detected in this workspace.</div>
        <Button onClick={() => void refreshAll()}>Refresh</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="text-muted">Branch: {branch || "(detached)"}</div>
          <div className="flex gap-1">
            <Button onClick={() => void refreshAll(selectedPath)} disabled={busy}>
              Refresh
            </Button>
            <Button onClick={() => void push()} className={settings.onlineMode ? "" : "border-warn text-warn"}>
              Push
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-[1fr,auto] gap-2">
          <select
            className="h-8 w-full rounded border border-border bg-black/20 px-2"
            value={targetBranch}
            onChange={(event) => setTargetBranch(event.target.value)}
          >
            <option value="">Select branch</option>
            {branches.map((item) => (
              <option key={item.name} value={item.name}>
                {item.current ? "* " : ""}
                {item.name}
                {item.remote ? " (remote)" : ""}
              </option>
            ))}
          </select>
          <Button onClick={() => void checkoutBranch()} disabled={!targetBranch}>
            Checkout
          </Button>
        </div>

        <div className="grid grid-cols-[1fr,auto] gap-2">
          <Input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="new-branch-name" />
          <Button onClick={() => void createBranch()} disabled={!newBranch.trim()}>
            Create
          </Button>
        </div>

        <div className="rounded border border-border/60 bg-black/20 p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Advanced Ops</div>
          <div className="grid grid-cols-[1fr,auto] gap-2">
            <Input
              value={mergeBranch}
              onChange={(event) => setMergeBranch(event.target.value)}
              placeholder={targetBranch || "branch to merge"}
            />
            <Button onClick={() => void mergeCurrent()} disabled={!mergeBranch.trim() && !targetBranch.trim()}>
              Merge
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-[1fr,auto] gap-2">
            <Input
              value={rebaseUpstream}
              onChange={(event) => setRebaseUpstream(event.target.value)}
              placeholder={targetBranch || "upstream branch"}
            />
            <Button onClick={() => void rebaseCurrent()} disabled={!rebaseUpstream.trim() && !targetBranch.trim()}>
              Rebase
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-[1fr,auto] gap-2">
            <Input value={cherryCommit} onChange={(event) => setCherryCommit(event.target.value)} placeholder="commit hash for cherry-pick" />
            <Button onClick={() => void cherryPickCommit()} disabled={!cherryCommit.trim()}>
              Cherry-pick
            </Button>
          </div>
          {!!operationStatus && <div className="mt-2 text-[11px] text-muted">{operationStatus}</div>}
        </div>
      </div>

      {conflicts.hasConflicts && (
        <div className="border-b border-warn/40 bg-warn/10 px-3 py-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-warn">Conflict Helper</div>
          <div className="space-y-2">
            {conflicts.files.map((file) => (
              <div key={file} className="rounded border border-warn/40 bg-black/30 p-2">
                <div className="mb-1 truncate text-text">{file}</div>
                <div className="flex flex-wrap gap-1">
                  <Button onClick={() => void loadDiff(file, false)}>Open Diff</Button>
                  <Button onClick={() => void resolveConflict(file, "ours")}>Use Ours</Button>
                  <Button onClick={() => void resolveConflict(file, "theirs")}>Use Theirs</Button>
                </div>
              </div>
            ))}
            {!!conflicts.hints.length && <div className="text-[11px] text-muted">{conflicts.hints.join(" ")}</div>}
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2 border-b border-border">
        <div className="lumen-scroll overflow-auto border-r border-border p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Changes</div>
          {files.map((file) => (
            <div key={file.path} className="mb-1 rounded border border-border/40 p-1.5">
              <button className="w-full truncate text-left hover:text-accent" onClick={() => void loadDiff(file.path, false)}>
                {file.path}
              </button>
              <div className="mt-1 flex flex-wrap gap-1">
                <Button onClick={() => void stage(file.path)}>Stage</Button>
                <Button onClick={() => void unstage(file.path)}>Unstage</Button>
                <Button onClick={() => void loadDiff(file.path, true)}>Staged Diff</Button>
                <Button onClick={() => void restoreWorking(file.path)}>Restore File</Button>
                <Button onClick={() => void restoreStaged(file.path)}>Restore HEAD</Button>
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

      <div className="space-y-2 border-b border-border p-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wide text-muted">History</div>
          <div className="flex items-center gap-1">
            <span className="text-muted">Limit</span>
            <Input
              type="number"
              min={5}
              max={100}
              value={historyLimit}
              onChange={(event) => setHistoryLimit(Math.min(100, Math.max(5, Number(event.target.value) || 25)))}
            />
          </div>
        </div>
        <div className="lumen-scroll max-h-28 overflow-auto rounded border border-border bg-black/25 p-2">
          {history.length === 0 && <div className="text-muted">No commit history available.</div>}
          {history.map((commitItem) => (
            <div key={commitItem.hash} className="mb-1 rounded border border-border/40 px-2 py-1">
              <div className="truncate text-text">{commitItem.shortHash} - {commitItem.message}</div>
              <div className="text-[10px] text-muted">
                {commitItem.author} · {new Date(commitItem.date).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-border p-2">
        <div className="grid grid-cols-[1fr,auto] gap-2">
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
