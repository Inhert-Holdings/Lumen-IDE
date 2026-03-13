const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require("electron");
const pty = require("node-pty");
const { chromium } = require("playwright-core");
const simpleGit = require("simple-git");
const { registerIpcHandlers } = require("./ipc/registerHandlers.cjs");
const { createPolicyManager } = require("./managers/policyManager.cjs");
const { createRuntimeManager } = require("./managers/runtimeManager.cjs");
const { createTerminalManager } = require("./managers/terminalManager.cjs");

const APP_ROOT = path.resolve(__dirname, "..");
const SETTINGS_FILE = "lumen-settings.json";
const WORKSPACE_FILE = "lumen-workspace.json";
const AUDIT_FILE = "lumen-audit.jsonl";
const MANAGED_MODELS_DIR = "ollama-models";
const MODEL_MANIFEST_RELATIVE = path.join("manifests", "registry.ollama.ai", "library", "qwen2.5-coder", "7b");
const PREVIEW_SCREENSHOT_DIR = "preview-screenshots";
const MAX_TREE_ENTRIES = 6000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PREVIEW_DEFAULT_PORT = 4173;
const PREVIEW_MAX_PORT_ATTEMPTS = 25;
const PREVIEW_PROJECT_WAIT_MS = 30000;
const PREVIEW_DIAGNOSTIC_LIMIT = 40;
const PREVIEW_EVENT_LIMIT = 120;
const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", "release", ".idea", ".vscode"]);
const POLICY_PRESETS = new Set([
  "read_only",
  "local_edit_only",
  "local_build_mode",
  "preview_operator",
  "git_operator",
  "full_local_workspace",
  "trusted_workspace_profile"
]);

const DEFAULT_SETTINGS = {
  provider: "ollama",
  baseUrl: "http://localhost:11434/v1",
  model: "qwen2.5-coder:7b",
  helperEnabled: true,
  helperUsesMainConnection: true,
  helperProvider: "ollama",
  helperBaseUrl: "http://localhost:11434/v1",
  helperModel: "qwen2.5-coder:1.5b",
  onlineMode: false,
  compactMode: true,
  recentModels: ["Qwen2.5-Coder-7B-Instruct", "qwen2.5-coder:7b"],
  helperRecentModels: ["Qwen2.5-Coder-1.5B-Instruct", "qwen2.5-coder:1.5b", "qwen2.5-coder:7b"],
  apiKey: "",
  helperApiKey: "",
  autoManageLocalRuntime: true,
  autoStopMinutes: 10,
  lowResourceMode: false,
  permissionPreset: "full_local_workspace"
};

function isBrokenPipeError(error) {
  return Boolean(error && (error.code === "EPIPE" || error.errno === -4047));
}

function guardProcessStream(stream) {
  if (!stream || typeof stream.on !== "function") return;
  stream.on("error", (error) => {
    if (isBrokenPipeError(error)) return;
    throw error;
  });
}

guardProcessStream(process.stdout);
guardProcessStream(process.stderr);

process.on("uncaughtException", (error) => {
  if (isBrokenPipeError(error)) return;
  throw error;
});

process.on("unhandledRejection", (reason) => {
  if (isBrokenPipeError(reason)) return;
  if (reason instanceof Error) throw reason;
  throw new Error(String(reason));
});

let workspaceRoot = APP_ROOT;
let mainWindow;
const llmStreams = new Map();
let managedRuntime = null;
let runtimeIdleTimer = null;
let lastRuntimeActivityAt = 0;
let previewRuntime = null;
let previewProjectRuntime = null;
let previewBrowserRuntime = null;
let workspaceWindowActive = true;
const workspaceWatcherState = {
  watcher: null,
  active: false,
  eventCount: 0,
  lastEventAt: "",
  lastReason: ""
};
const workspaceIndexState = {
  status: "idle",
  queued: false,
  running: false,
  lastIndexedAt: "",
  lastDurationMs: 0,
  filesIndexed: 0,
  dirsIndexed: 0,
  truncated: false,
  maxDepth: 0,
  maxEntries: 0,
  lastReason: "",
  error: ""
};
let workspaceIndexTimer = null;
const agentRuntimeState = {
  mode: "manual",
  taskGraph: []
};

function getUserDataPath(filename) {
  return path.join(app.getPath("userData"), filename);
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function redactSecrets(text) {
  if (!text) return "";
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[REDACTED_KEY]")
    .replace(/(api[_-]?key\s*[:=]\s*)([^\s,\"'}]+)/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)([^\s,\"'}]+)/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)([^\s]+)/gi, "$1[REDACTED]");
}

function redactValue(value) {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, val] of Object.entries(value)) {
      if (/key|token|secret|password/i.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redactValue(val);
      }
    }
    return output;
  }
  return value;
}

function audit(action, detail = {}) {
  const entry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    detail: redactValue(detail)
  };
  const auditPath = getUserDataPath(AUDIT_FILE);
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, "utf8");
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("audit:entry", entry);
  }
  return entry;
}

function loadAudit() {
  const auditPath = getUserDataPath(AUDIT_FILE);
  if (!fs.existsSync(auditPath)) return [];
  const lines = fs
    .readFileSync(auditPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-500).map((line) => safeJsonParse(line, null)).filter(Boolean);
}

function loadWorkspaceRoot() {
  const workspacePath = getUserDataPath(WORKSPACE_FILE);
  if (!fs.existsSync(workspacePath)) {
    workspaceRoot = APP_ROOT;
    return;
  }
  const payload = safeJsonParse(fs.readFileSync(workspacePath, "utf8"), null);
  if (!payload?.root) {
    workspaceRoot = APP_ROOT;
    return;
  }
  const target = path.resolve(payload.root);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    workspaceRoot = target;
    return;
  }
  workspaceRoot = APP_ROOT;
}

function saveWorkspaceRoot(root) {
  const workspacePath = getUserDataPath(WORKSPACE_FILE);
  fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
  fs.writeFileSync(workspacePath, JSON.stringify({ root }, null, 2), "utf8");
}

function encryptSecret(value) {
  if (!value) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage unavailable on this system.");
  }
  return safeStorage.encryptString(value).toString("base64");
}

function decryptSecret(value) {
  if (!value) return "";
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return "";
  }
}

function loadSettings() {
  const settingsPath = getUserDataPath(SETTINGS_FILE);
  if (!fs.existsSync(settingsPath)) return { ...DEFAULT_SETTINGS };
  const stored = safeJsonParse(fs.readFileSync(settingsPath, "utf8"), {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    apiKey: decryptSecret(stored.apiKeyEnc || ""),
    helperApiKey: decryptSecret(stored.helperApiKeyEnc || "")
  };
}

function saveSettings(input) {
  const settingsPath = getUserDataPath(SETTINGS_FILE);
  const next = {
    ...DEFAULT_SETTINGS,
    ...input,
    autoStopMinutes: Math.max(1, Number(input.autoStopMinutes) || DEFAULT_SETTINGS.autoStopMinutes),
    recentModels: Array.from(new Set([input.model, ...(input.recentModels || [])].filter(Boolean))).slice(0, 10),
    helperRecentModels: Array.from(new Set([input.helperModel, ...(input.helperRecentModels || [])].filter(Boolean))).slice(0, 10),
    lowResourceMode: Boolean(input.lowResourceMode),
    permissionPreset: normalizePolicyPreset(input.permissionPreset)
  };
  const persisted = {
    ...next,
    apiKey: undefined,
    helperApiKey: undefined,
    apiKeyEnc: encryptSecret(next.apiKey || ""),
    helperApiKeyEnc: encryptSecret(next.helperApiKey || "")
  };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(persisted, null, 2), "utf8");
  if (!next.autoManageLocalRuntime) {
    stopManagedRuntime("auto_runtime_disabled");
  } else {
    scheduleManagedRuntimeStop();
  }
  audit("settings.save", {
    provider: next.provider,
    baseUrl: next.baseUrl,
    model: next.model,
    helperEnabled: next.helperEnabled,
    helperModel: next.helperModel,
    onlineMode: next.onlineMode,
    lowResourceMode: next.lowResourceMode,
    permissionPreset: next.permissionPreset
  });
  syncWorkspaceWatcher("settings_save");
  scheduleWorkspaceIndex("settings_save");
  return next;
}

function isWithinWorkspace(targetPath) {
  const resolved = path.resolve(targetPath);
  return resolved === workspaceRoot || resolved.startsWith(`${workspaceRoot}${path.sep}`);
}

function safeResolve(target) {
  const resolved = path.resolve(target);
  if (!isWithinWorkspace(resolved)) {
    throw new Error("Path is outside current workspace.");
  }
  return resolved;
}

function getWorkspaceScanLimits() {
  const settings = loadSettings();
  if (settings.lowResourceMode) {
    return { maxTreeEntries: 2000, maxDepth: 3 };
  }
  return { maxTreeEntries: MAX_TREE_ENTRIES, maxDepth: 5 };
}

function scanWorkspaceStats(rootPath, maxDepth, maxEntries) {
  const counts = { files: 0, dirs: 0, truncated: false };

  function walk(currentPath, depth) {
    if (counts.truncated) return;
    if (depth > maxDepth) return;
    if (counts.files + counts.dirs >= maxEntries) {
      counts.truncated = true;
      return;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (counts.files + counts.dirs >= maxEntries) {
        counts.truncated = true;
        return;
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        counts.dirs += 1;
        walk(path.join(currentPath, entry.name), depth + 1);
      } else {
        counts.files += 1;
      }
    }
  }

  walk(rootPath, 0);
  return counts;
}

function stopWorkspaceWatcher(reason = "manual") {
  if (!workspaceWatcherState.watcher) {
    workspaceWatcherState.active = false;
    workspaceWatcherState.lastReason = reason;
    return;
  }
  try {
    workspaceWatcherState.watcher.close();
  } catch {
    // Ignore watcher close errors.
  }
  workspaceWatcherState.watcher = null;
  workspaceWatcherState.active = false;
  workspaceWatcherState.lastReason = reason;
}

function startWorkspaceWatcher(reason = "manual") {
  stopWorkspaceWatcher("restart");
  try {
    const watcher = fs.watch(workspaceRoot, { recursive: true }, (_eventType, fileName) => {
      const changed = String(fileName || "");
      if (!changed || changed.startsWith(".git")) return;
      if (changed.includes("node_modules") || changed.includes("\\dist\\") || changed.includes("/dist/")) return;
      workspaceWatcherState.eventCount += 1;
      workspaceWatcherState.lastEventAt = new Date().toISOString();
      scheduleWorkspaceIndex("watch_event");
    });
    watcher.on("error", () => {
      // Ignore transient watcher transport errors.
    });
    workspaceWatcherState.watcher = watcher;
    workspaceWatcherState.active = true;
    workspaceWatcherState.lastReason = reason;
  } catch {
    workspaceWatcherState.watcher = null;
    workspaceWatcherState.active = false;
    workspaceWatcherState.lastReason = "watcher_error";
  }
}

