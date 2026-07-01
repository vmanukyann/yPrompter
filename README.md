# yPrompter

**Schedule agent prompts for later.**

yPrompter is a tiny macOS menu-bar and Windows system-tray app. Choose a local repository, write a prompt, and run it with the local Codex CLI now or at one future time.

> **Early beta:** macOS may warn because the app is not notarized. Windows SmartScreen may warn because the app is unsigned.

## Requirements

- macOS or Windows
- Node.js 20+ to build from source
- The Codex CLI, already installed and signed in

Install the Codex CLI:

```sh
npm install -g @openai/codex
codex --version
```

yPrompter never asks for or stores OpenAI credentials. Authentication remains entirely with your local Codex installation.

## Run in development

```sh
npm install
npm run dev
```

Vite starts the React UI and Electron opens yPrompter. Closing the window hides it; use the tray/menu-bar icon to reopen it. Choose **Quit** in the tray menu to stop the app.

## Schedule a prompt

1. Choose a repository folder.
2. Enter the prompt.
3. Choose a future local date and time.
4. Select Plan, Goal, or Execute mode.
5. Choose a sandbox and approval policy.
6. Click **Schedule**.

Only one run can be scheduled at a time. Scheduling another replaces the current run. Scheduled runs default to `workspace-write` and `never` approval.

## Logs and local settings

Each run captures Codex stdout and stderr in a timestamped file. Use **Open Last Log** from the app.

- macOS: `~/Library/Application Support/yPrompter/runs/logs`
- Windows: `%APPDATA%\yPrompter\runs\logs`

Settings and the pending schedule are stored in `settings.json` in the same yPrompter app-data directory. A future scheduled run is restored after an app restart.

## Build releases

Build the web assets without packaging:

```sh
npm run build
```

Package on macOS:

```sh
npm run package:mac
```

Package on Windows:

```sh
npm run package:win
```

Artifacts are written to `release/`. macOS builds use a DMG target; Windows builds include NSIS installer and portable EXE targets. The v0.1 packages are intentionally unsigned. For the most reliable native package, run each packaging command on its target operating system.

## Known limitations

- yPrompter must remain running in the tray.
- The computer must remain awake at the scheduled time.
- v0.1 does not use macOS `launchd` or Windows Task Scheduler.
- Only one future run is supported.
- Unsigned beta packages may trigger operating-system security warnings.
- yPrompter does not push to GitHub itself. Codex should only push when the prompt explicitly asks it to.
