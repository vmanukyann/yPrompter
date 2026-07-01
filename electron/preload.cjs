const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("yPrompter", {
  getState: () => ipcRenderer.invoke("state:get"),
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  detectCodex: () => ipcRenderer.invoke("codex:detect"),
  chooseRepository: () => ipcRenderer.invoke("repo:choose"),
  addJob: () => ipcRenderer.invoke("job:add"),
  selectJob: (jobId) => ipcRenderer.invoke("job:select", jobId),
  updateJob: (jobId, updates) => ipcRenderer.invoke("job:update", jobId, updates),
  removeJob: (jobId) => ipcRenderer.invoke("job:remove", jobId),
  addImages: (jobId) => ipcRenderer.invoke("attachments:add", jobId),
  removeImage: (jobId, attachmentId) => ipcRenderer.invoke("attachments:remove", jobId, attachmentId),
  clearImages: (jobId) => ipcRenderer.invoke("attachments:clear", jobId),
  runNow: (jobId, updates) => ipcRenderer.invoke("job:run-now", jobId, updates),
  cancelRunning: () => ipcRenderer.invoke("run:cancel"),
  schedule: (jobId, updates) => ipcRenderer.invoke("schedule:set", jobId, updates),
  cancelSchedule: (jobId) => ipcRenderer.invoke("schedule:cancel", jobId),
  openLastLog: () => ipcRenderer.invoke("log:open-last"),
  getLogPreview: () => ipcRenderer.invoke("log:preview"),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  }
});