function shouldWorkspaceWatcherRun() {
  const settings = loadSettings();
  return !settings.lowResourceMode && workspaceWindowActive;
}

function syncWorkspaceWatcher(reason = "sync") {
  if (shouldWorkspaceWatcherRun()) {
    if (!workspaceWatcherState.watcher) {
      startWorkspaceWatcher(reason);
    }
    return;
  }
  stopWorkspaceWatcher(reason);
}

function runWorkspaceIndex(reason = "manual") {
  if (workspaceIndexState.running) {
    workspaceIndexState.queued = true;
    workspaceIndexState.lastReason = reason;
    return;
  }
  workspaceIndexState.running = true;
  workspaceIndexState.status = "indexing";
  workspaceIndexState.lastReason = reason;
  const startedAt = Date.now();
  const limits = getWorkspaceScanLimits();
  const maxDepth = Math.min(8, Math.max(2, limits.maxDepth + 1));
  const maxEntries = Math.min(30000, Math.max(3000, limits.maxTreeEntries * 2));
  workspaceIndexState.maxDepth = maxDepth;
  workspaceIndexState.maxEntries = maxEntries;
  workspaceIndexState.error = "";

  try {
    const stats = scanWorkspaceStats(workspaceRoot, maxDepth, maxEntries);
    workspaceIndexState.filesIndexed = stats.files;
    workspaceIndexState.dirsIndexed = stats.dirs;
    workspaceIndexState.truncated = stats.truncated;
    workspaceIndexState.lastIndexedAt = new Date().toISOString();
    workspaceIndexState.lastDurationMs = Date.now() - startedAt;
    workspaceIndexState.status = "idle";
  } catch (error) {
    workspaceIndexState.status = "error";
    workspaceIndexState.error = error instanceof Error ? error.message : "Workspace indexing failed.";
  } finally {
    workspaceIndexState.running = false;
    if (workspaceIndexState.queued) {
      workspaceIndexState.queued = false;
      scheduleWorkspaceIndex("queued_followup");
    }
  }
}

function scheduleWorkspaceIndex(reason = "manual") {
  workspaceIndexState.lastReason = reason;
  if (workspaceIndexState.running) {
    workspaceIndexState.queued = true;
    return;
  }
  if (workspaceIndexTimer) {
    clearTimeout(workspaceIndexTimer);
    workspaceIndexTimer = null;
  }
  const settings = loadSettings();
  workspaceIndexTimer = setTimeout(() => {
    workspaceIndexTimer = null;
    runWorkspaceIndex(reason);
  }, settings.lowResourceMode ? 3500 : 1200);
}

function listDirectoryTree(basePath, maxDepth = 5, maxTreeEntries = MAX_TREE_ENTRIES) {
  const counter = { value: 0 };

  function walk(currentPath, depth) {
    const name = path.basename(currentPath);
    if (counter.value >= maxTreeEntries) {
      return { name, path: currentPath, type: "dir", children: [], truncated: true };
    }

    const node = { name, path: currentPath, type: "dir", children: [], truncated: false };
    if (depth >= maxDepth) {
      node.truncated = true;
      return node;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return node;
    }

    entries
      .filter((entry) => (entry.isDirectory() ? !EXCLUDED_DIRS.has(entry.name) : true))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .forEach((entry) => {
        if (counter.value >= maxTreeEntries) {
          node.truncated = true;
          return;
        }
        const entryPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          node.children.push(walk(entryPath, depth + 1));
        } else {
          node.children.push({ name: entry.name, path: entryPath, type: "file" });
        }
        counter.value += 1;
      });

    return node;
  }

  return walk(basePath, 0);
}

function searchFiles(query, maxResults = 100) {
  const settings = loadSettings();
  const cappedResults = settings.lowResourceMode ? Math.min(maxResults || 60, 60) : maxResults;
  const maxDepth = settings.lowResourceMode ? 5 : 8;
  const results = [];
  const needle = query.toLowerCase();

  function walk(currentPath, depth = 0) {
    if (results.length >= cappedResults || depth > maxDepth) return;

    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath, depth + 1);
      } else {
        const lower = entry.name.toLowerCase();
        if (lower.includes(needle)) {
          results.push({ path: entryPath, line: 0, preview: "filename match" });
          if (results.length >= cappedResults) return;
          continue;
        }
        try {
          const content = fs.readFileSync(entryPath, "utf8");
          const lineIndex = content.toLowerCase().indexOf(needle);
          if (lineIndex >= 0) {
            const start = Math.max(0, lineIndex - 60);
            const end = Math.min(content.length, lineIndex + 120);
            results.push({ path: entryPath, line: 0, preview: content.slice(start, end).replace(/\s+/g, " ") });
          }
          if (results.length >= cappedResults) return;
        } catch {
          // Skip binary/unreadable files.
        }
      }
    }
  }

  if (!query) return [];
  walk(workspaceRoot);
  audit("files.search", { query, count: results.length, lowResourceMode: settings.lowResourceMode });
  return results;
}

function listDir(targetPath) {
  const basePath = targetPath ? safeResolve(targetPath) : workspaceRoot;
  const limits = getWorkspaceScanLimits();
  audit("files.list", { basePath });
  return {
    root: workspaceRoot,
    tree: listDirectoryTree(basePath, limits.maxDepth, limits.maxTreeEntries)
  };
}

function readFile(filePath) {
  const target = safeResolve(filePath);
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error("Path is not a file.");
  if (stat.size > MAX_FILE_BYTES) throw new Error("File exceeds editor size limit.");
  const content = fs.readFileSync(target, "utf8");
  audit("files.read", { path: target, bytes: content.length });
  return { path: target, content };
}

function writeFile(filePath, content, options = {}) {
  if (options.source === "agent_apply") {
    const decision = evaluatePolicyDecision({
      actionType: "write_file",
      preset: options.preset
    });
    audit("policy.decision", {
      actionType: "write_file",
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      risk: decision.risk,
      preset: decision.preset,
      source: "agent_apply",
      mode: agentRuntimeState.mode
    });
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    if (decision.requiresApproval && !options.approved) {
      throw new Error("write_file requires explicit approval by policy.");
    }
  }
  const target = safeResolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  audit("files.write", { path: target, bytes: content.length });
  scheduleWorkspaceIndex("write_file");
  return { ok: true };
}

function createFile(filePath) {
  const target = safeResolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.writeFileSync(target, "", "utf8");
  audit("files.create", { path: target });
  scheduleWorkspaceIndex("create_file");
  return { ok: true };
}

function createDirectory(dirPath) {
  const target = safeResolve(dirPath);
  fs.mkdirSync(target, { recursive: true });
  audit("files.mkdir", { path: target });
  scheduleWorkspaceIndex("create_dir");
  return { ok: true };
}

function renamePath(sourcePath, destinationPath) {
  const source = safeResolve(sourcePath);
  const destination = safeResolve(destinationPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(source, destination);
  audit("files.rename", { source, destination });
  scheduleWorkspaceIndex("rename_path");
  return { ok: true };
}

function deletePath(targetPath, options = {}) {
  if (options.source === "agent_apply") {
    const decision = evaluatePolicyDecision({
      actionType: "delete_file",
      preset: options.preset
    });
    audit("policy.decision", {
      actionType: "delete_file",
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      risk: decision.risk,
      preset: decision.preset,
      source: "agent_apply",
      mode: agentRuntimeState.mode
    });
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    if (decision.requiresApproval && !options.approved) {
      throw new Error("delete_file requires explicit approval by policy.");
    }
  }
  const target = safeResolve(targetPath);
  fs.rmSync(target, { recursive: true, force: true });
  audit("files.delete", { path: target });
  scheduleWorkspaceIndex("delete_path");
  return { ok: true };
}

function normalizePreviewEntry(entry) {
  const fallback = "index.html";
  const raw = String(entry || fallback)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!raw) return fallback;
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return fallback;
  }
  return raw;
}

function isPathInsideRoot(rootPath, candidatePath) {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function resolvePreviewTarget(inputPath, inputEntry) {
  const resolvedInput = inputPath
    ? safeResolve(path.isAbsolute(inputPath) ? inputPath : path.join(workspaceRoot, inputPath))
    : workspaceRoot;

  if (!fs.existsSync(resolvedInput)) {
    throw new Error("Preview path does not exist.");
  }

  const stat = fs.statSync(resolvedInput);
  if (stat.isFile()) {
    return {
      rootPath: path.dirname(resolvedInput),
      entryFile: path.basename(resolvedInput)
    };
  }

  if (!stat.isDirectory()) {
    throw new Error("Preview path must be a directory or file.");
  }

  return {
    rootPath: resolvedInput,
    entryFile: normalizePreviewEntry(inputEntry)
  };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".wasm": "application/wasm"
  };
  return types[ext] || "application/octet-stream";
}

function resolvePreviewFile(rootPath, entryFile, requestPath) {
  const requested = (requestPath || "/").replace(/\\/g, "/");
  const relative = (requested === "/" ? entryFile : requested.replace(/^\/+/, "")).trim();
  const parts = relative.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) return "";

  let target = path.resolve(rootPath, relative);
  if (!isPathInsideRoot(rootPath, target)) return "";

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, entryFile);
  }

  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    return target;
  }

  const fallback = path.resolve(rootPath, entryFile);
  if (fs.existsSync(fallback) && fs.statSync(fallback).isFile()) {
    return fallback;
  }

  return "";
}

