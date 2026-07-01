# yPrompter Agent Instructions

## Project

yPrompter is a cross-platform Electron desktop app for macOS and Windows.

Tagline: Schedule agent prompts for later.

The app wraps the user's local Codex CLI. It does not ask for OpenAI credentials and does not use private OpenAI APIs.

## v0.1 Goal

Ship a usable beta fast.

The v0.1 app must:
- Run on macOS and Windows.
- Live in the macOS menu bar and Windows system tray.
- Let the user schedule one Codex CLI prompt at a time.
- Let the user run the prompt immediately.
- Save logs locally.
- Show Codex CLI detection status.
- Document that the app must remain running and the computer must be awake.

## Tech Stack

Use Electron.

Prefer:
- TypeScript
- Vite
- React for renderer UI
- electron-builder for packaging

Keep the code boring, readable, and shippable.

## Hard No

Do not add:
- Accounts
- Payments
- Cloud sync
- Telemetry
- Analytics
- Subscription logic
- License keys
- Usage graph
- Six-prompt queue
- Auto-updater
- Native launchd integration
- Native Windows Task Scheduler integration
- Dangerous full-access/yolo Codex modes

Those are not v0.1.

## Codex CLI Integration

Detect Codex using:
- macOS/Linux: which codex
- Windows: where codex
- Also run: codex --version

Execution should use codex exec.

Use:
- --cd for selected repository
- --sandbox for selected sandbox option
- --ask-for-approval for selected approval option

Capture stdout and stderr into timestamped log files.

## Safety

Default sandbox: workspace-write.

Do not expose danger-full-access or yolo in v0.1.

Do not push to GitHub unless the user prompt explicitly says to push.

Scheduled runs are unattended. Warn the user.

## Storage

Use the standard Electron app data directory.

Store:
- settings
- scheduled job
- run logs

## Done Means

A task is not done unless:
- The app builds.
- The main UI opens.
- Codex CLI detection works or fails gracefully.
- Run Now works or fails gracefully.
- Scheduling one future run works while the app is open.
- Logs are written.
- README is updated.