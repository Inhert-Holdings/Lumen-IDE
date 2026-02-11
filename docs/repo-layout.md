# Repository layout

This repo is a monorepo with multiple deliverables. Use this map to find entry points quickly.

## Top-level directories
- `.devcontainer/` - Devcontainer configuration.
- `.github/` - CI workflows and GitHub automation.
- `.vscode/` - Editor settings.
- `apps/` - End-user apps and services.
- `apps/codex-cli/` - CLI packaging and distribution.
- `apps/shell-tool-mcp/` - MCP server for the shell tool.
- `codex-rs/` - Rust workspace (core engine, TUI, app-server).
- `docs/` - Documentation.
- `patches/` - Patch files used by build or release workflows.
- `scripts/` - Dev/build/release scripts.
- `packages/` - Language SDKs and shared packages.
- `packages/sdk/` - SDKs and client libraries.
- `third_party/` - Vendored third-party code or assets.

## Key entry points
- `README.md` - Quickstart and primary docs links.
- `docs/install.md` - Build and install steps.
- `docs/contributing.md` - Contribution workflow.
- `apps/codex-cli/README.md` - CLI packaging and usage details.
- `codex-rs/README.md` - Rust workspace overview.
- `apps/shell-tool-mcp/README.md` - MCP server overview.

## Build and tooling at repo root
- `justfile` - Task runner for common workflows.
- `pnpm-workspace.yaml` and `package.json` - Node workspace.
- `BUILD.bazel`, `MODULE.bazel`, and `*.bzl` - Bazel configuration.
- `flake.nix` and `flake.lock` - Nix development environment.