function injectPreviewReloadClient(html) {
  const snippet = `
<script>
(() => {
  if (window.__lumenLiveReload) return;
  window.__lumenLiveReload = true;
  try {
    const events = new EventSource("/__lumen_events");
    events.onmessage = (event) => {
      if (event?.data === "reload") {
        window.location.reload();
      }
    };
    window.addEventListener("beforeunload", () => events.close(), { once: true });
  } catch (_error) {
    // Ignore live reload transport failures.
  }
})();
</script>
`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${snippet}</body>`);
  }
  return `${html}\n${snippet}`;
}

function notifyPreviewClients(runtime, payload) {
  if (!runtime?.clients?.size) return;
  for (const client of Array.from(runtime.clients)) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      runtime.clients.delete(client);
      try {
        client.end();
      } catch {
        // Ignore socket close errors.
      }
    }
  }
}

function queuePreviewReload(runtime) {
  if (!runtime) return;
  if (runtime.reloadTimer) {
    clearTimeout(runtime.reloadTimer);
  }
  runtime.reloadTimer = setTimeout(() => {
    runtime.reloadTimer = null;
    notifyPreviewClients(runtime, "reload");
  }, 160);
}

function watchPreviewRoot(rootPath, runtime) {
  try {
    const watcher = fs.watch(rootPath, { recursive: true }, (_eventType, fileName) => {
      const changed = String(fileName || "");
      if (!changed || changed.startsWith(".git")) return;
      queuePreviewReload(runtime);
    });
    watcher.on("error", () => {
      // Ignore watcher transport errors.
    });
    return watcher;
  } catch {
    return null;
  }
}

async function listenOnPort(server, port) {
  return await new Promise((resolve, reject) => {
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function bindPreviewServer(server, preferredPort) {
  const startPort = Math.max(1024, Number(preferredPort) || PREVIEW_DEFAULT_PORT);

  for (let offset = 0; offset < PREVIEW_MAX_PORT_ATTEMPTS; offset += 1) {
    const port = startPort + offset;
    try {
      await listenOnPort(server, port);
      return port;
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : "";
      if (code !== "EADDRINUSE") {
        throw error;
      }
    }
  }

  await listenOnPort(server, 0);
  const address = server.address();
  if (typeof address !== "object" || !address?.port) {
    throw new Error("Could not resolve preview server port.");
  }
  return address.port;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectPackageManager(rootPath) {
  if (fs.existsSync(path.join(rootPath, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(rootPath, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(rootPath, "package-lock.json"))) return "npm";
  return "npm";
}

function resolveInspectionRoot(inputPath = "") {
  const resolvedInput = inputPath
    ? safeResolve(path.isAbsolute(inputPath) ? inputPath : path.join(workspaceRoot, inputPath))
    : workspaceRoot;

  if (!fs.existsSync(resolvedInput)) {
    throw new Error("Project path does not exist.");
  }

  const stat = fs.statSync(resolvedInput);
  return stat.isFile() ? path.dirname(resolvedInput) : resolvedInput;
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return "";
  return fs.readFileSync(filePath, "utf8");
}

function readJsonIfExists(filePath) {
  const raw = readTextIfExists(filePath);
  return raw ? safeJsonParse(raw, null) : null;
}

function relativeWorkspacePath(targetPath) {
  if (!targetPath) return "";
  const relative = path.relative(workspaceRoot, targetPath);
  if (!relative) return ".";
  return relative.replace(/\\/g, "/");
}

function buildScriptCommand(packageManager, scriptName) {
  return packageManager === "yarn" ? `yarn ${scriptName}` : `${packageManager} ${scriptName}`;
}

function inferPreviewUrl(scriptName, scriptText, preferredUrl, preferredPort) {
  const explicitUrl = String(preferredUrl || "").trim();
  if (explicitUrl) return explicitUrl;

  const explicitPort = Number(preferredPort) || 0;
  if (explicitPort > 0) return `http://127.0.0.1:${explicitPort}`;

  const normalized = String(scriptText || "");
  const portMatch = normalized.match(/(?:--port|-p)\s+(\d{2,5})/i) || normalized.match(/PORT\s*=\s*(\d{2,5})/i);
  if (portMatch?.[1]) {
    return `http://127.0.0.1:${portMatch[1]}`;
  }

  const lower = normalized.toLowerCase();
  if (scriptName === "preview" || lower.includes("vite preview")) {
    return `http://127.0.0.1:${PREVIEW_DEFAULT_PORT}`;
  }
  if (lower.includes("vite")) {
    return "http://127.0.0.1:5173";
  }
  if (lower.includes("astro")) {
    return "http://127.0.0.1:4321";
  }
  if (lower.includes("next")) {
    return "http://127.0.0.1:3000";
  }
  if (lower.includes("nuxt")) {
    return "http://127.0.0.1:3000";
  }
  if (lower.includes("svelte-kit") || lower.includes("sveltekit")) {
    return "http://127.0.0.1:5173";
  }
  if (lower.includes("webpack-dev-server") || lower.includes("react-scripts start")) {
    return "http://127.0.0.1:3000";
  }
  if (lower.includes("angular") || lower.includes("ng serve")) {
    return "http://127.0.0.1:4200";
  }
  return "http://127.0.0.1:3000";
}

function detectNodeFramework(packageJson, scripts) {
  const dependencyNames = new Set([
    ...Object.keys(packageJson?.dependencies || {}),
    ...Object.keys(packageJson?.devDependencies || {})
  ]);
  const scriptBlob = Object.values(scripts)
    .map((value) => String(value || ""))
    .join("\n")
    .toLowerCase();

  if (dependencyNames.has("next") || scriptBlob.includes("next dev")) {
    return { framework: "Next.js", confidence: "high" };
  }
  if (dependencyNames.has("astro") || scriptBlob.includes("astro dev")) {
    return { framework: "Astro", confidence: "high" };
  }
  if (dependencyNames.has("nuxt") || scriptBlob.includes("nuxt dev")) {
    return { framework: "Nuxt", confidence: "high" };
  }
  if (dependencyNames.has("@sveltejs/kit") || scriptBlob.includes("svelte-kit")) {
    return { framework: "SvelteKit", confidence: "high" };
  }
  if (dependencyNames.has("vite") || scriptBlob.includes("vite")) {
    return { framework: "Vite", confidence: "high" };
  }
  if (dependencyNames.has("electron") || dependencyNames.has("electron-builder")) {
    return { framework: "Electron", confidence: "high" };
  }
  if (dependencyNames.has("express")) {
    return { framework: "Express", confidence: "medium" };
  }
  if (dependencyNames.has("react")) {
    return { framework: "React", confidence: "medium" };
  }
  return { framework: "Node app", confidence: "low" };
}

function selectNodeRunScript(scripts) {
  const names = Object.keys(scripts || {});
  const ranked = [
    "dev",
    "start",
    "preview",
    "serve",
    "dev:server",
    "dev:app",
    "start:dev",
    "start:server",
    "web",
    "frontend"
  ];

  for (const candidate of ranked) {
    if (typeof scripts?.[candidate] === "string") {
      return candidate;
    }
  }

  const regexCandidates = [
    /^dev[:_-]/i,
    /^start[:_-]/i,
    /^serve[:_-]/i,
    /dev/i,
    /start/i,
    /serve/i,
    /preview/i
  ];
  for (const pattern of regexCandidates) {
    const found = names.find((name) => pattern.test(name) && typeof scripts[name] === "string");
    if (found) return found;
  }

  return "";
}

function findStaticRoot(rootPath) {
  const candidates = [rootPath, path.join(rootPath, "dist"), path.join(rootPath, "build"), path.join(rootPath, "public")];
  for (const candidate of candidates) {
    const entryPath = path.join(candidate, "index.html");
    if (fs.existsSync(entryPath) && fs.statSync(entryPath).isFile()) {
      return { rootPath: candidate, entryFile: "index.html" };
    }
  }
  return { rootPath: "", entryFile: "" };
}

function inspectNodeProject(rootPath, packageJson) {
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  const packageManager = detectPackageManager(rootPath);
  const orderedScripts = Object.entries(scripts)
    .filter(([, command]) => typeof command === "string")
    .map(([name, command]) => ({ name, command: String(command) }));
  const detected = detectNodeFramework(packageJson, scripts);
  const runScript = selectNodeRunScript(scripts);
  const buildScript = typeof scripts.build === "string" ? "build" : "";
  const staticTarget = findStaticRoot(rootPath);

  return {
    rootPath,
    kind: "node",
    framework: detected.framework,
    confidence: detected.confidence,
    packageManager,
    scripts: orderedScripts,
    runCommand: runScript ? buildScriptCommand(packageManager, runScript) : "",
    buildCommand: buildScript ? buildScriptCommand(packageManager, buildScript) : "",
    devUrl: runScript ? inferPreviewUrl(runScript, scripts[runScript], "", 0) : "",
    staticRoot: staticTarget.rootPath,
    entryFile: staticTarget.entryFile,
    summary: runScript
      ? `${detected.framework} project detected. Suggested run command: ${buildScriptCommand(packageManager, runScript)}`
      : `${detected.framework} project detected. No runnable dev script found.`
  };
}

function inspectPythonProject(rootPath) {
  const requirementsText = readTextIfExists(path.join(rootPath, "requirements.txt"));
  const pyprojectText = readTextIfExists(path.join(rootPath, "pyproject.toml"));
  const combined = `${requirementsText}\n${pyprojectText}`.toLowerCase();

  if (!combined.trim()) return null;

  if (combined.includes("fastapi")) {
    const entryModule = fs.existsSync(path.join(rootPath, "main.py")) ? "main:app" : "app:app";
    return {
      rootPath,
      kind: "python",
      framework: "FastAPI",
      confidence: "medium",
      packageManager: "python",
      scripts: [],
      runCommand: `uvicorn ${entryModule} --reload`,
      buildCommand: "",
      devUrl: "http://127.0.0.1:8000",
      staticRoot: "",
      entryFile: "",
      summary: "FastAPI project detected. Suggested run command: uvicorn ..."
    };
  }

  if (combined.includes("flask")) {
    const entryFile = fs.existsSync(path.join(rootPath, "app.py")) ? "app.py" : "main.py";
    return {
      rootPath,
      kind: "python",
      framework: "Flask",
      confidence: "medium",
      packageManager: "python",
      scripts: [],
      runCommand: `flask --app ${entryFile} run --debug`,
      buildCommand: "",
      devUrl: "http://127.0.0.1:5000",
      staticRoot: "",
      entryFile: "",
      summary: "Flask project detected. Suggested run command: flask --app ... run --debug"
    };
  }

  const hasManagePy = fs.existsSync(path.join(rootPath, "manage.py"));
  if (combined.includes("django") || hasManagePy) {
    return {
      rootPath,
      kind: "python",
      framework: "Django",
      confidence: hasManagePy ? "high" : "medium",
      packageManager: "python",
      scripts: [],
      runCommand: "python manage.py runserver",
      buildCommand: "",
      devUrl: "http://127.0.0.1:8000",
      staticRoot: "",
      entryFile: "",
      summary: "Django project detected. Suggested run command: python manage.py runserver"
    };
  }

  return {
    rootPath,
    kind: "python",
    framework: "Python app",
    confidence: "low",
    packageManager: "python",
    scripts: [],
    runCommand: "",
    buildCommand: "",
    devUrl: "",
    staticRoot: "",
    entryFile: "",
    summary: "Python project detected, but no preview command could be inferred."
  };
}

function inspectStaticProject(rootPath) {
  const staticTarget = findStaticRoot(rootPath);
  if (!staticTarget.rootPath) {
    return {
      rootPath,
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
      summary: "No runnable project or static entry point detected yet."
    };
  }

  return {
    rootPath,
    kind: "static",
    framework: "Static HTML",
    confidence: staticTarget.rootPath === rootPath ? "high" : "medium",
    packageManager: "",
    scripts: [],
    runCommand: "",
    buildCommand: "",
    devUrl: "",
    staticRoot: staticTarget.rootPath,
    entryFile: staticTarget.entryFile,
    summary: `Static preview available from ${relativeWorkspacePath(staticTarget.rootPath)}`
  };
}

function inspectProject(payload = {}) {
  const rootPath = resolveInspectionRoot(payload.path || "");
  const packageJson = readJsonIfExists(path.join(rootPath, "package.json"));

  if (packageJson) {
    return inspectNodeProject(rootPath, packageJson);
  }

  const pythonProject = inspectPythonProject(rootPath);
  if (pythonProject) return pythonProject;

  return inspectStaticProject(rootPath);
}

