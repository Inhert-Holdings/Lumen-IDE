const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require("electron");
const pty = require("node-pty");
const simpleGit = require("simple-git");

const APP_ROOT = path.resolve(__dirname, "..");
const SETTINGS_FILE = "lumen-settings.json";
const WORKSPACE_FILE = "lumen-workspace.json";
const AUDIT_FILE = "lumen-audit.jsonl";
const MANAGED_MODELS_DIR = "ollama-models";
const MODEL_MANIFEST_RELATIVE = path.join("manifests", "registry.ollama.ai", "library", "qwen2.5-coder", "7b");
const MAX_TREE_ENTRIES = 6000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PREVIEW_DEFAULT_PORT = 4173;
const PREVIEW_MAX_PORT_ATTEMPTS = 25;
const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", "release", ".idea", ".vscode"]);

const DEFAULT_SETTINGS = {
  provider: "ollama",
  baseUrl: "http://localhost:11434/v1",
  model: "qwen2.5-coder:7b",
  onlineMode: false,
  compactMode: true,
  recentModels: ["Qwen2.5-Coder-7B-Instruct", "qwen2.5-coder:7b"],
  apiKey: "",
  autoManageLocalRuntime: true,
  autoStopMinutes: 10
};

let workspaceRoot = APP_ROOT;
let mainWindow;
let terminalCounter = 0;
const terminals = new Map();
const llmStreams = new Map();
let managedRuntime = null;
let runtimeIdleTimer = null;
let lastRuntimeActivityAt = 0;
let previewRuntime = null;

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
    apiKey: decryptSecret(stored.apiKeyEnc || "")
  };
}

function saveSettings(input) {
  const settingsPath = getUserDataPath(SETTINGS_FILE);
  const next = {
    ...DEFAULT_SETTINGS,
    ...input,
    autoStopMinutes: Math.max(1, Number(input.autoStopMinutes) || DEFAULT_SETTINGS.autoStopMinutes),
    recentModels: Array.from(new Set([input.model, ...(input.recentModels || [])].filter(Boolean))).slice(0, 10)
  };
  const persisted = {
    ...next,
    apiKey: undefined,
    apiKeyEnc: encryptSecret(next.apiKey || "")
  };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(persisted, null, 2), "utf8");
  if (!next.autoManageLocalRuntime) {
    stopManagedRuntime("auto_runtime_disabled");
  } else {
    scheduleManagedRuntimeStop();
  }
  audit("settings.save", { provider: next.provider, baseUrl: next.baseUrl, model: next.model, onlineMode: next.onlineMode });
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

function listDirectoryTree(basePath, maxDepth = 5) {
  const counter = { value: 0 };

  function walk(currentPath, depth) {
    const name = path.basename(currentPath);
    if (counter.value >= MAX_TREE_ENTRIES) {
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
        if (counter.value >= MAX_TREE_ENTRIES) {
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
  const results = [];
  const needle = query.toLowerCase();

  function walk(currentPath, depth = 0) {
    if (results.length >= maxResults || depth > 8) return;

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
          if (results.length >= maxResults) return;
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
          if (results.length >= maxResults) return;
        } catch {
          // Skip binary/unreadable files.
        }
      }
    }
  }

  if (!query) return [];
  walk(workspaceRoot);
  audit("files.search", { query, count: results.length });
  return results;
}

