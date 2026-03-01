import { useEffect, useMemo, useState } from "react";

import { LM_STUDIO_PRESET, OLLAMA_PRESET, type LlmConfig } from "@lumen/llm-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/state/useAppStore";

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

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const applyPreset = (preset: "lmstudio" | "ollama") => {
    if (preset === "lmstudio") {
      setDraft((prev) => ({ ...prev, ...LM_STUDIO_PRESET }));
      return;
    }
    setDraft((prev) => ({ ...prev, ...OLLAMA_PRESET }));
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

  const testConnection = async () => {
    setStatus("Testing...");
    try {
      const result = await window.lumen.llm.test({
        baseUrl: draft.baseUrl,
        model: draft.model,
        apiKey: draft.apiKey
      });
      if (result.ok) {
        if (result.modelUsed && result.modelUsed !== draft.model) {
          setDraft((prev) => ({
            ...prev,
            model: result.modelUsed || prev.model,
            recentModels: Array.from(new Set([result.modelUsed || "", ...prev.recentModels].filter(Boolean))).slice(0, 10)
          }));
        }
        setStatus(result.note ? `Connected ✅ ${result.note}` : "Connected ✅");
      } else {
        setStatus("Failed ❌");
      }
    } catch (error) {
      setStatus(error instanceof Error ? `Failed ❌ ${error.message}` : "Failed ❌");
    }
  };

  const refreshModels = async () => {
    setWorking(true);
    try {
      const result = await window.lumen.llm.listModels({
        baseUrl: draft.baseUrl,
        model: draft.model,
        apiKey: draft.apiKey,
        provider: draft.provider
      });
      if (!result.models.length) {
        setStatus("No local models found. Use Install Selected Model to download one.");
        return;
      }
      setDraft((prev) => ({
        ...prev,
        recentModels: Array.from(new Set([...result.models, ...prev.recentModels])).slice(0, 20)
      }));
      setStatus(`Found ${result.models.length} local model(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? `Failed ❌ ${error.message}` : "Failed ❌");
    } finally {
      setWorking(false);
    }
  };

  const installSelectedModel = async () => {
    if (!draft.onlineMode) {
      setStatus("Enable Online mode first to install models.");
      return;
    }
    const approved = window.confirm(`Download model "${draft.model}" now? This uses internet and may take time.`);
    if (!approved) return;

    setWorking(true);
    setStatus(`Installing ${draft.model}...`);
    try {
      await window.lumen.llm.installModel({
        baseUrl: draft.baseUrl,
        model: draft.model,
        apiKey: draft.apiKey,
        provider: draft.provider
      });
      await refreshModels();
      setStatus(`Installed ✅ ${draft.model}`);
    } catch (error) {
      setStatus(error instanceof Error ? `Failed ❌ ${error.message}` : "Failed ❌");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="lumen-scroll h-full overflow-auto p-3 text-xs">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-muted">Lumen Settings</div>
        <div className="flex gap-1">
          <Button onClick={() => applyPreset("lmstudio")}>LM Studio</Button>
          <Button onClick={() => applyPreset("ollama")}>Ollama</Button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block">
          <div className="mb-1 text-muted">Provider</div>
          <select
            className="h-8 w-full rounded border border-border bg-black/20 px-2"
            value={draft.provider}
            onChange={(event) => setDraft((prev) => ({ ...prev, provider: event.target.value as LlmConfig["provider"] }))}
          >
            <option value="lmstudio">LM Studio</option>
            <option value="ollama">Ollama</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        <label className="block">
          <div className="mb-1 text-muted">Base URL</div>
          <Input value={draft.baseUrl} onChange={(event) => setDraft((prev) => ({ ...prev, baseUrl: event.target.value }))} />
        </label>

        <label className="block">
          <div className="mb-1 text-muted">Model Picker</div>
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

        <label className="block">
          <div className="mb-1 text-muted">API Key (optional)</div>
          <Input
            type="password"
            value={draft.apiKey}
            onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
            placeholder="Leave blank for local server without auth"
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.onlineMode}
            onChange={(event) => setDraft((prev) => ({ ...prev, onlineMode: event.target.checked }))}
          />
          <span>Online mode (OFF by default)</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.compactMode}
            onChange={(event) => setDraft((prev) => ({ ...prev, compactMode: event.target.checked }))}
          />
          <span>Compact mode</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.autoManageLocalRuntime}
            onChange={(event) => setDraft((prev) => ({ ...prev, autoManageLocalRuntime: event.target.checked }))}
          />
          <span>Auto-manage local runtime (no extra UI windows)</span>
        </label>

        <label className="block">
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

        <div className="flex gap-2 pt-1">
          <Button onClick={() => void testConnection()} disabled={working}>
            Connection Test
          </Button>
          <Button onClick={() => void refreshModels()} disabled={working}>
            Refresh Models
          </Button>
          <Button onClick={() => void installSelectedModel()} disabled={working}>
            Install Selected Model
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            Save Settings
          </Button>
        </div>

        <div className="text-[11px] text-muted">{status}</div>
      </div>
    </div>
  );
}
