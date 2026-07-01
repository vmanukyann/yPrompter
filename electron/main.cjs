const { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, nativeImage, shell } = require("electron");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

app.setName("yPrompter");
app.setPath(
  "userData",
  process.env.YPROMPTER_USER_DATA || path.join(app.getPath("appData"), "yPrompter")
);

const MAX_JOBS = 6;
const MAX_ATTACHMENTS = 5;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

let mainWindow;
let tray;
let scheduleTimer;
let quitting = false;
let runningJobId = "";
let activeChild = null;

function newJob(overrides = {}) {
  return {
    id: overrides.id || randomUUID(),
    repository: "",
    prompt: "",
    runAt: "",
    mode: "goal",
    sandbox: "workspace-write",
    approval: "never",
    status: "draft",
    scheduledAt: "",
    attachments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

const defaults = {
  jobs: [],
  selectedJobId: "",
  codex: {
    detected: false,
    path: "",
    version: "",
    checked: false,
    imageSupport: false,
    error: ""
  },
  lastRun: null,
  runs: [],
  lastLogPath: ""
};

let state = structuredClone(defaults);

function stateFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

function logsDirectory() {
  return path.join(app.getPath("userData"), "runs", "logs");
}

function jobDirectory(jobId) {
  return path.join(app.getPath("userData"), "jobs", jobId);
}

function attachmentsDirectory(jobId) {
  return path.join(jobDirectory(jobId), "attachments");
}

function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  if (!attachment.id || !attachment.name || !attachment.path) return null;
  return {
    id: String(attachment.id),
    name: path.basename(String(attachment.name)),
    path: String(attachment.path),
    size: Number(attachment.size) || 0,
    type: String(attachment.type || ""),
    importedAt: String(attachment.importedAt || "")
  };
}

function normalizeJob(job) {
  const base = newJob({ id: job?.id || randomUUID(), createdAt: job?.createdAt || new Date().toISOString() });
  const normalized = {
    ...base,
    ...job,
    id: base.id,
    attachments: Array.isArray(job?.attachments)
      ? job.attachments.map(normalizeAttachment).filter(Boolean).slice(0, MAX_ATTACHMENTS)
      : []
  };
  if (!["draft", "scheduled", "running", "succeeded", "failed", "missed"].includes(normalized.status)) {
    normalized.status = "draft";
  }
  return normalized;
}

function migrateLegacyState(saved) {
  const legacy = {
    ...(saved.settings || {}),
    ...(saved.scheduledRun || {})
  };
  const job = newJob({
    repository: legacy.repository || "",
    prompt: legacy.prompt || "",
    runAt: legacy.runAt || "",
    mode: legacy.mode || "goal",
    sandbox: legacy.sandbox || "workspace-write",
    approval: legacy.approval || "never",
    status: saved.scheduledRun ? "scheduled" : "draft",
    scheduledAt: saved.scheduledRun?.scheduledAt || ""
  });
  return {
    ...structuredClone(defaults),
    jobs: [job],
    selectedJobId: job.id,
    codex: { ...defaults.codex, ...(saved.codex || {}) },
    lastRun: saved.lastRun || null,
    runs: saved.lastRun ? [saved.lastRun] : [],
    lastLogPath: saved.lastLogPath || ""
  };
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (Array.isArray(saved.jobs)) {
      state = {
        ...structuredClone(defaults),
        ...saved,
        jobs: saved.jobs.map(normalizeJob).slice(0, MAX_JOBS),
        codex: { ...defaults.codex, ...(saved.codex || {}) },
        runs: Array.isArray(saved.runs) ? saved.runs.slice(0, 12) : []
      };
    } else {
      state = migrateLegacyState(saved);
    }
  } catch {
    const job = newJob();
    state = { ...structuredClone(defaults), jobs: [job], selectedJobId: job.id };
  }

  if (!state.jobs.length) state.jobs.push(newJob());
  if (!state.jobs.some((job) => job.id === state.selectedJobId)) {
    state.selectedJobId = state.jobs[0].id;
  }

  const now = Date.now();
  for (const job of state.jobs) {
    if (job.status === "running") {
      job.status = "failed";
      job.updatedAt = new Date().toISOString();
    }
    if (job.status === "scheduled" && (!job.runAt || new Date(job.runAt).getTime() <= now)) {
      job.status = "missed";
      job.updatedAt = new Date().toISOString();
    }
  }
  persistState();
}

