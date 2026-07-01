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

Version tags are the source of truth for CI packages. Pushing a tag that matches `v*.*.*` makes the workflow strip the leading `v`, apply that version to `package.json` and `package-lock.json` on the runner, and then build on `macos-latest` and `windows-latest`. For example, `v0.1.4` produces app packages at version `0.1.4`.

The workflow does not publish a GitHub Release and does not require `GH_TOKEN`. Electron-builder publishing remains disabled. Actions uploads a macOS artifact containing only the DMG and a Windows artifact containing a ZIP with the setup and portable EXE files. Workflow artifacts are retained for 30 days.

To create a clean beta release:

1. Commit and push all release changes.
2. Create a version tag, for example: `git tag v0.1.4`.
3. Push the tag: `git push origin v0.1.4`.
4. Open the resulting **Build beta artifacts** run in GitHub Actions and download `yPrompter-macOS-v0.1.4` and `yPrompter-Windows-v0.1.4`.
5. Create a GitHub Release for `v0.1.4`, then upload the macOS DMG and the Windows ZIP or its EXE files.
6. Do not upload `.blockmap` or `latest.yml` files for manual beta releases.

The GitHub Release version, git tag, and packaged app version must match. For example, release `v0.1.4` should use tag `v0.1.4` and contain packages built as app version `0.1.4`.

These CI packages are unsigned beta builds and are not notarized. macOS Gatekeeper may block or warn about the DMG, and Windows SmartScreen may warn about either EXE.

## Known limitations

- yPrompter must remain running in the tray.
- The computer must remain awake at the scheduled time.
- v0.1 does not use macOS `launchd` or Windows Task Scheduler.
- Only one future run is supported.
- Unsigned beta packages may trigger operating-system security warnings.
- yPrompter does not push to GitHub itself. Codex should only push when the prompt explicitly asks it to.
