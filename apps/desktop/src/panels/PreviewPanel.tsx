import { type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { diagnosticsPollIntervalMs, statusPollIntervalMs } from "@/engines/runtimeEngine";
import { createTimelineEntry } from "@/lib/timeline";
import { useAppStore } from "@/state/useAppStore";
import type {
  PreviewBrowserDiagnostics,
  PreviewPickedSelector,
  PreviewScreenshot,
  PreviewSnapshot,
  PreviewStatus,
  ProjectInspection
} from "@/types/electron";

type VerificationStep = {
  id: string;
  type:
    | "connect"
    | "snapshot"
    | "screenshot"
    | "click"
    | "type"
    | "press"
    | "checkpoint"
    | "assert_text"
    | "assert_url"
    | "assert_console_clean"
    | "assert_network_clean";
  selector?: string;
  text?: string;
  key?: string;
  url?: string;
  label?: string;
  expected?: string;
};

type VerificationFlow = {
  id: string;
  name: string;
  steps: VerificationStep[];
  updatedAt: string;
};

const VERIFICATION_FLOWS_KEY = "lumen.preview.verificationFlows.v2";

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

const EMPTY_DIAGNOSTICS: PreviewBrowserDiagnostics = {
  url: "",
  title: "",
  consoleEvents: [],
  networkEvents: [],
  domSummary: null
};

function makeFlowId() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function loadVerificationFlows(): VerificationFlow[] {
  try {
    const raw =
      localStorage.getItem(VERIFICATION_FLOWS_KEY) ||
      localStorage.getItem("lumen.preview.verificationFlows.v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is VerificationFlow =>
          item &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          Array.isArray(item.steps)
      )
      .slice(0, 40);
  } catch {
    return [];
  }
}

function saveVerificationFlows(flows: VerificationFlow[]) {
  try {
    localStorage.setItem(VERIFICATION_FLOWS_KEY, JSON.stringify(flows.slice(0, 40)));
  } catch {
    // Ignore local storage errors.
  }
}

function normalizeCheckpointLabel(label: string) {
  const trimmed = label.trim();
  if (!trimmed) return "checkpoint";
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

function describeStep(step: VerificationStep) {
  if (step.type === "assert_text") return `assert text contains "${step.expected || ""}"`;
  if (step.type === "assert_url") return `assert url contains "${step.expected || ""}"`;
  if (step.type === "assert_console_clean") return "assert console has no errors";
  if (step.type === "assert_network_clean") return "assert network has no errors";
  if (step.type === "checkpoint") return `checkpoint "${step.label || "checkpoint"}"`;
  if (step.type === "click") return `click ${step.selector || "(selector)"}`;
  if (step.type === "type") return `type ${step.selector || "(selector)"}`;
  if (step.type === "press") return `press ${step.key || "Enter"}`;
  if (step.type === "screenshot") return "screenshot";
  if (step.type === "snapshot") return "snapshot";
  return "connect";
}

export function PreviewPanel() {
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const settings = useAppStore((state) => state.settings);
  const rightPanelTab = useAppStore((state) => state.rightPanelTab);
  const terminalTabs = useAppStore((state) => state.terminalTabs);
  const terminalVisible = useAppStore((state) => state.terminalVisible);
  const projectInspection = useAppStore((state) => state.projectInspection);
  const addTerminalTab = useAppStore((state) => state.addTerminalTab);
  const setActiveTerminal = useAppStore((state) => state.setActiveTerminal);
  const setProjectInspection = useAppStore((state) => state.setProjectInspection);
  const patchSessionMemory = useAppStore((state) => state.patchSessionMemory);
  const toggleTerminal = useAppStore((state) => state.toggleTerminal);
  const appendTimeline = useAppStore((state) => state.appendTimeline);

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
  const [assertionValue, setAssertionValue] = useState("");
  const [checkpointLabel, setCheckpointLabel] = useState("checkpoint");
  const [snapshot, setSnapshot] = useState<PreviewSnapshot>(EMPTY_SNAPSHOT);
  const [lastScreenshot, setLastScreenshot] = useState<PreviewScreenshot | null>(null);
  const [diagnostics, setDiagnostics] = useState<PreviewBrowserDiagnostics>(EMPTY_DIAGNOSTICS);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState("");
  const [flows, setFlows] = useState<VerificationFlow[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [lastRunFlowId, setLastRunFlowId] = useState("");
  const [flowName, setFlowName] = useState("Quick Verify");
  const [flowSteps, setFlowSteps] = useState<VerificationStep[]>([]);
  const [flowImportText, setFlowImportText] = useState("");
  const [flowStatus, setFlowStatus] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState<VerificationStep[]>([]);
  const [pickerArmed, setPickerArmed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeUrl = useMemo(() => customUrl.trim() || status.url, [customUrl, status.url]);
  const inspection = status.inspection || projectInspection || EMPTY_INSPECTION;

  const recordPreviewTimeline = useCallback(
    (title: string, detail: string, status: "running" | "done" | "failed" = "done") => {
      appendTimeline(
        createTimelineEntry({
          phase: "verify",
          status,
          title,
          detail,
          source: "preview"
        })
      );
    },
    [appendTimeline]
  );

  const syncInspection = useCallback((nextInspection: ProjectInspection) => {
    setProjectInspection(nextInspection);
    patchSessionMemory({
      projectType: nextInspection.framework,
      detectedScripts: nextInspection.scripts.map((script) => script.name)
    });
  }, [patchSessionMemory, setProjectInspection]);

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

  const loadStatus = useCallback(async () => {
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
  }, [patchSessionMemory, syncInspection, workspaceRoot]);

  const pushRecordedStep = useCallback(
    (step: Omit<VerificationStep, "id">) => {
      if (!recording) return;
      setRecordedSteps((current) => [...current.slice(-79), { ...step, id: makeFlowId() }]);
    },
    [recording]
  );

  const loadDiagnostics = useCallback(
    async (forceConnect = false) => {
      setDiagnosticsBusy(true);
      setDiagnosticsStatus("");
      try {
        if (forceConnect && !status.browser.connected) {
          await window.lumen.preview.browserConnect({ url: activeUrl || undefined });
        }
        const result = await window.lumen.preview.browserDiagnostics({
          url: activeUrl || undefined,
          limit: settings.lowResourceMode ? 40 : 120,
          includeDom: true
        });
        setDiagnostics(result);
        setDiagnosticsStatus(
          `Diagnostics loaded: ${result.consoleEvents.length} console events, ${result.networkEvents.length} network events.`
        );
      } catch (nextError) {
        setDiagnosticsStatus(nextError instanceof Error ? nextError.message : "Failed to load diagnostics.");
      } finally {
        setDiagnosticsBusy(false);
      }
    },
    [activeUrl, settings.lowResourceMode, status.browser.connected]
  );

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const stored = loadVerificationFlows();
    setFlows(stored);
    if (stored.length) {
      setSelectedFlowId(stored[0].id);
    }
  }, []);

  useEffect(() => {
    if (rightPanelTab !== "preview" && rightPanelTab !== "diagnostics") return;
    const timer = setInterval(() => {
      void loadStatus();
    }, statusPollIntervalMs(settings.lowResourceMode));
    return () => clearInterval(timer);
  }, [loadStatus, rightPanelTab, settings.lowResourceMode]);

  useEffect(() => {
    if (rightPanelTab !== "preview" && rightPanelTab !== "diagnostics") return;
    if (!status.browser.connected) return;
    void loadDiagnostics(false);
    const timer = setInterval(() => {
      void loadDiagnostics(false);
    }, diagnosticsPollIntervalMs(settings.lowResourceMode));
    return () => clearInterval(timer);
  }, [loadDiagnostics, rightPanelTab, settings.lowResourceMode, status.browser.connected]);

  useEffect(() => {
    if (activeUrl) return;
    setPickerArmed(false);
  }, [activeUrl]);

  const runCurrentProject = async () => {
    setBusy(true);
    setError("");
    recordPreviewTimeline("Preview project start", `Path: ${projectPath.trim() || "."}`, "running");
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
      recordPreviewTimeline("Preview project running", next.url || "Project preview started");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to run current project.");
      recordPreviewTimeline(
        "Preview project failed",
        nextError instanceof Error ? nextError.message : "Failed to run current project.",
        "failed"
      );
    } finally {
      setBusy(false);
    }
  };

  const serveStaticFolder = async () => {
    setBusy(true);
    setError("");
    recordPreviewTimeline("Static preview start", `Path: ${staticPath.trim() || "."}`, "running");
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
      recordPreviewTimeline("Static preview running", next.url || "Static preview started");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to serve static preview.");
      recordPreviewTimeline(
        "Static preview failed",
        nextError instanceof Error ? nextError.message : "Failed to serve static preview.",
        "failed"
      );
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
      recordPreviewTimeline("Preview stopped", "Preview runtime stopped");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to stop preview.");
      recordPreviewTimeline("Preview stop failed", nextError instanceof Error ? nextError.message : "Failed to stop preview.", "failed");
    } finally {
      setBusy(false);
    }
  };

  const connectBrowser = async () => {
    setBusy(true);
    setError("");
    recordPreviewTimeline("Browser connect", activeUrl || "Connect browser", "running");
    try {
      const result = await window.lumen.preview.browserConnect({ url: activeUrl || undefined });
      setSnapshot(result.snapshot);
      pushRecordedStep({ type: "connect", url: activeUrl || undefined });
      await loadStatus();
      await loadDiagnostics(false);
      recordPreviewTimeline("Browser connected", result.url || activeUrl || "Connected");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to connect browser.");
      recordPreviewTimeline(
        "Browser connect failed",
        nextError instanceof Error ? nextError.message : "Failed to connect browser.",
        "failed"
      );
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
      pushRecordedStep({ type: "snapshot", url: activeUrl || undefined });
      await loadStatus();
      await loadDiagnostics(false);
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
      pushRecordedStep({ type: "click", selector: selector.trim(), url: activeUrl || undefined });
      await loadDiagnostics(false);
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
      pushRecordedStep({
        type: "type",
        selector: selector.trim(),
        text: browserText,
        url: activeUrl || undefined
      });
      await loadDiagnostics(false);
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
      pushRecordedStep({ type: "press", key: browserKey.trim() || "Enter", url: activeUrl || undefined });
      await loadDiagnostics(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Key press failed.");
    } finally {
      setBusy(false);
    }
  };

  const pickSelectorFromPreview = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!activeUrl) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratioX = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
    const ratioY = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(rect.height, 1)));
    setPickerArmed(false);
    setBusy(true);
    setError("");
    try {
      const picked: PreviewPickedSelector = await window.lumen.preview.browserPick({
        ratioX,
        ratioY,
        url: activeUrl || undefined
      });
      setSelector(picked.selector);
      setFlowStatus(`Picked selector: ${picked.selector}${picked.text ? ` (${picked.text})` : ""}`);
      await loadDiagnostics(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Selector picker failed.");
    } finally {
      setBusy(false);
    }
  };

  const captureScreenshot = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await window.lumen.preview.browserScreenshot({ url: activeUrl || undefined, fullPage: true });
      setLastScreenshot(result);
      pushRecordedStep({ type: "screenshot", url: activeUrl || undefined });
      await loadStatus();
      await loadDiagnostics(false);
      recordPreviewTimeline("Screenshot captured", result.path || "Screenshot saved");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Screenshot failed.");
      recordPreviewTimeline("Screenshot failed", nextError instanceof Error ? nextError.message : "Screenshot failed.", "failed");
    } finally {
      setBusy(false);
    }
  };

  const persistFlows = (nextFlows: VerificationFlow[]) => {
    setFlows(nextFlows);
    saveVerificationFlows(nextFlows);
  };

  const addFlowStep = (type: VerificationStep["type"]) => {
    const step: VerificationStep = {
      id: makeFlowId(),
      type,
      url: activeUrl || undefined
    };
    if (type === "click" || type === "type") {
      step.selector = selector.trim();
    }
    if (type === "type") {
      step.text = browserText;
    }
    if (type === "press") {
      step.key = browserKey.trim() || "Enter";
    }
    if (type === "assert_text" || type === "assert_url") {
      step.expected = assertionValue.trim();
    }
    if (type === "checkpoint") {
      step.label = checkpointLabel.trim() || "checkpoint";
    }
    setFlowSteps((current) => [...current, step]);
  };

  const removeFlowStep = (stepId: string) => {
    setFlowSteps((current) => current.filter((step) => step.id !== stepId));
  };

  const saveCurrentFlow = () => {
    if (!flowName.trim() || !flowSteps.length) return;
    const next: VerificationFlow = {
      id: makeFlowId(),
      name: flowName.trim(),
      steps: flowSteps,
      updatedAt: new Date().toISOString()
    };
    const nextFlows = [next, ...flows].slice(0, 40);
    persistFlows(nextFlows);
    setSelectedFlowId(next.id);
    setFlowStatus(`Saved flow "${next.name}" with ${next.steps.length} step(s).`);
  };

  const saveRecordedFlow = () => {
    if (!recordedSteps.length) return;
    const name = `${flowName.trim() || "Recorded Flow"} ${new Date().toLocaleTimeString()}`;
    const next: VerificationFlow = {
      id: makeFlowId(),
      name,
      steps: recordedSteps,
      updatedAt: new Date().toISOString()
    };
    const nextFlows = [next, ...flows].slice(0, 40);
    persistFlows(nextFlows);
    setSelectedFlowId(next.id);
    setRecordedSteps([]);
    setRecording(false);
    setFlowStatus(`Saved recorded flow "${next.name}".`);
    recordPreviewTimeline("Verification macro saved", `${next.name} (${next.steps.length} steps)`);
  };

  const loadFlowToDraft = () => {
    const flow = flows.find((item) => item.id === selectedFlowId);
    if (!flow) return;
    setFlowName(flow.name);
    setFlowSteps(flow.steps);
    setFlowStatus(`Loaded "${flow.name}" into draft.`);
  };

  const deleteSelectedFlow = () => {
    if (!selectedFlowId) return;
    const target = flows.find((item) => item.id === selectedFlowId);
    if (!target) return;
    if (!window.confirm(`Delete verification flow "${target.name}"?`)) return;
    const next = flows.filter((item) => item.id !== selectedFlowId);
    persistFlows(next);
    setSelectedFlowId(next[0]?.id || "");
    setFlowStatus(`Deleted "${target.name}".`);
  };

  const runFlow = async (flow: VerificationFlow) => {
    setBusy(true);
    setError("");
    setFlowStatus(`Running "${flow.name}"...`);
    recordPreviewTimeline("Verification flow started", `${flow.name} (${flow.steps.length} steps)`, "running");
    try {
      let latestSnapshot: PreviewSnapshot = EMPTY_SNAPSHOT;
      for (const [index, step] of flow.steps.entries()) {
        setFlowStatus(`Step ${index + 1}/${flow.steps.length}: ${describeStep(step)}`);
        if (step.type === "connect") {
          const result = await window.lumen.preview.browserConnect({ url: step.url || activeUrl || undefined });
          latestSnapshot = result.snapshot;
          setSnapshot(result.snapshot);
          continue;
        }
        if (step.type === "snapshot") {
          const result = await window.lumen.preview.browserSnapshot();
          latestSnapshot = result;
          setSnapshot(result);
          continue;
        }
        if (step.type === "screenshot") {
          const shot = await window.lumen.preview.browserScreenshot({ url: step.url || activeUrl || undefined, fullPage: true });
          setLastScreenshot(shot);
          continue;
        }
        if (step.type === "checkpoint") {
          const fileName = `checkpoint-${normalizeCheckpointLabel(step.label || "checkpoint")}-${Date.now()}.png`;
          const shot = await window.lumen.preview.browserScreenshot({
            url: step.url || activeUrl || undefined,
            fullPage: true,
            fileName
          });
          setLastScreenshot(shot);
          continue;
        }
        if (step.type === "click") {
          const result = await window.lumen.preview.browserClick({
            selector: step.selector || "",
            url: step.url || activeUrl || undefined
          });
          latestSnapshot = result;
          setSnapshot(result);
          continue;
        }
        if (step.type === "type") {
          const result = await window.lumen.preview.browserType({
            selector: step.selector || "",
            text: step.text || "",
            url: step.url || activeUrl || undefined
          });
          latestSnapshot = result;
          setSnapshot(result);
          continue;
        }
        if (step.type === "press") {
          const result = await window.lumen.preview.browserPress({
            key: step.key || "Enter",
            url: step.url || activeUrl || undefined
          });
          latestSnapshot = result;
          setSnapshot(result);
          continue;
        }
        if (step.type === "assert_text") {
          const expected = (step.expected || "").trim();
          if (!expected) throw new Error("assert_text step requires expected text.");
          if (!latestSnapshot.text) {
            latestSnapshot = await window.lumen.preview.browserSnapshot();
            setSnapshot(latestSnapshot);
          }
          if (!latestSnapshot.text.toLowerCase().includes(expected.toLowerCase())) {
            throw new Error(`Assertion failed: text "${expected}" not found in snapshot.`);
          }
          continue;
        }
        if (step.type === "assert_url") {
          const expected = (step.expected || "").trim();
          if (!expected) throw new Error("assert_url step requires expected URL fragment.");
          const current = await window.lumen.preview.status();
          const currentUrl = (current.browser.url || current.url || "").trim();
          if (!currentUrl.toLowerCase().includes(expected.toLowerCase())) {
            throw new Error(`Assertion failed: URL "${currentUrl}" does not include "${expected}".`);
          }
          continue;
        }
        if (step.type === "assert_console_clean") {
          const current = await window.lumen.preview.status();
          if (current.browser.consoleErrors > 0) {
            throw new Error(`Assertion failed: console has ${current.browser.consoleErrors} error(s).`);
          }
          continue;
        }
        if (step.type === "assert_network_clean") {
          const current = await window.lumen.preview.status();
          if (current.browser.networkErrors > 0) {
            throw new Error(`Assertion failed: network has ${current.browser.networkErrors} error(s).`);
          }
        }
      }
      await loadStatus();
      await loadDiagnostics(false);
      setLastRunFlowId(flow.id);
      setFlowStatus(
        `Flow complete ✅ ${flow.steps.length} step(s). ${latestSnapshot.title ? `Last snapshot: ${latestSnapshot.title}` : ""}`.trim()
      );
      recordPreviewTimeline("Verification flow complete", `${flow.name} (${flow.steps.length} steps)`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Verification flow failed.";
      setError(message);
      setFlowStatus(`Flow failed ❌ ${message}`);
      recordPreviewTimeline("Verification flow failed", `${flow.name}: ${message}`, "failed");
    } finally {
      setBusy(false);
    }
  };

  const runSelectedFlow = async () => {
    const flow = flows.find((item) => item.id === selectedFlowId);
    if (!flow) return;
    await runFlow(flow);
  };

  const rerunLastFlow = async () => {
    const flow = flows.find((item) => item.id === lastRunFlowId);
    if (!flow) {
      setFlowStatus("No previously run flow found.");
      return;
    }
    setSelectedFlowId(flow.id);
    await runFlow(flow);
  };

  const exportSelectedFlow = async () => {
    const flow = flows.find((item) => item.id === selectedFlowId);
    if (!flow) return;
    const payload = JSON.stringify({ name: flow.name, steps: flow.steps }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setFlowStatus(`Copied "${flow.name}" JSON to clipboard.`);
    } catch {
      setFlowStatus("Clipboard unavailable. Copy from import/export box.");
      setFlowImportText(payload);
    }
  };

  const importFlowFromJson = () => {
    const raw = flowImportText.trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { name?: string; steps?: VerificationStep[] };
      if (!Array.isArray(parsed.steps) || !parsed.steps.length) {
        throw new Error("Flow JSON must include a non-empty steps array.");
      }
      const name = (parsed.name || `Imported Flow ${new Date().toLocaleTimeString()}`).trim();
      const imported: VerificationFlow = {
        id: makeFlowId(),
        name,
        steps: parsed.steps.map((step) => ({ ...step, id: makeFlowId() })),
        updatedAt: new Date().toISOString()
      };
      const nextFlows = [imported, ...flows].slice(0, 40);
      persistFlows(nextFlows);
      setSelectedFlowId(imported.id);
      setFlowStatus(`Imported "${imported.name}" with ${imported.steps.length} step(s).`);
      recordPreviewTimeline("Verification macro imported", `${imported.name} (${imported.steps.length} steps)`);
    } catch (nextError) {
      setFlowStatus(nextError instanceof Error ? nextError.message : "Failed to import flow JSON.");
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
            <Button onClick={() => void captureScreenshot()} disabled={busy || !status.browser.connected}>
              Screenshot
            </Button>
            <Button onClick={() => setPickerArmed((current) => !current)} disabled={busy || !activeUrl}>
              {pickerArmed ? "Cancel Pick" : "Pick In Preview"}
            </Button>
            <Button onClick={() => void loadDiagnostics(true)} disabled={diagnosticsBusy || (!status.browser.connected && !activeUrl)}>
              Diagnostics
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
          {lastScreenshot?.path && (
            <div className="mt-2 rounded border border-border bg-black/30 p-2 text-[11px] text-muted">
              Screenshot saved: <span className="text-text">{lastScreenshot.path}</span>
            </div>
          )}
          {(status.browser.lastConsoleError || status.browser.lastNetworkError) && (
            <div className="mt-2 rounded border border-border bg-black/30 p-2 text-[11px] text-muted">
              {status.browser.lastConsoleError && <div>Last console error: {status.browser.lastConsoleError}</div>}
              {status.browser.lastNetworkError && <div>Last network error: {status.browser.lastNetworkError}</div>}
            </div>
          )}
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wide text-muted">Diagnostics Panes</div>
            <Button onClick={() => void loadDiagnostics(true)} disabled={diagnosticsBusy || (!status.browser.connected && !activeUrl)}>
              {diagnosticsBusy ? "Loading..." : "Refresh Diagnostics"}
            </Button>
          </div>
          {diagnosticsStatus && <div className="mb-2 text-[11px] text-muted">{diagnosticsStatus}</div>}
          {diagnostics.domSummary && (
            <div className="mb-2 rounded border border-border bg-black/25 p-2 text-[11px]">
              <div className="mb-1 text-[10px] uppercase text-muted">DOM Summary</div>
              <div>Title: {diagnostics.domSummary.title || "(untitled)"}</div>
              <div>URL: {diagnostics.domSummary.url}</div>
              <div>
                Interactive: {diagnostics.domSummary.counts.interactive} | Links: {diagnostics.domSummary.counts.links} | Buttons:{" "}
                {diagnostics.domSummary.counts.buttons} | Inputs: {diagnostics.domSummary.counts.inputs}
              </div>
              {!!diagnostics.domSummary.headings.length && (
                <div className="mt-1 truncate">Headings: {diagnostics.domSummary.headings.join(" | ")}</div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            <div className="rounded border border-border bg-black/25 p-2">
              <div className="mb-1 text-[10px] uppercase text-muted">Console ({diagnostics.consoleEvents.length})</div>
              <pre className="lumen-scroll max-h-44 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted">
                {diagnostics.consoleEvents.length
                  ? diagnostics.consoleEvents
                      .slice(-60)
                      .map((event) => `[${event.type}] ${event.text}`)
                      .join("\n")
                  : "No console events yet."}
              </pre>
            </div>
            <div className="rounded border border-border bg-black/25 p-2">
              <div className="mb-1 text-[10px] uppercase text-muted">Network ({diagnostics.networkEvents.length})</div>
              <pre className="lumen-scroll max-h-44 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted">
                {diagnostics.networkEvents.length
                  ? diagnostics.networkEvents
                      .slice(-60)
                      .map((event) => `${event.method} ${event.url} -> ${event.status}${event.error ? ` (${event.error})` : ""}`)
                      .join("\n")
                  : "No network events yet."}
              </pre>
            </div>
          </div>
        </div>

        <div className="rounded border border-border bg-black/20 p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Verification Flows</div>
          <label className="block">
            <div className="mb-1 text-muted">Draft flow name</div>
            <Input value={flowName} onChange={(event) => setFlowName(event.target.value)} placeholder="Smoke Test Flow" />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => setRecording((current) => !current)} disabled={busy}>
              {recording ? "Stop Recording" : "Start Recording"}
            </Button>
            <Button onClick={saveRecordedFlow} disabled={!recordedSteps.length}>
              Save Recorded Flow
            </Button>
            <Button onClick={() => setRecordedSteps([])} disabled={!recordedSteps.length}>
              Clear Recording
            </Button>
            <Button onClick={() => void rerunLastFlow()} disabled={!lastRunFlowId || busy}>
              Rerun Last Flow
            </Button>
          </div>
          {recordedSteps.length > 0 && (
            <div className="mt-2 rounded border border-border bg-black/25 p-2">
              <div className="mb-1 text-[10px] uppercase text-muted">
                Recording {recording ? "(active)" : "(stopped)"} · {recordedSteps.length} step(s)
              </div>
              <pre className="lumen-scroll max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted">
                {recordedSteps
                  .slice(-20)
                  .map((step, index) => `${index + 1}. ${describeStep(step)}`)
                  .join("\n")}
              </pre>
            </div>
          )}
          <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-muted">Assertion value (text/url fragment)</div>
              <Input
                value={assertionValue}
                onChange={(event) => setAssertionValue(event.target.value)}
                placeholder="Expected text or URL fragment"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-muted">Checkpoint label</div>
              <Input
                value={checkpointLabel}
                onChange={(event) => setCheckpointLabel(event.target.value)}
                placeholder="homepage-loaded"
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => addFlowStep("connect")} disabled={busy || !activeUrl}>
              + Connect
            </Button>
            <Button onClick={() => addFlowStep("snapshot")} disabled={busy || !status.browser.connected}>
              + Snapshot
            </Button>
            <Button onClick={() => addFlowStep("screenshot")} disabled={busy || !status.browser.connected}>
              + Screenshot
            </Button>
            <Button onClick={() => addFlowStep("click")} disabled={busy || !selector.trim()}>
              + Click
            </Button>
            <Button onClick={() => addFlowStep("type")} disabled={busy || !selector.trim()}>
              + Type
            </Button>
            <Button onClick={() => addFlowStep("press")} disabled={busy || !status.browser.connected}>
              + Press
            </Button>
            <Button onClick={() => addFlowStep("checkpoint")} disabled={busy || !status.browser.connected}>
              + Checkpoint
            </Button>
            <Button onClick={() => addFlowStep("assert_text")} disabled={busy || !assertionValue.trim()}>
              + Assert Text
            </Button>
            <Button onClick={() => addFlowStep("assert_url")} disabled={busy || !assertionValue.trim()}>
              + Assert URL
            </Button>
            <Button onClick={() => addFlowStep("assert_console_clean")} disabled={busy || !status.browser.connected}>
              + Assert Console Clean
            </Button>
            <Button onClick={() => addFlowStep("assert_network_clean")} disabled={busy || !status.browser.connected}>
              + Assert Network Clean
            </Button>
          </div>

          {flowSteps.length > 0 && (
            <div className="mt-2 rounded border border-border bg-black/25 p-2">
              <div className="mb-1 text-[10px] uppercase text-muted">Draft Steps</div>
              <div className="space-y-1">
                {flowSteps.map((step, index) => (
                  <div key={step.id} className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1">
                    <div className="truncate">{index + 1}. {describeStep(step)}</div>
                    <Button onClick={() => removeFlowStep(step.id)}>Remove</Button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Button onClick={saveCurrentFlow} disabled={!flowName.trim() || !flowSteps.length}>
                  Save Flow
                </Button>
                <Button onClick={() => setFlowSteps([])} disabled={!flowSteps.length}>
                  Clear Draft
                </Button>
              </div>
            </div>
          )}

          <div className="mt-2 rounded border border-border bg-black/25 p-2">
            <div className="mb-1 text-[10px] uppercase text-muted">Saved Flows</div>
            <select
              className="h-8 w-full rounded border border-border bg-black/20 px-2 text-[11px]"
              value={selectedFlowId}
              onChange={(event) => setSelectedFlowId(event.target.value)}
            >
              <option value="">Select flow</option>
              {flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name} ({flow.steps.length} steps)
                </option>
              ))}
            </select>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => void runSelectedFlow()} disabled={busy || !selectedFlowId}>
                Run Flow
              </Button>
              <Button onClick={loadFlowToDraft} disabled={!selectedFlowId}>
                Load to Draft
              </Button>
              <Button onClick={() => void exportSelectedFlow()} disabled={!selectedFlowId}>
                Export JSON
              </Button>
              <Button onClick={deleteSelectedFlow} disabled={!selectedFlowId}>
                Delete
              </Button>
            </div>
            <div className="mt-2 space-y-2">
              <Input
                value={flowImportText}
                onChange={(event) => setFlowImportText(event.target.value)}
                placeholder='Paste flow JSON, for example {"name":"Smoke","steps":[...]}'
              />
              <div className="flex gap-2">
                <Button onClick={importFlowFromJson} disabled={!flowImportText.trim()}>
                  Import JSON
                </Button>
                <Button onClick={() => setFlowImportText("")} disabled={!flowImportText.trim()}>
                  Clear JSON
                </Button>
              </div>
            </div>
            {flowStatus && <div className="mt-2 text-[11px] text-muted">{flowStatus}</div>}
          </div>
        </div>

        {error && <div className="text-[11px] text-bad">{error}</div>}
      </div>

      <div className="min-h-0 flex-1 p-2">
        {activeUrl ? (
          <div className="relative h-full w-full">
            <iframe
              key={`${activeUrl}-${refreshKey}`}
              title="Lumen Live Preview"
              src={activeUrl}
              className="h-full w-full rounded border border-border bg-black"
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
            />
            {pickerArmed && (
              <button
                type="button"
                className="absolute inset-0 z-10 cursor-crosshair rounded border border-accent/40 bg-accent/5"
                onClick={(event) => void pickSelectorFromPreview(event)}
              >
                <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[11px] text-accent">
                  Click element to capture selector
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded border border-dashed border-border bg-black/20 text-xs text-muted">
            Run the current project or serve a static folder to preview it inside Lumen.
          </div>
        )}
      </div>
    </div>
  );
}
