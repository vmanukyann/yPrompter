const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

app.setName("yPrompter");
app.setPath("userData", path.join(app.getPath("appData"), "yPrompter"));

let mainWindow;
let tray;
let scheduleTimer;
let quitting = false;
let running = false;

const defaults = {
  settings: {
    repository: "",
    prompt: "",
    runAt: "",
    mode: "goal",
    sandbox: "workspace-write",
    approval: "never"
  },
  codex: { detected: false, path: "", version: "", checked: false },
  scheduledRun: null,
  lastRun: null,
  lastLogPath: ""
};

let state = structuredClone(defaults);

function stateFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

function logsDirectory() {
  return path.join(app.getPath("userData"), "runs", "logs");
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    state = {
      ...structuredClone(defaults),
      ...saved,
      settings: { ...defaults.settings, ...(saved.settings || {}) },
      codex: { ...defaults.codex, ...(saved.codex || {}) }
    };
  } catch {
    state = structuredClone(defaults);
  }

  if (state.scheduledRun && new Date(state.scheduledRun.runAt).getTime() <= Date.now()) {
    state.lastRun = { status: "missed", message: "Scheduled time passed while yPrompter was closed." };
    state.scheduledRun = null;
    persistState();
  }
}

function persistState() {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  const temp = `${stateFile()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, stateFile());
}

function publicState() {
  return { ...state, running, appDataPath: app.getPath("userData") };
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("state:changed", publicState());
  }
}

function saveAndBroadcast() {
  persistState();
  broadcastState();
}

function trayImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
    <rect x="3" y="2" width="12" height="14" rx="3" fill="none" stroke="black" stroke-width="1.7"/>
    <path d="M6 6l3 3 3-3M9 9v4" fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  image.setTemplateImage(true);
  return image;
}

function showWindow() {
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 440,
    minHeight: 620,
    show: false,
    title: "yPrompter",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  mainWindow.once("ready-to-show", showWindow);
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip("yPrompter — Schedule agent prompts for later.");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open yPrompter", click: showWindow },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on("click", showWindow);
}

function findCommand(command, args = []) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ ok: false, output: error.message }));
    child.on("close", (code) => resolve({ ok: code === 0, output: `${stdout}${stderr}`.trim() }));
  });
}

async function detectCodex() {
  const locator = process.platform === "win32" ? "where" : "which";
  const located = await findCommand(locator, ["codex"]);
  const version = await findCommand("codex", ["--version"]);
  const detected = located.ok && version.ok;
  state.codex = {
    checked: true,
    detected,
    path: located.ok ? located.output.split(/\r?\n/)[0] : "",
    version: version.ok ? version.output.split(/\r?\n/)[0] : ""
  };
  saveAndBroadcast();
  return state.codex;
}

const modePrefixes = {
  plan: "Do not modify files. Inspect the repo and produce a careful implementation plan.",
  goal: "Work toward this goal over this repository. Make the smallest safe progress possible, then summarize what changed and what remains.",
  execute: "Implement the requested change. Modify files as needed. Run relevant checks. Summarize changed files and test results."
};

function validateRequest(request, scheduling = false) {
  if (!request.repository || !fs.existsSync(request.repository)) throw new Error("Choose an existing repository folder.");
  if (!request.prompt || !request.prompt.trim()) throw new Error("Enter a prompt.");
  if (!["plan", "goal", "execute"].includes(request.mode)) throw new Error("Invalid mode.");
  if (!["read-only", "workspace-write"].includes(request.sandbox)) throw new Error("Invalid sandbox.");
  if (!["never", "on-request"].includes(request.approval)) throw new Error("Invalid approval mode.");
  if (scheduling && (!request.runAt || new Date(request.runAt).getTime() <= Date.now())) {
    throw new Error("Choose a future run date and time.");
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function execute(request, source) {
  validateRequest(request);
  if (running) throw new Error("A prompt is already running.");
  running = true;
  state.settings = { ...request };
  state.lastRun = { status: "running", source, startedAt: new Date().toISOString(), message: "Codex is running…" };
  saveAndBroadcast();

  fs.mkdirSync(logsDirectory(), { recursive: true });
  const logPath = path.join(logsDirectory(), `${timestamp()}.log`);
  state.lastLogPath = logPath;
  persistState();

  const fullPrompt = `${modePrefixes[request.mode]}\n\n${request.prompt.trim()}`;
  const args = [
    "--cd", request.repository,
    "--sandbox", request.sandbox,
    "--ask-for-approval", request.approval,
    "exec",
    fullPrompt
  ];
  const header = [
    `yPrompter run: ${new Date().toLocaleString()}`,
    `Repository: ${request.repository}`,
    `Mode: ${request.mode}`,
    `Sandbox: ${request.sandbox}`,
    `Approval: ${request.approval}`,
    "",
    "---- output ----",
    ""
  ].join("\n");
  fs.writeFileSync(logPath, header);

  return new Promise((resolve) => {
    const child = spawn("codex", args, { cwd: request.repository, windowsHide: true, shell: false });
    child.stdout.on("data", (chunk) => fs.appendFileSync(logPath, chunk));
    child.stderr.on("data", (chunk) => fs.appendFileSync(logPath, chunk));
    child.on("error", (error) => {
      fs.appendFileSync(logPath, `\nFailed to start Codex: ${error.message}\n`);
      finishRun("failed", error.message);
      resolve(publicState());
    });
    child.on("close", (code) => {
      if (!running) return;
      fs.appendFileSync(logPath, `\n---- exit code: ${code} ----\n`);
      finishRun(code === 0 ? "succeeded" : "failed", code === 0 ? "Codex completed successfully." : `Codex exited with code ${code}.`);
      resolve(publicState());
    });
  });
}

function finishRun(status, message) {
  running = false;
  state.lastRun = {
    ...state.lastRun,
    status,
    message,
    finishedAt: new Date().toISOString(),
    logPath: state.lastLogPath
  };
  saveAndBroadcast();
}

function armScheduler() {
  clearTimeout(scheduleTimer);
  if (!state.scheduledRun) return;
  const remaining = new Date(state.scheduledRun.runAt).getTime() - Date.now();
  if (remaining <= 0) {
    const request = state.scheduledRun;
    state.scheduledRun = null;
    persistState();
    execute(request, "scheduled").catch((error) => {
      running = false;
      state.lastRun = { status: "failed", message: error.message, finishedAt: new Date().toISOString() };
      saveAndBroadcast();
    });
    return;
  }
  scheduleTimer = setTimeout(armScheduler, Math.min(remaining, 2_147_000_000));
}

ipcMain.handle("state:get", () => publicState());
ipcMain.handle("settings:save", (_event, settings) => {
  state.settings = { ...defaults.settings, ...settings };
  persistState();
  return true;
});
ipcMain.handle("codex:detect", detectCodex);
ipcMain.handle("repo:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "Choose a repository" });
  return result.canceled ? "" : result.filePaths[0];
});
ipcMain.handle("run:now", async (_event, request) => {
  execute(request, "manual").catch((error) => {
    running = false;
    state.lastRun = { status: "failed", message: error.message, finishedAt: new Date().toISOString() };
    saveAndBroadcast();
  });
  return publicState();
});
ipcMain.handle("schedule:set", (_event, request) => {
  validateRequest(request, true);
  state.settings = { ...request };
  state.scheduledRun = { ...request, scheduledAt: new Date().toISOString() };
  saveAndBroadcast();
  armScheduler();
  return publicState();
});
ipcMain.handle("schedule:cancel", () => {
  state.scheduledRun = null;
  clearTimeout(scheduleTimer);
  saveAndBroadcast();
  return publicState();
});
ipcMain.handle("log:open-last", async () => {
  if (!state.lastLogPath || !fs.existsSync(state.lastLogPath)) throw new Error("No run log is available yet.");
  const error = await shell.openPath(state.lastLogPath);
  if (error) throw new Error(error);
  return true;
});

app.whenReady().then(() => {
  loadState();
  createWindow();
  createTray();
  armScheduler();
  detectCodex();
});

app.on("activate", showWindow);
app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => {
  // Keep running in the tray on every platform.
});
