# Lumen IDE (Desktop)

Lumen IDE is a local-first desktop IDE built with Electron + React + TypeScript.

## Implemented scope

- Explorer: open folder, recursive file tree, create/rename/delete file and folder, file search
- Monaco editor: multi-tab editing and save
- Terminal: xterm.js + node-pty with multiple tabs, clear/kill tab
- Git panel: status, per-file diff, stage/unstage, commit, push (online mode gated)
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
- Integrated runtime bundle support:
  - bundled `ollama.exe` inside app resources
  - bundled `qwen2.5-coder:7b` model seed copied to app data on first run
  - works without installing Ollama separately
- Offline-first policy: online mode defaults OFF and blocks non-local remote actions
- Project runtime detection improvements:
  - broader script detection (`dev`, `start`, `preview`, `serve`, `dev:*`, `start:*`)
  - framework URL defaults for Vite/Next/Astro/Nuxt/SvelteKit/CRA/Angular
  - Python detection expanded to FastAPI, Flask, and Django
- Audit log with secret redaction
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

- Browser automation phase (Playwright browsing/search tools) is intentionally skipped in this implementation and documented as online-only future work.
- `run_cmd` is restricted to workspace cwd and blocks common unsafe patterns; it is not a full OS sandbox.
- Secret storage uses Electron `safeStorage` encryption.
