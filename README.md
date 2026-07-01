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

### GitHub Actions beta builds

Pushing a version tag that matches `v*.*.*` (for example, `v0.1.1`) starts the **Build beta artifacts** workflow. It builds on both `macos-latest` and `windows-latest`. You can also run it manually from **Actions → Build beta artifacts → Run workflow**.

After both jobs finish, open the workflow run in GitHub and download `yPrompter-macOS-<tag>` and `yPrompter-Windows-<tag>` from its **Artifacts** section. GitHub downloads each workflow artifact as a ZIP. The macOS ZIP contains the DMG, and the Windows ZIP contains the NSIS installer and portable EXE. Workflow artifacts are retained for 30 days.

To publish the files with a GitHub Release:

1. Download and unzip both workflow artifacts.
2. Open the repository's **Releases** page and create a new release for the same tag, or edit an existing release for that tag.
3. Drag the DMG and both Windows EXE files into the release's binary attachment area.
4. Mark the release as a pre-release while yPrompter remains in beta, then publish it.

These CI packages are unsigned beta builds and are not notarized. macOS Gatekeeper may block or warn about the DMG, and Windows SmartScreen may warn about either EXE.

## Known limitations

- yPrompter must remain running in the tray.
- The computer must remain awake at the scheduled time.
- v0.1 does not use macOS `launchd` or Windows Task Scheduler.
- Only one future run is supported.
- Unsigned beta packages may trigger operating-system security warnings.
- yPrompter does not push to GitHub itself. Codex should only push when the prompt explicitly asks it to.
