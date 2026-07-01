# yPrompter

**Schedule agent prompts for later.**

yPrompter is a macOS menu-bar and Windows system-tray app. Queue up to six local Codex jobs, attach reference images, and run each prompt now or at a future time.

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

## Queue and schedule jobs

1. Add or select a queued job.
2. Choose a repository folder and enter the prompt.
3. Optionally add up to five PNG, JPG/JPEG, or WebP images.
4. Choose a future local date and time.
5. Select Plan, Goal, or Execute mode.
6. Choose a sandbox and approval policy.
7. Click **Schedule Run**.

The queue holds up to six jobs. Only one Codex process runs at a time; scheduled jobs that become due while another job is running wait for it to finish.

## Local image attachments

Selected images are validated (20 MB maximum per file) and copied into:

- macOS: `~/Library/Application Support/yPrompter/jobs/<jobId>/attachments`
- Windows: `%APPDATA%\yPrompter\jobs\<jobId>\attachments`

Removing an image or clearing a job's images removes the local copies. yPrompter never uploads attachments itself. At execution time, existing copies are passed to supported Codex CLIs with `codex exec --image`. Older Codex versions are blocked with an update message.

## Logs and local settings

Each run captures Codex stdout and stderr in a timestamped file. Use **Open Last Log** from the app.

- macOS: `~/Library/Application Support/yPrompter/runs/logs`
- Windows: `%APPDATA%\yPrompter\runs\logs`

Queued jobs and schedules are stored in `settings.json` in the same yPrompter app-data directory. Future scheduled jobs are restored after an app restart.

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
- Up to six jobs and five images per job are supported.
- Unsigned beta packages may trigger operating-system security warnings.
- yPrompter does not push to GitHub itself. Codex should only push when the prompt explicitly asks it to.
