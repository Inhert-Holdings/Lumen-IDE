import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/state/useAppStore";
import type { PolicyDecision } from "@/types/electron";

type TrustPreset = ReturnType<typeof useAppStore.getState>["settings"]["permissionPreset"];

type ActionSample = {
  id: string;
  label: string;
  actionType: string;
  command?: string;
};

type EvaluatedAction = {
  sample: ActionSample;
  decision: PolicyDecision;
};

const PRESETS: Array<{ id: TrustPreset; label: string; description: string }> = [
  { id: "read_only", label: "Read Only", description: "Read/list/search and passive checks only." },
  { id: "local_edit_only", label: "Local Edit Only", description: "Allow local file edits, no command execution lane." },
  { id: "local_build_mode", label: "Local Build Mode", description: "Allow local builds + preview workflow with gated changes." },
  { id: "preview_operator", label: "Preview Operator", description: "Operate preview/browser actions with no file-write lane." },
  { id: "git_operator", label: "Git Operator", description: "Git stage/commit/push operations with risk-based gating." },
  { id: "full_local_workspace", label: "Full Local Workspace", description: "All local actions available, approvals still required by risk." },
  { id: "trusted_workspace_profile", label: "Trusted Workspace", description: "More permissive trusted profile, still blocks online when disabled." }
];

const BASE_ACTIONS: ActionSample[] = [
  { id: "list_dir", label: "List directory", actionType: "list_dir" },
  { id: "read_file", label: "Read file", actionType: "read_file" },
  { id: "search_files", label: "Search files", actionType: "search_files" },
  { id: "write_file", label: "Write file", actionType: "write_file" },
  { id: "delete_file", label: "Delete file", actionType: "delete_file" },
  { id: "preview_start", label: "Start preview", actionType: "preview_start" },
  { id: "preview_snapshot", label: "Preview snapshot", actionType: "preview_snapshot" },
  { id: "preview_click", label: "Preview click/type/press", actionType: "preview_click" },
  { id: "git_status", label: "Git status", actionType: "git_status" },
  { id: "git_commit", label: "Git commit", actionType: "git_commit" },
  { id: "git_push", label: "Git push", actionType: "git_push" }
];

export function PermissionsPanel() {
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const [selectedPreset, setSelectedPreset] = useState<TrustPreset>(settings.permissionPreset);
  const [commandSample, setCommandSample] = useState("git status --short");
  const [evaluations, setEvaluations] = useState<EvaluatedAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const actions = useMemo<ActionSample[]>(
    () => [
      ...BASE_ACTIONS,
      { id: "run_cmd", label: "Run command sample", actionType: "run_cmd", command: commandSample.trim() || "git status --short" }
    ],
    [commandSample]
  );

  const evaluatePreset = useCallback(async (preset: TrustPreset) => {
    setBusy(true);
    setStatus("");
    try {
      const rows = await Promise.all(
        actions.map(async (sample) => {
          const decision = await window.lumen.policy.evaluate({
            actionType: sample.actionType,
            command: sample.command || "",
            preset
          });
          return { sample, decision };
        })
      );
      setEvaluations(rows);
      setStatus(`Policy evaluation complete for ${preset}.`);
    } catch (error) {
      setStatus(error instanceof Error ? `Failed ❌ ${error.message}` : "Failed ❌");
    } finally {
      setBusy(false);
    }
  }, [actions]);

  useEffect(() => {
    setSelectedPreset(settings.permissionPreset);
  }, [settings.permissionPreset]);

  useEffect(() => {
    void evaluatePreset(selectedPreset);
  }, [evaluatePreset, selectedPreset]);

  const applyPreset = async () => {
    setBusy(true);
    setStatus("");
    try {
      await window.lumen.policy.setPreset({ preset: selectedPreset });
      const loaded = await window.lumen.settings.load();
      setSettings(loaded);
      setStatus(`Applied preset ✅ ${selectedPreset}`);
      await evaluatePreset(selectedPreset);
    } catch (error) {
      setStatus(error instanceof Error ? `Failed ❌ ${error.message}` : "Failed ❌");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lumen-scroll h-full overflow-auto p-3 text-xs">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Permissions Center</div>
      <div className="mb-3 rounded border border-border bg-black/20 p-2 text-[11px] text-muted">
        <div>Current workspace preset: {settings.permissionPreset.replace(/_/g, " ")}</div>
        <div>Online mode: {settings.onlineMode ? "enabled" : "disabled"}</div>
        <div>Low resource mode: {settings.lowResourceMode ? "enabled" : "disabled"}</div>
      </div>

      <div className="space-y-3">
        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Preset Selector</div>
          <select
            className="h-8 w-full rounded border border-border bg-black/20 px-2"
            value={selectedPreset}
            onChange={(event) => setSelectedPreset(event.target.value as TrustPreset)}
          >
            {PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <div className="mt-2 rounded border border-border/70 bg-black/20 p-2 text-[11px] text-muted">
            {PRESETS.find((preset) => preset.id === selectedPreset)?.description}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => void applyPreset()} disabled={busy}>
              Apply Preset
            </Button>
            <Button onClick={() => void evaluatePreset(selectedPreset)} disabled={busy}>
              Re-evaluate Matrix
            </Button>
          </div>
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Command Sample</div>
          <Input value={commandSample} onChange={(event) => setCommandSample(event.target.value)} />
          <div className="mt-1 text-[11px] text-muted">Used by `run_cmd` policy evaluation row.</div>
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Policy Matrix</div>
          <div className="space-y-1">
            {evaluations.map(({ sample, decision }) => (
              <div key={sample.id} className="rounded border border-border/70 bg-black/20 p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-text">{sample.label}</div>
                  <div className="flex items-center gap-1">
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted">{decision.risk}</span>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${
                        decision.allowed ? "border-[#27543a] text-[#7ce09f]" : "border-[#5a2a2a] text-[#ff9e9e]"
                      }`}
                    >
                      {decision.allowed ? "allow" : "deny"}
                    </span>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${
                        decision.requiresApproval ? "border-[#66532a] text-[#ffd58a]" : "border-border text-muted"
                      }`}
                    >
                      {decision.requiresApproval ? "approval" : "auto"}
                    </span>
                  </div>
                </div>
                {sample.command && <div className="mt-1 break-all text-muted">cmd: {sample.command}</div>}
                <div className="mt-1 text-muted">{decision.reason}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-muted">{status}</div>
    </div>
  );
}
