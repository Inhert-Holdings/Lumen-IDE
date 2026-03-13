/* eslint-env node */
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { _electron as playwrightElectron } from "playwright-core";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const appEntry = path.join(desktopDir, "electron", "main.cjs");
const distIndex = path.join(desktopDir, "dist", "index.html");

function assertBuiltArtifacts() {
  if (!existsSync(distIndex)) {
    throw new Error(
      `Desktop dist assets not found at ${distIndex}. Run "pnpm --filter @lumen/desktop build" before smoke tests.`
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

async function runProcess(command, args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const allowFailure = Boolean(options.allowFailure);
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code: code ?? 0, stdout, stderr };
      if (!allowFailure && result.code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed with code ${result.code}\n${stderr || stdout}`));
        return;
      }
      resolve(result);
    });
  });
}

async function createWorkspaceFixture(workspaceRoot) {
  const staticHtml = [
    "<!doctype html>",
    "<html>",
    "  <head>",
    "    <meta charset='utf-8' />",
    "    <title>Lumen Smoke App</title>",
    "    <style>body{font-family:Segoe UI,Arial,sans-serif;background:#0b1220;color:#d9e4ff;padding:24px}input,button{padding:8px 10px;border:1px solid #335;margin-right:6px;border-radius:6px}button{background:#14213d;color:#fff}#result{margin-top:12px}</style>",
    "  </head>",
    "  <body>",
    "    <h1>Lumen Smoke App</h1>",
    "    <p id='status'>ready</p>",
    "    <input id='nameInput' placeholder='type a name' />",
    "    <button id='applyBtn'>Apply</button>",
    "    <div id='result'></div>",
    "    <script>",
    "      const input = document.getElementById('nameInput');",
    "      const result = document.getElementById('result');",
    "      document.getElementById('applyBtn').addEventListener('click', () => {",
    "        const name = (input.value || 'friend').trim();",
    "        result.textContent = `Hello ${name}`;",
    "      });",
    "    </script>",
    "  </body>",
    "</html>"
  ].join("\n");

  await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify(
      {
        name: "lumen-e2e-workspace",
        private: true,
        version: "0.0.0",
        scripts: {
          dev: "node dev-server.cjs",
          test: "node -e \"console.log('workspace tests ok')\""
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(workspaceRoot, "package-lock.json"),
    JSON.stringify({ name: "lumen-e2e-workspace", lockfileVersion: 3, requires: true, packages: {} }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(workspaceRoot, "dev-server.cjs"),
    [
      "const http = require('node:http');",
      "const port = 4173;",
      "const html = require('node:fs').readFileSync('index.html', 'utf8');",
      "const server = http.createServer((_req, res) => {",
      "  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });",
      "  res.end(html);",
      "});",
      "server.listen(port, '127.0.0.1', () => {",
      "  console.log(`Lumen preview listening at http://127.0.0.1:${port}`);",
      "});"
    ].join("\n"),
    "utf8"
  );
  await writeFile(path.join(workspaceRoot, "index.html"), staticHtml, "utf8");
  await writeFile(
    path.join(workspaceRoot, "src", "app.js"),
    "export const appName = 'Lumen Smoke Workspace';\n",
    "utf8"
  );
  await writeFile(path.join(workspaceRoot, "README.md"), "# Lumen E2E Workspace\n", "utf8");

  await runProcess("git", ["init"], { cwd: workspaceRoot });
  await runProcess("git", ["config", "user.name", "Lumen E2E"], { cwd: workspaceRoot });
  await runProcess("git", ["config", "user.email", "lumen-e2e@example.com"], { cwd: workspaceRoot });
  await runProcess("git", ["add", "."], { cwd: workspaceRoot });
  await runProcess("git", ["commit", "-m", "chore: seed workspace"], { cwd: workspaceRoot });
}

function normalizePrompt(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => String(message?.content || ""))
    .join("\n\n");
}

