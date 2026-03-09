import { useEffect, useMemo, useState } from "react";

import { LM_STUDIO_PRESET, OLLAMA_PRESET, type LlmConfig, type Provider } from "@lumen/llm-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/state/useAppStore";

type ConfigTarget = "main" | "helper";

export function SettingsPanel() {
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);

  const [draft, setDraft] = useState<LlmConfig>(settings);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);

  const modelOptions = useMemo(
    () => Array.from(new Set([...(draft.recentModels || []), draft.model].filter(Boolean))).slice(0, 20),
    [draft.model, draft.recentModels]
  );

  const helperModelOptions = useMemo(
    () => Array.from(new Set([...(draft.helperRecentModels || []), draft.helperModel, draft.model].filter(Boolean))).slice(0, 20),
    [draft.helperModel, draft.helperRecentModels, draft.model]
  );

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const applyPreset = (target: ConfigTarget, preset: "lmstudio" | "ollama") => {
    const base = preset === "lmstudio" ? LM_STUDIO_PRESET : OLLAMA_PRESET;
    if (target === "main") {
      setDraft((prev) => ({ ...prev, ...base }));
      return;
    }

    setDraft((prev) => ({
      ...prev,
      helperProvider: base.provider,
      helperBaseUrl: base.baseUrl,
      helperModel: preset === "lmstudio" ? "Qwen2.5-Coder-1.5B-Instruct" : "qwen2.5-coder:1.5b",
      helperApiKey: ""
    }));
  };

  const connectionFor = (target: ConfigTarget) => {
    if (target === "main" || draft.helperUsesMainConnection) {
      return {
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        model: target === "main" ? draft.model : draft.helperModel,
        apiKey: draft.apiKey
      };
    }

    return {
      provider: draft.helperProvider,
      baseUrl: draft.helperBaseUrl,
      model: draft.helperModel,
      apiKey: draft.helperApiKey
    };
  };

  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const saved = await window.lumen.settings.save(draft);
      setSettings(saved);
      setDraft(saved);
      setStatus("Saved ✅");
    } catch (error) {
      setStatus(error instanceof Error ? `Failed ❌ ${error.message}` : "Failed ❌");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (target: ConfigTarget) => {
    setStatus(`Testing ${target} model...`);
    try {
      const current = connectionFor(target);
      const result = await window.lumen.llm.test({
        baseUrl: current.baseUrl,
        model: current.model,
        apiKey: current.apiKey
      });
      if (result.ok) {
        setDraft((prev) => {
          if (target === "main") {
            return {
              ...prev,
              model: result.modelUsed || prev.model,
              recentModels: Array.from(new Set([result.modelUsed || "", ...prev.recentModels].filter(Boolean))).slice(0, 20)
            };
          }

          return {
            ...prev,
            helperModel: result.modelUsed || prev.helperModel,
            helperRecentModels: Array.from(new Set([result.modelUsed || "", ...prev.helperRecentModels].filter(Boolean))).slice(0, 20)
          };
        });
        setStatus(result.note ? `${target} connected ✅ ${result.note}` : `${target} connected ✅`);
      } else {
        setStatus(`${target} failed ❌`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? `Failed ❌ ${error.message}` : "Failed ❌");
    }
  };

  const refreshModels = async (target: ConfigTarget) => {
    setWorking(true);
    try {
      const current = connectionFor(target);
      const result = await window.lumen.llm.listModels({
        baseUrl: current.baseUrl,
        model: current.model,
        apiKey: current.apiKey,
        provider: current.provider
      });
      if (!result.models.length) {
        setStatus(`No local ${target} models found.`);
        return;
      }

      setDraft((prev) =>
        target === "main"
          ? {
              ...prev,
              recentModels: Array.from(new Set([...result.models, ...prev.recentModels])).slice(0, 20)
            }
          : {
              ...prev,
              helperRecentModels: Array.from(new Set([...result.models, ...prev.helperRecentModels])).slice(0, 20)
            }
      );
      setStatus(`Found ${result.models.length} ${target} model(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? `Failed ❌ ${error.message}` : "Failed ❌");
    } finally {
      setWorking(false);
    }
  };

  const installModel = async (target: ConfigTarget) => {
    const current = connectionFor(target);
    if (!draft.onlineMode) {
      setStatus("Enable Online mode first to install models.");
      return;
    }
    if (!window.confirm(`Download ${target} model "${current.model}" now?`)) return;

    setWorking(true);
    setStatus(`Installing ${current.model}...`);
    try {
      await window.lumen.llm.installModel({
        baseUrl: current.baseUrl,
        model: current.model,
        apiKey: current.apiKey,
        provider: current.provider
      });
      await refreshModels(target);
      setStatus(`Installed ✅ ${current.model}`);
    } catch (error) {
      setStatus(error instanceof Error ? `Failed ❌ ${error.message}` : "Failed ❌");
    } finally {
      setWorking(false);
    }
  };

  const providerSelect = (value: Provider, target: ConfigTarget) => {
    if (target === "main") {
      setDraft((prev) => ({ ...prev, provider: value }));
      return;
    }
    setDraft((prev) => ({ ...prev, helperProvider: value }));
  };

  return (
    <div className="lumen-scroll h-full overflow-auto p-3 text-xs">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-muted">Lumen Settings</div>
        <div className="flex gap-1">
          <Button onClick={() => applyPreset("main", "lmstudio")}>LM Studio</Button>
          <Button onClick={() => applyPreset("main", "ollama")}>Ollama</Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Main Model</div>

          <label className="block">
            <div className="mb-1 text-muted">Provider</div>
            <select
              className="h-8 w-full rounded border border-border bg-black/20 px-2"
              value={draft.provider}
              onChange={(event) => providerSelect(event.target.value as Provider, "main")}
            >
              <option value="lmstudio">LM Studio</option>
              <option value="ollama">Ollama</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          <label className="mt-2 block">
            <div className="mb-1 text-muted">Base URL</div>
            <Input value={draft.baseUrl} onChange={(event) => setDraft((prev) => ({ ...prev, baseUrl: event.target.value }))} />
          </label>

          <label className="mt-2 block">
            <div className="mb-1 text-muted">Main Model Picker</div>
            <Input
              list="lumen-models"
              value={draft.model}
              onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))}
            />
            <datalist id="lumen-models">
              {modelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>

          <label className="mt-2 block">
            <div className="mb-1 text-muted">API Key (optional)</div>
            <Input
              type="password"
              value={draft.apiKey}
              onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
              placeholder="Leave blank for local server without auth"
            />
          </label>

          <div className="mt-2 flex gap-2">
            <Button onClick={() => void testConnection("main")} disabled={working}>
              Test Main
            </Button>
            <Button onClick={() => void refreshModels("main")} disabled={working}>
              Refresh Main
            </Button>
            <Button onClick={() => void installModel("main")} disabled={working}>
              Install Main
            </Button>
          </div>
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wide text-muted">Helper Model</div>
            <div className="flex gap-1">
              <Button onClick={() => applyPreset("helper", "lmstudio")}>LM Studio</Button>
              <Button onClick={() => applyPreset("helper", "ollama")}>Ollama</Button>
            </div>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.helperEnabled}
              onChange={(event) => setDraft((prev) => ({ ...prev, helperEnabled: event.target.checked }))}
            />
            <span>Enable lightweight helper model for side jobs</span>
          </label>

          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.helperUsesMainConnection}
              onChange={(event) => setDraft((prev) => ({ ...prev, helperUsesMainConnection: event.target.checked }))}
            />
            <span>Helper uses same runtime as main model</span>
          </label>

          <label className="mt-2 block">
            <div className="mb-1 text-muted">Helper Model Picker</div>
            <Input
              list="lumen-helper-models"
              value={draft.helperModel}
              onChange={(event) => setDraft((prev) => ({ ...prev, helperModel: event.target.value }))}
              placeholder="qwen2.5-coder:1.5b"
            />
            <datalist id="lumen-helper-models">
              {helperModelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>

          {!draft.helperUsesMainConnection && (
            <>
              <label className="mt-2 block">
                <div className="mb-1 text-muted">Helper Provider</div>
                <select
                  className="h-8 w-full rounded border border-border bg-black/20 px-2"
                  value={draft.helperProvider}
                  onChange={(event) => providerSelect(event.target.value as Provider, "helper")}
                >
                  <option value="lmstudio">LM Studio</option>
                  <option value="ollama">Ollama</option>
                  <option value="custom">Custom</option>
                </select>
              </label>

              <label className="mt-2 block">
                <div className="mb-1 text-muted">Helper Base URL</div>
                <Input
                  value={draft.helperBaseUrl}
                  onChange={(event) => setDraft((prev) => ({ ...prev, helperBaseUrl: event.target.value }))}
                />
              </label>

              <label className="mt-2 block">
                <div className="mb-1 text-muted">Helper API Key (optional)</div>
                <Input
                  type="password"
                  value={draft.helperApiKey}
                  onChange={(event) => setDraft((prev) => ({ ...prev, helperApiKey: event.target.value }))}
                />
              </label>
            </>
          )}

          <div className="mt-2 text-[11px] text-muted">
            Recommended lightweight helper: `qwen2.5-coder:1.5b`
          </div>

          <div className="mt-2 flex gap-2">
            <Button onClick={() => void testConnection("helper")} disabled={working || !draft.helperEnabled}>
              Test Helper
            </Button>
            <Button onClick={() => void refreshModels("helper")} disabled={working || !draft.helperEnabled}>
              Refresh Helper
            </Button>
            <Button onClick={() => void installModel("helper")} disabled={working || !draft.helperEnabled}>
              Install Helper
            </Button>
          </div>
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Runtime</div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.onlineMode}
              onChange={(event) => setDraft((prev) => ({ ...prev, onlineMode: event.target.checked }))}
            />
            <span>Online mode (OFF by default)</span>
          </label>

          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.compactMode}
              onChange={(event) => setDraft((prev) => ({ ...prev, compactMode: event.target.checked }))}
            />
            <span>Compact mode</span>
          </label>

          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.autoManageLocalRuntime}
              onChange={(event) => setDraft((prev) => ({ ...prev, autoManageLocalRuntime: event.target.checked }))}
            />
            <span>Auto-manage local runtime (no extra UI windows)</span>
          </label>

          <label className="mt-2 block">
            <div className="mb-1 text-muted">Auto-stop runtime after idle (minutes)</div>
            <Input
              type="number"
              min={1}
              max={240}
              value={draft.autoStopMinutes}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  autoStopMinutes: Math.max(1, Number(event.target.value) || 1)
                }))
              }
            />
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <Button onClick={() => void save()} disabled={saving}>
            Save Settings
          </Button>
        </div>

        <div className="text-[11px] text-muted">{status}</div>
      </div>
    </div>
  );
}
