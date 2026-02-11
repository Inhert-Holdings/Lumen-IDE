# Lumen IDE

Lumen IDE is a premium AI-first desktop IDE built on top of the OpenAI Codex repository. Its internal AI engine is **Nyx**, currently stubbed with placeholders and ready for future integrations.

## Setup

```bash
cd lumen-ide
npm install
```

## Run locally (dev)

```bash
npm start
```

This launches Electron + Vite and opens the Lumen IDE window with:
- Dark luxury UI
- Explorer sidebar
- Monaco Editor
- Nyx AI Console
- Settings panel

## Build & Package

```bash
npm run build
```

Artifacts land in `lumen-ide/release/`.

## Folder Structure

```
lumen-ide/
  backend/          # Nyx engine stubs (future server + automation)
  src/
    components/     # Top bar, settings panel
    editor/         # Monaco editor integration
    panels/         # Explorer + Nyx console
    services/       # Nyx service stubs for renderer
  main.js           # Electron main process
  preload.js        # IPC bridge (future secure API)
```

## Nyx Integration (Future)

- `src/services/nyxService.js` is the renderer-side API.
- `backend/nyxService.js` is the backend placeholder.
- `main.js` exposes IPC handlers (`nyx:send`, `settings:*`).

Replace the placeholder logic with real AI runtime, vector memory, and server connectors.

## Notes

- Codex CLI remains intact at the repo root.
- Lumen IDE is additive and isolated under `/lumen-ide`.
- Local settings are stored in `lumen-ide/.lumen-user/` for this build.