function streamBodyFor(messages, model) {
  const prompt = normalizePrompt(messages);
  if (prompt.includes("You are Lumen helper planner.")) {
    return JSON.stringify(["Scope workspace files", "Plan execution actions", "Prepare patch proposal", "Await apply approval"]);
  }
  if (prompt.includes("You are Lumen objective planner.")) {
    return JSON.stringify(["Inspect current project files", "Generate concrete file update", "Run safe verification command"]);
  }
  if (prompt.includes("You are Lumen IDE autonomous planner.")) {
    return JSON.stringify([
      {
        type: "list_dir",
        path: ".",
        reason: "Inspect workspace root"
      },
      {
        type: "read_file",
        path: "src/app.js",
        reason: "Review existing app module"
      },
      {
        type: "write_file",
        path: "src/generated-tool.js",
        reason: "Create requested tool module",
        content: "export function createTool() {\n  return 'Lumen tool ready';\n}\n"
      },
      {
        type: "run_cmd",
        command: "node -v",
        reason: "Verify local Node runtime availability"
      }
    ]);
  }
  if (prompt.includes("Reply with: pong")) {
    return "pong";
  }
  if (prompt.toLowerCase().includes("main stream check")) {
    return `MAIN_STREAM_OK (${model})`;
  }
  if (prompt.includes("You are Lumen helper runtime analyzer.")) {
    return "- No blockers detected\n- Continue with apply review";
  }
  return "[]";
}

async function readRequestBody(request) {
  return await new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => resolve(body));
  });
}