function detectPreviewProject(payload = {}) {
  const inspection = inspectProject(payload);
  if (inspection.kind !== "node") {
    throw new Error("Run Current Project currently supports package.json-based projects. Use Serve Static Folder otherwise.");
  }

  const scriptsMap = Object.fromEntries(inspection.scripts.map((script) => [script.name, script.command]));
  const preferredScript = String(payload.command || "").trim();
  const inferredScript = selectNodeRunScript(scriptsMap);
  const selectedScript = preferredScript
    ? inspection.scripts.find((script) => script.name === preferredScript)
    : inspection.scripts.find((script) => script.name === inferredScript);
  if (!selectedScript) {
    throw new Error("No runnable project script found. Add a dev/start script in package.json, then retry.");
  }

  return {
    rootPath: inspection.rootPath,
    packageManager: inspection.packageManager,
    scriptName: selectedScript.name,
    command: buildScriptCommand(inspection.packageManager, selectedScript.name),
    url: inferPreviewUrl(selectedScript.name, selectedScript.command, payload.url, payload.port),
    packagePath: path.join(inspection.rootPath, "package.json"),
    inspection
  };
}

function normalizeLocalPreviewUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(String(rawUrl).replace(/[),.;]+$/, ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (!["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"].includes(parsed.hostname)) return "";
    if (parsed.hostname !== "127.0.0.1") {
      parsed.hostname = "127.0.0.1";
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function extractLocalPreviewUrls(text) {
  const matches = String(text || "").match(/\bhttps?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s"'`)]*)?/gi) || [];
  return Array.from(new Set(matches.map((match) => normalizeLocalPreviewUrl(match)).filter(Boolean)));
}

function appendTerminalOutput(record, chunk) {
  record.recentOutput = `${record.recentOutput || ""}${chunk}`.slice(-80000);
  const detectedUrls = extractLocalPreviewUrls(chunk);
  if (!detectedUrls.length) return;
  record.recentUrls = Array.from(new Set([...(record.recentUrls || []), ...detectedUrls])).slice(-10);
}

async function waitForPreviewUrlInTerminal(record, preferredUrl, timeoutMs = PREVIEW_PROJECT_WAIT_MS) {
  const startedAt = Date.now();
  const settings = loadSettings();
  const pollMs = settings.lowResourceMode ? 1000 : 500;
  let lastError = "";
  let currentUrl = normalizeLocalPreviewUrl(preferredUrl);

  const onData = (chunk) => {
    appendTerminalOutput(record, chunk);
    const recentUrl = record.recentUrls?.at(-1) || "";
    if (recentUrl) {
      currentUrl = recentUrl;
    }
  };

  record.collectors.add(onData);
  try {
    while (Date.now() - startedAt < timeoutMs) {
      const candidates = Array.from(new Set([currentUrl, ...(record.recentUrls || [])].filter(Boolean)));
      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate, { method: "GET" });
          if (response.ok || response.status < 500) {
            return {
              url: candidate,
              detectedUrl: record.recentUrls?.at(-1) || candidate,
              terminalOutput: (record.recentOutput || "").slice(-12000)
            };
          }
          lastError = `HTTP ${response.status}`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Preview URL did not respond";
        }
      }
      await sleep(pollMs);
    }
  } finally {
    record.collectors.delete(onData);
  }

  throw new Error(
    `Preview server did not become ready.${currentUrl ? ` Last expected URL: ${currentUrl}.` : ""} ${lastError}`.trim()
  );
}

function getPreviewBrowserStatus() {
  return {
    connected: Boolean(previewBrowserRuntime?.page),
    url: previewBrowserRuntime?.url || "",
    title: previewBrowserRuntime?.title || "",
    executable: previewBrowserRuntime?.executable || "",
    consoleErrors: previewBrowserRuntime?.consoleErrors?.length || 0,
    networkErrors: previewBrowserRuntime?.networkErrors?.length || 0,
    lastConsoleError: previewBrowserRuntime?.consoleErrors?.at(-1) || "",
    lastNetworkError: previewBrowserRuntime?.networkErrors?.at(-1) || ""
  };
}

function findLocalBrowserExecutable() {
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
      ]
    : [process.env.CHROME_BIN, process.env.BROWSER].filter(Boolean);

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function pushPreviewDiagnostic(target, value) {
  target.push(String(value || "").trim());
  if (target.length > PREVIEW_DIAGNOSTIC_LIMIT) {
    target.splice(0, target.length - PREVIEW_DIAGNOSTIC_LIMIT);
  }
}

function pushPreviewEvent(target, value, limit = PREVIEW_EVENT_LIMIT) {
  target.push(value);
  if (target.length > limit) {
    target.splice(0, target.length - limit);
  }
}

async function ensurePreviewBrowser() {
  if (previewBrowserRuntime?.browser) {
    return previewBrowserRuntime;
  }

  const executablePath = findLocalBrowserExecutable();
  if (!executablePath) {
    throw new Error("No supported local browser found for Playwright. Install Microsoft Edge or Chrome.");
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--disable-gpu", "--disable-dev-shm-usage"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();
  previewBrowserRuntime = {
    browser,
    context,
    page,
    url: "",
    title: "",
    executable: executablePath,
    consoleErrors: [],
    networkErrors: [],
    consoleEvents: [],
    networkEvents: []
  };

  page.on("console", (message) => {
    if (previewBrowserRuntime?.page !== page) return;
    const text = message.text();
    const entry = {
      type: message.type(),
      text,
      location: message.location(),
      at: new Date().toISOString()
    };
    pushPreviewEvent(previewBrowserRuntime.consoleEvents, entry);
    if (message.type() === "error") {
      pushPreviewDiagnostic(previewBrowserRuntime.consoleErrors, text);
    }
  });
  page.on("pageerror", (error) => {
    if (previewBrowserRuntime?.page === page) {
      pushPreviewEvent(previewBrowserRuntime.consoleEvents, {
        type: "pageerror",
        text: error.message,
        location: null,
        at: new Date().toISOString()
      });
      pushPreviewDiagnostic(previewBrowserRuntime.consoleErrors, error.message);
    }
  });
  page.on("requestfailed", (request) => {
    if (previewBrowserRuntime?.page === page) {
      const failure = request.failure()?.errorText || "request failed";
      pushPreviewEvent(previewBrowserRuntime.networkEvents, {
        type: "requestfailed",
        url: request.url(),
        method: request.method(),
        status: 0,
        ok: false,
        error: failure,
        at: new Date().toISOString()
      });
      pushPreviewDiagnostic(previewBrowserRuntime.networkErrors, `${request.method()} ${request.url()} (${failure})`);
    }
  });
  page.on("response", (response) => {
    if (previewBrowserRuntime?.page !== page) return;
    const status = response.status();
    const entry = {
      type: "response",
      url: response.url(),
      method: response.request().method(),
      status,
      ok: status >= 200 && status < 400,
      error: status >= 400 ? `HTTP ${status}` : "",
      at: new Date().toISOString()
    };
    pushPreviewEvent(previewBrowserRuntime.networkEvents, entry);
    if (status >= 400) {
      pushPreviewDiagnostic(previewBrowserRuntime.networkErrors, `${entry.method} ${entry.url} (HTTP ${status})`);
    }
  });

  audit("preview.browser_open", { executablePath });
  return previewBrowserRuntime;
}

async function closePreviewBrowser(reason = "manual") {
  if (!previewBrowserRuntime?.browser) {
    return getPreviewBrowserStatus();
  }

  const runtime = previewBrowserRuntime;
  previewBrowserRuntime = null;
  await runtime.browser.close();
  audit("preview.browser_close", { reason, url: runtime.url });
  return getPreviewBrowserStatus();
}

function currentPreviewUrl(fallbackUrl = "") {
  if (fallbackUrl) return fallbackUrl;
  if (previewProjectRuntime?.url) return previewProjectRuntime.url;
  if (previewRuntime?.port) return `http://127.0.0.1:${previewRuntime.port}/`;
  if (previewBrowserRuntime?.url) return previewBrowserRuntime.url;
  return "";
}

async function connectPreviewBrowser(targetUrl = "") {
  const url = currentPreviewUrl(targetUrl);
  if (!url) {
    throw new Error("No preview URL is active. Start a project or static preview first.");
  }

  assertRemoteAllowed(url);
  const runtime = await ensurePreviewBrowser();
  runtime.consoleErrors = [];
  runtime.networkErrors = [];
  runtime.consoleEvents = [];
  runtime.networkEvents = [];
  await runtime.page.goto(url, { waitUntil: "domcontentloaded" });
  runtime.url = url;
  runtime.title = await runtime.page.title();
  audit("preview.browser_connect", { url });
  return { ...getPreviewBrowserStatus(), snapshot: await snapshotPreviewBrowser() };
}

async function snapshotPreviewBrowser() {
  const runtime = previewBrowserRuntime?.page ? previewBrowserRuntime : await connectPreviewBrowser();
  const title = await runtime.page.title();
  const text = await runtime.page.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    return bodyText.replace(/\s+\n/g, "\n").trim().slice(0, 5000);
  });
  runtime.title = title;
  return {
    url: runtime.url,
    title,
    text
  };
}

function normalizeScreenshotFileName(inputName) {
  const value = String(inputName || "").trim();
  if (!value) return "";
  const base = path.basename(value).replace(/[^A-Za-z0-9._-]/g, "-");
  if (!base) return "";
  return base.toLowerCase().endsWith(".png") ? base : `${base}.png`;
}

async function screenshotPreviewBrowser(payload = {}) {
  const runtime = previewBrowserRuntime?.page ? previewBrowserRuntime : await connectPreviewBrowser(payload.url || "");
  const screenshotDir = getUserDataPath(PREVIEW_SCREENSHOT_DIR);
  fs.mkdirSync(screenshotDir, { recursive: true });

  const requestedName = normalizeScreenshotFileName(payload.fileName || "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = requestedName || `preview-${stamp}.png`;
  const targetPath = path.join(screenshotDir, fileName);

  await runtime.page.screenshot({
    path: targetPath,
    fullPage: Boolean(payload.fullPage)
  });
  runtime.title = await runtime.page.title();
  audit("preview.browser_screenshot", {
    path: targetPath,
    url: runtime.url,
    fullPage: Boolean(payload.fullPage)
  });
  return {
    path: targetPath,
    url: runtime.url,
    title: runtime.title
  };
}

async function readPreviewDomSummary(runtime) {
  return await runtime.page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
      .map((node) => node.textContent?.trim() || "")
      .filter(Boolean)
      .slice(0, 12);
    const links = document.querySelectorAll("a[href]").length;
    const buttons = document.querySelectorAll("button").length;
    const inputs = document.querySelectorAll("input,textarea,select").length;
    const forms = document.querySelectorAll("form").length;
    const interactive = document.querySelectorAll("a[href],button,input,textarea,select,[role='button']").length;
    const textSample = (document.body?.innerText || "").replace(/\s+\n/g, "\n").trim().slice(0, 2000);
    return {
      url: location.href,
      title: document.title || "",
      headings,
      counts: {
        links,
        buttons,
        inputs,
        forms,
        interactive
      },
      textSample
    };
  });
}

