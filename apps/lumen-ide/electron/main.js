const path = require("path");
const fs = require("fs");

const APP_ROOT = path.resolve(__dirname, "..");

require("dotenv").config({ path: path.join(APP_ROOT, ".env") });

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { sendToNyx, receiveSuggestions } = require("./backend/nyxService");

const SETTINGS_FILE = "lumen-settings.enc.json";
const WORKSPACE_STATE_FILE = "lumen-workspace.json";
const USER_DATA_DIR = path.join(APP_ROOT, ".lumen-user");
const DEFAULT_WORKSPACE_ROOT = APP_ROOT;
let workspaceRoot = DEFAULT_WORKSPACE_ROOT;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TREE_DEPTH = 4;
const MAX_TREE_ENTRIES = 800;
const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", "out", "build", ".lumen-user"]);
const EXCLUDED_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "lumen-settings.enc.json"
]);

// Keep local settings inside the repo for this build; swap to OS defaults for production.
app.setPath("userData", USER_DATA_DIR);

function getSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

function getWorkspaceStatePath() {
  return path.join(app.getPath("userData"), WORKSPACE_STATE_FILE);
}

function encodeSettings(data) {
  // Placeholder for real encryption: replace with strong encryption later.
  const json = JSON.stringify(data, null, 2);
  return Buffer.from(json, "utf8").toString("base64");
}

function decodeSettings(encoded) {
  try {
    const json = Buffer.from(encoded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function loadWorkspaceRoot() {
  const statePath = getWorkspaceStatePath();
  if (!fs.existsSync(statePath)) {
    workspaceRoot = DEFAULT_WORKSPACE_ROOT;
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (data?.root && fs.existsSync(data.root)) {
      const stat = fs.statSync(data.root);
      if (stat.isDirectory()) {
        workspaceRoot = data.root;
        return;
      }
    }
  } catch {
    // Ignore and fallback to default.
  }
  workspaceRoot = DEFAULT_WORKSPACE_ROOT;
}

function saveWorkspaceRoot(root) {
  const statePath = getWorkspaceStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ root }, null, 2), "utf8");
}

function isWithinWorkspace(targetPath) {
  const resolved = path.resolve(targetPath);
  return resolved === workspaceRoot || resolved.startsWith(`${workspaceRoot}${path.sep}`);
}

function shouldSkipEntry(entry) {
  if (!entry) return true;
  if (entry.isDirectory()) {
    return EXCLUDED_DIRS.has(entry.name);
  }
  return EXCLUDED_FILES.has(entry.name);
}

function buildTree(currentPath, depth, maxDepth, counter) {
  const name = path.basename(currentPath);
  const node = {
    name,
    path: currentPath,
    type: "dir",
    children: [],
    truncated: false
  };

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

  const filtered = entries.filter((entry) => !shouldSkipEntry(entry));
  filtered.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of filtered) {
    if (counter.count >= MAX_TREE_ENTRIES) {
      node.truncated = true;
      break;
    }
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      node.children.push(buildTree(entryPath, depth + 1, maxDepth, counter));
    } else {
      node.children.push({
        name: entry.name,
        path: entryPath,
        type: "file"
      });
    }
    counter.count += 1;
  }

  return node;
}

function listWorkspace({ maxDepth = MAX_TREE_DEPTH } = {}) {
  const counter = { count: 0 };
  const tree = buildTree(workspaceRoot, 0, maxDepth, counter);
  return {
    status: "ok",
    root: workspaceRoot,
    tree,
    truncated: counter.count >= MAX_TREE_ENTRIES
  };
}

function readWorkspaceFile(filePath) {
  if (!filePath || !isWithinWorkspace(filePath)) {
    return { status: "error", message: "File is outside the workspace root." };
  }

  const fileName = path.basename(filePath);
  if (EXCLUDED_FILES.has(fileName)) {
    return { status: "error", message: "This file is restricted from the explorer." };
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { status: "error", message: "File not found." };
  }

  if (!stat.isFile()) {
    return { status: "error", message: "Path is not a file." };
  }

  if (stat.size > MAX_FILE_BYTES) {
    return { status: "error", message: "File is too large to open in the editor." };
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    return { status: "ok", path: filePath, content };
  } catch {
    return { status: "error", message: "Unable to read file." };
  }
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0b0f14",
    title: "Lumen IDE",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_START_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(path.join(APP_ROOT, "dist", "index.html"));
  }
}

ipcMain.handle("nyx:send", async (_event, payload) => {
  return sendToNyx(payload);
});

ipcMain.handle("nyx:suggestions", async () => {
  return receiveSuggestions();
});

ipcMain.handle("explorer:list", async (_event, options) => {
  return listWorkspace(options || {});
});

ipcMain.handle("explorer:selectRoot", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select workspace folder"
  });
  if (result.canceled || !result.filePaths?.length) {
    return { status: "cancelled" };
  }
  const nextRoot = result.filePaths[0];
  workspaceRoot = nextRoot;
  saveWorkspaceRoot(nextRoot);
  return listWorkspace();
});

ipcMain.handle("explorer:read", async (_event, payload) => {
  return readWorkspaceFile(payload?.path);
});

ipcMain.handle("settings:load", async () => {
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return null;
  }
  const encoded = fs.readFileSync(settingsPath, "utf8");
  return decodeSettings(encoded);
});

ipcMain.handle("settings:save", async (_event, settings) => {
  const settingsPath = getSettingsPath();
  const encoded = encodeSettings(settings || {});
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, encoded, "utf8");
  return { status: "saved" };
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
  if (process.platform !== "darwin") {
    app.quit();
  }
});
