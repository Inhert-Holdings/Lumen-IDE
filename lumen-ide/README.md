# Lumen IDE

Lumen IDE is a premium AI-first desktop IDE built on top of the OpenAI Codex repository. Its internal AI engine is **Nyx**, now wired for live inference via the OpenAI Responses API.

## Setup

```bash
cd lumen-ide
npm install
```

## Run locally (dev)

```bash
# PowerShell
$env:OPENAI_API_KEY="your-key-here"

npm start
```

This launches Electron + Vite and opens the Lumen IDE window with:
- Dark luxury UI
- Explorer sidebar
- Monaco Editor
- Nyx AI Console (live)
- Settings panel

## Nyx live inference

Nyx auto-selects a model based on task complexity and what your API key can access. Defaults are:

- Low complexity: `codex-mini-latest`
- Medium complexity: `gpt-5.1-codex`
- High complexity: `gpt-5.2-codex`

You can also manually select a model and reasoning effort in the Nyx Console.

Optional overrides via environment variables:

```bash
$env:LUMEN_MODEL_LOW="codex-mini-latest"
$env:LUMEN_MODEL_MEDIUM="gpt-5.1-codex"
$env:LUMEN_MODEL_HIGH="gpt-5.2-codex"
$env:LUMEN_MODEL_OVERRIDE="gpt-5.1-codex"
```

Nyx uses `OPENAI_API_KEY` and an optional `OPENAI_BASE_URL` for enterprise routing.

## Build & Package

```bash
npm run build
```

Artifacts land in `lumen-ide/release/`.

## Folder Structure

```
lumen-ide/
  backend/          # Nyx engine + OpenAI client
  src/
    components/     # Top bar, settings panel
    editor/         # Monaco editor integration
    panels/         # Explorer + Nyx console
    services/       # Renderer-side Nyx bridge
  main.js           # Electron main process
  preload.js        # IPC bridge (future secure API)
```

## Nyx Integration

- `src/services/nyxService.js` is the renderer-side API.
- `backend/nyxService.js` handles model selection + live inference.
- `backend/openaiClient.js` wraps `/v1/models` and `/v1/responses`.
- `main.js` exposes IPC handlers (`nyx:send`, `nyx:suggestions`, `settings:*`).

Replace the placeholder logic with real AI runtime, vector memory, and server connectors.

## Notes

- Codex CLI remains intact at the repo root.
- Lumen IDE is additive and isolated under `/lumen-ide`.
- Local settings are stored in `lumen-ide/.lumen-user/` for this build.