async function getPreviewBrowserDiagnostics(payload = {}) {
  const runtime = previewBrowserRuntime?.page ? previewBrowserRuntime : await connectPreviewBrowser(payload.url || "");
  const limit = Math.min(Math.max(Number(payload.limit) || 60, 10), 200);
  const includeDom = payload.includeDom !== false;
  const domSummary = includeDom ? await readPreviewDomSummary(runtime) : null;
  runtime.title = await runtime.page.title();

  return {
    url: runtime.url,
    title: runtime.title,
    consoleEvents: (runtime.consoleEvents || []).slice(-limit),
    networkEvents: (runtime.networkEvents || []).slice(-limit),
    domSummary
  };
}

async function clickPreviewBrowser(payload = {}) {
  const runtime = previewBrowserRuntime?.page ? previewBrowserRuntime : await connectPreviewBrowser(payload.url || "");
  const selector = String(payload.selector || "").trim();
  if (!selector) throw new Error("A CSS selector is required for preview click.");
  await runtime.page.click(selector);
  runtime.title = await runtime.page.title();
  audit("preview.browser_click", { selector, url: runtime.url });
  return snapshotPreviewBrowser();
}

async function typePreviewBrowser(payload = {}) {
  const runtime = previewBrowserRuntime?.page ? previewBrowserRuntime : await connectPreviewBrowser(payload.url || "");
  const selector = String(payload.selector || "").trim();
  if (!selector) throw new Error("A CSS selector is required for preview type.");
  await runtime.page.fill(selector, String(payload.text || ""));
  runtime.title = await runtime.page.title();
  audit("preview.browser_type", { selector, url: runtime.url });
  return snapshotPreviewBrowser();
}

async function pressPreviewBrowser(payload = {}) {
  const runtime = previewBrowserRuntime?.page ? previewBrowserRuntime : await connectPreviewBrowser(payload.url || "");
  const key = String(payload.key || "").trim();
  if (!key) throw new Error("A key is required for preview press.");
  await runtime.page.keyboard.press(key);
  runtime.title = await runtime.page.title();
  audit("preview.browser_press", { key, url: runtime.url });
  return snapshotPreviewBrowser();
}

async function pickPreviewBrowserSelector(payload = {}) {
  const runtime = previewBrowserRuntime?.page ? previewBrowserRuntime : await connectPreviewBrowser(payload.url || "");
  const ratioX = Number(payload.ratioX);
  const ratioY = Number(payload.ratioY);
  if (!Number.isFinite(ratioX) || !Number.isFinite(ratioY)) {
    throw new Error("Selector picker requires ratioX and ratioY.");
  }
  if (ratioX < 0 || ratioX > 1 || ratioY < 0 || ratioY > 1) {
    throw new Error("Selector picker ratios must be between 0 and 1.");
  }

  const result = await runtime.page.evaluate(({ ratioX: xRatio, ratioY: yRatio }) => {
    function cssSelector(node) {
      if (!node || !(node instanceof Element)) return "";
      if (node.id) return `#${CSS.escape(node.id)}`;
      const segments = [];
      let current = node;
      while (current && current.nodeType === 1 && segments.length < 6) {
        const tag = current.tagName.toLowerCase();
        let segment = tag;
        if (current.classList?.length) {
          const classNames = Array.from(current.classList).filter(Boolean).slice(0, 2);
          if (classNames.length) {
            segment += `.${classNames.map((name) => CSS.escape(name)).join(".")}`;
          }
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            segment += `:nth-of-type(${index})`;
          }
        }
        segments.unshift(segment);
        if (tag === "body") break;
        current = parent;
      }
      return segments.join(" > ");
    }

    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0, 1);
    const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0, 1);
    const x = Math.max(0, Math.min(viewportWidth - 1, Math.round(viewportWidth * xRatio)));
    const y = Math.max(0, Math.min(viewportHeight - 1, Math.round(viewportHeight * yRatio)));
    const element = document.elementFromPoint(x, y);
    if (!element) {
      return { selector: "", tag: "", text: "", x, y, ratioX: xRatio, ratioY: yRatio };
    }
    const selector = cssSelector(element);
    return {
      selector,
      tag: element.tagName.toLowerCase(),
      text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140),
      x,
      y,
      ratioX: xRatio,
      ratioY: yRatio
    };
  }, { ratioX, ratioY });

  if (!result?.selector) {
    throw new Error("No element selector could be derived at that point.");
  }
  audit("preview.browser_pick_selector", {
    selector: result.selector,
    x: result.x,
    y: result.y,
    ratioX: result.ratioX,
    ratioY: result.ratioY,
    url: runtime.url
  });
  return result;
}

function getPreviewStatus() {
  const browser = getPreviewBrowserStatus();
  const isProject = Boolean(previewProjectRuntime);
  const isStatic = Boolean(previewRuntime);

  if (!isProject && !isStatic) {
    return {
      running: false,
      mode: "idle",
      url: "",
      port: 0,
      rootPath: "",
      entryFile: "",
      projectPath: "",
      projectCommand: "",
      terminalId: "",
      startedAt: "",
      lastDetectedUrl: "",
      inspection: inspectProject({}),
      browser
    };
  }

  return {
    running: true,
    mode: isProject ? "project" : "static",
    url: isProject ? previewProjectRuntime.url : `http://127.0.0.1:${previewRuntime.port}/`,
    port: isProject ? 0 : previewRuntime.port,
    rootPath: isProject ? previewProjectRuntime.rootPath : previewRuntime.rootPath,
    entryFile: isProject ? "" : previewRuntime.entryFile,
    projectPath: previewProjectRuntime?.rootPath || "",
    projectCommand: previewProjectRuntime?.command || "",
    terminalId: previewProjectRuntime?.terminalId || "",
    startedAt: isProject ? previewProjectRuntime.startedAt : previewRuntime.startedAt,
    lastDetectedUrl: previewProjectRuntime?.lastDetectedUrl || "",
    inspection: isProject ? previewProjectRuntime.inspection : previewRuntime.inspection,
    browser
  };
}

async function stopPreviewServer(reason = "manual") {
  if (!previewRuntime) {
    return { ok: true, ...getPreviewStatus() };
  }

  const runtime = previewRuntime;
  previewRuntime = null;

  if (runtime.reloadTimer) {
    clearTimeout(runtime.reloadTimer);
  }
  if (runtime.watcher) {
    try {
      runtime.watcher.close();
    } catch {
      // Ignore watcher close errors.
    }
  }
  for (const client of Array.from(runtime.clients || [])) {
    try {
      client.end();
    } catch {
      // Ignore socket close errors.
    }
  }

  await new Promise((resolve) => runtime.server.close(() => resolve()));
  audit("preview.stop", { reason, port: runtime.port, rootPath: runtime.rootPath });

  return { ok: true, ...getPreviewStatus() };
}

async function startPreviewServer(payload = {}) {
  const { rootPath, entryFile } = resolvePreviewTarget(payload.path || "", payload.entry || "index.html");
  const preferredPort = Number(payload.port) || PREVIEW_DEFAULT_PORT;

  if (previewProjectRuntime) {
    await stopPreviewProject("switch_to_static");
  }
  if (previewRuntime) {
    await stopPreviewServer("restart");
  }

  const runtimeState = {
    clients: new Set(),
    watcher: null,
    reloadTimer: null,
    server: null,
    port: 0,
    rootPath,
    entryFile,
    startedAt: "",
    inspection: inspectProject({ path: rootPath })
  };

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/__lumen_health") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (requestUrl.pathname === "/__lumen_events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive"
      });
      response.write("retry: 1000\n\n");
      runtimeState.clients.add(response);
      request.on("close", () => {
        runtimeState.clients.delete(response);
      });
      return;
    }

    const decodedPath = decodeURIComponent(requestUrl.pathname);
    const targetFile = resolvePreviewFile(rootPath, entryFile, decodedPath);
    if (!targetFile) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const contentType = contentTypeFor(targetFile);
    if (contentType.startsWith("text/html")) {
      try {
        const html = fs.readFileSync(targetFile, "utf8");
        response.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-store"
        });
        response.end(injectPreviewReloadClient(html));
      } catch {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Preview read error");
      }
      return;
    }

    response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    const stream = fs.createReadStream(targetFile);
    stream.on("error", () => {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Preview read error");
    });
    stream.pipe(response);
  });

  const port = await bindPreviewServer(server, preferredPort);
  runtimeState.server = server;
  runtimeState.port = port;
  runtimeState.watcher = watchPreviewRoot(rootPath, runtimeState);
  runtimeState.startedAt = new Date().toISOString();
  previewRuntime = runtimeState;

  audit("preview.start", { rootPath, entryFile, port });
  return getPreviewStatus();
}

function spawnPreviewProjectFallbackProcess(project, terminalRecord, terminalId) {
  const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
  const args =
    process.platform === "win32"
      ? [
          "-NoLogo",
          "-NoProfile",
          "-Command",
          `Set-Location -LiteralPath '${project.rootPath.replace(/'/g, "''")}'; ${project.command}`
        ]
      : ["-lc", `cd '${project.rootPath.replace(/'/g, "\\'")}'; ${project.command}`];

  const child = spawn(shell, args, {
    cwd: project.rootPath,
    env: process.env,
    windowsHide: true
  });

  const forward = (chunk) => {
    const text = chunk.toString();
    appendTerminalOutput(terminalRecord, text);
    emitTerminalData(terminalId, text);
  };

  child.stdout.on("data", forward);
  child.stderr.on("data", forward);
  child.on("close", (code) => {
    emitTerminalData(terminalId, `\r\n[preview process exited with code ${code ?? 0}]\r\n`);
  });

  audit("preview.project_fallback_spawn", {
    command: project.command,
    rootPath: project.rootPath,
    terminalId
  });
  return child;
}

async function stopPreviewProject(reason = "manual") {
  if (!previewProjectRuntime) {
    return { ok: true, ...getPreviewStatus() };
  }

  const runtime = previewProjectRuntime;
  previewProjectRuntime = null;
  if (runtime.process) {
    try {
      runtime.process.kill();
    } catch {
      // Ignore process stop failures.
    }
  }
  if (runtime.terminalId && terminals.has(runtime.terminalId)) {
    try {
      writeTerminal(runtime.terminalId, "\u0003");
    } catch {
      // Ignore terminal stop failures.
    }
  }
  audit("preview.project_stop", { reason, rootPath: runtime.rootPath, command: runtime.command });
  return { ok: true, ...getPreviewStatus() };
}