async function createMockLlmServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && requestUrl.pathname === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          data: [{ id: "lumen-main" }, { id: "lumen-helper" }]
        })
      );
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/v1/chat/completions") {
      const raw = await readRequestBody(req);
      const payload = JSON.parse(raw || "{}");
      const model = String(payload.model || "");
      const stream = Boolean(payload.stream);
      const prompt = normalizePrompt(payload.messages);
      requests.push({
        at: new Date().toISOString(),
        model,
        stream,
        prompt
      });

      const content = streamBodyFor(payload.messages, model);

      if (!stream) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-local",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content },
                finish_reason: "stop"
              }
            ]
          })
        );
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive"
      });
      const chunks = content.match(/.{1,30}/g) || [content];
      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve mock server address.");
  }
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  return {
    baseUrl,
    requests,
    close: async () => {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

async function main() {
  assertBuiltArtifacts();

  const runRoot = await mkdtemp(path.join(os.tmpdir(), "lumen-e2e-"));
  const workspaceRoot = path.join(runRoot, "workspace");
  const appDataRoot = path.join(runRoot, "appdata");
  const artifactsRoot = path.join(runRoot, "artifacts");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(appDataRoot, { recursive: true });
  await mkdir(artifactsRoot, { recursive: true });
  await createWorkspaceFixture(workspaceRoot);

  const mockLlm = await createMockLlmServer();
  const errors = [];
  const approvals = { clicks: 0 };

  const electronApp = await playwrightElectron.launch({
    executablePath: electronBinary,
    args: [appEntry],
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LOCALAPPDATA: appDataRoot,
      ELECTRON_ENABLE_LOGGING: "0"
    }
  });

  let approveTimer = null;
  try {
    const page = await electronApp.firstWindow();
    page.on("dialog", (dialog) => {
      dialog.accept().catch(() => {});
    });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => Boolean(window.lumen?.workspace), null, { timeout: 30000 });
    await page.evaluate(() => {
      window.confirm = () => true;
    });

    approveTimer = setInterval(() => {
      const run = async () => {
        const button = page.getByRole("button", { name: "Approve Action" });
        const visible = await button.isVisible().catch(() => false);
        if (!visible) return;
        await button.click({ timeout: 300 }).catch(() => {});
        approvals.clicks += 1;
      };
      void run();
    }, 180);

    await page.evaluate(
      async ({ root, baseUrl }) => {
        await window.lumen.workspace.setRoot({ root, source: "e2e" });
        const current = await window.lumen.settings.load();
        await window.lumen.settings.save({
          ...current,
          provider: "custom",
          baseUrl,
          model: "lumen-main",
          apiKey: "",
          helperEnabled: true,
          helperUsesMainConnection: true,
          helperProvider: "custom",
          helperBaseUrl: baseUrl,
          helperModel: "lumen-helper",
          helperApiKey: "",
          onlineMode: false,
          permissionPreset: "full_local_workspace",
          lowResourceMode: false
        });
      },
      { root: workspaceRoot, baseUrl: mockLlm.baseUrl }
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.lumen?.workspace), null, { timeout: 30000 });
    await page.evaluate(() => {
      window.confirm = () => true;
    });
    await page.evaluate(async ({ root }) => {
      await window.lumen.workspace.setRoot({ root, source: "e2e_reload" });
    }, { root: workspaceRoot });

    const llmConnectivity = await page.evaluate(async ({ baseUrl }) => {
      const testResult = await window.lumen.llm.test({
        baseUrl,
        model: "lumen-main",
        apiKey: "",
        provider: "custom"
      });
      const listResult = await window.lumen.llm.listModels({
        baseUrl,
        model: "lumen-main",
        apiKey: "",
        provider: "custom"
      });
      return { testResult, listResult };
    }, { baseUrl: mockLlm.baseUrl });

    assert.equal(llmConnectivity.testResult.ok, true, "Local LLM connection test should succeed.");
    assert(llmConnectivity.listResult.models.includes("lumen-main"), "Model list should include lumen-main.");

    const mainStreamText = await page.evaluate(async ({ baseUrl }) => {
      const requestId = `main-stream-${Date.now()}`;
      return await new Promise((resolve, reject) => {
        let text = "";
        const offChunk = window.lumen.llm.onChunk((payload) => {
          if (payload.requestId === requestId) text += payload.delta;
        });
        const offDone = window.lumen.llm.onDone((payload) => {
          if (payload.requestId !== requestId) return;
          offChunk();
          offDone();
          offError();
          resolve(text);
        });
        const offError = window.lumen.llm.onError((payload) => {
          if (payload.requestId !== requestId) return;
          offChunk();
          offDone();
          offError();
          reject(new Error(payload.error));
        });
        window.lumen.llm
          .startStream({
            requestId,
            config: { baseUrl, model: "lumen-main", apiKey: "" },
            messages: [{ role: "user", content: "main stream check" }]
          })
          .catch((error) => {
            offChunk();
            offDone();
            offError();
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      });
    }, { baseUrl: mockLlm.baseUrl });

    assert(mainStreamText.includes("MAIN_STREAM_OK"), "Main model stream should emit expected content.");

    const pushPolicy = await page.evaluate(() => window.lumen.policy.evaluate({ actionType: "git_push" }));
    assert.equal(pushPolicy.allowed, false, "git_push should be blocked while online mode is off.");

    const terminal = await page.evaluate(() => window.lumen.terminal.create({ cols: 100, rows: 30 }));
    const runCmdResult = await page.evaluate(
      async ({ terminalId }) =>
        await window.lumen.agent.runCmd({
          command: "Get-Location",
          terminalId,
          source: "agent",
          preset: "full_local_workspace",
          approved: true
        }),
      { terminalId: terminal.id }
    );
    assert.equal(runCmdResult.code, 0, "Terminal command should exit with code 0.");

    const gitCheck = await page.evaluate(async ({ absoluteAppFilePath }) => {
      const statusInitial = await window.lumen.git.status();
      await window.lumen.workspace.write({
        path: absoluteAppFilePath,
        content: "export const appName = 'Lumen Smoke Workspace Updated';\n",
        source: "agent",
        approved: true,
        preset: "full_local_workspace"
      });
      const statusChanged = await window.lumen.git.status();
      await window.lumen.git.stage({ paths: ["src/app.js"] });
      const commit = await window.lumen.git.commit({ message: "test: e2e git check", approved: true });
      const history = await window.lumen.git.history({ limit: 3 });
      return { statusInitial, statusChanged, commit, history };
    }, { absoluteAppFilePath: path.join(workspaceRoot, "src", "app.js") });
    assert.equal(gitCheck.statusInitial.isRepo, true, "Workspace must be a git repo.");
    assert(gitCheck.statusChanged.files.some((file) => file.path === "src/app.js"), "git status should detect workspace change.");
    assert(gitCheck.commit.hash && gitCheck.commit.hash.length >= 7, "git commit should return a hash.");
    assert(gitCheck.history.commits.length >= 1, "git history should contain commits.");

    const previewStatus = await page.evaluate(
      async ({ terminalId }) =>
        await window.lumen.preview.startProject({
          terminalId,
          url: "http://127.0.0.1:4173",
          port: 4173,
          source: "agent",
          preset: "full_local_workspace",
          approved: true
        }),
      { terminalId: terminal.id }
    );
    assert.equal(previewStatus.running, true, "Preview must be running after project start.");
    assert(previewStatus.url.includes("127.0.0.1"), "Preview URL should be local.");

    const browserConnect = await page.evaluate(
      async ({ url }) =>
        await window.lumen.preview.browserConnect({
          url,
          source: "agent",
          preset: "full_local_workspace",
          approved: true
        }),
      { url: previewStatus.url }
    );
    assert.equal(browserConnect.connected, true, "Preview browser should connect.");
    assert(browserConnect.snapshot.title.includes("Lumen Smoke App"), "Preview snapshot title should match fixture.");

    const clickSnapshot = await page.evaluate(async () => {
      await window.lumen.preview.browserType({
        selector: "#nameInput",
        text: "Lumen QA",
        source: "agent",
        preset: "full_local_workspace",
        approved: true
      });
      return await window.lumen.preview.browserClick({
        selector: "#applyBtn",
        source: "agent",
        preset: "full_local_workspace",
        approved: true
      });
    });
    assert(clickSnapshot.text.includes("Hello Lumen QA"), "Preview browser interactions should update page state.");

    const previewArtifacts = await page.evaluate(async () => {
      const screenshot = await window.lumen.preview.browserScreenshot({
        fileName: "e2e-preview.png",
        source: "agent",
        preset: "full_local_workspace",
        approved: true
      });
      const diagnostics = await window.lumen.preview.browserDiagnostics({
        includeDom: true,
        limit: 20,
        source: "agent",
        preset: "full_local_workspace",
        approved: true
      });
      return { screenshot, diagnostics };
    });
    assert.equal(existsSync(previewArtifacts.screenshot.path), true, "Preview screenshot should be written to disk.");
    assert(
      (previewArtifacts.diagnostics.domSummary?.counts?.buttons || 0) >= 1,
      "Preview diagnostics should include DOM summary data."
    );

    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await page.locator("#agent-prompt").fill("Build a tiny tool file and ensure it can be applied.");
    await page.getByRole("button", { name: "Run Agent" }).click();

    const applyButton = page.getByRole("button", { name: "Apply Selected" });
    try {
      await waitFor(async () => await applyButton.isVisible().catch(() => false), 120000, "agent diff proposal");
    } catch (error) {
      const agentDebug = await page.evaluate(async () => {
        const taskGraph = await window.lumen.agent.getTaskGraph();
        const audit = await window.lumen.audit.list();
        const bodyText = window.document.body?.innerText || "";
        return {
          taskGraph,
          auditTail: audit.entries.slice(-25),
          bodyTail: bodyText.slice(-3000)
        };
      });
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nAgent debug: ${JSON.stringify(agentDebug, null, 2)}\nMock requests: ${JSON.stringify(mockLlm.requests.slice(-20), null, 2)}`
      );
    }
    await waitFor(async () => await applyButton.isEnabled().catch(() => false), 120000, "apply button enable");
    await applyButton.click();

    const generatedToolPath = path.join(workspaceRoot, "src", "generated-tool.js");
    await waitFor(async () => existsSync(generatedToolPath), 20000, "generated tool file");
    const generatedTool = await readFile(generatedToolPath, "utf8");
    assert(generatedTool.includes("createTool"), "Applied agent changes should write generated tool file.");

    const runtimeHealth = await page.evaluate(async () => await window.lumen.runtime.getHealth());
    assert(
      runtimeHealth.preview.projectRunning || runtimeHealth.preview.staticRunning,
      "Runtime health should report an active preview runtime."
    );

    const auditList = await page.evaluate(async () => await window.lumen.audit.list());
    assert(
      auditList.entries.some((entry) => entry.action === "policy.decision"),
      "Audit should contain policy decisions."
    );
    assert(
      auditList.entries.some((entry) => entry.action === "preview.project_start" || entry.action === "preview.start"),
      "Audit should contain preview runtime start events."
    );

    const helperStreams = mockLlm.requests.filter((request) => request.stream && request.model === "lumen-helper").length;
    const mainStreams = mockLlm.requests.filter((request) => request.stream && request.model === "lumen-main").length;
    assert(helperStreams > 0, "Helper lane must execute at least one streaming request.");
    assert(mainStreams > 0, "Main lane must execute at least one streaming request.");

    await page.evaluate(async () => {
      await window.lumen.preview.stop();
      await window.lumen.preview.browserClose();
    });

    const report = {
      workspaceRoot,
      appDataRoot,
      mockBaseUrl: mockLlm.baseUrl,
      approvals: approvals.clicks,
      helperStreams,
      mainStreams,
      auditEntries: auditList.entries.length
    };
    await writeFile(path.join(artifactsRoot, "smoke-report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({ ok: true, ...report }, null, 2));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    const pages = electronApp.windows();
    const first = pages[0];
    if (first) {
      const failurePath = path.join(artifactsRoot, "failure.png");
      await first.screenshot({ path: failurePath, fullPage: true }).catch(() => {});
    }
    throw error;
  } finally {
    if (approveTimer) clearInterval(approveTimer);
    await electronApp.close().catch(() => {});
    await mockLlm.close().catch(() => {});
    if (errors.length) {
      console.error("Smoke test errors:");
      for (const entry of errors) {
        console.error(`- ${entry}`);
      }
    }
    if (process.env.LUMEN_E2E_KEEP !== "1") {
      await rm(runRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
