import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const blankForm = {
  repository: "",
  prompt: "",
  runAt: "",
  mode: "goal",
  sandbox: "workspace-write",
  approval: "never"
};

function localInputValue(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function displayTime(iso) {
  return iso ? new Date(iso).toLocaleString() : "None";
}

function App() {
  const [appState, setAppState] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [error, setError] = useState("");

  useEffect(() => {
    window.yPrompter.getState().then((next) => {
      setAppState(next);
      setForm({ ...blankForm, ...next.settings, runAt: localInputValue(next.settings?.runAt) });
    });
    return window.yPrompter.onStateChanged(setAppState);
  }, []);

  useEffect(() => {
    if (!appState) return;
    const timer = setTimeout(() => window.yPrompter.saveSettings(request()), 300);
    return () => clearTimeout(timer);
  }, [form, appState]);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const request = () => ({ ...form, runAt: form.runAt ? new Date(form.runAt).toISOString() : "" });

  async function act(action) {
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught.message || String(caught));
    }
  }

  async function chooseRepository() {
    const folder = await window.yPrompter.chooseRepository();
    if (folder) setForm((current) => ({ ...current, repository: folder }));
  }

  if (!appState) return <main className="loading">Opening yPrompter…</main>;

  return (
    <main>
      <header>
        <div className="mark">y</div>
        <div>
          <h1>yPrompter</h1>
          <p>Schedule agent prompts for later.</p>
        </div>
      </header>

      <section className="status-strip">
        <span className={`dot ${appState.codex.detected ? "good" : "bad"}`} />
        <div>
          <strong>Codex CLI {appState.codex.detected ? "detected" : "not detected"}</strong>
          <small>{appState.codex.version || "Install Codex CLI, then check again."}</small>
        </div>
        <button className="quiet" onClick={() => act(window.yPrompter.detectCodex)}>Check</button>
      </section>

      <label>
        Repository folder
        <div className="row">
          <input value={form.repository} onChange={update("repository")} placeholder="/path/to/repository" />
          <button className="secondary" onClick={() => act(chooseRepository)}>Choose…</button>
        </div>
      </label>

      <label>
        Prompt
        <textarea value={form.prompt} onChange={update("prompt")} placeholder="What should Codex work on?" rows="4" />
      </label>

      <div className="grid">
        <label>
          Run date and time
          <input type="datetime-local" value={form.runAt} onChange={update("runAt")} />
        </label>
        <label>
          Mode
          <select value={form.mode} onChange={update("mode")}>
            <option value="plan">Plan</option>
            <option value="goal">Goal</option>
            <option value="execute">Execute</option>
          </select>
        </label>
        <label>
          Sandbox
          <select value={form.sandbox} onChange={update("sandbox")}>
            <option value="read-only">read-only</option>
            <option value="workspace-write">workspace-write</option>
          </select>
        </label>
        <label>
          Approval
          <select value={form.approval} onChange={update("approval")}>
            <option value="never">never</option>
            <option value="on-request">on-request</option>
          </select>
        </label>
      </div>

      <aside>
        Scheduled runs are unattended. Keep yPrompter open in the tray and keep the computer awake.
      </aside>

      {error && <div className="error">{error}</div>}

      <div className="actions">
        <button disabled={appState.running || !appState.codex.detected} onClick={() => act(() => window.yPrompter.runNow(request()))}>
          {appState.running ? "Running…" : "Run Now"}
        </button>
        <button className="accent" disabled={appState.running || !appState.codex.detected} onClick={() => act(() => window.yPrompter.schedule(request()))}>
          Schedule
        </button>
        <button className="secondary" disabled={!appState.scheduledRun} onClick={() => act(window.yPrompter.cancelSchedule)}>
          Cancel Scheduled Run
        </button>
        <button className="secondary" disabled={!appState.lastLogPath} onClick={() => act(window.yPrompter.openLastLog)}>
          Open Last Log
        </button>
      </div>

      <footer>
        <div><span>Last run</span><strong className={`run-${appState.lastRun?.status || "none"}`}>{appState.lastRun?.message || "No runs yet"}</strong></div>
        <div><span>Next scheduled run</span><strong>{displayTime(appState.scheduledRun?.runAt)}</strong></div>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