async function startPreviewProject(payload = {}) {
  const project = detectPreviewProject(payload);
  const terminalId = String(payload.terminalId || "").trim();
  if (!terminalId || !terminals.has(terminalId)) {
    throw new Error("Preview terminal is not available. Create a terminal first.");
  }

  await stopPreviewServer("switch_to_project");
  if (previewProjectRuntime) {
    await stopPreviewProject("restart");
  }

  const terminalRecord = terminals.get(terminalId);
  if (!terminalRecord) {
    throw new Error("Preview terminal closed before the project could start.");
  }
  terminalRecord.recentOutput = "";
  terminalRecord.recentUrls = [];

  writeTerminal(terminalId, `\u0003`);
  await sleep(200);
  writeTerminal(terminalId, `${project.command}\r`);
  let detachedProcess = null;
  let readiness = null;
  try {
    readiness = await waitForPreviewUrlInTerminal(terminalRecord, project.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    audit("preview.project_terminal_boot_failed", {
      command: project.command,
      rootPath: project.rootPath,
      terminalId,
      error: message
    });
    detachedProcess = spawnPreviewProjectFallbackProcess(project, terminalRecord, terminalId);
    try {
      readiness = await waitForPreviewUrlInTerminal(terminalRecord, project.url);
    } catch (fallbackError) {
      if (detachedProcess) {
        try {
          detachedProcess.kill();
        } catch {
          // Ignore fallback process kill errors.
        }
      }
      const staticRoot = String(project.inspection?.staticRoot || "");
      const entryFile = String(project.inspection?.entryFile || "index.html");
      if (staticRoot && fs.existsSync(path.join(staticRoot, entryFile))) {
        audit("preview.project_fallback_static", {
          rootPath: staticRoot,
          entryFile,
          command: project.command,
          terminalId
        });
        return await startPreviewServer({
          path: staticRoot,
          entry: entryFile,
          port: Number(payload?.port) || PREVIEW_DEFAULT_PORT
        });
      }
      throw fallbackError;
    }
  }

  previewProjectRuntime = {
    ...project,
    url: readiness.url,
    terminalId,
    startedAt: new Date().toISOString(),
    lastDetectedUrl: readiness.detectedUrl || readiness.url,
    process: detachedProcess
  };
  audit("preview.project_start", {
    rootPath: project.rootPath,
    command: project.command,
    url: readiness.url,
    terminalId
  });
  return getPreviewStatus();
}

async function stopPreview(reason = "manual") {
  await stopPreviewServer(reason);
  await stopPreviewProject(reason);
  await closePreviewBrowser(reason);
  return { ok: true, ...getPreviewStatus() };
}

function isLocalUrl(baseUrl) {
  const value = String(baseUrl || "").trim();
  if (!value) return false;
  const candidate = /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const parsed = new URL(candidate);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.replace(/^\[|\]$/g, ""));
  } catch {
    return /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/|$)/i.test(value);
  }
}

function assertRemoteAllowed(baseUrl) {
  if (isLocalUrl(baseUrl)) return;
  const settings = loadSettings();
  if (!settings.onlineMode) {
    throw new Error("Online mode is disabled. Enable it in Settings first.");
  }
}

function isReadOnlyCommand(command) {
  const normalized = String(command || "").trim().toLowerCase();
  if (!normalized) return true;
  const allowlist = [
    /^dir$/,
    /^ls(\s|$)/,
    /^pwd$/,
    /^git\s+status(\s|$)/,
    /^git\s+diff(\s|$)/,
    /^git\s+log(\s|$)/,
    /^cat(\s|$)/,
    /^type(\s|$)/,
    /^rg(\s|$)/,
    /^findstr(\s|$)/,
    /^echo(\s|$)/,
    /^whoami$/,
    /^get-childitem(\s|$)/i,
    /^get-content(\s|$)/i
  ];
  return allowlist.some((pattern) => pattern.test(normalized));
}

const policyManager = createPolicyManager({
  loadSettings,
  saveSettings,
  audit,
  agentRuntimeState,
  policyPresets: POLICY_PRESETS,
  defaultPreset: DEFAULT_SETTINGS.permissionPreset,
  isReadOnlyCommand
});

const runtimeManager = createRuntimeManager({
  loadSettings,
  saveSettings,
  audit,
  syncWorkspaceWatcher,
  scheduleWorkspaceIndex,
  getManagedRuntime: () => managedRuntime,
  getPreviewState: () => ({
    staticRuntime: previewRuntime,
    projectRuntime: previewProjectRuntime,
    browserRuntime: previewBrowserRuntime
  }),
  getWorkspaceWatcherState: () => workspaceWatcherState,
  getWorkspaceIndexState: () => workspaceIndexState
});

function normalizePolicyPreset(value) {
  return policyManager.normalizePolicyPreset(value);
}

function riskForActionType(actionType, command = "") {
  return policyManager.riskForActionType(actionType, command);
}

function evaluatePolicyDecision(payload = {}) {
  return policyManager.evaluatePolicyDecision(payload);
}

function enforceAgentPolicy(payload, actionType, command = "") {
  return policyManager.enforceAgentPolicy(payload, actionType, command);
}

function getPolicyState() {
  return policyManager.getPolicyState();
}

function setPolicyPreset(nextPreset) {
  return policyManager.setPolicyPreset(nextPreset);
}

function getRuntimeHealth() {
  return runtimeManager.getRuntimeHealth();
}

function setLowResourceMode(enabled) {
  return runtimeManager.setLowResourceMode(enabled);
}

function buildLlmHeaders(config) {
  return {
    "Content-Type": "application/json",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
  };
}

function normalizeModelName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeModelFamily(value) {
  return normalizeModelName(value).split(":")[0];
}

function isModelNotFoundError(status, text) {
  if (status !== 404) return false;
  const normalized = String(text || "").toLowerCase();
  return normalized.includes("model") && normalized.includes("not found");
}

function formatModelList(models) {
  if (!models.length) return "(none)";
  const preview = models.slice(0, 8).join(", ");
  return models.length > 8 ? `${preview} ...` : preview;
}

function pickInstalledModel(requestedModel, availableModels) {
  if (!availableModels.length) return "";

  const requestedExact = normalizeModelName(requestedModel);
  const requestedFamily = normalizeModelFamily(requestedModel);

  const exact = availableModels.find((model) => normalizeModelName(model) === requestedExact);
  if (exact) return exact;

  const family = availableModels.find((model) => normalizeModelFamily(model) === requestedFamily);
  if (family) return family;

  if (requestedFamily) {
    const containsRequestedFamily = availableModels.find((model) => normalizeModelName(model).includes(requestedFamily));
    if (containsRequestedFamily) return containsRequestedFamily;
  }

  if (requestedFamily.includes("qwen2.5-coder")) {
    const qwenCandidate = availableModels.find((model) => normalizeModelName(model).includes("qwen2.5-coder"));
    if (qwenCandidate) return qwenCandidate;
  }

  return availableModels[0];
}

function getBundledRuntimePath(...segments) {
  const devCandidate = path.join(__dirname, "runtime", ...segments);
  if (fs.existsSync(devCandidate)) return devCandidate;

  const unpackedCandidate = path.join(process.resourcesPath || "", "app.asar.unpacked", "electron", "runtime", ...segments);
  if (fs.existsSync(unpackedCandidate)) return unpackedCandidate;

  return "";
}

function getBundledOllamaExecutablePath() {
  if (process.platform === "win32") {
    return getBundledRuntimePath("ollama", "ollama.exe");
  }
  return getBundledRuntimePath("ollama", "ollama");
}

function getBundledModelSeedPath() {
  return getBundledRuntimePath("ollama-models");
}

function getManagedModelsTargetPath() {
  return getUserDataPath(MANAGED_MODELS_DIR);
}

function hasManifest(modelsRoot) {
  if (!modelsRoot) return false;
  return fs.existsSync(path.join(modelsRoot, MODEL_MANIFEST_RELATIVE));
}

function ensureWritableManagedModelsPath() {
  const target = getManagedModelsTargetPath();
  if (hasManifest(target)) return target;

  const source = getBundledModelSeedPath();
  if (!source || !hasManifest(source)) return "";

  fs.mkdirSync(path.dirname(target), { recursive: true });
  audit("runtime.seed_models.start", { source, target });
  try {
    fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
    audit("runtime.seed_models.complete", { target });
    return target;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model seed copy failed.";
    audit("runtime.seed_models.error", { source, target, error: message });
    throw new Error(`Integrated model seed failed: ${message}`);
  }
}

function resolveManagedOllamaExecutable() {
  const bundled = getBundledOllamaExecutablePath();
  return bundled || "ollama";
}

function resolveManagedModelsPath() {
  if (process.env.OLLAMA_MODELS && hasManifest(process.env.OLLAMA_MODELS)) {
    return process.env.OLLAMA_MODELS;
  }

  const bundled = getBundledModelSeedPath();
  if (bundled && hasManifest(bundled)) return bundled;

  const existing = getManagedModelsTargetPath();
  if (hasManifest(existing)) return existing;
  return "";
}

function shouldManageRuntime(config) {
  const settings = loadSettings();
  if (!settings.autoManageLocalRuntime) return false;
  const baseUrl = String(config?.baseUrl || "").replace(/\/$/, "");
  if (!isLocalUrl(baseUrl)) return false;
  if (String(config?.provider || "").toLowerCase() === "ollama") return true;
  return /localhost:11434|127\.0\.0\.1:11434|\[::1\]:11434/i.test(baseUrl);
}