function listDir(targetPath) {
  const basePath = targetPath ? safeResolve(targetPath) : workspaceRoot;
  audit("files.list", { basePath });
  return {
    root: workspaceRoot,
    tree: listDirectoryTree(basePath)
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

function writeFile(filePath, content) {
  const target = safeResolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  audit("files.write", { path: target, bytes: content.length });
  return { ok: true };
}

function createFile(filePath) {
  const target = safeResolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.writeFileSync(target, "", "utf8");
  audit("files.create", { path: target });
  return { ok: true };
}

function createDirectory(dirPath) {
  const target = safeResolve(dirPath);
  fs.mkdirSync(target, { recursive: true });
  audit("files.mkdir", { path: target });
  return { ok: true };
}

function renamePath(sourcePath, destinationPath) {
  const source = safeResolve(sourcePath);
  const destination = safeResolve(destinationPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(source, destination);
  audit("files.rename", { source, destination });
  return { ok: true };
}

function deletePath(targetPath) {
  const target = safeResolve(targetPath);
  fs.rmSync(target, { recursive: true, force: true });
  audit("files.delete", { path: target });
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

function getPreviewStatus() {
  if (!previewRuntime) {
    return {
      running: false,
      url: "",
      port: 0,
      rootPath: "",
      entryFile: ""
    };
  }

  return {
    running: true,
    url: `http://127.0.0.1:${previewRuntime.port}/`,
    port: previewRuntime.port,
    rootPath: previewRuntime.rootPath,
    entryFile: previewRuntime.entryFile
  };
}

async function stopPreviewServer(reason = "manual") {
  if (!previewRuntime) {
    return { ok: true, ...getPreviewStatus() };
  }

  const runtime = previewRuntime;
  previewRuntime = null;

  await new Promise((resolve) => runtime.server.close(() => resolve()));
  audit("preview.stop", { reason, port: runtime.port, rootPath: runtime.rootPath });

  return { ok: true, ...getPreviewStatus() };
}

async function startPreviewServer(payload = {}) {
  const { rootPath, entryFile } = resolvePreviewTarget(payload.path || "", payload.entry || "index.html");
  const preferredPort = Number(payload.port) || PREVIEW_DEFAULT_PORT;

  if (previewRuntime) {
    await stopPreviewServer("restart");
  }

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/__lumen_health") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    const decodedPath = decodeURIComponent(requestUrl.pathname);
    const targetFile = resolvePreviewFile(rootPath, entryFile, decodedPath);
    if (!targetFile) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypeFor(targetFile),
      "Cache-Control": "no-store"
    });

    const stream = fs.createReadStream(targetFile);
    stream.on("error", () => {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Preview read error");
    });
    stream.pipe(response);
  });

  const port = await bindPreviewServer(server, preferredPort);
  previewRuntime = {
    server,
    port,
    rootPath,
    entryFile,
    startedAt: new Date().toISOString()
  };

  audit("preview.start", { rootPath, entryFile, port });
  return getPreviewStatus();
}

function isLocalUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function assertRemoteAllowed(baseUrl) {
  if (isLocalUrl(baseUrl)) return;
  const settings = loadSettings();
  if (!settings.onlineMode) {
    throw new Error("Online mode is disabled. Enable it in Settings first.");
  }
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

function createTerminal({ cols = 120, rows = 30 } = {}) {
  const id = `term-${++terminalCounter}`;
  const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";

  const terminal = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: workspaceRoot,
    env: process.env
  });

  terminal.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal:data", { id, data });
    }
  });

  terminal.onExit(({ exitCode }) => {
    terminals.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal:exit", { id, exitCode });
    }
  });

  terminals.set(id, terminal);
  audit("terminal.create", { id, shell, cwd: workspaceRoot });
  return { id, shell, cwd: workspaceRoot };
}

function listTerminals() {
  return Array.from(terminals.keys()).map((id) => ({ id }));
}

function writeTerminal(id, data) {
  const terminal = terminals.get(id);
  if (!terminal) throw new Error("Terminal not found.");
  terminal.write(data);
}

function resizeTerminal(id, cols, rows) {
  const terminal = terminals.get(id);
  if (!terminal) throw new Error("Terminal not found.");
  terminal.resize(Math.max(40, cols), Math.max(6, rows));
}

function killTerminal(id) {
  const terminal = terminals.get(id);
  if (!terminal) return { ok: true };
  terminal.kill();
  terminals.delete(id);
  audit("terminal.kill", { id });
  return { ok: true };
}

function disallowUnsafeCommand(command) {
  const trimmed = command.trim();
  if (!trimmed) return;
  if (trimmed.includes("..\\") || trimmed.includes("../")) {
    throw new Error("Relative parent paths are blocked for run_cmd.");
  }
  if (/\bhttps?:\/\//i.test(trimmed) && !loadSettings().onlineMode) {
    throw new Error("Command references network resource while Online mode is disabled.");
  }
}

async function runCommand(command) {
  disallowUnsafeCommand(command);
  audit("agent.run_cmd", { command });

  const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
  const args = process.platform === "win32"
    ? ["-NoLogo", "-NoProfile", "-Command", `Set-Location -LiteralPath '${workspaceRoot.replace(/'/g, "''")}'; ${command}`]
    : ["-lc", `cd '${workspaceRoot.replace(/'/g, "\\'")}'; ${command}`];

  return await new Promise((resolve) => {
    const child = spawn(shell, args, {
      cwd: workspaceRoot,
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 0,
        stdout: stdout.slice(-24000),
        stderr: stderr.slice(-12000)
      });
    });
  });
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

