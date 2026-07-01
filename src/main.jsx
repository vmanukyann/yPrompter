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

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function App() {
  const [appState, setAppState] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [error, setError] = useState("");
  const [logPreview, setLogPreview] = useState("");
  const [now, setNow] = useState(Date.now());

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

  useEffect(() => {
    if (!appState?.running) return;
    const refresh = () => {
      setNow(Date.now());
      window.yPrompter.getLogPreview().then((preview) => setLogPreview(preview.content)).catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [appState?.running, appState?.lastRun?.logPath]);

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
  const run = appState.lastRun;
  const elapsedMs = appState.running
    ? now - new Date(run.startedAt).getTime()
    : run?.durationMs;

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
          <small>
            {appState.codex.detected
              ? `${appState.codex.version} · ${appState.codex.path}`
              : appState.codex.error || "Install Codex CLI, then check again."}
          </small>
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
        {form.approval === "on-request" && (
          <strong>on-request can block unattended runs. Use never for overnight jobs.</strong>
        )}
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

      <section className={`run-status run-status-${run?.status || "idle"}`}>
        <div className="run-status-heading">
          <strong>{appState.running ? "Codex CLI is running..." : "Run status"}</strong>
          {elapsedMs != null && <span>{formatDuration(elapsedMs)}</span>}
        </div>
        <p>yPrompter runs Codex CLI with <code>codex exec</code>. Runs do not appear inside the Codex desktop app.</p>
        {run && (
          <dl>
            <div><dt>Status</dt><dd>{run.status === "succeeded" ? "Success" : run.status}</dd></div>
            {run.exitCode != null && <div><dt>Exit code</dt><dd>{run.exitCode}</dd></div>}
            {run.signal && <div><dt>Signal</dt><dd>{run.signal}</dd></div>}
            {run.repository && <div><dt>Repository</dt><dd>{run.repository}</dd></div>}
            {run.codexPath && <div><dt>Codex</dt><dd>{run.codexPath}</dd></div>}
            {run.logPath && <div><dt>Log</dt><dd>{run.logPath}</dd></div>}
          </dl>
        )}
        {appState.running && (
          <>
            <div className="live-log-actions">
              <button className="danger" onClick={() => act(window.yPrompter.cancelRunning)}>Cancel Running Job</button>
              <button className="secondary" onClick={() => act(window.yPrompter.openLastLog)}>Open Live Log</button>
              <button className="secondary" onClick={() => act(async () => {
                const preview = await window.yPrompter.getLogPreview();
                setLogPreview(preview.content);
              })}>Refresh Log Preview</button>
            </div>
            <pre className="log-preview">{logPreview || "Waiting for Codex output…"}</pre>
          </>
        )}
      </section>

      <footer>
        <div><span>Last run</span><strong className={`run-${appState.lastRun?.status || "none"}`}>{appState.lastRun?.message || "No runs yet"}</strong></div>
        <div><span>Next scheduled run</span><strong>{displayTime(appState.scheduledRun?.runAt)}</strong></div>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