async function isRuntimeReachable(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/models`, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

function clearRuntimeIdleTimer() {
  if (runtimeIdleTimer) {
    clearTimeout(runtimeIdleTimer);
    runtimeIdleTimer = null;
  }
}

function stopManagedRuntime(reason = "manual") {
  clearRuntimeIdleTimer();
  if (!managedRuntime?.process || managedRuntime.process.killed) {
    managedRuntime = null;
    return;
  }
  try {
    managedRuntime.process.kill();
  } catch {
    // Ignore kill errors.
  }
  audit("runtime.stop", { reason, runtime: managedRuntime.name });
  managedRuntime = null;
}

function scheduleManagedRuntimeStop() {
  clearRuntimeIdleTimer();
  if (!managedRuntime) return;

  const settings = loadSettings();
  const minutes = Math.max(1, Number(settings.autoStopMinutes) || 10);
  runtimeIdleTimer = setTimeout(() => {
    const idleForMs = Date.now() - lastRuntimeActivityAt;
    if (idleForMs >= minutes * 60 * 1000) {
      stopManagedRuntime("idle_timeout");
    } else {
      scheduleManagedRuntimeStop();
    }
  }, minutes * 60 * 1000);
}

function markRuntimeActivity() {
  if (!managedRuntime) return;
  lastRuntimeActivityAt = Date.now();
  scheduleManagedRuntimeStop();
}

async function startManagedOllama() {
  if (managedRuntime?.process && !managedRuntime.process.killed) return true;

  try {
    const executable = resolveManagedOllamaExecutable();
    const modelsPath = resolveManagedModelsPath();
    const runtimeEnv = {
      ...process.env,
      ...(modelsPath ? { OLLAMA_MODELS: modelsPath } : {})
    };

    const child = spawn(executable, ["serve"], {
      env: runtimeEnv,
      windowsHide: true,
      stdio: "ignore"
    });

    managedRuntime = {
      name: "ollama",
      process: child,
      executable,
      modelsPath
    };
    lastRuntimeActivityAt = Date.now();
    scheduleManagedRuntimeStop();
    audit("runtime.start", { runtime: "ollama", mode: "background_hidden", executable, modelsPath });

    child.on("exit", () => {
      managedRuntime = null;
      clearRuntimeIdleTimer();
    });
    child.on("error", (error) => {
      audit("runtime.error", { runtime: "ollama", error: error?.message || "unknown" });
    });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start Ollama runtime.";
    audit("runtime.error", { runtime: "ollama", error: message });
    throw new Error(`Integrated runtime start failed: ${message}`);
  }
}

async function ensureManagedRuntime(config) {
  if (!shouldManageRuntime(config)) return;
  const baseUrl = String(config.baseUrl || "").replace(/\/$/, "");

  const alreadyReachable = await isRuntimeReachable(baseUrl);
  if (alreadyReachable) return;

  await startManagedOllama();
  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isRuntimeReachable(baseUrl)) {
      markRuntimeActivity();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Integrated runtime did not become ready in time.");
}

async function fetchAvailableModels(baseUrl, config) {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => null);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data
      .map((item) => (typeof item?.id === "string" ? item.id.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function postChatCompletions(baseUrl, config, body, signal) {
  return await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: buildLlmHeaders(config),
    body: JSON.stringify(body)
  });
}

async function resolveMissingModel(baseUrl, config) {
  const availableModels = await fetchAvailableModels(baseUrl, config);
  if (!availableModels.length) {
    return {
      requestedModel: config.model,
      resolvedModel: "",
      availableModels,
      reason:
        "No local models are installed. Open Settings -> enable Online mode -> click Install Selected Model, then test again."
    };
  }

  const resolvedModel = pickInstalledModel(config.model, availableModels);
  const changed = normalizeModelName(resolvedModel) !== normalizeModelName(config.model);

  return {
    requestedModel: config.model,
    resolvedModel,
    availableModels,
    reason: changed
      ? `Configured model "${config.model}" not found. Auto-switched to installed model "${resolvedModel}".`
      : `Configured model "${config.model}" not found. Available models: ${formatModelList(availableModels)}`
  };
}

async function testLlmConnection(config) {
  const baseUrl = (config.baseUrl || "").replace(/\/$/, "");
  assertRemoteAllowed(baseUrl);
  await ensureManagedRuntime(config);
  markRuntimeActivity();

  let modelUsed = config.model;
  let note = "";

  let response = await postChatCompletions(baseUrl, config, {
    model: modelUsed,
    messages: [{ role: "user", content: "Reply with: pong" }],
    stream: false,
    max_tokens: 8,
    temperature: 0
  });

  if (!response.ok) {
    const text = await response.text();
    if (isModelNotFoundError(response.status, text)) {
      const resolved = await resolveMissingModel(baseUrl, config);
      if (!resolved.resolvedModel) {
        throw new Error(resolved.reason);
      }
      if (normalizeModelName(resolved.resolvedModel) === normalizeModelName(config.model)) {
        throw new Error(resolved.reason);
      }
      modelUsed = resolved.resolvedModel;
      note = resolved.reason;
      audit("llm.model_resolved", {
        baseUrl,
        requestedModel: config.model,
        resolvedModel: modelUsed,
        availableModels: resolved.availableModels
      });
      response = await postChatCompletions(baseUrl, config, {
        model: modelUsed,
        messages: [{ role: "user", content: "Reply with: pong" }],
        stream: false,
        max_tokens: 8,
        temperature: 0
      });
    } else {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 280)}`);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 280)}`);
  }

  const payload = await response.json();
  audit("llm.test", { baseUrl, requestedModel: config.model, modelUsed, ok: true });
  return {
    ok: true,
    reply: payload?.choices?.[0]?.message?.content || "",
    modelUsed,
    note
  };
}

async function openLlmStreamResponse(baseUrl, config, messages, signal) {
  let modelUsed = config.model;
  let response = await postChatCompletions(
    baseUrl,
    config,
    {
      model: config.model,
      messages,
      stream: true,
      temperature: config.temperature ?? 0.2
    },
    signal
  );

  if ((!response.ok || !response.body) && response.status) {
    const text = await response.text();
    if (isModelNotFoundError(response.status, text)) {
      const resolved = await resolveMissingModel(baseUrl, config);
      if (!resolved.resolvedModel) {
        throw new Error(resolved.reason);
      }
      if (normalizeModelName(resolved.resolvedModel) === normalizeModelName(config.model)) {
        throw new Error(resolved.reason);
      }
      modelUsed = resolved.resolvedModel;
      audit("llm.model_resolved", {
        baseUrl,
        requestedModel: config.model,
        resolvedModel: modelUsed,
        availableModels: resolved.availableModels
      });
      response = await postChatCompletions(
        baseUrl,
        config,
        {
          model: modelUsed,
          messages,
          stream: true,
          temperature: config.temperature ?? 0.2
        },
        signal
      );
      if (!response.ok || !response.body) {
        const secondText = await response.text();
        throw new Error(`HTTP ${response.status}: ${secondText.slice(0, 280)}`);
      }
      return { response, modelUsed, note: resolved.reason };
    }
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 280)}`);
  }

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 280)}`);
  }

  return { response, modelUsed, note: "" };
}

async function listLlmModels(config) {
  const baseUrl = (config.baseUrl || "").replace(/\/$/, "");
  assertRemoteAllowed(baseUrl);
  await ensureManagedRuntime(config);
  markRuntimeActivity();
  const models = await fetchAvailableModels(baseUrl, config);
  audit("llm.models.list", { baseUrl, count: models.length });
  return { models };
}

async function installLlmModel(config) {
  const baseUrl = (config.baseUrl || "").replace(/\/$/, "");
  assertRemoteAllowed(baseUrl);
  if (!isLocalUrl(baseUrl)) {
    throw new Error("Model installation is supported only for local Ollama endpoints.");
  }
  const provider = String(config.provider || "").toLowerCase();
  const isOllamaEndpoint = /localhost:11434|127\.0\.0\.1:11434|\[::1\]:11434/i.test(baseUrl);
  if (provider !== "ollama" && !isOllamaEndpoint) {
    throw new Error("Install Selected Model works only with the Ollama preset/endpoint.");
  }

  const settings = loadSettings();
  if (!settings.onlineMode) {
    throw new Error("Online mode must be enabled to install models.");
  }

  const model = String(config.model || "").trim();
  if (!model) {
    throw new Error("Select a model name first.");
  }

  await ensureManagedRuntime({ ...config, provider: "ollama" });
  markRuntimeActivity();
  audit("llm.install.start", { model, baseUrl });

  return await new Promise((resolve, reject) => {
    const executable = resolveManagedOllamaExecutable();
    const modelsPath = ensureWritableManagedModelsPath();
    const installEnv = {
      ...process.env,
      ...(modelsPath ? { OLLAMA_MODELS: modelsPath } : {})
    };
    const child = spawn(executable, ["pull", model], {
      env: installEnv,
      windowsHide: true
    });

    let output = "";
    const appendOutput = (chunk) => {
      output += chunk.toString();
      if (output.length > 24000) {
        output = output.slice(-24000);
      }
    };

    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);

    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : "Unknown installation error";
      audit("llm.install.error", { model, error: message });
      reject(new Error(`Model install failed: ${message}`));
    });

    child.on("close", (code) => {
      markRuntimeActivity();
      if (code === 0) {
        const cleaned = output.replace(/\u001b\[[0-9;]*m/g, "").trim().slice(-2000);
        audit("llm.install.complete", { model, ok: true });
        resolve({ ok: true, model, output: cleaned });
        return;
      }
      const cleaned = output.replace(/\u001b\[[0-9;]*m/g, "").trim().slice(-2000);
      audit("llm.install.error", { model, code, output: cleaned });
      reject(new Error(cleaned || `Model install failed with exit code ${code}`));
    });
  });
}

async function startLlmStream(event, payload) {
  const { requestId, config, messages } = payload;
  const baseUrl = (config.baseUrl || "").replace(/\/$/, "");
  assertRemoteAllowed(baseUrl);
  await ensureManagedRuntime(config);
  markRuntimeActivity();

  const controller = new AbortController();
  llmStreams.set(requestId, controller);

  try {
    const { response, modelUsed, note } = await openLlmStreamResponse(baseUrl, config, messages, controller.signal);
    if (note) {
      event.sender.send("llm:status", { requestId, message: note, modelUsed });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      markRuntimeActivity();
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const packet = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        packet
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .forEach((line) => {
            const payloadText = line.slice(5).trim();
            if (!payloadText || payloadText === "[DONE]") return;
            try {
              const chunk = JSON.parse(payloadText);
              const delta = chunk?.choices?.[0]?.delta?.content;
              if (delta) {
                event.sender.send("llm:chunk", { requestId, delta });
              }
            } catch {
              // Ignore malformed chunks.
            }
          });

        boundary = buffer.indexOf("\n\n");
      }
    }

    event.sender.send("llm:done", { requestId });
    markRuntimeActivity();
    audit("llm.stream.complete", { requestId, requestedModel: config.model, modelUsed, baseUrl });
  } catch (error) {
    event.sender.send("llm:error", {
      requestId,
      error: error instanceof Error ? error.message : "Unknown stream error"
    });
    audit("llm.stream.error", {
      requestId,
      model: config.model,
      baseUrl,
      error: error instanceof Error ? error.message : "Unknown stream error"
    });
  } finally {
    llmStreams.delete(requestId);
  }
}

function stopLlmStream(requestId) {
  const controller = llmStreams.get(requestId);
  if (controller) {
    controller.abort();
    llmStreams.delete(requestId);
  }
  return { ok: true };
}

function emitTerminalData(id, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("terminal:data", { id, data });
  }
}

const terminalManager = createTerminalManager({
  pty,
  spawn,
  randomUUID,
  getWorkspaceRoot: () => workspaceRoot,
  emitTerminalData,
  onTerminalExit: (id, exitCode) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal:exit", { id, exitCode });
    }
  },
  appendTerminalOutput,
  loadSettings,
  evaluatePolicyDecision,
  audit,
  agentRuntimeState
});

const terminals = terminalManager.terminals;

function createTerminal(payload = {}) {
  return terminalManager.createTerminal(payload);
}

function listTerminals() {
  return terminalManager.listTerminals();
}

function writeTerminal(id, data) {
  return terminalManager.writeTerminal(id, data);
}

function resizeTerminal(id, cols, rows) {
  return terminalManager.resizeTerminal(id, cols, rows);
}

function killTerminal(id) {
  return terminalManager.killTerminal(id);
}

async function runCommand(command, options = {}) {
  return terminalManager.runCommand(command, options);
}

async function getGit() {
  const git = simpleGit({ baseDir: workspaceRoot, binary: "git" });
  const isRepo = await git.checkIsRepo();
  return { git, isRepo };
}

async function gitStatus() {
  const { git, isRepo } = await getGit();
  if (!isRepo) return { isRepo: false, files: [], branch: "" };
  const status = await git.status();
  const files = status.files.map((file) => ({
    path: file.path,
    index: file.index,
    workingDir: file.working_dir
  }));
  audit("git.status", { files: files.length, branch: status.current });
  return { isRepo: true, files, branch: status.current };
}

async function gitDiff(filePath, staged = false) {
  const { git, isRepo } = await getGit();
  if (!isRepo) return { isRepo: false, diff: "" };
  const args = staged ? ["--staged"] : [];
  if (filePath) args.push("--", filePath);
  const diff = await git.diff(args);
  audit("git.diff", { filePath, staged, bytes: diff.length });
  return { isRepo: true, diff };
}

async function gitStage(paths) {
  const { git, isRepo } = await getGit();
  if (!isRepo) throw new Error("Not a git repository.");
  await git.add(paths);
  audit("git.stage", { paths });
  return { ok: true };
}

async function gitUnstage(paths) {
  const { git, isRepo } = await getGit();
  if (!isRepo) throw new Error("Not a git repository.");
  await git.reset(["HEAD", "--", ...paths]);
  audit("git.unstage", { paths });
  return { ok: true };
}

function enforceGitPolicy(actionType, options = {}) {
  const decision = evaluatePolicyDecision({
    actionType,
    preset: options?.preset || ""
  });
  audit("policy.decision", {
    actionType,
    allowed: decision.allowed,
    requiresApproval: decision.requiresApproval,
    risk: decision.risk,
    preset: decision.preset,
    source: "git"
  });
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
  if (decision.requiresApproval && !options.approved) {
    throw new Error(`${actionType} requires explicit approval by policy.`);
  }
}

async function gitCommit(message, options = {}) {
  enforceGitPolicy("git_commit", options);
  const { git, isRepo } = await getGit();
  if (!isRepo) throw new Error("Not a git repository.");
  const result = await git.commit(message);
  audit("git.commit", { message, hash: result.commit });
  return { ok: true, hash: result.commit };
}

async function gitPush(options = {}) {
  enforceGitPolicy("git_push", options);
  const settings = loadSettings();
  if (!settings.onlineMode) {
    throw new Error("Online mode is disabled. Enable it before pushing.");
  }
  const { git, isRepo } = await getGit();
  if (!isRepo) throw new Error("Not a git repository.");
  await git.push();
  audit("git.push", { ok: true });
  return { ok: true };
}

async function gitMerge(payload = {}) {
  const branch = String(payload.branch || "").trim();
  if (!branch) throw new Error("Merge target branch is required.");
  enforceGitPolicy("git_merge", payload);

  const { git, isRepo } = await getGit();
  if (!isRepo) throw new Error("Not a git repository.");
  const result = await git.merge([branch]);
  audit("git.merge", {
    branch,
    summary: result?.summary || null
  });
  return {
    ok: true,
    branch,
    summary: result?.summary || null
  };
}

async function gitRebase(payload = {}) {
  const upstream = String(payload.upstream || "").trim();
  if (!upstream) throw new Error("Rebase upstream branch is required.");
  enforceGitPolicy("git_rebase", payload);

  const { git, isRepo } = await getGit();
  if (!isRepo) throw new Error("Not a git repository.");
  const output = await git.raw(["rebase", upstream]);
  audit("git.rebase", { upstream });
  return {
    ok: true,
    upstream,
    output: String(output || "").slice(-4000)
  };
}

async function gitCherryPick(payload = {}) {
  const commit = String(payload.commit || "").trim();
  if (!commit) throw new Error("Cherry-pick commit hash is required.");
  enforceGitPolicy("git_cherry_pick", payload);

  const { git, isRepo } = await getGit();
  if (!isRepo) throw new Error("Not a git repository.");
  const output = await git.raw(["cherry-pick", commit]);
  audit("git.cherry_pick", { commit });
  return {
    ok: true,
    commit,
    output: String(output || "").slice(-4000)
  };
}

async function gitBranches() {
  const { git, isRepo } = await getGit();
  if (!isRepo) return { isRepo: false, current: "", branches: [] };

  const local = await git.branchLocal();
  const remoteRaw = await git.raw(["branch", "-r"]);
  const remote = remoteRaw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\*\s*/, ""))
    .filter((line) => line && !line.includes("->"));

  const branches = [
    ...local.all.map((name) => ({
      name,
      current: name === local.current,
      remote: false
    })),
    ...remote
      .filter((name) => !local.all.includes(name))
      .map((name) => ({
        name,
        current: false,
        remote: true
      }))
  ];

  audit("git.branches", { current: local.current, count: branches.length });
  return {
    isRepo: true,
    current: local.current,
    branches
  };
}

async function gitCheckoutBranch(payload = {}) {
  const name = String(payload.name || "").trim();
  if (!name) throw new Error("Branch name is required.");

  const { git, isRepo } = await getGit();
  if (!isRepo) throw new Error("Not a git repository.");

  if (payload.create) {
    await git.checkoutLocalBranch(name);
  } else {
    await git.checkout(name);
  }
  audit("git.checkout", { name, create: Boolean(payload.create) });
  return { ok: true, current: name };
}

async function gitHistory(limit = 25) {
  const { git, isRepo } = await getGit();
  if (!isRepo) return { isRepo: false, commits: [] };

  const maxCount = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const log = await git.log({ maxCount });
  const commits = log.all.map((item) => ({
    hash: item.hash,
    shortHash: item.hash.slice(0, 8),
    message: item.message,
    author: item.author_name,
    date: item.date
  }));
  audit("git.history", { count: commits.length });
  return { isRepo: true, commits };
}

async function gitRestore(paths = [], options = {}) {
  const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
  if (!list.length) throw new Error("At least one file path is required for restore.");

  const { git, isRepo } = await getGit();
  if (!isRepo) throw new Error("Not a git repository.");

  const restoreWorking = options?.workingTree !== false;
  const restoreStaged = Boolean(options?.staged);
  if (!restoreWorking && !restoreStaged) {
    throw new Error("Restore requires staged or workingTree target.");
  }

  if (restoreStaged) {
    await git.reset(["HEAD", "--", ...list]);
  }
  if (restoreWorking) {
    await git.checkout(["--", ...list]);
  }
  audit("git.restore", { paths: list, staged: restoreStaged, workingTree: restoreWorking });
  return { ok: true };
}

async function gitConflicts() {
  const { git, isRepo } = await getGit();
  if (!isRepo) return { isRepo: false, hasConflicts: false, files: [], hints: [] };

  const status = await git.status();
  const conflictSet = new Set(status.conflicted || []);
  for (const file of status.files) {
    if (String(file.index || "").includes("U") || String(file.working_dir || "").includes("U")) {
      conflictSet.add(file.path);
    }
  }
  const files = Array.from(conflictSet);
  const hints = files.length
    ? [
        "Open conflicted files and resolve markers.",
        "Use Use Ours / Use Theirs for quick resolution.",
        "Stage resolved files and commit."
      ]
    : [];
  audit("git.conflicts", { files: files.length });
  return { isRepo: true, hasConflicts: files.length > 0, files, hints };
}

async function gitResolveConflict(payload = {}) {
  const filePath = String(payload.path || "").trim();
  const strategy = String(payload.strategy || "").trim().toLowerCase();
  if (!filePath) throw new Error("Conflict path is required.");
  if (!["ours", "theirs"].includes(strategy)) {
    throw new Error("Conflict strategy must be 'ours' or 'theirs'.");
  }

  const { git, isRepo } = await getGit();
  if (!isRepo) throw new Error("Not a git repository.");

  await git.raw(["checkout", `--${strategy}`, "--", filePath]);
  await git.add([filePath]);
  audit("git.resolve_conflict", { path: filePath, strategy });
  return { ok: true, path: filePath, strategy };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1640,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    title: "Lumen IDE",
    icon: path.join(__dirname, "assets", "logo.png"),
    backgroundColor: "#0c1017",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(APP_ROOT, "dist", "index.html"));
  }

  mainWindow.on("focus", () => {
    workspaceWindowActive = true;
    syncWorkspaceWatcher("window_focus");
  });

  mainWindow.on("blur", () => {
    workspaceWindowActive = false;
    syncWorkspaceWatcher("window_blur");
  });
}

registerIpcHandlers({
  ipcMain,
  dialog,
  fs,
  path,
  getWorkspaceRoot: () => workspaceRoot,
  setWorkspaceRoot: (nextRoot) => {
    workspaceRoot = nextRoot;
  },
  saveWorkspaceRoot,
  stopPreview,
  syncWorkspaceWatcher,
  scheduleWorkspaceIndex,
  audit,
  terminals,
  killTerminal,
  listDir,
  readFile,
  writeFile,
  createFile,
  createDirectory,
  renamePath,
  deletePath,
  searchFiles,
  inspectProject,
  createTerminal,
  listTerminals,
  writeTerminal,
  resizeTerminal,
  loadSettings,
  saveSettings,
  getPolicyState,
  setPolicyPreset,
  evaluatePolicyDecision,
  agentRuntimeState,
  testLlmConnection,
  listLlmModels,
  installLlmModel,
  startLlmStream,
  stopLlmStream,
  runCommand,
  getPreviewStatus,
  enforceAgentPolicy,
  startPreviewServer,
  startPreviewProject,
  connectPreviewBrowser,
  snapshotPreviewBrowser,
  getPreviewBrowserDiagnostics,
  screenshotPreviewBrowser,
  clickPreviewBrowser,
  typePreviewBrowser,
  pressPreviewBrowser,
  pickPreviewBrowserSelector,
  closePreviewBrowser,
  setLowResourceMode,
  getRuntimeHealth,
  gitStatus,
  gitDiff,
  gitStage,
  gitUnstage,
  gitCommit,
  gitPush,
  gitMerge,
  gitRebase,
  gitCherryPick,
  gitBranches,
  gitCheckoutBranch,
  gitHistory,
  gitRestore,
  gitConflicts,
  gitResolveConflict,
  loadAudit,
  getUserDataPath,
  AUDIT_FILE
});

app.whenReady().then(async () => {
  loadWorkspaceRoot();
  syncWorkspaceWatcher("app_ready");
  scheduleWorkspaceIndex("app_ready");
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  void stopPreview("app_exit");
  stopWorkspaceWatcher("app_exit");
  if (workspaceIndexTimer) {
    clearTimeout(workspaceIndexTimer);
    workspaceIndexTimer = null;
  }
  for (const terminalId of Array.from(terminals.keys())) {
    killTerminal(terminalId);
  }
  for (const controller of llmStreams.values()) {
    controller.abort();
  }
  stopManagedRuntime("app_exit");
  if (process.platform !== "darwin") {
    app.quit();
  }
});