function persistState() {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  const temp = `${stateFile()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, stateFile());
}

function publicAttachment(attachment) {
  const { path: _privatePath, ...safe } = attachment;
  return safe;
}

function publicJob(job) {
  return {
    ...job,
    attachments: job.attachments.map(publicAttachment)
  };
}

function publicState() {
  return {
    ...state,
    jobs: state.jobs.map(publicJob),
    running: Boolean(runningJobId),
    runningJobId,
    appDataPath: app.getPath("userData"),
    limits: {
      jobs: MAX_JOBS,
      attachments: MAX_ATTACHMENTS,
      imageBytes: MAX_IMAGE_BYTES
    }
  };
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
    width: 1180,
    height: 820,
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
  tray.setToolTip("yPrompter — Queue Codex prompts for later.");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open yPrompter", click: showWindow },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on("click", showWindow);
}

function buildAugmentedEnv() {
  const env = { ...process.env };
  if (process.platform !== "darwin") return env;

  const home = app.getPath("home");
  const requiredPaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin")
  ];
  const inheritedPaths = (env.PATH || "").split(path.delimiter).filter(Boolean);
  env.PATH = [...new Set([...requiredPaths, ...inheritedPaths])].join(path.delimiter);
  return env;
}

function findCommand(command, args = [], env = buildAugmentedEnv()) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => done({ ok: false, output: error.message }));
    child.on("close", (code) => done({ ok: code === 0, output: `${stdout}${stderr}`.trim() }));
  });
}

async function detectCodex() {
  const env = buildAugmentedEnv();
  const locator = process.platform === "win32" ? "where.exe" : "/usr/bin/which";
  const located = await findCommand(locator, ["codex"], env);
  const resolvedPath = located.ok ? located.output.split(/\r?\n/).find(Boolean)?.trim() || "" : "";
  const version = resolvedPath
    ? await findCommand(resolvedPath, ["--version"], env)
    : { ok: false, output: "" };
  const execHelp = resolvedPath && version.ok
    ? await findCommand(resolvedPath, ["exec", "--help"], env)
    : { ok: false, output: "" };
  const detected = Boolean(resolvedPath && version.ok);
  const imageSupport = Boolean(execHelp.ok && /(?:^|\s)(?:-i,\s*)?--image(?:\s|<)/m.test(execHelp.output));
  const lookupHint = process.platform === "win32" ? "where codex" : "which codex";
  state.codex = {
    checked: true,
    detected,
    path: detected ? resolvedPath : "",
    version: detected ? version.output.split(/\r?\n/)[0] : "",
    imageSupport,
    error: detected ? "" : `Codex CLI was not found. Open a terminal and run: ${lookupHint}`
  };
  saveAndBroadcast();
  return state.codex;
}

const modePrefixes = {
  plan: "Do not modify files. Inspect the repo and produce a careful implementation plan.",
  goal: "Work toward this goal over this repository. Make the smallest safe progress possible, then summarize what changed and what remains.",
  execute: "Implement the requested change. Modify files as needed. Run relevant checks. Summarize changed files and test results."
};

function findJob(jobId) {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error("That queued job no longer exists.");
  return job;
}

function editableFields(input = {}) {
  return {
    repository: String(input.repository || ""),
    prompt: String(input.prompt || ""),
    runAt: String(input.runAt || ""),
    mode: String(input.mode || "goal"),
    sandbox: String(input.sandbox || "workspace-write"),
    approval: String(input.approval || "never")
  };
}

function updateJobFields(job, input) {
  const next = editableFields(input);
  const changed = Object.entries(next).some(([key, value]) => job[key] !== value);
  if (!changed) return false;
  Object.assign(job, next, { updatedAt: new Date().toISOString() });
  if (["succeeded", "failed", "missed"].includes(job.status)) job.status = "draft";
  return true;
}

function validateJob(job, scheduling = false) {
  if (!job.repository || !fs.existsSync(job.repository)) throw new Error("Choose an existing repository folder.");
  if (!job.prompt || !job.prompt.trim()) throw new Error("Enter a prompt.");
  if (!["plan", "goal", "execute"].includes(job.mode)) throw new Error("Invalid mode.");
  if (!["read-only", "workspace-write"].includes(job.sandbox)) throw new Error("Invalid sandbox.");
  if (!["never", "on-request"].includes(job.approval)) throw new Error("Invalid approval mode.");
  if (scheduling && (!job.runAt || new Date(job.runAt).getTime() <= Date.now())) {
    throw new Error("Choose a future run date and time.");
  }
}

function hasImageSignature(filePath, extension) {
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(12);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (bytesRead < 4) return false;
  if (extension === ".png") {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extension === ".webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF"
      && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function validateImageFile(filePath) {
  const name = path.basename(filePath);
  const extension = path.extname(name).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`"${name}" is not supported. Add a PNG, JPG/JPEG, or WebP image.`);
  }
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    throw new Error(`"${name}" could not be read.`);
  }
  if (!stats.isFile() || stats.size === 0) throw new Error(`"${name}" is empty or is not a file.`);
  if (stats.size > MAX_IMAGE_BYTES) {
    throw new Error(`"${name}" is larger than 20 MB. Choose a smaller image.`);
  }
  if (!hasImageSignature(filePath, extension)) {
    throw new Error(`"${name}" does not contain valid ${extension.slice(1).toUpperCase()} image data.`);
  }
  return { name, extension, size: stats.size };
}

function verifiedAttachmentPaths(job) {
  if (!job.attachments.length) return [];
  if (!state.codex.imageSupport) {
    throw new Error("This Codex CLI does not support image attachments for non-interactive runs. Update Codex, then click Verify.");
  }
  const expectedDirectory = path.resolve(attachmentsDirectory(job.id));
  return job.attachments.map((attachment) => {
    const resolved = path.resolve(attachment.path);
    if (path.dirname(resolved) !== expectedDirectory || !fs.existsSync(resolved)) {
      throw new Error(`Attachment "${attachment.name}" is missing. Remove it or add it again before running.`);
    }
    return resolved;
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function appendRunEnd(logPath, run, exitCode, signal) {
  const endedAt = new Date();
  const startedAt = new Date(run?.startedAt || endedAt);
  const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  fs.appendFileSync(logPath, [
    "",
    "---- run ended ----",
    `End time: ${endedAt.toISOString()}`,
    `Duration: ${durationMs} ms`,
    `Exit code: ${exitCode == null ? "none" : exitCode}`,
    `Signal: ${signal || "none"}`,
    ""
  ].join("\n"));
}

function finishRun(jobId, status, message, exitCode, signal) {
  const finishedAt = new Date();
  const run = state.lastRun;
  const startedAt = new Date(run?.startedAt || finishedAt);
  const completedRun = {
    ...run,
    status,
    message,
    exitCode,
    signal,
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    logPath: state.lastLogPath
  };
  state.lastRun = completedRun;
  state.runs = [completedRun, ...state.runs.filter((item) => item.id !== completedRun.id)].slice(0, 12);
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (job) {
    job.status = status;
    job.updatedAt = finishedAt.toISOString();
  }
  runningJobId = "";
  activeChild = null;
  saveAndBroadcast();
  armScheduler();
}

function execute(jobId, source) {
  const job = findJob(jobId);
  validateJob(job);
  if (runningJobId) throw new Error("Another queued job is already running.");
  const codexPath = state.codex.detected ? state.codex.path : "";
  if (!codexPath) {
    const lookupHint = process.platform === "win32" ? "where codex" : "which codex";
    throw new Error(`Codex CLI is not detected. Open a terminal and run: ${lookupHint}`);
  }
  const imagePaths = verifiedAttachmentPaths(job);
  const attachmentNames = job.attachments.map((attachment) => attachment.name);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  runningJobId = job.id;
  job.status = "running";
  job.scheduledAt = "";
  job.updatedAt = startedAt;
  state.lastRun = {
    id: runId,
    jobId: job.id,
    status: "running",
    source,
    startedAt,
    repository: job.repository,
    mode: job.mode,
    codexPath,
    attachmentNames,
    message: "Codex CLI is running..."
  };

  fs.mkdirSync(logsDirectory(), { recursive: true });
  const logPath = path.join(logsDirectory(), `${timestamp()}.log`);
  state.lastLogPath = logPath;
  state.lastRun.logPath = logPath;
  saveAndBroadcast();

  const fullPrompt = `${modePrefixes[job.mode]}\n\n${job.prompt.trim()}`;
  const args = [
    "--cd", job.repository,
    "--sandbox", job.sandbox,
    "--ask-for-approval", job.approval,
    "exec",
    ...imagePaths.flatMap((imagePath) => ["--image", imagePath]),
    "-"
  ];
  const header = [
    `yPrompter run: ${new Date().toLocaleString()}`,
    `Job: ${job.id}`,
    `Repository: ${job.repository}`,
    `Mode: ${job.mode}`,
    `Sandbox: ${job.sandbox}`,
    `Approval: ${job.approval}`,
    `Attachments: ${attachmentNames.length ? attachmentNames.join(", ") : "none"}`,
    "",
    "---- output ----",
    ""
  ].join("\n");
  fs.writeFileSync(logPath, header);

  const child = spawn(codexPath, args, {
    cwd: job.repository,
    env: buildAugmentedEnv(),
    windowsHide: true,
    shell: false
  });
  activeChild = child;
  let finished = false;
  const finishOnce = (status, message, code, signal) => {
    if (finished) return;
    finished = true;
    appendRunEnd(logPath, state.lastRun, code, signal);
    finishRun(job.id, status, message, code, signal);
  };
  child.stdout.on("data", (chunk) => fs.appendFileSync(logPath, chunk));
  child.stderr.on("data", (chunk) => fs.appendFileSync(logPath, chunk));
  child.on("error", (error) => {
    fs.appendFileSync(logPath, `\nFailed to start Codex: ${error.message}\n`);
    finishOnce("failed", error.message, null, null);
  });
  child.on("close", (code, signal) => {
    const cancelled = signal != null;
    finishOnce(
      code === 0 && !cancelled ? "succeeded" : "failed",
      cancelled
        ? `Codex was cancelled with signal ${signal}.`
        : code === 0 ? "Codex completed successfully." : `Codex exited with code ${code}.`,
      code,
      signal
    );
  });
  child.stdin.on("error", (error) => {
    fs.appendFileSync(logPath, `\nstdin error: ${error.message}\n`);
  });
  child.stdin.write(fullPrompt);
  fs.appendFileSync(logPath, `Prompt written to stdin (${Buffer.byteLength(fullPrompt)} bytes).\n`);
  child.stdin.end();
  fs.appendFileSync(logPath, "stdin closed; Codex received EOF.\n\n");
}

function nextScheduledJob() {
  return state.jobs
    .filter((job) => job.status === "scheduled" && job.runAt)
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())[0] || null;
}

function armScheduler() {
  clearTimeout(scheduleTimer);
  const job = nextScheduledJob();
  if (!job) return;
  const remaining = new Date(job.runAt).getTime() - Date.now();
  if (remaining <= 0) {
    if (runningJobId) {
      scheduleTimer = setTimeout(armScheduler, 1000);
      return;
    }
    try {
      execute(job.id, "scheduled");
    } catch (error) {
      job.status = "failed";
      job.updatedAt = new Date().toISOString();
      const failedRun = {
        id: randomUUID(),
        jobId: job.id,
        status: "failed",
        source: "scheduled",
        message: error.message,
        attachmentNames: job.attachments.map((attachment) => attachment.name),
        finishedAt: new Date().toISOString()
      };
      state.lastRun = failedRun;
      state.runs = [failedRun, ...state.runs].slice(0, 12);
      saveAndBroadcast();
      armScheduler();
    }
    return;
  }
  scheduleTimer = setTimeout(armScheduler, Math.min(remaining, 2_147_000_000));
}

ipcMain.handle("state:get", () => publicState());
ipcMain.handle("clipboard:write", (_event, text) => {
  clipboard.writeText(String(text || ""));
  return true;
});
ipcMain.handle("codex:detect", detectCodex);
ipcMain.handle("repo:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "Choose a repository" });
  return result.canceled ? "" : result.filePaths[0];
});
ipcMain.handle("job:add", () => {
  if (state.jobs.length >= MAX_JOBS) throw new Error(`The queue is limited to ${MAX_JOBS} jobs.`);
  const job = newJob();
  state.jobs.push(job);
  state.selectedJobId = job.id;
  saveAndBroadcast();
  return publicJob(job);
});
ipcMain.handle("job:select", (_event, jobId) => {
  findJob(jobId);
  state.selectedJobId = jobId;
  saveAndBroadcast();
  return publicState();
});
ipcMain.handle("job:update", (_event, jobId, updates) => {
  const job = findJob(jobId);
  if (runningJobId === jobId) throw new Error("A running job cannot be edited.");
  const changed = updateJobFields(job, updates);
  if (changed) {
    persistState();
    if (job.status === "scheduled") armScheduler();
  }
  return publicJob(job);
});
ipcMain.handle("job:remove", (_event, jobId) => {
  if (runningJobId === jobId) throw new Error("Stop this job before removing it.");
  const index = state.jobs.findIndex((job) => job.id === jobId);
  if (index < 0) throw new Error("That queued job no longer exists.");
  state.jobs.splice(index, 1);
  fs.rmSync(jobDirectory(jobId), { recursive: true, force: true });
  if (!state.jobs.length) state.jobs.push(newJob());
  if (state.selectedJobId === jobId) {
    state.selectedJobId = state.jobs[Math.min(index, state.jobs.length - 1)].id;
  }
  saveAndBroadcast();
  armScheduler();
  return publicState();
});
ipcMain.handle("attachments:add", async (_event, jobId) => {
  const job = findJob(jobId);
  if (runningJobId === jobId) throw new Error("Images cannot be changed while this job is running.");
  const remaining = MAX_ATTACHMENTS - job.attachments.length;
  if (remaining <= 0) throw new Error(`This job already has the maximum of ${MAX_ATTACHMENTS} images.`);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Add up to ${remaining} images`,
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }
    ]
  });
  if (result.canceled) return publicJob(job);
  if (result.filePaths.length > remaining) {
    throw new Error(`You can add ${remaining} more image${remaining === 1 ? "" : "s"} to this job.`);
  }

  const validated = result.filePaths.map((filePath) => ({ filePath, ...validateImageFile(filePath) }));
  const directory = attachmentsDirectory(job.id);
  fs.mkdirSync(directory, { recursive: true });
  const added = [];
  try {
    for (const image of validated) {
      const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}${image.extension}`;
      const destination = path.join(directory, storedName);
      fs.copyFileSync(image.filePath, destination, fs.constants.COPYFILE_EXCL);
      const attachment = {
        id: randomUUID(),
        name: image.name,
        path: destination,
        size: image.size,
        type: image.extension.slice(1),
        importedAt: new Date().toISOString()
      };
      added.push(attachment);
      job.attachments.push(attachment);
    }
  } catch (error) {
    for (const attachment of added) fs.rmSync(attachment.path, { force: true });
    job.attachments = job.attachments.filter((attachment) => !added.some((item) => item.id === attachment.id));
    throw new Error(`Images could not be imported: ${error.message}`);
  }
  job.updatedAt = new Date().toISOString();
  saveAndBroadcast();
  return publicJob(job);
});
ipcMain.handle("attachments:remove", (_event, jobId, attachmentId) => {
  const job = findJob(jobId);
  if (runningJobId === jobId) throw new Error("Images cannot be changed while this job is running.");
  const index = job.attachments.findIndex((attachment) => attachment.id === attachmentId);
  if (index < 0) throw new Error("That image is no longer attached.");
  const [attachment] = job.attachments.splice(index, 1);
  fs.rmSync(attachment.path, { force: true });
  job.updatedAt = new Date().toISOString();
  saveAndBroadcast();
  return publicJob(job);
});
ipcMain.handle("attachments:clear", (_event, jobId) => {
  const job = findJob(jobId);
  if (runningJobId === jobId) throw new Error("Images cannot be changed while this job is running.");
  fs.rmSync(attachmentsDirectory(jobId), { recursive: true, force: true });
  job.attachments = [];
  job.updatedAt = new Date().toISOString();
  saveAndBroadcast();
  return publicJob(job);
});
ipcMain.handle("job:run-now", (_event, jobId, updates) => {
  const job = findJob(jobId);
  updateJobFields(job, updates);
  validateJob(job);
  verifiedAttachmentPaths(job);
  execute(jobId, "manual");
  return publicState();
});
ipcMain.handle("run:cancel", () => {
  if (!runningJobId || !activeChild) throw new Error("No Codex job is currently running.");
  if (state.lastLogPath && fs.existsSync(state.lastLogPath)) {
    fs.appendFileSync(state.lastLogPath, `\nCancellation requested at ${new Date().toISOString()}.\n`);
  }
  const signalled = activeChild.kill("SIGTERM");
  if (!signalled) throw new Error("Could not send the cancellation signal to Codex.");
  return publicState();
});
ipcMain.handle("schedule:set", (_event, jobId, updates) => {
  const job = findJob(jobId);
  if (runningJobId === jobId) throw new Error("A running job cannot be scheduled.");
  updateJobFields(job, updates);
  validateJob(job, true);
  verifiedAttachmentPaths(job);
  job.status = "scheduled";
  job.scheduledAt = new Date().toISOString();
  saveAndBroadcast();
  armScheduler();
  return publicState();
});
ipcMain.handle("schedule:cancel", (_event, jobId) => {
  const job = findJob(jobId);
  if (job.status === "scheduled") {
    job.status = "draft";
    job.scheduledAt = "";
    job.updatedAt = new Date().toISOString();
  }
  saveAndBroadcast();
  armScheduler();
  return publicState();
});
ipcMain.handle("log:open-last", async () => {
  if (!state.lastLogPath || !fs.existsSync(state.lastLogPath)) throw new Error("No run log is available yet.");
  const error = await shell.openPath(state.lastLogPath);
  if (error) throw new Error(error);
  return true;
});
ipcMain.handle("log:preview", () => {
  const logPath = state.lastRun?.logPath || state.lastLogPath;
  if (!logPath || !fs.existsSync(logPath)) return { content: "" };
  const size = fs.statSync(logPath).size;
  const maxBytes = 16 * 1024;
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(logPath, "r");
  try {
    fs.readSync(descriptor, buffer, 0, length, start);
  } finally {
    fs.closeSync(descriptor);
  }
  return {
    content: `${start > 0 ? "… showing the latest 16 KB …\n" : ""}${buffer.toString("utf8")}`
  };
});

app.whenReady().then(async () => {
  loadState();
  createWindow();
  createTray();
  await detectCodex();
  armScheduler();
});

app.on("activate", showWindow);
app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => {
  // Keep running in the tray on every platform.
});
