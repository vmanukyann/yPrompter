# yPrompter Product Spec

## One-line pitch

yPrompter schedules agent prompts for later.

## Main use case

A user is out of Codex quota or wants Codex to run while they are away. They pick a repo, paste a prompt, choose a time, and yPrompter runs the prompt through the local Codex CLI.

## Technical backend

Use the local Codex CLI. Do not call private OpenAI APIs. Do not ask for OpenAI credentials.

Execution command pattern:

codex exec --cd "<repo>" --sandbox "<sandbox>" --ask-for-approval "<approval>" "<prompt>"

## v0.1 Platform

- macOS menu bar
- Windows system tray
- Electron app

## v0.1 Constraint

The app must remain running and the computer must be awake at the scheduled time.

## Modes

Plan mode prepends:
Do not modify files. Inspect the repo and produce a careful implementation plan.

Goal mode prepends:
Work toward this goal over this repository. Make the smallest safe progress possible, then summarize what changed and what remains.

Execute mode prepends:
Implement the requested change. Modify files as needed. Run relevant checks. Summarize changed files and test results.

## Safety defaults

- Default sandbox: workspace-write
- Default scheduled approval mode: never
- Do not include full-access / yolo / dangerous bypass options in v0.1
- Do not push to GitHub unless the user prompt explicitly says to push