async function gitCommit(message) {
  const { git, isRepo } = await getGit();
  if (!isRepo) throw new Error("Not a git repository.");
  const result = await git.commit(message);
  audit("git.commit", { message, hash: result.commit });
  return { ok: true, hash: result.commit };
}

async function gitPush() {
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
}

ipcMain.handle("workspace:getRoot", async () => ({ root: workspaceRoot }));
ipcMain.handle("workspace:openFolder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select workspace folder"
  });

  if (result.canceled || !result.filePaths?.length) return { cancelled: true, root: workspaceRoot };

  workspaceRoot = path.resolve(result.filePaths[0]);
  saveWorkspaceRoot(workspaceRoot);
  await stopPreviewServer("workspace_changed");
  audit("workspace.open", { root: workspaceRoot });

  for (const terminalId of Array.from(terminals.keys())) {
    killTerminal(terminalId);
  }

  return { cancelled: false, root: workspaceRoot };
});

ipcMain.handle("files:list", async (_event, payload) => {
  return listDir(payload?.path);
});
ipcMain.handle("files:read", async (_event, payload) => readFile(payload.path));
ipcMain.handle("files:write", async (_event, payload) => writeFile(payload.path, payload.content));
ipcMain.handle("files:create", async (_event, payload) => createFile(payload.path));
ipcMain.handle("files:mkdir", async (_event, payload) => createDirectory(payload.path));
ipcMain.handle("files:rename", async (_event, payload) => renamePath(payload.path, payload.nextPath));
ipcMain.handle("files:delete", async (_event, payload) => deletePath(payload.path));
ipcMain.handle("files:search", async (_event, payload) => ({ results: searchFiles(payload.query, payload.maxResults) }));

ipcMain.handle("terminal:create", async (_event, payload) => createTerminal(payload || {}));
ipcMain.handle("terminal:list", async () => ({ terminals: listTerminals() }));
ipcMain.handle("terminal:write", async (_event, payload) => {
  writeTerminal(payload.id, payload.data);
  return { ok: true };
});
ipcMain.handle("terminal:resize", async (_event, payload) => {
  resizeTerminal(payload.id, payload.cols, payload.rows);
  return { ok: true };
});
ipcMain.handle("terminal:kill", async (_event, payload) => killTerminal(payload.id));

ipcMain.handle("settings:load", async () => loadSettings());
ipcMain.handle("settings:save", async (_event, payload) => saveSettings(payload));

ipcMain.handle("llm:test", async (_event, payload) => testLlmConnection(payload));
ipcMain.handle("llm:listModels", async (_event, payload) => listLlmModels(payload));
ipcMain.handle("llm:installModel", async (_event, payload) => installLlmModel(payload));
ipcMain.handle("llm:startStream", async (event, payload) => {
  startLlmStream(event, payload);
  return { ok: true };
});
ipcMain.handle("llm:abortStream", async (_event, payload) => stopLlmStream(payload.requestId));

ipcMain.handle("agent:runCmd", async (_event, payload) => runCommand(payload.command));
ipcMain.handle("preview:status", async () => getPreviewStatus());
ipcMain.handle("preview:start", async (_event, payload) => startPreviewServer(payload || {}));
ipcMain.handle("preview:stop", async () => stopPreviewServer("manual"));

ipcMain.handle("git:status", async () => gitStatus());
ipcMain.handle("git:diff", async (_event, payload) => gitDiff(payload?.path || "", Boolean(payload?.staged)));
ipcMain.handle("git:stage", async (_event, payload) => gitStage(payload.paths));
ipcMain.handle("git:unstage", async (_event, payload) => gitUnstage(payload.paths));
ipcMain.handle("git:commit", async (_event, payload) => gitCommit(payload.message));
ipcMain.handle("git:push", async () => gitPush());

ipcMain.handle("audit:list", async () => ({ entries: loadAudit() }));
ipcMain.handle("audit:clear", async () => {
  const auditPath = getUserDataPath(AUDIT_FILE);
  if (fs.existsSync(auditPath)) fs.rmSync(auditPath, { force: true });
  audit("audit.clear", {});
  return { ok: true };
});

app.whenReady().then(async () => {
  loadWorkspaceRoot();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  for (const terminalId of Array.from(terminals.keys())) {
    killTerminal(terminalId);
  }
  for (const controller of llmStreams.values()) {
    controller.abort();
  }
  void stopPreviewServer("app_exit");
  stopManagedRuntime("app_exit");
  if (process.platform !== "darwin") {
    app.quit();
  }
});
