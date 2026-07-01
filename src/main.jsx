import React, { useEffect, useMemo, useState } from "react";
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

function formFromJob(job) {
  return {
    ...blankForm,
    ...job,
    runAt: localInputValue(job?.runAt)
  };
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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function envelopeMessage(form) {
  if (form.mode === "plan") return "Codex will only plan — no files will be changed.";
  if (form.sandbox === "read-only") return "Codex can inspect this repository, but it cannot change files.";
  if (form.approval === "on-request") {
    return "Codex can edit files inside this repo. You’ll be asked to approve anything outside it.";
  }
  return "Codex can edit files inside this repo without asking for approval.";
}

function envelopeRisk(form) {
  if (form.mode === "plan" || form.sandbox === "read-only") {
    return { level: "contained", label: "Contained", detail: "No repository writes" };
  }
  if (form.approval === "on-request") {
    return { level: "guarded", label: "Guarded", detail: "Writes allowed · escalation gated" };
  }
  return { level: "elevated", label: "Elevated autonomy", detail: "Workspace writes · no approval prompts" };
}

function resultMessage(run) {
  if (!run) return "No run details are available yet.";
  if (run.status === "succeeded") return "Codex finished successfully.";
  if (run.status === "running") return "Codex is working. Follow the live log for current output.";
  if (run.exitCode != null) return `Codex exited with code ${run.exitCode}. View the log for details.`;
  return run.message || "The run did not complete.";
}

function runStatusLabel(value) {
  const status = typeof value === "string" ? value : value?.status;
  if (!status || status === "draft") return "Draft";
  if (status === "succeeded") return "Completed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function jobTitle(job, index) {
  const firstLine = job.prompt?.trim().split(/\r?\n/)[0];
  return firstLine ? firstLine.slice(0, 44) : `Untitled job ${index + 1}`;
}

function App() {
  const [appState, setAppState] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [form, setForm] = useState(blankForm);
  const [error, setError] = useState("");
  const [logPreview, setLogPreview] = useState("");
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState("");

  useEffect(() => {
    window.yPrompter.getState().then((next) => {
      setAppState(next);
      const initialId = next.selectedJobId || next.jobs[0]?.id || "";
      setSelectedJobId(initialId);
      setForm(formFromJob(next.jobs.find((job) => job.id === initialId)));
    });
    return window.yPrompter.onStateChanged((next) => {
      setAppState(next);
      if (next.selectedJobId && next.selectedJobId !== selectedJobId) {
        setSelectedJobId(next.selectedJobId);
        setForm(formFromJob(next.jobs.find((job) => job.id === next.selectedJobId)));
      }
    });
  }, [selectedJobId]);

  useEffect(() => {
    if (!appState || !selectedJobId) return;
    const timer = setTimeout(() => {
      window.yPrompter.updateJob(selectedJobId, request())
        .then((updatedJob) => {
          setAppState((current) => current ? {
            ...current,
            jobs: current.jobs.map((job) => job.id === updatedJob.id ? updatedJob : job)
          } : current);
        })
        .catch((caught) => {
          setError(caught.message || String(caught));
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [form, selectedJobId]);

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

  const selectedJob = useMemo(
    () => appState?.jobs.find((job) => job.id === selectedJobId) || null,
    [appState?.jobs, selectedJobId]
  );

  const update = (key) => (event) => {
    setError("");
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const request = () => ({
    ...form,
    runAt: form.runAt ? new Date(form.runAt).toISOString() : ""
  });

  async function act(action) {
    setError("");
    try {
      return await action();
    } catch (caught) {
      setError(caught.message || String(caught));
      return null;
    }
  }

  async function chooseRepository() {
    const folder = await window.yPrompter.chooseRepository();
    if (folder) setForm((current) => ({ ...current, repository: folder }));
  }

  async function chooseJob(job) {
    if (job.id === selectedJobId) return;
    setSelectedJobId(job.id);
    setForm(formFromJob(job));
    await act(() => window.yPrompter.selectJob(job.id));
  }

  async function addJob() {
    const job = await act(window.yPrompter.addJob);
    if (job) {
      setSelectedJobId(job.id);
      setForm(formFromJob(job));
    }
  }

  async function removeSelectedJob() {
    if (!selectedJob) return;
    await act(() => window.yPrompter.removeJob(selectedJob.id));
  }

  async function copyValue(value, key) {
    await window.yPrompter.copyText(value);
    setCopied(key);
    setTimeout(() => setCopied(""), 1200);
  }

  if (!appState || !selectedJob) return <main className="loading">Opening yPrompter…</main>;

  const run = appState.lastRun;
  const elapsedMs = appState.running && run
    ? now - new Date(run.startedAt).getTime()
    : run?.durationMs;
  const attachments = selectedJob.attachments || [];
  const attachmentsBlocked = attachments.length > 0 && !appState.codex.imageSupport;
  const isReady = appState.codex.detected
    && form.repository.trim()
    && form.prompt.trim()
    && !attachmentsBlocked;
  const hasFutureTime = form.runAt && new Date(form.runAt).getTime() > Date.now();
  const scheduleDisabled = appState.running || !isReady || !hasFutureTime;
  const scheduleHint = appState.running
    ? "Wait for the current run to finish before scheduling."
    : attachmentsBlocked
      ? "Update Codex and click Verify before scheduling a job with images."
      : !appState.codex.detected
        ? "Verify the Codex CLI before scheduling a run."
        : !form.repository.trim() && !form.prompt.trim()
          ? "Choose a repository and add a command brief before scheduling."
          : !form.repository.trim()
            ? "Choose a repository before scheduling this run."
            : !form.prompt.trim()
              ? "Add a command brief before scheduling this run."
              : !hasFutureTime
                ? "Choose a future time to schedule this run."
                : "";
  const risk = envelopeRisk(form);
  const scheduledCount = appState.jobs.filter((job) => job.status === "scheduled").length;
  const status = !appState.codex.detected || error
    ? { tone: "attention", label: "Needs attention", text: error || appState.codex.error }
    : appState.running
      ? { tone: "running", label: "Running", text: `Codex is running queued job ${appState.jobs.findIndex((job) => job.id === appState.runningJobId) + 1}.` }
      : scheduledCount
        ? { tone: "scheduled", label: "Scheduled", text: `${scheduledCount} job${scheduledCount === 1 ? "" : "s"} waiting in the queue.` }
        : run?.status === "succeeded"
          ? { tone: "completed", label: "Completed", text: `Finished in ${formatDuration(run.durationMs)}.` }
          : run?.status === "failed" || run?.status === "missed"
            ? { tone: "failed", label: "Failed", text: run.message || "Run failed." }
            : { tone: "idle", label: "Idle", text: "Queue a task or run the selected job now." };

  return (
    <main className="console">
      <header className="app-header">
        <div className="identity">
          <div className="mark" role="img" aria-label="yPrompter">
            <span className="mark-y">y</span><span className="mark-prompt">&gt;</span><span className="mark-cursor" aria-hidden="true" />
          </div>
          <div>
            <h1>yPrompter</h1>
            <p>Run Console</p>
          </div>
        </div>
        <div className="environment">
          <div className="environment-main">
            <span className={`environment-chip ${appState.codex.detected ? "verified" : "missing"}`}>
              <span className="environment-dot" aria-hidden="true" />
              {appState.codex.detected ? "Codex ready" : "Codex missing"}
            </span>
            <button className="button button-quiet" onClick={() => act(window.yPrompter.detectCodex)}>Verify</button>
          </div>
          <details className="environment-details">
            <summary>CLI details</summary>
            <div className="environment-popover">
              <span>Version</span><code>{appState.codex.version || "Unavailable"}</code>
              <span>Image input</span><code>{appState.codex.imageSupport ? "Supported · --image" : "Not supported"}</code>
              <span>Executable</span><code title={appState.codex.path}>{appState.codex.path || appState.codex.error}</code>
            </div>
          </details>
        </div>
      </header>

      <section className={`persistent-status status-${status.tone}`} aria-live="polite">
        <span className="status-symbol" aria-hidden="true">{status.tone === "completed" ? "✓" : status.tone === "failed" || status.tone === "attention" ? "!" : "●"}</span>
        <div><strong>{status.label}</strong><span>{status.text}</span></div>
      </section>

      <div className="console-grid">
        <div className="setup-zone">
          <section className="queue-strip" aria-label="Job queue">
            <div className="queue-heading">
              <div><span>Queue</span><strong>{appState.jobs.length} / {appState.limits.jobs} jobs</strong></div>
              <button className="button button-secondary" disabled={appState.jobs.length >= appState.limits.jobs} onClick={addJob}>+ Add Job</button>
            </div>
            <div className="queue-list">
              {appState.jobs.map((job, index) => (
                <button
                  key={job.id}
                  className={`queue-job ${job.id === selectedJobId ? "selected" : ""}`}
                  onClick={() => chooseJob(job)}
                >
                  <span className={`queue-index state-${job.status}`}>{String(index + 1).padStart(2, "0")}</span>
                  <span className="queue-copy">
                    <strong>{jobTitle(job, index)}</strong>
                    <small>
                      {runStatusLabel(job.status)}
                      {job.attachments?.length ? ` · ${job.attachments.length} image${job.attachments.length === 1 ? "" : "s"}` : ""}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel task-panel">
            <div className="section-heading">
              <div><span>01 / Task setup</span><h2>Define queued job {appState.jobs.findIndex((job) => job.id === selectedJobId) + 1}</h2></div>
              <button className="button button-text-danger" disabled={appState.runningJobId === selectedJobId} onClick={removeSelectedJob}>Remove Job</button>
            </div>
            <label className="field repository-field">
              <span>Repository</span>
              <div className="field-row">
                <span className="path-prefix" aria-hidden="true">~/</span>
                <input className="path-input" value={form.repository} onChange={update("repository")} placeholder="Select a repository…" title={form.repository} />
                {form.repository && <button className="button button-icon" title="Copy repository path" onClick={() => copyValue(form.repository, "repo")}>{copied === "repo" ? "Copied" : "Copy"}</button>}
                <button className="button button-secondary" onClick={() => act(chooseRepository)}>Choose…</button>
              </div>
            </label>
            <label className="field prompt-field">
              <div className="field-label-row"><span>Command brief</span><span className="editor-language">TASK.md</span></div>
              <div className="prompt-editor">
                <div className="editor-gutter" aria-hidden="true">01<br />02<br />03<br />04<br />05<br />06</div>
                <textarea value={form.prompt} onChange={update("prompt")} placeholder="Describe the result Codex should deliver…" rows="8" />
              </div>
              <div className="prompt-guides">
                <span><b>Outcome</b> What should be true?</span>
                <span><b>Constraints</b> What must stay unchanged?</span>
                <span><b>Checks</b> How should Codex verify it?</span>
              </div>
            </label>

            <div className="attachments-section">
              <div className="attachments-heading">
                <div>
                  <span>Attachments</span>
                  <small>PNG, JPG/JPEG, or WebP · 20 MB each · stored locally</small>
                </div>
                <div>
                  <span className="attachment-count">{attachments.length} / {appState.limits.attachments}</span>
                  <button className="button button-secondary" disabled={attachments.length >= appState.limits.attachments || appState.runningJobId === selectedJobId} onClick={() => act(() => window.yPrompter.addImages(selectedJobId))}>Add Images</button>
                  {attachments.length > 0 && <button className="button button-quiet button-clear" disabled={appState.runningJobId === selectedJobId} onClick={() => act(() => window.yPrompter.clearImages(selectedJobId))}>Clear Images</button>}
                </div>
              </div>
              {attachments.length ? (
                <ul className="attachment-list">
                  {attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <span className="attachment-icon" aria-hidden="true">IMG</span>
                      <div><strong title={attachment.name}>{attachment.name}</strong><small>{attachment.type.toUpperCase()} · {formatBytes(attachment.size)}</small></div>
                      <button className="button button-icon" disabled={appState.runningJobId === selectedJobId} onClick={() => act(() => window.yPrompter.removeImage(selectedJobId, attachment.id))} aria-label={`Remove ${attachment.name}`}>Remove</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="attachments-empty">No images attached. Imported images are copied into this job’s local app-data folder.</p>}
              {attachmentsBlocked && (
                <p className="attachment-warning"><span aria-hidden="true">!</span>Image execution requires a newer Codex CLI. Update Codex, then click Verify.</p>
              )}
            </div>
          </section>

          <section className="panel envelope-panel">
            <div className="section-heading">
              <div><span>02 / Execution envelope</span><h2>Autonomy &amp; trust boundary</h2></div>
              <span className={`risk-badge risk-${risk.level}`}><i />{risk.label}</span>
            </div>
            <div className="control-grid">
              <label className="boundary-control">
                <span>Operating mode</span><small>What Codex may attempt</small>
                <select value={form.mode} onChange={update("mode")}><option value="plan">Plan only</option><option value="goal">Goal-directed</option><option value="execute">Execute</option></select>
              </label>
              <label className="boundary-control">
                <span>Filesystem boundary</span><small>Where changes are permitted</small>
                <select value={form.sandbox} onChange={update("sandbox")}><option value="read-only">Read only</option><option value="workspace-write">Workspace write</option></select>
              </label>
              <label className="boundary-control">
                <span>Approval policy</span><small>When execution must pause</small>
                <select value={form.approval} onChange={update("approval")}><option value="never">Never ask</option><option value="on-request">Ask on request</option></select>
              </label>
            </div>
            <div className={`consequence consequence-${risk.level}`}>
              <div><span>Computed consequence</span><strong>{risk.detail}</strong></div>
              <p>{envelopeMessage(form)}</p>
            </div>
          </section>

          <section className="panel schedule-panel">
            <div className="section-heading"><div><span>03 / Schedule</span><h2>Run later</h2></div><span className="section-meta">Optional</span></div>
            <div className="schedule-row">
              <label className="field"><span>Local date and time</span><input type="datetime-local" value={form.runAt} onChange={update("runAt")} /></label>
              <p>yPrompter must remain open and this computer must stay awake.</p>
            </div>
            {scheduleHint && <p className="schedule-hint"><span aria-hidden="true">i</span>{scheduleHint}</p>}
            {selectedJob.status === "scheduled" && (
              <div className={`schedule-note ${selectedJob.approval === "on-request" ? "warning" : ""}`}>
                <strong>Queued for {displayTime(selectedJob.runAt)}</strong>
                <span>{selectedJob.approval === "on-request" ? "Approval requests can block this unattended run." : "Images and prompt are stored locally until execution."}</span>
              </div>
            )}
          </section>

          {error && <div className="inline-error"><strong>Needs attention</strong><span>{error}</span></div>}

          <section className="action-bar" aria-label="Run actions">
            <div className="primary-actions">
              <button className="button button-primary" disabled={appState.running || !isReady} onClick={() => act(() => window.yPrompter.runNow(selectedJobId, request()))}><span aria-hidden="true">▶</span> Run Now</button>
              <button className="button button-secondary" disabled={scheduleDisabled} onClick={() => act(() => window.yPrompter.schedule(selectedJobId, request()))}>{selectedJob.status === "scheduled" ? "Update Schedule" : "Schedule Run"}</button>
            </div>
            <div className="secondary-actions">
              {appState.runningJobId === selectedJobId && <button className="button button-danger" onClick={() => act(window.yPrompter.cancelRunning)}>Stop Run</button>}
              {selectedJob.status === "scheduled" && <button className="button button-text-danger" onClick={() => act(() => window.yPrompter.cancelSchedule(selectedJobId))}>Cancel Scheduled Run</button>}
            </div>
          </section>
        </div>

        <aside className="operations-zone">
          <section className={`panel run-detail run-detail-${run?.status || "idle"}`}>
            <div className="section-heading run-detail-heading">
              <div><span>Operations</span><h2>{appState.running ? "Current run" : "Last run"}</h2></div>
              <span className={`state-badge state-${run?.status || "idle"}`}>{runStatusLabel(run)}</span>
            </div>
            <p className="result-message">{resultMessage(run)}</p>
            {run ? (
              <>
                <dl className="detail-grid">
                  <div><dt>Started</dt><dd>{displayTime(run.startedAt)}</dd></div>
                  <div><dt>Finished</dt><dd>{displayTime(run.finishedAt)}</dd></div>
                  <div><dt>Duration</dt><dd>{formatDuration(elapsedMs)}</dd></div>
                  <div><dt>Exit code</dt><dd>{run.exitCode == null ? "—" : run.exitCode}</dd></div>
                </dl>
                {run.attachmentNames?.length > 0 && (
                  <div className="run-attachments">
                    <span>Image input</span>
                    <p>{run.attachmentNames.join(", ")}</p>
                  </div>
                )}
              </>
            ) : <div className="empty-run"><span aria-hidden="true">&gt;_</span><p>Run facts will appear after the first execution.</p></div>}
            <p className="cli-note">Attachments stay local until <code>codex exec --image</code> runs.</p>
          </section>

          <section className="panel log-card">
            <div className="section-heading">
              <div><span>Output</span><h2>Run log</h2></div>
              <button className="button button-quiet" disabled={!appState.lastLogPath} onClick={() => act(window.yPrompter.openLastLog)}>View Log</button>
            </div>
            {run?.logPath ? (
              <>
                <div className="log-path-row">
                  <code title={run.logPath}>{run.logPath}</code>
                  <button className="button button-icon" onClick={() => copyValue(run.logPath, "log")}>{copied === "log" ? "Copied" : "Copy"}</button>
                </div>
                <details className="log-tail" open={appState.running}>
                  <summary>Log tail</summary>
                  <div className="log-toolbar">
                    <button className="button button-secondary" onClick={() => act(async () => {
                      const preview = await window.yPrompter.getLogPreview();
                      setLogPreview(preview.content);
                    })}>Refresh output</button>
                  </div>
                  <pre className="log-preview">{logPreview || "Waiting for Codex output…"}</pre>
                </details>
              </>
            ) : <p className="empty-state">No log is available yet.</p>}
          </section>

          <section className="panel recent-runs">
            <div className="section-heading"><div><span>History</span><h2>Recent runs</h2></div></div>
            {appState.runs.length ? (
              <div className="history-list">
                {appState.runs.slice(0, 4).map((item) => (
                  <div className="history-run" key={item.id || `${item.startedAt}-${item.finishedAt}`}>
                    <span className={`history-status state-${item.status}`} aria-hidden="true" />
                    <div>
                      <strong>{runStatusLabel(item)}</strong>
                      <span>{displayTime(item.startedAt || item.finishedAt)}</span>
                      {item.attachmentNames?.length > 0 && <small>{item.attachmentNames.join(", ")}</small>}
                    </div>
                    <dl>
                      <div><dt>Duration</dt><dd>{formatDuration(item.durationMs)}</dd></div>
                      <div><dt>Exit</dt><dd>{item.exitCode == null ? "—" : item.exitCode}</dd></div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : <div className="history-empty"><span>—</span><p>No recent runs yet.</p></div>}
          </section>
        </aside>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
