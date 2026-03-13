import { useEffect, useMemo, useRef, useState } from "react";
import { applyPatch, formatPatch, parsePatch, type ParsedDiff } from "diff";

import {
  buildDiff,
  deriveRecoverySuggestions,
  extractActionsFromText,
  fallbackActions,
  permissionForAction,
  redactSecrets,
  runAutonomousLoop,
  type AgentAction,
  type PermissionRequirement
} from "@lumen/core-agent";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { applyActionResultsToTaskGraph, createExecutionTaskGraph } from "@/engines/agentEngine";
import { liveBuildLoopIntervalMs } from "@/engines/runtimeEngine";
import { formatTrustPreset } from "@/engines/trustEngine";
import { createTimelineEntry, timelineFromAudit } from "@/lib/timeline";
import { useAppStore } from "@/state/useAppStore";

type AgentPanelProps = {
  refreshTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
};

type ChatLine = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  meta?: {
    reasoning?: ReasoningLevel;
    model?: string;
  };
};

type ApprovalRequest = {
  action: AgentAction;
  requirement: PermissionRequirement;
};

type ReasoningLevel = "low" | "medium" | "high" | "extra_high";

type RelatedFileContext = {
  path: string;
  content: string;
};

type DirectEditResult = {
  pendingChange: {
    id: string;
    type: "write";
    path: string;
    previousContent: string;
    nextContent: string;
    existedBefore: boolean;
    diff: string;
  };
  summary: string;
  relatedPaths: string[];
};

type HunkMeta = {
  id: string;
  header: string;
  added: number;
  removed: number;
  preview: string;
};

type HelperTask = "terminal_summary" | "action_extraction" | "mini_plan" | "selector_candidates" | "transcript_compress";

const HELPER_TASKS: HelperTask[] = [
  "terminal_summary",
  "action_extraction",
  "mini_plan",
  "selector_candidates",
  "transcript_compress"
];

function makeId() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function fileLabel(inputPath: string) {
  return inputPath.split(/[\\/]/).filter(Boolean).at(-1) || inputPath;
}

function normalizePath(root: string, inputPath?: string) {
  if (!inputPath || inputPath === ".") return root;
  if (/^[A-Za-z]:\\/.test(inputPath) || inputPath.startsWith("/")) return inputPath;
  return `${root.replace(/[\\/]+$/, "")}\\${inputPath.replace(/^[\\/]+/, "")}`;
}

