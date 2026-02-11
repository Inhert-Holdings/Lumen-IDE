const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const SETTINGS_FILE = "lumen-settings.enc.json";
const USER_DATA_DIR = path.join(__dirname, ".lumen-user");

// Keep local settings inside the repo for this build; swap to OS defaults for production.
app.setPath("userData", USER_DATA_DIR);

function getSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
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
    await win.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

ipcMain.handle("nyx:send", async (_event, payload) => {
  // Placeholder response until Nyx is implemented.
  return {
    status: "ok",
    receivedBytes: payload?.content?.length || 0,
    summary: "Nyx placeholder response: analysis queued.",
    suggestions: [
      "Refactor this module into smaller units.",
      "Add tests around the main workflow.",
      "Document public APIs before release."
    ],
    timestamp: new Date().toISOString()
  };
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
