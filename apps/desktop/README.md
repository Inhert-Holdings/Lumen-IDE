# Lumen IDE (Desktop)

Lumen IDE is a local-first desktop IDE built with Electron + React + TypeScript.

## Implemented scope

- Explorer: open folder, recursive file tree, create/rename/delete file and folder, file search
- Monaco editor: multi-tab editing and save
- Terminal: xterm.js + node-pty with multiple tabs, clear/kill tab
- Git panel: status, per-file diff, stage/unstage, commit, push (online mode gated), branch switch/create, history, file restore, conflict helper (`ours/theirs`)
- AI Agent panel: autonomous PLAN -> EXECUTE -> VERIFY -> PROPOSE -> APPLY flow
- Patch review supports per-file select plus hunk-level partial apply
- Applied patch history with rollback of the latest applied patch set
- Strict action schema for internal tools (`list_dir`, `read_file`, `search_files`, `write_file`, `delete_file`, `run_cmd`, `git_*`)
- Approval modal before write/delete/non-read-only run_cmd/git commit/git push
- Settings for local LLM presets (LM Studio + Ollama), model picker, connection test
- Settings includes integrated local model management:
  - Refresh installed local models
  - Install selected model via Ollama from inside Lumen
  - Auto-fallback to an installed model if configured model is missing
- Auto-managed local runtime mode (Ollama) runs in background with no extra UI windows
- Runtime health API and diagnostics panel (`runtime:getHealth`) for process/runtime/preview status
- Integrated runtime bundle support:
  - bundled `ollama.exe` inside app resources
  - bundled `qwen2.5-coder:7b` model seed copied to app data on first run
  - works without installing Ollama separately
- Offline-first policy: online mode defaults OFF and blocks non-local remote actions
- Trust engine presets replace full-access toggle:
  - `read_only`, `local_edit_only`, `local_build_mode`, `preview_operator`, `git_operator`, `full_local_workspace`, `trusted_workspace_profile`
  - default preset is `full_local_workspace`
  - policy decisions are enforced at tool boundaries and logged with risk/decision metadata
- Dedicated Permissions Center panel:
  - live policy matrix per preset
  - preset apply control with runtime sync
  - command-sample evaluation for `run_cmd` risk/approval behavior
- Agent phases and execution model:
  - explicit phases: `understand → scope → plan → execute → verify → recover → propose → apply → summarize`
  - task graph + confidence lanes (`obvious`, `likely`, `uncertain`, `risky`)
  - planner context uses workspace inspection + git + preview + session memory
  - helper lane is hard-scoped to side jobs (mini-plan, action extraction, terminal summarization)
  - recovery policy handlers for common failures (missing scripts, dependency issues, port conflicts, compile-error localization)
  - apply phase detects workspace drift and blocks conflicting hunks/files from unsafe apply
- Live Build Mode:
  - continuous preview/terminal signal loop
  - auto-runs safe read-only checks
  - write/delete/apply remains approval-gated
- Performance/weight controls:
  - lazy-mounted right-panel views (agent/timeline/preview/git/permissions/settings/audit/diagnostics)
  - low-resource mode reduces index depth, polling rates, and disables helper lane
  - scoped preview polling based on active contextual tabs
  - renderer bundle split (`vendor`, `vendor-monaco`, `vendor-terminal`, `vendor-layout`, `vendor-state`)
- Store architecture:
  - renderer store split into slice modules: `ui`, `workspace`, `editor`, `terminal`, `preview`, `git`, `agent`, `policy`
- Project runtime detection improvements:
  - broader script detection (`dev`, `start`, `preview`, `serve`, `dev:*`, `start:*`)
  - framework URL defaults for Vite/Next/Astro/Nuxt/SvelteKit/CRA/Angular
  - Python detection expanded to FastAPI, Flask, and Django
- Audit log with secret redaction
- Preview Mission Control:
  - browser screenshot capture
  - reusable verification flows (save/run/delete local flow macros)
  - interaction recorder for browser actions + rerun-last-flow shortcut
  - diagnostics panes with DOM summary, console events, and network event feed
- Agent session persistence:
  - task graph + session working memory are persisted per workspace and restored on restart
- Compact mode toggle and keyboard shortcuts

## Presets

- LM Studio
  - `base_url`: `http://localhost:1234/v1`
  - `model`: `Qwen2.5-Coder-7B-Instruct`
- Ollama
  - `base_url`: `http://localhost:11434/v1`
  - `model`: `qwen2.5-coder:7b`

`api_key` is optional for both.

## Keyboard shortcuts

- `Ctrl+P` command palette
- `Ctrl+Shift+`` toggle terminal
- `Ctrl+B` toggle explorer
- `Ctrl+L` focus agent prompt
- `Ctrl+S` save active tab

## Run locally

```powershell
pnpm install
pnpm --filter @lumen/desktop dev
```

From repository root, you can also run:

```powershell
pnpm dev
```

## Build Windows artifact

```powershell
pnpm --filter @lumen/desktop build
```

To clear old desktop build artifacts and local Vite cache:

```powershell
pnpm --filter @lumen/desktop clean
```

Output:

- `apps/desktop/release/Lumen IDE Setup 0.1.0.exe`
- `apps/desktop/release/win-unpacked/`

Note: the all-in-one build is large because it includes the local model payload.

## Integrated local model setup (no extra terminal needed)

1. Open `Settings` panel.
2. Select `Ollama` preset.
3. Turn `Online mode` ON only for model download.
4. Click `Install Selected Model`.
5. Click `Connection Test`.
6. Save settings.

If no model is installed yet, Connection Test now shows a direct setup message instead of a generic 404.

## Notes and limitations

- Browser automation is integrated for preview interaction (`connect/snapshot/click/type/press`) and remains online-gated for remote URLs.
- Browser automation in preview now also includes screenshot capture and reusable verification flows.
- `run_cmd` is restricted to workspace cwd and blocks common unsafe patterns; it is not a full OS sandbox.
- Secret storage uses Electron `safeStorage` encryption.