function extractPathFromPrompt(goal: string) {
  const quotedMatch = goal.match(/["']([^"']+\.[A-Za-z0-9]{1,8})["']/);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const pathMatch = goal.match(/([A-Za-z]:\\[^\s"'`]+|(?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8})/);
  return pathMatch?.[1] || "";
}

function isEditIntent(goal: string) {
  return /\b(edit|change|modify|update|fix|rewrite|refactor|improve|patch|add|remove|replace|rename|implement|convert|optimize|clean up)\b/i.test(goal);
}

function isReadIntent(goal: string) {
  return /\b(read|open|show|inspect|explain|review|check)\b/i.test(goal);
}

function isBuildIntent(goal: string) {
  return (
    /\b(build|create|make|generate|scaffold|develop)\b/i.test(goal) &&
    /\b(app|application|website|site|landing|dashboard|frontend|ui|web)\b/i.test(goal)
  );
}

function isPreviewIntent(goal: string) {
  return /\b(preview|run|start|launch|open|test)\b/i.test(goal) && /\b(app|project|preview|site|website|ui)\b/i.test(goal);
}

function hasBuildOutputActions(actions: AgentAction[]) {
  return actions.some((action) => action.type === "write_file" || action.type === "delete_file" || action.type === "run_cmd");
}

const GOAL_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "have",
  "will",
  "about",
  "make",
  "build",
  "create",
  "update",
  "change",
  "file",
  "project",
  "app",
  "website"
]);

function extractGoalKeywords(goal: string) {
  const matches = goal.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
  return Array.from(new Set(matches.filter((word) => !GOAL_STOP_WORDS.has(word)))).slice(0, 4);
}

function sanitizeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function inferScaffoldFolder(goal: string) {
  const named = goal.match(/\b(?:named|called)\s+["']?([A-Za-z0-9 _-]{2,40})["']?/i)?.[1];
  const segment = sanitizeSegment(named || "");
  if (segment) return segment;
  if (/\bwebsite|site|landing|web\b/i.test(goal)) return "lumen-website";
  return "lumen-app";
}

function defaultScaffoldActions(goal: string): AgentAction[] {
  const folder = inferScaffoldFolder(goal);
  const title = goal.trim().replace(/\s+/g, " ").slice(0, 60) || "Lumen App";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="app">
      <header class="top">
        <h1>${title}</h1>
        <p>Generated by Lumen IDE agent.</p>
      </header>
      <section class="card">
        <h2>Starter App</h2>
        <p>This offline starter is ready for edits.</p>
        <button id="ping">Test Interaction</button>
        <pre id="output">Click the button to test app.js</pre>
      </section>
    </main>
    <script src="./app.js"></script>
  </body>
</html>
`;

  const css = `:root {
  --bg: #020817;
  --panel: #0b1220;
  --line: #1f2a44;
  --text: #e2e8f0;
  --muted: #94a3b8;
  --accent: #22d3ee;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", Tahoma, sans-serif;
  background: radial-gradient(1200px 600px at 20% -20%, #0f172a, var(--bg));
  color: var(--text);
}
.app {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}
.top h1 {
  margin: 0 0 8px;
  font-size: 1.7rem;
}
.top p {
  margin: 0 0 18px;
  color: var(--muted);
}
.card {
  background: linear-gradient(180deg, rgba(11, 18, 32, 0.95), rgba(11, 18, 32, 0.85));
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 18px;
}
button {
  border: 1px solid #1e3a8a;
  background: #0f172a;
  color: var(--text);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
button:hover { border-color: var(--accent); }
pre {
  margin: 12px 0 0;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: rgba(2, 6, 23, 0.7);
  white-space: pre-wrap;
}
`;

  const js = `const button = document.getElementById("ping");
const output = document.getElementById("output");

if (button && output) {
  button.addEventListener("click", () => {
    output.textContent = "App is running. Next step: ask Lumen agent for feature changes.";
  });
}
`;

  const readme = `# ${folder}

Generated by Lumen IDE agent for request:
${goal}

## Run
Open \`index.html\` in a browser.

## Files
- \`index.html\`
- \`styles.css\`
- \`app.js\`
`;

  return [
    { type: "write_file", path: `${folder}/index.html`, content: html, reason: "Create starter website shell" },
    { type: "write_file", path: `${folder}/styles.css`, content: css, reason: "Create starter styles" },
    { type: "write_file", path: `${folder}/app.js`, content: js, reason: "Create starter logic" },
    { type: "write_file", path: `${folder}/README.md`, content: readme, reason: "Create usage notes" }
  ];
}

function reasoningTemperature(level: ReasoningLevel) {
  if (level === "low") return 0.05;
  if (level === "medium") return 0.2;
  if (level === "high") return 0.35;
  return 0.5;
}

function reasoningInstruction(level: ReasoningLevel) {
  if (level === "low") return "Use minimal reasoning and provide a direct, concise result.";
  if (level === "medium") return "Use balanced reasoning and keep the response concise.";
  if (level === "high") return "Use deeper reasoning and verify assumptions before concluding.";
  return "Use maximum careful reasoning and provide the most robust solution with checks.";
}

function maxPlannerActions(level: ReasoningLevel) {
  if (level === "low") return 2;
  if (level === "medium") return 4;
  if (level === "high") return 8;
  return 12;
}

function shouldRunVerify(level: ReasoningLevel, goal: string, pendingChanges: number) {
  const explicitVerify = /\b(test|lint|verify|check|build|compile)\b/i.test(goal);
  const heavierEdit = /\b(refactor|rewrite|migrate|convert)\b/i.test(goal);
  if (level === "low") return false;
  if (level === "medium") return explicitVerify;
  if (level === "high") return explicitVerify || (pendingChanges > 0 && heavierEdit);
  return pendingChanges > 0 || explicitVerify;
}

function isLocalModelEndpoint(baseUrl: string) {
  const value = String(baseUrl || "").trim().toLowerCase();
  if (!value) return false;
  const candidate = /^[a-z]+:\/\//.test(value) ? value : `http://${value}`;
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/|$)/i.test(value);
  }
}

function parseChangePatch(diffText: string): ParsedDiff | null {
  const patches = parsePatch(diffText || "");
  return patches[0] || null;
}

function buildHunkMeta(diffText: string): HunkMeta[] {
  const patch = parseChangePatch(diffText);
  if (!patch?.hunks?.length) return [];

  return patch.hunks.map((hunk, index) => {
    const added = hunk.lines.filter((line) => line.startsWith("+")).length;
    const removed = hunk.lines.filter((line) => line.startsWith("-")).length;
    const preview = hunk.lines
      .filter((line) => line.startsWith("+") || line.startsWith("-"))
      .slice(0, 5)
      .join("\n");
    return {
      id: String(index),
      header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      added,
      removed,
      preview
    };
  });
}

function buildPatchFromHunks(diffText: string, selectedHunkIds: string[]) {
  const patch = parseChangePatch(diffText);
  if (!patch?.hunks?.length) return "";

  const chosen = patch.hunks.filter((_hunk, index) => selectedHunkIds.includes(String(index)));
  if (!chosen.length) return "";

  return formatPatch({
    ...patch,
    hunks: chosen
  });
}

function parseRelativeSpecifiers(source: string) {
  const specifiers = new Set<string>();
  const patterns = [
    /(?:import|export)\s+[^"'`]*?\sfrom\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match) {
      const specifier = match[1]?.trim();
      if (specifier?.startsWith(".")) {
        specifiers.add(specifier);
      }
      match = pattern.exec(source);
    }
  }

  return Array.from(specifiers);
}

function resolveLocalCandidatePaths(targetPath: string, specifier: string) {
  const normalizedBase = normalizePath(targetPath.replace(/[\\/][^\\/]+$/, ""), specifier).replace(/\//g, "\\");
  const candidates = new Set<string>();
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".css", ".json", ".md", "\\index.ts", "\\index.tsx", "\\index.js"];

  for (const extension of extensions) {
    candidates.add(`${normalizedBase}${extension}`);
  }

  return Array.from(candidates);
}

function buildFastSummary(
  goal: string,
  actions: AgentAction[],
  actionResults: Array<{ action: AgentAction; result: { ok: boolean; output?: unknown; error?: string }; skipped?: boolean }>,
  pendingCount: number,
  verifyResult: { ok: boolean; output?: unknown; error?: string } | null,
  extra?: string
) {
  const completed = actionResults.filter((item) => item.result.ok && !item.skipped).length;
  const firstChange = actionResults.find((item) => item.action.path)?.action.path;
  const targetText = firstChange ? ` Target: ${fileLabel(firstChange)}.` : "";
  const verifyText = verifyResult ? ` Verify: ${verifyResult.ok ? "pass" : "fail"}.` : "";
  const extraText = extra ? ` ${extra}` : "";
  return `Ran ${completed}/${actions.length} actions for "${goal}". Pending changes: ${pendingCount}.${targetText}${verifyText}${extraText}`.trim();
}

export function AgentPanel({ refreshTree, openFile }: AgentPanelProps) {
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const settings = useAppStore((state) => state.settings);
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const terminalTabs = useAppStore((state) => state.terminalTabs);
  const terminalVisible = useAppStore((state) => state.terminalVisible);
  const addTerminalTab = useAppStore((state) => state.addTerminalTab);
  const setActiveTerminal = useAppStore((state) => state.setActiveTerminal);
  const toggleTerminal = useAppStore((state) => state.toggleTerminal);
  const setRightPanelTab = useAppStore((state) => state.setRightPanelTab);
  const appendAudit = useAppStore((state) => state.appendAudit);
  const appendTimeline = useAppStore((state) => state.appendTimeline);
  const pendingChanges = useAppStore((state) => state.pendingChanges);
  const setPendingChanges = useAppStore((state) => state.setPendingChanges);
  const clearPendingChanges = useAppStore((state) => state.clearPendingChanges);
  const appliedPatchHistory = useAppStore((state) => state.appliedPatchHistory);
  const pushAppliedPatchSet = useAppStore((state) => state.pushAppliedPatchSet);
  const popAppliedPatchSet = useAppStore((state) => state.popAppliedPatchSet);
  const clearAppliedPatchHistory = useAppStore((state) => state.clearAppliedPatchHistory);
  const agentPhase = useAppStore((state) => state.agentPhase);
  const setAgentPhase = useAppStore((state) => state.setAgentPhase);
  const agentMode = useAppStore((state) => state.agentMode);
  const setAgentMode = useAppStore((state) => state.setAgentMode);
  const taskGraph = useAppStore((state) => state.taskGraph);
  const setTaskGraph = useAppStore((state) => state.setTaskGraph);
  const patchTaskNode = useAppStore((state) => state.patchTaskNode);
  const incrementRecoveryAttempt = useAppStore((state) => state.incrementRecoveryAttempt);
  const resetRecoveryAttempt = useAppStore((state) => state.resetRecoveryAttempt);
  const recoveryAttempt = useAppStore((state) => state.recoveryAttempt);
  const patchSessionMemory = useAppStore((state) => state.patchSessionMemory);

  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [planLines, setPlanLines] = useState<string[]>([]);
  const [goalObjectives, setGoalObjectives] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [streamStatus, setStreamStatus] = useState("");
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [chatModel, setChatModel] = useState(settings.model);
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>("medium");
  const [showPlan, setShowPlan] = useState(false);
  const [selectedChangeIds, setSelectedChangeIds] = useState<string[]>([]);
  const [selectedHunksByChange, setSelectedHunksByChange] = useState<Record<string, string[]>>({});
  const [activeChangeId, setActiveChangeId] = useState("");

  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const resolveApprovalRef = useRef<((approved: boolean) => void) | null>(null);
  const lastLiveHintRef = useRef("");

  useEffect(() => {
    setChatModel((current) => current || settings.model);
  }, [settings.model]);

  useEffect(() => {
    void window.lumen.agent.getTaskGraph().then((state) => {
      setAgentMode(state.mode);
      if (Array.isArray(state.taskGraph)) {
        setTaskGraph(state.taskGraph as Parameters<typeof setTaskGraph>[0]);
      }
    });
  }, [setAgentMode, setTaskGraph]);

  useEffect(() => {
    void window.lumen.agent.setMode({ mode: agentMode, taskGraph });
  }, [agentMode, taskGraph]);

  useEffect(() => {
    if (!pendingChanges.length) {
      setSelectedChangeIds([]);
      setSelectedHunksByChange({});
      setActiveChangeId("");
      return;
    }

    setSelectedChangeIds((current) => {
      const available = new Set(pendingChanges.map((change) => change.id));
      const filtered = current.filter((id) => available.has(id));
      return filtered.length ? filtered : pendingChanges.map((change) => change.id);
    });
    setSelectedHunksByChange((current) => {
      const next: Record<string, string[]> = {};
      for (const change of pendingChanges) {
        const availableHunks = buildHunkMeta(change.diff).map((hunk) => hunk.id);
        if (!availableHunks.length) {
          next[change.id] = [];
          continue;
        }
        const existing = (current[change.id] || []).filter((id) => availableHunks.includes(id));
        next[change.id] = existing.length ? existing : availableHunks;
      }
      return next;
    });
    setActiveChangeId((current) => (pendingChanges.some((change) => change.id === current) ? current : pendingChanges[0].id));
  }, [pendingChanges]);

  useEffect(() => {
    if (agentMode !== "live_build") return;
    const timer = setInterval(() => {
      if (busy) return;
      void (async () => {
        const status = await window.lumen.preview.status().catch(() => null);
        if (status) {
          patchSessionMemory({
            activePreviewUrl: status.url || "",
            previewMode: status.mode
          });
          const hint = status.browser.consoleErrors
            ? `Preview has ${status.browser.consoleErrors} console error(s).`
            : status.browser.networkErrors
              ? `Preview has ${status.browser.networkErrors} network error(s).`
              : status.running
                ? "Preview is running cleanly."
                : "No preview currently running.";
          if (hint !== lastLiveHintRef.current) {
            lastLiveHintRef.current = hint;
            pushMessage("system", `Live Build: ${hint}`);
          }
        }

        if (settings.permissionPreset !== "read_only") {
          await window.lumen.agent
            .runCmd({
              command: "git status --short",
              terminalId: "",
              approved: true,
              source: "agent",
              preset: settings.permissionPreset
            })
            .catch(() => null);
        }
      })();
    }, liveBuildLoopIntervalMs(settings.lowResourceMode));
    return () => clearInterval(timer);
  }, [agentMode, busy, patchSessionMemory, settings.lowResourceMode, settings.permissionPreset]);

  const activeTabPath = useMemo(() => tabs.find((tab) => tab.id === activeTabId)?.path || "", [tabs, activeTabId]);
  const helperConnection = useMemo(
    () =>
      settings.helperEnabled && !settings.lowResourceMode
        ? {
            baseUrl: (settings.helperUsesMainConnection ? settings.baseUrl : settings.helperBaseUrl).trim(),
            model: settings.helperModel.trim(),
            apiKey: settings.helperUsesMainConnection ? settings.apiKey : settings.helperApiKey
          }
        : null,
    [
      settings.apiKey,
      settings.baseUrl,
      settings.helperApiKey,
      settings.helperBaseUrl,
      settings.helperEnabled,
      settings.helperModel,
      settings.helperUsesMainConnection,
      settings.lowResourceMode
    ]
  );

  const pushMessage = (role: ChatLine["role"], text: string, meta?: ChatLine["meta"]) => {
    setMessages((prev) => [...prev, { id: makeId(), role, text, meta }]);
  };

  const recordAudit = (entry: Parameters<typeof appendAudit>[0]) => {
    appendAudit(entry);
    const timelineEntry = timelineFromAudit(entry);
    if (timelineEntry) {
      appendTimeline(timelineEntry);
    }
  };

  const shouldMirrorLoopAudit = (action: string) =>
    ![
      "agent.run_cmd",
      "agent.preview_start",
      "agent.preview_status",
      "agent.preview_snapshot",
      "agent.preview_screenshot",
      "agent.preview_click",
      "agent.preview_type",
      "agent.preview_press",
      "agent.git_status",
      "agent.git_diff",
      "agent.git_stage",
      "agent.git_unstage",
      "agent.git_commit",
      "agent.git_push"
    ].includes(action);

  const evaluatePolicyForAction = async (action: AgentAction) => {
    return await window.lumen.policy.evaluate({
      actionType: action.type,
      command: action.command || "",
      preset: settings.permissionPreset
    });
  };

  const toggleChangeSelection = (changeId: string) => {
    setSelectedChangeIds((current) =>
      current.includes(changeId) ? current.filter((id) => id !== changeId) : [...current, changeId]
    );
  };

  const toggleHunkSelection = (changeId: string, hunkId: string) => {
    setSelectedHunksByChange((current) => {
      const existing = current[changeId] || [];
      const next = existing.includes(hunkId) ? existing.filter((id) => id !== hunkId) : [...existing, hunkId];
      return { ...current, [changeId]: next };
    });
  };

  const setAllHunksSelected = (changeId: string, selected: boolean) => {
    const change = pendingChanges.find((item) => item.id === changeId);
    if (!change) return;
    const allHunks = buildHunkMeta(change.diff).map((hunk) => hunk.id);
    setSelectedHunksByChange((current) => ({ ...current, [changeId]: selected ? allHunks : [] }));
  };

  const ensureNamedTerminal = async (title: string) => {
    const existing = terminalTabs.find((tab) => tab.title === title);
    if (existing) {
      setActiveTerminal(existing.id);
      if (!terminalVisible) toggleTerminal();
      return existing.id;
    }

    const created = await window.lumen.terminal.create({ cols: 120, rows: 30 });
    addTerminalTab({ id: created.id, title });
    setActiveTerminal(created.id);
    if (!terminalVisible) toggleTerminal();
    return created.id;
  };

  const requestApproval = async (action: AgentAction, requirement: PermissionRequirement) => {
    const decision = await evaluatePolicyForAction(action);
    recordAudit({
      id: makeId(),
      timestamp: new Date().toISOString(),
      action: "policy.evaluate",
      detail: {
        actionType: action.type,
        allowed: decision.allowed,
        requiresApproval: decision.requiresApproval,
        risk: decision.risk,
        preset: decision.preset,
        reason: decision.reason,
        mode: agentMode
      }
    });
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    if (!decision.requiresApproval) return true;
    return await new Promise<boolean>((resolve) => {
      resolveApprovalRef.current = resolve;
      setApproval({
        action,
        requirement: {
          ...requirement,
          reason: `${requirement.reason} · ${decision.reason}`
        }
      });
    });
  };

  const streamToText = async (
    modelMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: {
      includeReasoning?: boolean;
      statusLabel?: string;
      modelRole?: "main" | "helper";
      helperTask?: HelperTask;
    }
  ) => {
    const requestId = makeId();
    const requestedRole = options?.modelRole || "main";
    if (requestedRole === "helper" && !options?.helperTask) {
      throw new Error("Helper lane requires an explicit helper task.");
    }
    if (options?.helperTask && !HELPER_TASKS.includes(options.helperTask)) {
      throw new Error(`Unsupported helper task: ${options.helperTask}`);
    }

    const canUseHelper = requestedRole === "helper" && helperConnection?.baseUrl && helperConnection?.model && !settings.lowResourceMode;
    const modelRole = canUseHelper ? "helper" : "main";
    const modelConfig = canUseHelper
      ? helperConnection
      : {
          baseUrl: settings.baseUrl,
          model: chatModel.trim() || settings.model,
          apiKey: settings.apiKey
        };
    const chosenModel = modelConfig.model;
    const includeReasoning = options?.includeReasoning !== false;
    const enhancedMessages = includeReasoning
      ? [{ role: "system" as const, content: `Reasoning mode: ${reasoningInstruction(reasoningLevel)}` }, ...modelMessages]
      : modelMessages;

    return await new Promise<string>((resolve, reject) => {
      let full = "";
      const hasStreamTimeouts = !isLocalModelEndpoint(modelConfig.baseUrl);
      const firstTokenTimeoutMs = modelRole === "helper" ? 20000 : 300000;
      const inactivityTimeoutMs = modelRole === "helper" ? 20000 : settings.lowResourceMode ? 180000 : 300000;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const clearStreamTimeout = () => {
        if (!timeout) return;
        clearTimeout(timeout);
        timeout = null;
      };
      const scheduleTimeout = (ms: number, message: string) => {
        clearStreamTimeout();
        timeout = setTimeout(() => {
          offChunk();
          offStatus();
          offDone();
          offError();
          setStreamStatus("");
          reject(new Error(message));
        }, ms);
      };
      if (hasStreamTimeouts) {
        scheduleTimeout(firstTokenTimeoutMs, `${modelRole === "helper" ? "Helper" : "Main"} model timeout after ${firstTokenTimeoutMs}ms`);
      }
      const touchTimeout = () => {
        if (!hasStreamTimeouts) return;
        scheduleTimeout(
          inactivityTimeoutMs,
          `${modelRole === "helper" ? "Helper" : "Main"} model stream stalled after ${inactivityTimeoutMs}ms without activity`
        );
      };
      setStreamStatus(options?.statusLabel || `Contacting ${modelRole === "helper" ? "helper" : "main"} model: ${chosenModel}`);

      const offChunk = window.lumen.llm.onChunk(({ requestId: chunkId, delta }) => {
        if (chunkId !== requestId) return;
        touchTimeout();
        full += delta;
      });
      const offStatus = window.lumen.llm.onStatus(({ requestId: statusId, message }) => {
        if (statusId !== requestId) return;
        touchTimeout();
        setStreamStatus(message || "Streaming response...");
      });
      const offDone = window.lumen.llm.onDone(({ requestId: doneId }) => {
        if (doneId !== requestId) return;
        offChunk();
        offStatus();
        offDone();
        offError();
        clearStreamTimeout();
        setStreamStatus("");
        resolve(full);
      });
      const offError = window.lumen.llm.onError(({ requestId: errorId, error: streamError }) => {
        if (errorId !== requestId) return;
        offChunk();
        offStatus();
        offDone();
        offError();
        clearStreamTimeout();
        setStreamStatus("");
        reject(new Error(streamError));
      });

      void window.lumen.llm
        .startStream({
          requestId,
          config: {
            baseUrl: modelConfig.baseUrl,
            model: chosenModel,
            apiKey: modelConfig.apiKey,
            temperature: reasoningTemperature(reasoningLevel)
          },
          messages: enhancedMessages
        })
        .catch((nextError) => {
          offChunk();
          offStatus();
          offDone();
          offError();
          clearStreamTimeout();
          setStreamStatus("");
          reject(nextError instanceof Error ? nextError : new Error("Failed to start stream"));
        });
    });
  };

  const resolveTargetPath = (goal: string) => {
    const fromPrompt = extractPathFromPrompt(goal);
    if (fromPrompt) return normalizePath(workspaceRoot, fromPrompt);
    if (activeTabPath) return activeTabPath;
    return "";
  };

  const gatherRelatedContext = async (targetPath: string, source: string) => {
    const candidatePaths = new Set<string>();
    for (const specifier of parseRelativeSpecifiers(source)) {
      for (const candidate of resolveLocalCandidatePaths(targetPath, specifier)) {
        candidatePaths.add(candidate);
      }
    }

    const siblingBase = targetPath.replace(/\.[^.]+$/, "");
    [`${siblingBase}.css`, `${siblingBase}.module.css`, `${siblingBase}.json`].forEach((candidate) => candidatePaths.add(candidate));

    const related: RelatedFileContext[] = [];
    for (const candidate of Array.from(candidatePaths)) {
      if (candidate === targetPath || related.length >= 3) continue;
      try {
        const file = await window.lumen.workspace.read({ path: candidate });
        if (!file.content.trim()) continue;
        related.push({
          path: file.path,
          content: file.content.slice(0, 12000)
        });
      } catch {
        // Ignore missing or unreadable neighbor files.
      }
    }

    return related;
  };

  const shouldUseDirectEditPath = (goal: string) => {
    if (isBuildIntent(goal) || !isEditIntent(goal)) return false;
    return Boolean(resolveTargetPath(goal));
  };

  const heuristicActions = (goal: string): AgentAction[] => {
    const actions: AgentAction[] = [];
    const targetPath = resolveTargetPath(goal);

    if (isBuildIntent(goal)) {
      return defaultScaffoldActions(goal);
    }

    if (isPreviewIntent(goal)) {
      return [
        { type: "preview_start", path: ".", reason: "Run the current project preview inside the workspace" },
        { type: "preview_snapshot", reason: "Inspect the running preview" }
      ];
    }

    if (isReadIntent(goal) && targetPath) {
      actions.push({ type: "read_file", path: targetPath, reason: "Read target file from prompt/active tab" });
    }

    if (isEditIntent(goal) && targetPath) {
      actions.push({ type: "read_file", path: targetPath, reason: "Load file before edit proposal" });
    }

    if (actions.length > 0) return actions;
    return fallbackActions(goal);
  };

  const enrichPlannedActions = (goal: string, actions: AgentAction[]): AgentAction[] => {
    const targetPath = resolveTargetPath(goal);
    const next = [...actions];
    const hasScopeAction = next.some((action) => action.type === "list_dir" || action.type === "read_file" || action.type === "search_files");
    const hasWriteAction = next.some((action) => action.type === "write_file" || action.type === "delete_file");

    if (isEditIntent(goal) && targetPath && !next.some((action) => action.type === "read_file" && normalizePath(workspaceRoot, action.path) === targetPath)) {
      next.unshift({
        type: "read_file",
        path: targetPath,
        reason: "Planner enrichment: load target file before edits"
      });
    }

    if (hasWriteAction && !hasScopeAction) {
      next.unshift({
        type: "list_dir",
        path: ".",
        reason: "Planner enrichment: refresh workspace structure before writes"
      });
    }

    if (
      hasWriteAction &&
      !next.some((action) => action.type === "read_file" && String(action.path || "").toLowerCase().endsWith("package.json"))
    ) {
      next.push({
        type: "read_file",
        path: "package.json",
        reason: "Planner enrichment: inspect scripts/dependencies before verify"
      });
    }

    const deduped: AgentAction[] = [];
    const seen = new Set<string>();
    for (const action of next) {
      const key = [
        action.type,
        action.path || "",
        action.command || "",
        action.query || "",
        action.selector || "",
        action.text || "",
        action.key || ""
      ].join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(action);
    }

    const hardLimit = Math.max(6, maxPlannerActions(reasoningLevel) + 3);
    return deduped.slice(0, hardLimit);
  };

  const buildScaffoldActions = async (goal: string): Promise<AgentAction[]> => {
    const fallback = defaultScaffoldActions(goal);
    const prompt = [
      "Return only a JSON array.",
      "Schema:",
      '[{"path":"relative/path.ext","content":"full file content"}]',
      "Generate a complete starter app that is runnable offline.",
      "Keep to 3-8 files.",
      "No markdown fences.",
      "No prose outside JSON."
    ].join("\n");

    try {
      const text = await streamToText([
        { role: "system", content: prompt },
        { role: "user", content: `Build this app or website:\n${goal}` }
      ]);
      const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return fallback;

      const generated = parsed
        .filter((item): item is { path: string; content: string } => {
          if (!item || typeof item !== "object") return false;
          const candidate = item as Record<string, unknown>;
          return typeof candidate.path === "string" && typeof candidate.content === "string";
        })
        .map((item) => ({
          type: "write_file" as const,
          path: item.path.replace(/\\/g, "/").replace(/^\/+/, ""),
          content: item.content,
          reason: "Scaffold project file"
        }))
        .filter((item) => item.path.length > 0 && !item.path.includes(".."));

      return generated.length ? generated : fallback;
    } catch {
      return fallback;
    }
  };

  const proposeDirectEdit = async (goal: string): Promise<DirectEditResult | null> => {
    const targetPath = resolveTargetPath(goal);
    if (!targetPath || !isEditIntent(goal)) return null;

    let before = "";
    let existedBefore = true;
    try {
      before = (await window.lumen.workspace.read({ path: targetPath })).content;
    } catch {
      before = "";
      existedBefore = false;
    }

    if (before.length > 180000) {
      throw new Error("Active file is too large for direct edit fallback. Open a smaller file or specify targeted edits.");
    }

    const relatedContext = before ? await gatherRelatedContext(targetPath, before) : [];

    const systemPrompt = [
      "You are Lumen IDE fast edit mode.",
      reasoningInstruction(reasoningLevel),
      "Return only JSON with keys summary and content.",
      'Schema: {"summary":"short user-facing summary","content":"full updated file content"}',
      "Make the smallest correct edit that satisfies the request.",
      "Preserve unrelated code, imports, formatting style, and working behavior.",
      "Do not include markdown fences or extra prose."
    ].join("\n");

    const text = await streamToText([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          `User request:\n${goal}`,
          `Target file:\n${targetPath}`,
          before ? `Current file content:\n${before}` : "Current file content:\n<file does not exist yet>",
          relatedContext.length
            ? `Related workspace context:\n${relatedContext
                .map((item) => `FILE: ${item.path}\n${item.content}`)
                .join("\n\n")}`
            : ""
        ]
          .filter(Boolean)
          .join("\n\n")
      }
    ], { statusLabel: `Editing ${fileLabel(targetPath)}...` });

    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    let nextContent = "";
    let summary = "";

    try {
      const parsed = JSON.parse(cleaned) as { summary?: string; content?: string };
      nextContent = String(parsed.content || "").trimEnd();
      summary = String(parsed.summary || "").trim();
    } catch {
      nextContent = cleaned.trimEnd();
    }

    if (!nextContent || nextContent === before) return null;

    return {
      pendingChange: {
        id: makeId(),
        type: "write" as const,
        path: targetPath,
        previousContent: before,
        nextContent,
        existedBefore,
        diff: buildDiff(targetPath, before, nextContent)
      },
      summary: summary || `Prepared edits for ${fileLabel(targetPath)}.`,
      relatedPaths: relatedContext.map((item) => item.path)
    };
  };

  const collectPlannerContext = async (goal: string) => {
    const keywords = extractGoalKeywords(goal);
    const keywordQueries = keywords.slice(0, settings.lowResourceMode ? 1 : 3);
    const keywordSearches = await Promise.all(
      keywordQueries.map((query) =>
        window.lumen.workspace
          .search({ query, maxResults: settings.lowResourceMode ? 5 : 10 })
          .then((result) => ({ query, results: result.results }))
          .catch(() => ({ query, results: [] as Array<{ path: string; line: number; preview: string }> }))
      )
    );
    const plannerCandidates = Array.from(
      new Set(
        keywordSearches
          .flatMap((entry) => entry.results)
          .slice(0, settings.lowResourceMode ? 8 : 20)
          .map((entry) => entry.path)
      )
    );

    const [inspection, gitStatus, previewStatus, directory] = await Promise.all([
      window.lumen.workspace.inspect({ path: "." }).catch(() => null),
      window.lumen.git.status().catch(() => null),
      window.lumen.preview.status().catch(() => null),
      window.lumen.workspace.list({ path: "." }).catch(() => null)
    ]);

    const topEntries = (directory?.tree?.children || [])
      .slice(0, settings.lowResourceMode ? 10 : 20)
      .map((entry) => `${entry.type === "dir" ? "dir" : "file"}:${entry.name}`);

    const candidatePaths = Array.from(
      new Set(
        [
          activeTabPath,
          ...(gitStatus?.files || []).map((file: { path: string }) => file.path),
          ...plannerCandidates
        ]
          .filter(Boolean)
          .slice(0, settings.lowResourceMode ? 6 : 14)
      )
    );
    const contextFiles = (
      await Promise.all(
        candidatePaths.map(async (candidate) => {
          try {
            const file = await window.lumen.workspace.read({ path: normalizePath(workspaceRoot, candidate) });
            const snippet = file.content.slice(0, settings.lowResourceMode ? 1200 : 2400);
            return {
              path: file.path,
              snippet
            };
          } catch {
            return null;
          }
        })
      )
    ).filter((item): item is { path: string; snippet: string } => Boolean(item));

    const memory = useAppStore.getState().sessionMemory;
    return {
      goal,
      workspaceRoot,
      activeTabPath,
      lowResourceMode: settings.lowResourceMode,
      onlineMode: settings.onlineMode,
      trustPreset: settings.permissionPreset,
      inspection: inspection
        ? {
            framework: inspection.framework,
            runCommand: inspection.runCommand,
            buildCommand: inspection.buildCommand,
            scripts: inspection.scripts.map((script) => script.name),
            devUrl: inspection.devUrl
          }
        : null,
      git: gitStatus
        ? {
            branch: gitStatus.branch,
            changedFiles: gitStatus.files.slice(0, 20).map((file) => file.path)
          }
        : null,
      preview: previewStatus
        ? {
            running: previewStatus.running,
            mode: previewStatus.mode,
            url: previewStatus.url,
            consoleErrors: previewStatus.browser.consoleErrors,
            networkErrors: previewStatus.browser.networkErrors
          }
        : null,
      memory: {
        currentGoal: memory.currentGoal,
        lastFailedCommand: memory.lastFailedCommand,
        knownBlockers: memory.knownBlockers.slice(0, 6),
        filesTouched: memory.filesTouched.slice(0, 12)
      },
      topEntries,
      keywords,
      plannerCandidates,
      contextFiles
    };
  };

  const deriveObjectivesFromActions = (goal: string, actions: AgentAction[]) => {
    const base = actions.slice(0, 8).map((action) => {
      if (action.type === "run_cmd" && action.command) return `Run: ${action.command}`;
      if (action.path) return `${action.type} ${fileLabel(action.path)}`;
      if (action.query) return `${action.type} "${action.query}"`;
      return action.type;
    });
    if (base.length) return base;
    return [`Scope workspace for: ${goal}`];
  };

  const draftObjectivesWithHelper = async (goal: string, context: unknown, actions: AgentAction[]) => {
    if (!helperConnection?.model || settings.lowResourceMode) {
      return deriveObjectivesFromActions(goal, actions);
    }
    try {
      const text = await streamToText(
        [
          {
            role: "system",
            content: [
              "You are Lumen objective planner.",
              "Return only JSON array with 3-8 concise objective lines.",
              "Each line should be directly actionable and ordered by dependency."
            ].join("\n")
          },
          {
            role: "user",
            content: JSON.stringify({ goal, context, actions }, null, 2)
          }
        ],
        {
          includeReasoning: false,
          modelRole: "helper",
          helperTask: "mini_plan",
          statusLabel: `Helper objectives: ${helperConnection.model}`
        }
      );
      const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      if (!Array.isArray(parsed)) return deriveObjectivesFromActions(goal, actions);
      const items = parsed.map((line) => String(line || "").trim()).filter(Boolean).slice(0, 8);
      return items.length ? items : deriveObjectivesFromActions(goal, actions);
    } catch {
      return deriveObjectivesFromActions(goal, actions);
    }
  };

  const draftMiniPlanWithHelper = async (goal: string, context: unknown) => {
    if (!helperConnection?.model || settings.lowResourceMode) return [];
    try {
      const text = await streamToText(
        [
          {
            role: "system",
            content: [
              "You are Lumen helper planner.",
              "Return only a JSON array of 3-8 short plan lines.",
              'Example: ["Scope files", "Run preview", "Propose diff"]'
            ].join("\n")
          },
          {
            role: "user",
            content: JSON.stringify({ goal, context }, null, 2)
          }
        ],
        {
          includeReasoning: false,
          modelRole: "helper",
          helperTask: "mini_plan",
          statusLabel: `Helper mini-plan: ${helperConnection.model}`
        }
      );
      const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      if (!Array.isArray(parsed)) return [];
      return parsed.map((line) => String(line || "").trim()).filter(Boolean).slice(0, 8);
    } catch {
      return [];
    }
  };

  const planActions = async (goal: string, context: unknown): Promise<AgentAction[]> => {
    const systemPrompt = [
      "You are Lumen IDE autonomous planner.",
      "Return only JSON array. No prose.",
      `Reasoning level: ${reasoningLevel}`,
      reasoningInstruction(reasoningLevel),
      `Prefer no more than ${maxPlannerActions(reasoningLevel)} actions unless strictly needed.`,
      "Break the goal into concrete subtasks and include only executable tool actions.",
      "Allowed action types:",
      "list_dir, read_file, search_files, write_file, delete_file, run_cmd, preview_start, preview_status, preview_snapshot, preview_screenshot, preview_click, preview_type, preview_press, git_status, git_diff, git_stage, git_unstage, git_commit, git_push",
      "For write_file include path and full desired content.",
      "Use preview_start to run the current project or a static workspace folder in Lumen preview.",
      "Use preview_snapshot after preview_start to inspect the page text/title.",
      "Use preview_screenshot when visual evidence is useful.",
      "Use preview_click and preview_type with CSS selectors.",
      "Avoid risky git actions unless user clearly asks for git commit/push.",
      "Do not use remote actions."
    ].join("\n");

    try {
      const text = await streamToText([
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            `Goal:\n${goal}`,
            "Workspace context:",
            JSON.stringify(context, null, 2)
          ].join("\n\n")
        }
      ], {
        statusLabel: helperConnection?.model ? `Planning with helper model: ${helperConnection.model}` : "Planning actions...",
        modelRole: "helper",
        helperTask: "action_extraction"
      });
      const actions = extractActionsFromText(text).slice(0, maxPlannerActions(reasoningLevel));
      if (actions.length === 0) {
        return heuristicActions(goal);
      }
      if (isBuildIntent(goal) && !hasBuildOutputActions(actions)) {
        return await buildScaffoldActions(goal);
      }
      return enrichPlannedActions(goal, actions);
    } catch {
      const fallback = heuristicActions(goal);
      if (isBuildIntent(goal) && !hasBuildOutputActions(fallback)) {
        return await buildScaffoldActions(goal);
      }
      return enrichPlannedActions(goal, fallback);
    }
  };

  const executeAction = async (action: AgentAction) => {
    const policyDecision = await evaluatePolicyForAction(action);
    if (!policyDecision.allowed) {
      return { ok: false, error: policyDecision.reason };
    }
    switch (action.type) {
      case "list_dir": {
        const listed = await window.lumen.workspace.list({ path: normalizePath(workspaceRoot, action.path) });
        return { ok: true, output: listed.tree };
      }
      case "read_file": {
        const read = await window.lumen.workspace.read({ path: normalizePath(workspaceRoot, action.path) });
        return { ok: true, output: read.content };
      }
      case "search_files": {
        const result = await window.lumen.workspace.search({ query: action.query || "", maxResults: 80 });
        return { ok: true, output: result.results };
      }
      case "write_file": {
        const targetPath = normalizePath(workspaceRoot, action.path);
        let before = "";
        let existedBefore = true;
        try {
          before = (await window.lumen.workspace.read({ path: targetPath })).content;
        } catch {
          before = "";
          existedBefore = false;
        }
        const next = action.content || "";
        const diff = buildDiff(targetPath, before, next);

        return {
          ok: true,
          output: "pending write",
          pendingChange: {
            id: makeId(),
            type: "write" as const,
            path: targetPath,
            previousContent: before,
            nextContent: next,
            existedBefore,
            diff
          }
        };
      }
      case "delete_file": {
        const targetPath = normalizePath(workspaceRoot, action.path);
        const before = (await window.lumen.workspace.read({ path: targetPath })).content;
        const diff = buildDiff(targetPath, before, "");
        return {
          ok: true,
          output: "pending delete",
          pendingChange: {
            id: makeId(),
            type: "delete" as const,
            path: targetPath,
            previousContent: before,
            nextContent: "",
            existedBefore: true,
            diff
          }
        };
      }
      case "run_cmd": {
        const terminalId = await ensureNamedTerminal("Agent");
        const result = await window.lumen.agent.runCmd({
          command: action.command || "",
          terminalId,
          approved: true,
          source: "agent",
          preset: settings.permissionPreset
        });
        if (result.code !== 0) {
          patchSessionMemory({
            lastFailedCommand: action.command || "",
            knownBlockers: [result.stderr || result.stdout || "Command failed"]
          });
        }
        return { ok: result.code === 0, output: `${result.stdout}\n${result.stderr}`.trim() };
      }
      case "preview_start": {
        setRightPanelTab("preview");
        const terminalId = await ensureNamedTerminal("Preview");
        try {
          const result = await window.lumen.preview.startProject({
            path: action.path || ".",
            command: action.command,
            url: action.url,
            port: action.port,
            terminalId,
            source: "agent",
            approved: true,
            preset: settings.permissionPreset
          });
          patchSessionMemory({
            activePreviewUrl: result.url,
            previewMode: result.mode
          });
          return { ok: true, output: result };
        } catch {
          const result = await window.lumen.preview.start({
            path: action.path || ".",
            entry: action.entry || "index.html",
            port: action.port,
            source: "agent",
            approved: true,
            preset: settings.permissionPreset,
            command: action.command
          });
          patchSessionMemory({
            activePreviewUrl: result.url,
            previewMode: result.mode
          });
          return { ok: true, output: result };
        }
      }
      case "preview_status": {
        const result = await window.lumen.preview.status();
        return { ok: true, output: result };
      }
      case "preview_snapshot": {
        const status = await window.lumen.preview.status();
        const result = status.browser.connected
          ? await window.lumen.preview.browserSnapshot({
              source: "agent",
              approved: true,
              preset: settings.permissionPreset
            })
          : (
              await window.lumen.preview.browserConnect({
                url: action.url || status.url,
                source: "agent",
                approved: true,
                preset: settings.permissionPreset
              })
            ).snapshot;
        return { ok: true, output: result };
      }
      case "preview_screenshot": {
        const status = await window.lumen.preview.status();
        if (!status.browser.connected) {
          await window.lumen.preview.browserConnect({
            url: action.url || status.url,
            source: "agent",
            approved: true,
            preset: settings.permissionPreset
          });
        }
        const result = await window.lumen.preview.browserScreenshot({
          url: action.url,
          source: "agent",
          approved: true,
          preset: settings.permissionPreset
        });
        return { ok: true, output: result };
      }
      case "preview_click": {
        const status = await window.lumen.preview.status();
        if (!status.browser.connected) {
          await window.lumen.preview.browserConnect({
            url: action.url || status.url,
            source: "agent",
            approved: true,
            preset: settings.permissionPreset
          });
        }
        const result = await window.lumen.preview.browserClick({
          selector: action.selector || "",
          url: action.url,
          source: "agent",
          approved: true,
          preset: settings.permissionPreset
        });
        return { ok: true, output: result };
      }
      case "preview_type": {
        const status = await window.lumen.preview.status();
        if (!status.browser.connected) {
          await window.lumen.preview.browserConnect({
            url: action.url || status.url,
            source: "agent",
            approved: true,
            preset: settings.permissionPreset
          });
        }
        const result = await window.lumen.preview.browserType({
          selector: action.selector || "",
          text: action.text || "",
          url: action.url,
          source: "agent",
          approved: true,
          preset: settings.permissionPreset
        });
        return { ok: true, output: result };
      }
      case "preview_press": {
        const status = await window.lumen.preview.status();
        if (!status.browser.connected) {
          await window.lumen.preview.browserConnect({
            url: action.url || status.url,
            source: "agent",
            approved: true,
            preset: settings.permissionPreset
          });
        }
        const result = await window.lumen.preview.browserPress({
          key: action.key || "Enter",
          url: action.url,
          source: "agent",
          approved: true,
          preset: settings.permissionPreset
        });
        return { ok: true, output: result };
      }
      case "git_status": {
        const result = await window.lumen.git.status();
        return { ok: true, output: result };
      }
      case "git_diff": {
        const result = await window.lumen.git.diff({ path: action.path, staged: action.staged });
        return { ok: true, output: result.diff };
      }
      case "git_stage": {
        await window.lumen.git.stage({ paths: action.paths || (action.path ? [action.path] : []) });
        return { ok: true, output: "staged" };
      }
      case "git_unstage": {
        await window.lumen.git.unstage({ paths: action.paths || (action.path ? [action.path] : []) });
        return { ok: true, output: "unstaged" };
      }
      case "git_commit": {
        const result = await window.lumen.git.commit({ message: action.message || "Lumen IDE commit", approved: true });
        return { ok: true, output: result.hash };
      }
      case "git_push": {
        await window.lumen.git.push({ approved: true });
        return { ok: true, output: "pushed" };
      }
      default:
        return { ok: false, error: "Unsupported action" };
    }
  };

  const runRecoveryPolicies = async (
    failedActions: Array<{ action: AgentAction; result: { ok: boolean; error?: string; output?: unknown } }>
  ) => {
    if (!failedActions.length) return;
    setAgentPhase("recover");
    incrementRecoveryAttempt();
    const attempt = useAppStore.getState().recoveryAttempt;
    const knownBlockers = new Set(useAppStore.getState().sessionMemory.knownBlockers || []);
    appendTimeline(
      createTimelineEntry({
        phase: "recover",
        status: "running",
        title: "Recovery policies started",
        detail: `${failedActions.length} failed action(s), attempt ${attempt}`,
        source: "agent"
      })
    );

    for (const failed of failedActions) {
      const rawFailure = `${failed.result.error || ""}\n${String(failed.result.output || "")}`.trim();
      let recovered = false;
      if (helperConnection?.model && !settings.lowResourceMode) {
        try {
          const helperSummary = await streamToText(
            [
              {
                role: "system",
                content: [
                  "You are Lumen helper runtime analyzer.",
                  "Return max 4 concise bullet lines.",
                  "Focus on root cause and next local command."
                ].join("\n")
              },
              {
                role: "user",
                content: rawFailure.slice(0, 10000)
              }
            ],
            {
              includeReasoning: false,
              modelRole: "helper",
              helperTask: "terminal_summary",
              statusLabel: `Helper failure summary: ${helperConnection.model}`
            }
          );
          if (helperSummary.trim()) {
            pushMessage("system", `Recovery summary:\n${helperSummary.trim()}`);
          }
        } catch {
          // Helper summaries are best-effort and should never block recovery.
        }
      }

      const suggestions = deriveRecoverySuggestions({
        failedAction: failed.action,
        error: failed.result.error,
        output: failed.result.output,
        hasPendingChanges: useAppStore.getState().pendingChanges.length > 0,
        recoveryAttempt: attempt
      });
      if (!suggestions.length) {
        appendTimeline(
          createTimelineEntry({
            phase: "recover",
            status: "blocked",
            title: "No recovery policy matched",
            detail: failed.result.error || failed.action.reason || failed.action.type,
            source: "agent"
          })
        );
      }

      for (const suggestion of suggestions) {
        knownBlockers.add(suggestion.blocker);
        appendTimeline(
          createTimelineEntry({
            phase: "recover",
            status: "running",
            title: `Recovery: ${suggestion.policy}`,
            detail: suggestion.reason,
            source: "agent"
          })
        );
        if (suggestion.policy === "localize_compile_error" && suggestion.filePath && suggestion.line) {
          const candidatePath = normalizePath(workspaceRoot, suggestion.filePath);
          try {
            const snippet = await window.lumen.workspace.read({ path: candidatePath });
            const lines = snippet.content.split(/\r?\n/);
            const start = Math.max(0, suggestion.line - 3);
            const end = Math.min(lines.length, suggestion.line + 2);
            const context = lines
              .slice(start, end)
              .map((line, index) => `${start + index + 1}: ${line}`)
              .join("\n");
            pushMessage("system", `Recovery: localized compile error near ${fileLabel(candidatePath)}:${suggestion.line}\n${context}`);
            appendTimeline(
              createTimelineEntry({
                phase: "recover",
                status: "done",
                title: "Compile error localized",
                detail: `${fileLabel(candidatePath)}:${suggestion.line}`,
                source: "agent"
              })
            );
          } catch {
            // Ignore snippet failures.
          }
          continue;
        }

        if (suggestion.policy === "rollback_patch") {
          const latestPatch = useAppStore.getState().appliedPatchHistory.at(-1);
          if (latestPatch) {
            pushMessage(
              "system",
              `Recovery policy suggests rollback of latest patch (${latestPatch.changes.length} file change(s)) before retry.`
            );
            appendTimeline(
              createTimelineEntry({
                phase: "recover",
                status: "blocked",
                title: "Rollback suggested",
                detail: `${latestPatch.changes.length} file change(s) recommended for rollback`,
                source: "agent"
              })
            );
          }
          continue;
        }

        if (!suggestion.action) continue;
        const requirement = permissionForAction(suggestion.action);
        let approved = true;
        if (requirement.approvalRequired) {
          approved = await requestApproval(suggestion.action, requirement);
        }
        if (!approved) {
          pushMessage("system", `Recovery action denied: ${suggestion.policy}.`);
          appendTimeline(
            createTimelineEntry({
              phase: "recover",
              status: "blocked",
              title: "Recovery action denied",
              detail: suggestion.policy,
              source: "agent"
            })
          );
          continue;
        }
        const outcome = await executeAction(suggestion.action);
        if (outcome.ok) {
          pushMessage("system", `Recovery executed: ${suggestion.reason}`);
          recovered = true;
          appendTimeline(
            createTimelineEntry({
              phase: "recover",
              status: "done",
              title: "Recovery action executed",
              detail: suggestion.reason,
              source: "agent"
            })
          );
        } else {
          appendTimeline(
            createTimelineEntry({
              phase: "recover",
              status: "failed",
              title: "Recovery action failed",
              detail: outcome.error || suggestion.reason,
              source: "agent"
            })
          );
        }
      }

      if (recovered && failed.action.type === "run_cmd" && failed.action.command) {
        appendTimeline(
          createTimelineEntry({
            phase: "recover",
            status: "running",
            title: "Retry original command",
            detail: failed.action.command,
            source: "agent"
          })
        );
        const retryOutcome = await executeAction({
          type: "run_cmd",
          command: failed.action.command,
          reason: "Retry original command after recovery"
        });
        if (retryOutcome.ok) {
          appendTimeline(
            createTimelineEntry({
              phase: "recover",
              status: "done",
              title: "Original command recovered",
              detail: failed.action.command,
              source: "agent"
            })
          );
          pushMessage("system", `Recovery succeeded and original command passed: ${failed.action.command}`);
        } else {
          appendTimeline(
            createTimelineEntry({
              phase: "recover",
              status: "failed",
              title: "Original command still failing",
              detail: retryOutcome.error || failed.action.command,
              source: "agent"
            })
          );
        }
      }
    }
    patchSessionMemory({
      knownBlockers: Array.from(knownBlockers).slice(0, 10)
    });
  };

  const patchFirstNodeByPhase = (
    phase: "verify" | "propose" | "apply",
    status: "pending" | "running" | "done" | "failed" | "blocked",
    detail: string
  ) => {
    const node = useAppStore
      .getState()
      .taskGraph.find((item) => item.phase === phase);
    if (!node) return;
    patchTaskNode(node.id, { status, detail });
  };

  const runAgent = async () => {
    const goal = prompt.trim();
    if (!goal || busy) return;

    setBusy(true);
    setError("");
    setGoalObjectives([]);
    setAgentPhase("understand");
    resetRecoveryAttempt();
    pushMessage("user", goal);
    setPrompt("");
    patchSessionMemory({
      currentGoal: goal,
      verificationStatus: "idle",
      knownBlockers: [],
      lastFailedCommand: "",
      filesTouched: []
    });
    appendTimeline(
      createTimelineEntry({
        phase: "understand",
        status: "running",
        title: "Goal received",
        detail: goal,
        source: "agent"
      })
    );

    try {
      setAgentPhase("scope");
      if (shouldUseDirectEditPath(goal)) {
        setAgentPhase("plan");
        const fastEdit = await proposeDirectEdit(goal);
        if (fastEdit) {
          setAgentPhase("propose");
          const pendingList = [
            {
              id: fastEdit.pendingChange.id,
              path: fastEdit.pendingChange.path,
              type: fastEdit.pendingChange.type,
              diff: fastEdit.pendingChange.diff,
              previousContent: fastEdit.pendingChange.previousContent,
              nextContent: fastEdit.pendingChange.nextContent,
              existedBefore: fastEdit.pendingChange.existedBefore
            }
          ];
          setPlanLines([
            `FAST EDIT: ${fileLabel(fastEdit.pendingChange.path)}`,
            "CONTEXT: use active file and nearby imports",
            "PROPOSE: generate one pending diff immediately",
            "APPLY: only after explicit approval"
          ]);
          setGoalObjectives([
            `Edit ${fileLabel(fastEdit.pendingChange.path)} directly`,
            "Generate minimal diff for requested change",
            "Run optional verification command",
            "Apply only after explicit approval"
          ]);
          setPendingChanges(pendingList);
          recordAudit({
            id: makeId(),
            timestamp: new Date().toISOString(),
            action: "agent.fast_edit",
            detail: {
              path: fastEdit.pendingChange.path,
              relatedFiles: fastEdit.relatedPaths
            }
          });
          patchSessionMemory({
            filesTouched: [fastEdit.pendingChange.path],
            verificationStatus: shouldRunVerify(reasoningLevel, goal, pendingList.length) ? "pending" : "skipped"
          });

          let verifyResult: { ok: boolean; output?: unknown; error?: string } | null = null;
          const shouldVerify = shouldRunVerify(reasoningLevel, goal, pendingList.length);
          if (shouldVerify) {
            setAgentPhase("verify");
            const verifyAction: AgentAction = {
              type: "run_cmd",
              command: "pnpm test --if-present",
              reason: "VERIFY step after fast edit"
            };
            const verifyRequirement = permissionForAction(verifyAction);
            let verifyApproved = true;
            if (verifyRequirement.approvalRequired) {
              verifyApproved = await requestApproval(verifyAction, verifyRequirement);
            }
            if (verifyApproved) {
              verifyResult = await executeAction(verifyAction);
              recordAudit({
                id: makeId(),
                timestamp: new Date().toISOString(),
                action: "agent.verify",
                detail: { ok: verifyResult.ok, path: fastEdit.pendingChange.path }
              });
              patchSessionMemory({
                verificationStatus: verifyResult.ok ? "passed" : "failed",
                lastFailedCommand: verifyResult.ok ? "" : verifyAction.command || "",
                knownBlockers: verifyResult.ok ? [] : [verifyResult.error || "Verification failed"]
              });
            } else {
              patchSessionMemory({ verificationStatus: "skipped" });
            }
          }

          pushMessage(
            "assistant",
            `${fastEdit.summary}${fastEdit.relatedPaths.length ? ` Context: ${fastEdit.relatedPaths.map(fileLabel).join(", ")}.` : ""}${
              verifyResult ? ` Verify: ${verifyResult.ok ? "pass" : "fail"}.` : ""
            }`,
            {
              reasoning: reasoningLevel,
              model: chatModel.trim() || settings.model
            }
          );
          setAgentPhase("summarize");
          return;
        }
      }

      setAgentPhase("plan");
      const plannerContext = await collectPlannerContext(goal);
      const helperMiniPlan = await draftMiniPlanWithHelper(goal, plannerContext);
      if (helperMiniPlan.length) {
        setPlanLines(helperMiniPlan);
      }
      let actions = await planActions(goal, plannerContext);
      setTaskGraph(createExecutionTaskGraph(goal, actions));
      const objectives = await draftObjectivesWithHelper(goal, plannerContext, actions);
      setGoalObjectives(objectives);
      appendTimeline(
        createTimelineEntry({
          phase: "plan",
          status: "done",
          title: "Objectives drafted",
          detail: objectives.slice(0, 3).join(" | "),
          source: "agent"
        })
      );

      setAgentPhase("execute");
      let loopResult = await runAutonomousLoop({
        goal,
        actions,
        onlineMode: settings.onlineMode,
        executeTool: executeAction,
        requestApproval,
        log: (entry) => {
          if (!shouldMirrorLoopAudit(entry.action)) return;
          recordAudit({
            id: makeId(),
            timestamp: entry.timestamp,
            action: entry.action,
            detail: entry.detail
          });
        }
      });

      if (isBuildIntent(goal) && loopResult.pendingChanges.length === 0) {
        setAgentPhase("recover");
        incrementRecoveryAttempt();
        pushMessage("system", "Planner produced no file changes. Switching to scaffold build mode.");
        actions = await buildScaffoldActions(goal);
        setTaskGraph(createExecutionTaskGraph(goal, actions));
        setAgentPhase("execute");
        loopResult = await runAutonomousLoop({
          goal,
          actions,
          onlineMode: settings.onlineMode,
          executeTool: executeAction,
          requestApproval,
          log: (entry) => {
            if (!shouldMirrorLoopAudit(entry.action)) return;
            recordAudit({
              id: makeId(),
              timestamp: entry.timestamp,
              action: entry.action,
              detail: entry.detail
            });
          }
        });
      }

      let verifyResult = loopResult.verifyResult;
      const shouldVerify = shouldRunVerify(reasoningLevel, goal, loopResult.pendingChanges.length);
      if (shouldVerify) {
        setAgentPhase("verify");
        const verifyAction: AgentAction = {
          type: "run_cmd",
          command: "pnpm test --if-present",
          reason: "VERIFY step after proposed changes"
        };
        const verifyRequirement = permissionForAction(verifyAction);
        let verifyApproved = true;
        if (verifyRequirement.approvalRequired) {
          verifyApproved = await requestApproval(verifyAction, verifyRequirement);
        }
        if (verifyApproved) {
          patchSessionMemory({ verificationStatus: "pending" });
          verifyResult = await executeAction(verifyAction);
          recordAudit({
            id: makeId(),
            timestamp: new Date().toISOString(),
            action: "agent.verify",
            detail: { ok: verifyResult.ok }
          });
          patchSessionMemory({
            verificationStatus: verifyResult.ok ? "passed" : "failed",
            lastFailedCommand: verifyResult.ok ? "" : verifyAction.command || "",
            knownBlockers: verifyResult.ok ? [] : [verifyResult.error || "Verification failed"]
          });
          patchFirstNodeByPhase(
            "verify",
            verifyResult.ok ? "done" : "failed",
            verifyResult.ok ? "Verification checks passed." : verifyResult.error || "Verification failed."
          );
        } else {
          verifyResult = { ok: false, error: "Verification command denied by user" };
          patchSessionMemory({
            verificationStatus: "skipped",
            knownBlockers: ["Verification command denied by user"]
          });
          patchFirstNodeByPhase("verify", "blocked", "Verification was denied by user.");
        }
      } else {
        patchSessionMemory({ verificationStatus: "skipped" });
        patchFirstNodeByPhase("verify", "blocked", "Verification skipped by reasoning policy.");
      }

      const fallbackEdit = await proposeDirectEdit(goal).catch((fallbackError) => {
        pushMessage("system", fallbackError instanceof Error ? fallbackError.message : "Direct edit fallback failed.");
        return null;
      });
      const allPendingChanges = fallbackEdit
        ? [...loopResult.pendingChanges, fallbackEdit.pendingChange]
        : loopResult.pendingChanges;

      const failedActions = loopResult.actionResults.filter((item) => !item.result.ok && !item.skipped);
      await runRecoveryPolicies(failedActions);
      const failedCommand = failedActions.find((item) => item.action.type === "run_cmd")?.action.command || "";
      patchSessionMemory({
        filesTouched: allPendingChanges.map((change) => change.path),
        lastFailedCommand: failedCommand,
        knownBlockers: failedActions.map(
          (item) => item.result.error || item.action.reason || `${item.action.type} failed`
        )
      });

      setPlanLines(loopResult.plan);
      setTaskGraph(applyActionResultsToTaskGraph(useAppStore.getState().taskGraph || [], loopResult.actionResults));
      setAgentPhase("propose");
      setPendingChanges(
        allPendingChanges.map((change) => ({
          id: change.id,
          path: change.path,
          type: change.type,
          diff: change.diff,
          previousContent: change.previousContent,
          nextContent: change.nextContent,
          existedBefore: change.existedBefore
        }))
      );
      patchFirstNodeByPhase(
        "propose",
        allPendingChanges.length ? "done" : "blocked",
        allPendingChanges.length
          ? `${allPendingChanges.length} pending proposal change(s) ready for review.`
          : "No pending changes were produced."
      );
      patchFirstNodeByPhase(
        "apply",
        allPendingChanges.length ? "pending" : "blocked",
        allPendingChanges.length ? "Waiting for explicit apply approval." : "No change set to apply."
      );

      const assistantReply = buildFastSummary(
        goal,
        actions,
        loopResult.actionResults,
        allPendingChanges.length,
        verifyResult
      );

      pushMessage("assistant", assistantReply, {
        reasoning: reasoningLevel,
        model: chatModel.trim() || settings.model
      });
      setAgentPhase("summarize");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Agent run failed";
      setError(message);
      setAgentPhase("recover");
      incrementRecoveryAttempt();
      patchSessionMemory({
        verificationStatus: "failed",
        knownBlockers: [message]
      });
      appendTimeline(
        createTimelineEntry({
          phase: "recover",
          status: "failed",
          title: "Agent run failed",
          detail: message,
          source: "agent"
        })
      );
      pushMessage("system", message);
    } finally {
      setBusy(false);
      setStreamStatus("");
      setTimeout(() => promptInputRef.current?.focus(), 0);
    }
  };

  const selectedPendingChanges = useMemo(
    () => pendingChanges.filter((change) => selectedChangeIds.includes(change.id)),
    [pendingChanges, selectedChangeIds]
  );
  const activePendingChange = useMemo(
    () => pendingChanges.find((change) => change.id === activeChangeId) || selectedPendingChanges[0] || pendingChanges[0] || null,
    [activeChangeId, pendingChanges, selectedPendingChanges]
  );
  const activePendingHunks = useMemo(
    () => (activePendingChange ? buildHunkMeta(activePendingChange.diff) : []),
    [activePendingChange]
  );
  const activeSelectedHunkIds = useMemo(() => {
    if (!activePendingChange) return [];
    const selected = selectedHunksByChange[activePendingChange.id];
    if (selected && selected.length) return selected;
    return activePendingHunks.map((hunk) => hunk.id);
  }, [activePendingChange, activePendingHunks, selectedHunksByChange]);
  const selectedChangeCountWithHunks = useMemo(
    () =>
      selectedPendingChanges.filter((change) => {
        const hunks = buildHunkMeta(change.diff);
        if (!hunks.length) return true;
        const selected = selectedHunksByChange[change.id] || [];
        return selected.length > 0;
      }).length,
    [selectedPendingChanges, selectedHunksByChange]
  );
  const latestAppliedPatchSet = appliedPatchHistory.at(-1) || null;

  const applyPendingChanges = async () => {
    if (!selectedPendingChanges.length) return;
    if (!selectedChangeCountWithHunks) return;
    if (!window.confirm(`Apply ${selectedChangeCountWithHunks} selected change(s)?`)) return;
    setAgentPhase("apply");
    patchFirstNodeByPhase("apply", "running", "Applying selected proposal changes to workspace.");

    const nextPending: typeof pendingChanges = [];
    const appliedChanges: typeof pendingChanges = [];
    const conflictPaths: string[] = [];

    for (const change of pendingChanges) {
      if (!selectedChangeIds.includes(change.id)) {
        nextPending.push(change);
        continue;
      }

      let liveContent = "";
      let liveExists = true;
      try {
        liveContent = (await window.lumen.workspace.read({ path: change.path })).content;
      } catch {
        liveContent = "";
        liveExists = false;
      }

      if (!liveExists && change.type === "delete") {
        appliedChanges.push({
          ...change,
          nextContent: "",
          diff: buildDiff(change.path, change.previousContent, "")
        });
        continue;
      }

      if (liveContent !== change.previousContent) {
        const targetContent = change.type === "delete" ? "" : change.nextContent;
        nextPending.push({
          ...change,
          previousContent: liveContent,
          existedBefore: liveExists,
          diff: buildDiff(change.path, liveContent, targetContent)
        });
        conflictPaths.push(change.path);
        continue;
      }

      const hunks = buildHunkMeta(change.diff);
      const selectedHunkIds = hunks.length
        ? (selectedHunksByChange[change.id] || []).filter((id) => hunks.some((hunk) => hunk.id === id))
        : [];
      if (hunks.length && selectedHunkIds.length === 0) {
        nextPending.push(change);
        continue;
      }

      const allHunksSelected = !hunks.length || selectedHunkIds.length === hunks.length;
      const fullTarget = change.type === "delete" ? "" : change.nextContent;
      let applyTarget = fullTarget;

      if (!allHunksSelected) {
        const selectedPatch = buildPatchFromHunks(change.diff, selectedHunkIds);
        const partialTarget = selectedPatch ? applyPatch(change.previousContent, selectedPatch) : change.previousContent;
        if (partialTarget === false) {
          throw new Error(`Could not apply selected hunks for ${fileLabel(change.path)}.`);
        }
        applyTarget = partialTarget;
      }

      if (applyTarget !== change.previousContent) {
        if (change.type === "delete" && applyTarget === "") {
          await window.lumen.workspace.delete({
            path: change.path,
            source: "agent_apply",
            approved: true,
            preset: settings.permissionPreset
          });
        } else {
          await window.lumen.workspace.write({
            path: change.path,
            content: applyTarget,
            source: "agent_apply",
            approved: true,
            preset: settings.permissionPreset
          });
        }
        appliedChanges.push({
          ...change,
          nextContent: applyTarget,
          diff: buildDiff(change.path, change.previousContent, applyTarget)
        });
      }

      if (!allHunksSelected && applyTarget !== fullTarget) {
        nextPending.push({
          ...change,
          previousContent: applyTarget,
          existedBefore: change.existedBefore || applyTarget.length > 0,
          diff: buildDiff(change.path, applyTarget, fullTarget)
        });
      }
    }

    if (!appliedChanges.length) {
      patchFirstNodeByPhase("apply", "blocked", "No selected changes were applied.");
      return;
    }

    setPendingChanges(nextPending);
    pushAppliedPatchSet({
      id: makeId(),
      timestamp: new Date().toISOString(),
      changes: appliedChanges
    });
    await refreshTree();
    if (appliedChanges.length === 1 && appliedChanges[0].type === "write") {
      await openFile(appliedChanges[0].path);
    }
    patchSessionMemory({
      filesTouched: appliedChanges.map((change) => change.path),
      knownBlockers: []
    });
    appendTimeline(
      createTimelineEntry({
        phase: "apply",
        status: "done",
        title: "Patch applied",
        detail: `${appliedChanges.length} selected file change(s) written to workspace`,
        source: "agent"
      })
    );
    if (conflictPaths.length) {
      appendTimeline(
        createTimelineEntry({
          phase: "apply",
          status: "blocked",
          title: "Apply conflicts detected",
          detail: `${conflictPaths.length} file(s) changed since proposal and were kept pending`,
          source: "agent"
        })
      );
      pushMessage(
        "system",
        `Skipped ${conflictPaths.length} change(s) because files changed since proposal: ${conflictPaths
          .map(fileLabel)
          .join(", ")}. Review refreshed diffs before applying.`
      );
    }
    pushMessage(
      "system",
      `Applied ${appliedChanges.length} change(s). ${nextPending.length ? `${nextPending.length} proposal(s) still pending.` : ""}`.trim()
    );
    patchFirstNodeByPhase(
      "apply",
      nextPending.length ? "blocked" : "done",
      nextPending.length
        ? `${appliedChanges.length} change(s) applied, ${nextPending.length} still pending.`
        : `${appliedChanges.length} change(s) applied successfully.`
    );
  };

  const rollbackLastApply = async () => {
    if (!latestAppliedPatchSet) return;
    if (!window.confirm(`Rollback ${latestAppliedPatchSet.changes.length} applied change(s)?`)) return;
    setAgentPhase("recover");

    for (const change of latestAppliedPatchSet.changes) {
      if (change.type === "delete") {
        await window.lumen.workspace.write({
          path: change.path,
          content: change.previousContent,
          source: "agent_apply",
          approved: true,
          preset: settings.permissionPreset
        });
        continue;
      }

      if (change.existedBefore) {
        await window.lumen.workspace.write({
          path: change.path,
          content: change.previousContent,
          source: "agent_apply",
          approved: true,
          preset: settings.permissionPreset
        });
      } else {
        await window.lumen.workspace.delete({
          path: change.path,
          source: "agent_apply",
          approved: true,
          preset: settings.permissionPreset
        });
      }
    }

    await refreshTree();
    popAppliedPatchSet();
    patchSessionMemory({
      filesTouched: latestAppliedPatchSet.changes.map((change) => change.path)
    });
    appendTimeline(
      createTimelineEntry({
        phase: "recover",
        status: "done",
        title: "Rollback completed",
        detail: `${latestAppliedPatchSet.changes.length} file change(s) reverted`,
        source: "agent"
      })
    );
    pushMessage("system", "Rolled back the last applied patch.");
    patchFirstNodeByPhase("apply", "blocked", "Latest applied patch was rolled back.");
  };

  const diffPreview = useMemo(() => {
    if (activePendingChange) {
      const selectedHunks = activeSelectedHunkIds;
      const partial = buildPatchFromHunks(activePendingChange.diff, selectedHunks);
      return partial || activePendingChange.diff;
    }
    return selectedPendingChanges.map((change) => change.diff).join("\n");
  }, [activePendingChange, activeSelectedHunkIds, selectedPendingChanges]);
  const modelOptions = useMemo(
    () => Array.from(new Set([chatModel, settings.model, ...(settings.recentModels || [])].filter(Boolean))),
    [chatModel, settings.model, settings.recentModels]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">AI Agent</div>
        <div className="mb-2 text-[11px] text-muted">
          Main: {chatModel.trim() || settings.model}
          {helperConnection?.model ? ` · Helper: ${helperConnection.model}` : ""}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
          {(["understand", "scope", "plan", "execute", "verify", "recover", "propose", "apply", "summarize"] as const).map((phase) => (
            <span
              key={phase}
              className={`rounded border px-1.5 py-0.5 uppercase ${
                agentPhase === phase ? "border-accent text-accent bg-accent/10" : "border-border text-muted"
              }`}
            >
              {phase}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <label className="block">
            <div className="mb-1 text-muted">Chat Model</div>
            <input
              list="agent-models"
              className="h-8 w-full rounded border border-border bg-black/20 px-2 text-xs"
              value={chatModel}
              onChange={(event) => setChatModel(event.target.value)}
            />
            <datalist id="agent-models">
              {modelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <div className="mb-1 text-muted">Reasoning</div>
            <select
              className="h-8 w-full rounded border border-border bg-black/20 px-2 text-xs"
              value={reasoningLevel}
              onChange={(event) => setReasoningLevel(event.target.value as ReasoningLevel)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="extra_high">Extra High</option>
            </select>
          </label>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[11px]">
          <span className="rounded border border-border px-2 py-1 text-[10px] uppercase text-muted">
            Trust: {formatTrustPreset(settings.permissionPreset)}
          </span>
          <Button
            onClick={() => {
              const nextMode = agentMode === "live_build" ? "manual" : "live_build";
              setAgentMode(nextMode);
            }}
          >
            {agentMode === "live_build" ? "Stop Live Build" : "Start Live Build"}
          </Button>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showPlan} onChange={(event) => setShowPlan(event.target.checked)} />
            <span>Show Plan</span>
          </label>
          <span className="text-muted">Recoveries: {recoveryAttempt}</span>
        </div>
      </div>

      <div className="lumen-scroll flex-1 overflow-auto p-2">
        {messages.length === 0 && (
          <div className="mb-2 rounded border border-border bg-black/20 p-2 text-[11px] text-muted">
            Agent loop: PLAN → EXECUTE → VERIFY → PROPOSE → APPLY
          </div>
        )}
        {messages.map((line) => (
          <div
            key={line.id}
            className={`mb-2 flex ${line.role === "assistant" ? "justify-end" : line.role === "user" ? "justify-start" : "justify-center"}`}
          >
            <div
              className={`max-w-[92%] rounded border p-2 text-[11px] ${
                line.role === "assistant"
                  ? "border-accent/40 bg-accent/5"
                  : line.role === "user"
                    ? "border-border bg-black/20"
                    : "border-border bg-black/25"
              }`}
            >
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase text-muted">{line.role}</div>
              {line.role === "assistant" && line.meta && (
                <div className="flex items-center gap-1">
                  {line.meta.reasoning && (
                    <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                      reasoning: {line.meta.reasoning.replace("_", " ")}
                    </span>
                  )}
                  {line.meta.model && (
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                      model: {line.meta.model}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="whitespace-pre-wrap break-words">{line.text}</div>
          </div>
          </div>
        ))}

        {showPlan && planLines.length > 0 && (
          <div className="mb-2 rounded border border-border bg-black/20 p-2 text-[11px]">
            <div className="mb-1 text-[10px] uppercase text-muted">Plan</div>
            <ol className="list-decimal pl-4">
              {planLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </div>
        )}

        {showPlan && goalObjectives.length > 0 && (
          <div className="mb-2 rounded border border-border bg-black/20 p-2 text-[11px]">
            <div className="mb-1 text-[10px] uppercase text-muted">Objectives</div>
            <ol className="list-decimal pl-4">
              {goalObjectives.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </div>
        )}

        {taskGraph.length > 0 && (
          <div className="mb-2 rounded border border-border bg-black/20 p-2 text-[11px]">
            <div className="mb-1 text-[10px] uppercase text-muted">Task Graph</div>
            <div className="space-y-1">
              {taskGraph.map((node) => (
                <div key={node.id} className="flex items-center justify-between gap-2 rounded border border-border/50 px-2 py-1">
                  <div className="min-w-0 truncate">{node.id}. {node.title}</div>
                  <div className="flex items-center gap-1">
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">{node.confidence}</span>
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted">{node.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {pendingChanges.length > 0 && (
          <div className="mb-2 rounded border border-accent/40 bg-accent/5 p-2 text-[11px]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase text-accent">Patch Review</div>
              <div className="text-[10px] text-muted">
                {selectedChangeCountWithHunks}/{pendingChanges.length} selected
              </div>
            </div>
            <div className="mb-2 space-y-1 rounded border border-border bg-black/20 p-2">
              {pendingChanges.map((change) => {
                const selected = selectedChangeIds.includes(change.id);
                return (
                  <label key={change.id} className="flex cursor-pointer items-center justify-between gap-2 rounded border border-transparent px-2 py-1 hover:border-border">
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleChangeSelection(change.id)}
                      />
                      <button
                        type="button"
                        className={`truncate text-left ${activePendingChange?.id === change.id ? "text-accent" : "text-text"}`}
                        onClick={() => setActiveChangeId(change.id)}
                      >
                        {fileLabel(change.path)}
                      </button>
                    </div>
                    <span className="text-[10px] uppercase text-muted">{change.type}</span>
                  </label>
                );
              })}
            </div>
            {activePendingChange && activePendingHunks.length > 0 && (
              <div className="mb-2 rounded border border-border bg-black/25 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-[10px] uppercase text-muted">Hunks · {fileLabel(activePendingChange.path)}</div>
                  <div className="flex gap-1">
                    <Button onClick={() => setAllHunksSelected(activePendingChange.id, true)}>All Hunks</Button>
                    <Button onClick={() => setAllHunksSelected(activePendingChange.id, false)}>Clear Hunks</Button>
                  </div>
                </div>
                <div className="space-y-1">
                  {activePendingHunks.map((hunk) => {
                    const selected = activeSelectedHunkIds.includes(hunk.id);
                    return (
                      <label
                        key={`${activePendingChange.id}-${hunk.id}`}
                        className="block cursor-pointer rounded border border-transparent px-2 py-1 hover:border-border"
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleHunkSelection(activePendingChange.id, hunk.id)}
                          />
                          <span className="text-[10px] text-muted">{hunk.header}</span>
                          <span className="text-[10px] text-good">+{hunk.added}</span>
                          <span className="text-[10px] text-bad">-{hunk.removed}</span>
                        </div>
                        {hunk.preview && (
                          <pre className="lumen-scroll max-h-20 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-black/30 p-2 text-[10px] text-muted">
                            {redactSecrets(hunk.preview)}
                          </pre>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <pre className="lumen-scroll max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-black/30 p-2">
              {redactSecrets(diffPreview)}
            </pre>
            <div className="mt-2 flex gap-2">
              <Button onClick={() => void applyPendingChanges()} disabled={!selectedChangeCountWithHunks}>
                Apply Selected
              </Button>
              <Button
                onClick={() => setSelectedChangeIds(pendingChanges.map((change) => change.id))}
                disabled={selectedPendingChanges.length === pendingChanges.length}
              >
                Select All
              </Button>
              <Button
                onClick={() => {
                  clearPendingChanges();
                  patchFirstNodeByPhase("propose", "blocked", "Proposal discarded by user.");
                  patchFirstNodeByPhase("apply", "blocked", "Apply cancelled because proposal was discarded.");
                  appendTimeline(
                    createTimelineEntry({
                      phase: "propose",
                      status: "blocked",
                      title: "Patch discarded",
                      detail: "Pending proposal was cleared without apply",
                      source: "agent"
                    })
                  );
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        )}

        {appliedPatchHistory.length > 0 && (
          <div className="mb-2 rounded border border-border bg-black/20 p-2 text-[11px]">
            <div className="mb-1 text-[10px] uppercase text-muted">Applied Patch History</div>
            <div className="mb-2 text-muted">
              {appliedPatchHistory.length} patch set(s) recorded in this session.
            </div>
            {latestAppliedPatchSet && (
              <div className="mb-2 text-muted">
                Latest patch: {latestAppliedPatchSet.changes.length} file change(s) at{" "}
                {new Date(latestAppliedPatchSet.timestamp).toLocaleTimeString()}.
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={() => void rollbackLastApply()} disabled={!latestAppliedPatchSet}>
                Rollback Latest
              </Button>
              <Button onClick={() => clearAppliedPatchHistory()}>Clear History</Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border p-2">
        <Textarea
          ref={promptInputRef}
          id="agent-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.ctrlKey) {
              event.preventDefault();
              void runAgent();
            }
          }}
          rows={3}
          spellCheck={false}
          placeholder="Enter = new line, Ctrl+Enter = send"
        />
        {streamStatus && <div className="text-[11px] text-muted">{streamStatus}</div>}
        <div className="flex gap-2">
          <Button onClick={() => void runAgent()} disabled={busy || !prompt.trim()}>
            {busy ? "Running..." : "Run Agent"}
          </Button>
          <Button
            onClick={() => {
              setMessages([]);
              setPlanLines([]);
              clearPendingChanges();
              clearAppliedPatchHistory();
            }}
          >
            Clear
          </Button>
        </div>
        {error && <div className="text-[11px] text-bad">{error}</div>}
      </div>

      <Modal
        open={Boolean(approval)}
        title="Permission Required"
        onConfirm={() => {
          resolveApprovalRef.current?.(true);
          resolveApprovalRef.current = null;
          setApproval(null);
        }}
        onCancel={() => {
          resolveApprovalRef.current?.(false);
          resolveApprovalRef.current = null;
          setApproval(null);
        }}
        confirmLabel="Approve Action"
      >
        {approval && (
          <div className="space-y-2">
            <div>
              <span className="text-muted">Action:</span> {approval.action.type}
            </div>
            <div>
              <span className="text-muted">Reason:</span> {approval.requirement.reason}
            </div>
            <pre className="whitespace-pre-wrap break-words rounded border border-border bg-black/30 p-2 text-[11px]">
              {JSON.stringify(approval.action, null, 2)}
            </pre>
          </div>
        )}
      </Modal>
    </div>
  );
}
