const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("yPrompter", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  detectCodex: () => ipcRenderer.invoke("codex:detect"),
  chooseRepository: () => ipcRenderer.invoke("repo:choose"),
  runNow: (request) => ipcRenderer.invoke("run:now", request),
  schedule: (request) => ipcRenderer.invoke("schedule:set", request),
  cancelSchedule: () => ipcRenderer.invoke("schedule:cancel"),
  openLastLog: () => ipcRenderer.invoke("log:open-last"),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  }
});
