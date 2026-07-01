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
  return iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function formatDuration(milliseconds) {
  if (milliseconds == null || Number.isNaN(milliseconds)) return "—";
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function envelopeMessage(form) {
  if (form.mode === "plan") return "Codex will only plan — no files will be changed.";
  if (form.sandbox === "read-only") return "Codex can inspect this repository, but it cannot change files.";
  if (form.approval === "on-request") {
    return "Codex can edit files inside this repo. You’ll be asked to approve anything outside it.";
  }
  return "Codex can edit files inside this repo without asking for approval.";
}

function resultMessage(run) {
  if (!run) return "No run details are available yet.";
  if (run.status === "succeeded") return "Codex finished successfully.";
  if (run.status === "running") return "Codex is working. Follow the live log for current output.";
  if (run.exitCode != null) return `Codex exited with code ${run.exitCode}. View the log for the failure details.`;
  if (run.status === "failed") {
    return "Codex stopped before finishing — no exit code was returned. This usually means the process was killed externally. View the log for the last output.";
  }
  return run.message || "The run did not complete.";
}

function App() {
  const [appState, setAppState] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [error, setError] = useState("");
  const [logPreview, setLogPreview] = useState("");
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState("");

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

  useEffect(() => {
    const logPath = appState?.lastRun?.logPath;
    if (!logPath) {
      setLogPreview("");
      return;
    }
    window.yPrompter.getLogPreview().then((preview) => setLogPreview(preview.content)).catch(() => {});
  }, [appState?.lastRun?.logPath, appState?.lastRun?.status]);

  const update = (key) => (event) => {
    setError("");
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };
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

  async function copyValue(value, key) {
    await window.yPrompter.copyText(value);
    setCopied(key);
    setTimeout(() => setCopied(""), 1200);
  }

  if (!appState) return <main className="loading">Opening yPrompter…</main>;
  const run = appState.lastRun;
  const elapsedMs = appState.running
    ? now - new Date(run.startedAt).getTime()
    : run?.durationMs;
  const isReady = appState.codex.detected && form.repository.trim() && form.prompt.trim();
  const hasFutureTime = form.runAt && new Date(form.runAt).getTime() > Date.now();
  const runMode = run?.mode || appState.settings?.mode || form.mode;
  const status = !appState.codex.detected || error
    ? { tone: "attention", label: "Needs attention", text: error || appState.codex.error }
    : appState.running
      ? { tone: "running", label: "Running", text: `Codex is running in ${runMode} mode.` }
      : appState.scheduledRun
        ? { tone: "scheduled", label: "Scheduled", text: `Scheduled for ${displayTime(appState.scheduledRun.runAt)}.` }
        : run?.status === "succeeded"
          ? { tone: "completed", label: "Completed", text: `Finished in ${formatDuration(run.durationMs)}.` }
          : run?.status === "failed" || run?.status === "missed"
            ? { tone: "failed", label: "Failed", text: "Run failed." }
            : { tone: "idle", label: "Idle", text: "No runs yet — configure a task below." };

  return (
    <main className="console">
      <header className="app-header">
        <div className="identity">
          <div className="mark">y</div>
          <div>
            <h1>yPrompter</h1>
            <p>Schedule agent prompts for later.</p>
          </div>
        </div>
        <div className="environment">
          <span className={`environment-chip ${appState.codex.detected ? "verified" : "missing"}`}>
            <span aria-hidden="true">{appState.codex.detected ? "✓" : "!"}</span>
            {appState.codex.detected ? "Codex ready" : "Codex missing"}
          </span>
          <span className="environment-detail" title={`${appState.codex.version} · ${appState.codex.path}`}>
            {appState.codex.detected ? `${appState.codex.version} · ${appState.codex.path}` : appState.codex.error}
          </span>
          <button className="button button-quiet" onClick={() => act(window.yPrompter.detectCodex)}>Verify</button>
        </div>
      </header>

      <section className={`persistent-status status-${status.tone}`} aria-live="polite">
        <span className="status-symbol" aria-hidden="true">{status.tone === "completed" ? "✓" : status.tone === "failed" || status.tone === "attention" ? "!" : "●"}</span>
        <div><strong>{status.label}</strong><span>{status.text}</span></div>
      </section>

      <section className="panel task-panel">
        <div className="section-heading"><div><span>Task</span><h2>What should Codex do?</h2></div></div>
        <label className="field">
          <span>Repository</span>
          <div className="field-row">
            <input className="path-input" value={form.repository} onChange={update("repository")} placeholder="Select a repository…" title={form.repository} />
            {form.repository && <button className="button button-icon" title="Copy repository path" onClick={() => copyValue(form.repository, "repo")}>{copied === "repo" ? "Copied" : "Copy"}</button>}
            <button className="button button-secondary" onClick={() => act(chooseRepository)}>Choose…</button>
          </div>
        </label>
        <label className="field prompt-field">
          <span>Task prompt</span>
          <textarea value={form.prompt} onChange={update("prompt")} placeholder="Describe the outcome, constraints, and checks Codex should perform…" rows="7" />
        </label>
      </section>

      <section className="panel">
        <div className="section-heading"><div><span>Execution envelope</span><h2>Trust boundary</h2></div></div>
        <div className="control-grid">
          <label className="field"><span>Mode</span><select value={form.mode} onChange={update("mode")}><option value="plan">Plan</option><option value="goal">Goal</option><option value="execute">Execute</option></select></label>
          <label className="field"><span>Sandbox</span><select value={form.sandbox} onChange={update("sandbox")}><option value="read-only">read-only</option><option value="workspace-write">workspace-write</option></select></label>
          <label className="field"><span>Approval</span><select value={form.approval} onChange={update("approval")}><option value="never">never</option><option value="on-request">on-request</option></select></label>
        </div>
        <p className="consequence"><span aria-hidden="true">→</span>{envelopeMessage(form)}</p>
      </section>

      <section className="panel schedule-panel">
        <div className="section-heading"><div><span>Schedule</span><h2>Run later</h2></div></div>
        <label className="field"><span>Date and time</span><input type="datetime-local" value={form.runAt} onChange={update("runAt")} /></label>
        {appState.scheduledRun && (
          <div className={`schedule-note ${appState.scheduledRun.approval === "on-request" ? "warning" : ""}`}>
            <strong>This run happens unattended.</strong>
            <span>Keep yPrompter open and your Mac awake at {displayTime(appState.scheduledRun.runAt)}.</span>
            {appState.scheduledRun.approval === "on-request" && <span>on-request can block unattended runs. Use never for overnight jobs.</span>}
          </div>
        )}
      </section>

      {error && <div className="inline-error"><strong>Needs attention</strong><span>{error}</span></div>}

      <section className="action-bar">
        <div>
          <button className="button button-primary" disabled={appState.running || !isReady} onClick={() => act(() => window.yPrompter.runNow(request()))}>Run Now</button>
          <button className="button button-secondary" disabled={appState.running || !isReady || !hasFutureTime} onClick={() => act(() => window.yPrompter.schedule(request()))}>{appState.scheduledRun ? "Update Schedule" : "Schedule Run"}</button>
        </div>
        <div>
          {appState.running && <button className="button button-danger" onClick={() => act(window.yPrompter.cancelRunning)}>Stop Run</button>}
          <button className="button button-secondary" disabled={!appState.lastLogPath} onClick={() => act(window.yPrompter.openLastLog)}>View Log</button>
          {appState.scheduledRun && <button className="button button-text-danger" onClick={() => act(window.yPrompter.cancelSchedule)}>Cancel Scheduled Run</button>}
        </div>
      </section>

      <section className={`panel run-detail run-detail-${run?.status || "idle"}`}>
        <div className="section-heading run-detail-heading">
          <div><span>Run detail</span><h2>{appState.running ? "Current run" : "Last run"}</h2></div>
          <span className={`state-badge state-${run?.status || "idle"}`}>{run?.status === "succeeded" ? "Completed" : run?.status || "Idle"}</span>
        </div>
        <p className="result-message">{resultMessage(run)}</p>
        <p className="cli-note">yPrompter runs Codex CLI with <code>codex exec</code>. Runs do not appear inside the Codex desktop app.</p>
        {run ? (
          <dl className="detail-grid">
            <div><dt>Started</dt><dd>{displayTime(run.startedAt)}</dd></div>
            <div><dt>Finished</dt><dd>{displayTime(run.finishedAt)}</dd></div>
            <div><dt>Duration</dt><dd>{formatDuration(elapsedMs)}</dd></div>
            <div><dt>Exit code</dt><dd>{run.exitCode == null ? "—" : run.exitCode}</dd></div>
            {run.signal && <div><dt>Signal</dt><dd>{run.signal}</dd></div>}
          </dl>
        ) : <p className="empty-state">Run details will appear here after the first run.</p>}
        {run?.logPath && (
          <div className="log-path-row">
            <div><span>Log file</span><code title={run.logPath}>{run.logPath}</code></div>
            <button className="button button-icon" onClick={() => copyValue(run.logPath, "log")}>{copied === "log" ? "Copied" : "Copy"}</button>
          </div>
        )}
        {run?.logPath && (
          <details className="log-tail" open={appState.running}>
            <summary>Log tail</summary>
            <div className="log-toolbar">
              <button className="button button-secondary" onClick={() => act(window.yPrompter.openLastLog)}>{appState.running ? "Open Live Log" : "View Full Log"}</button>
              <button className="button button-secondary" onClick={() => act(async () => {
                const preview = await window.yPrompter.getLogPreview();
                setLogPreview(preview.content);
              })}>Refresh</button>
            </div>
            <pre className="log-preview">{logPreview || "Waiting for Codex output…"}</pre>
          </details>
        )}
      </section>

      <section className="panel recent-runs">
        <div className="section-heading"><div><span>History</span><h2>Recent runs</h2></div></div>
        {/* TODO(v0.2): Populate when a bounded run-history store exists. */}
        <p className="empty-state">No recent runs yet.</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
