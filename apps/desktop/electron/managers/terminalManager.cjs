function createTerminalManager(deps) {
  const {
    pty,
    spawn,
    randomUUID,
    getWorkspaceRoot,
    emitTerminalData,
    onTerminalExit,
    appendTerminalOutput,
    loadSettings,
    evaluatePolicyDecision,
    audit,
    agentRuntimeState
  } = deps;

  let terminalCounter = 0;
  const terminals = new Map();
  const terminalCommandTimeoutMs = 90 * 1000;

  function createTerminal({ cols = 120, rows = 30 } = {}) {
    const workspaceRoot = getWorkspaceRoot();
    const id = `term-${++terminalCounter}`;
    const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";

    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: workspaceRoot,
      env: process.env
    });
    const record = {
      id,
      shell,
      cwd: workspaceRoot,
      pty: ptyProcess,
      collectors: new Set(),
      queue: Promise.resolve(),
      recentOutput: "",
      recentUrls: []
    };

    ptyProcess.onData((data) => {
      appendTerminalOutput(record, data);
      emitTerminalData(id, data);
      for (const collector of Array.from(record.collectors)) {
        try {
          collector(data);
        } catch {
          record.collectors.delete(collector);
        }
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      terminals.delete(id);
      onTerminalExit(id, exitCode);
    });

    terminals.set(id, record);
    audit("terminal.create", { id, shell, cwd: workspaceRoot });
    return { id, shell, cwd: workspaceRoot };
  }

  function listTerminals() {
    return Array.from(terminals.values()).map((terminal) => ({ id: terminal.id }));
  }

  function writeTerminal(id, data) {
    const terminal = terminals.get(id);
    if (!terminal) throw new Error("Terminal not found.");
    terminal.pty.write(data);
  }

  function resizeTerminal(id, cols, rows) {
    const terminal = terminals.get(id);
    if (!terminal) throw new Error("Terminal not found.");
    terminal.pty.resize(Math.max(40, cols), Math.max(6, rows));
  }

  function killTerminal(id) {
    const terminal = terminals.get(id);
    if (!terminal) return { ok: true };
    terminal.pty.kill();
    terminals.delete(id);
    audit("terminal.kill", { id });
    return { ok: true };
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function runCommandInTerminal(record, command) {
    const token = randomUUID().replace(/-/g, "");
    const startToken = `__LUMEN_START_${token}__`;
    const exitTokenPattern = new RegExp(`${escapeRegExp(`__LUMEN_EXIT_${token}_`)}(-?\\d+)__`);
    const shellCommand =
      process.platform === "win32"
        ? [
            "$__lumenCode = 0",
            `Write-Output '${startToken}'`,
            "try {",
            command,
            "  if (-not $?) {",
            "    $__lumenCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } else { 1 }",
            "  } elseif ($LASTEXITCODE -is [int]) {",
            "    $__lumenCode = $LASTEXITCODE",
            "  }",
            "} catch {",
            "  Write-Error $_",
            "  $__lumenCode = 1",
            "}",
            `Write-Output \"__LUMEN_EXIT_${token}_$($__lumenCode)__\"`
          ].join("\r\n")
        : [`printf '${startToken}\\n'`, command, `printf '__LUMEN_EXIT_${token}_%s__\\n' \"$?\"`].join("\n");

    const previous = record.queue.catch(() => {});
    const next = previous.then(
      () =>
        new Promise((resolve, reject) => {
          let buffer = "";
          let started = false;
          let output = "";
          let onData = null;
          const timeout = setTimeout(() => {
            if (onData) record.collectors.delete(onData);
            reject(new Error("Terminal command timed out."));
          }, terminalCommandTimeoutMs);

          const finish = (code) => {
            clearTimeout(timeout);
            if (onData) record.collectors.delete(onData);
            resolve({
              code,
              stdout: output.replace(/\r/g, "").trim(),
              stderr: ""
            });
          };

          onData = (chunk) => {
            buffer += chunk;
            if (!started) {
              const startIndex = buffer.indexOf(startToken);
              if (startIndex === -1) {
                buffer = buffer.slice(-4000);
                return;
              }
              started = true;
              buffer = buffer.slice(startIndex + startToken.length);
            }

            const match = exitTokenPattern.exec(buffer);
            if (!match || match.index === undefined) return;

            output += buffer.slice(0, match.index);
            finish(Number(match[1] || 1));
          };

          record.collectors.add(onData);
          record.pty.write(`${shellCommand}\r`);
        })
    );
    record.queue = next.catch(() => {});
    return next;
  }

  function disallowUnsafeCommand(command) {
    const trimmed = command.trim();
    if (!trimmed) return;
    if (trimmed.includes("..\\") || trimmed.includes("../")) {
      throw new Error("Relative parent paths are blocked for run_cmd.");
    }
    if (/\bhttps?:\/\//i.test(trimmed) && !loadSettings().onlineMode) {
      throw new Error("Command references network resource while Online mode is disabled.");
    }
  }

  async function runDetachedCommand(command) {
    const workspaceRoot = getWorkspaceRoot();
    const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
    const args =
      process.platform === "win32"
        ? ["-NoLogo", "-NoProfile", "-Command", `Set-Location -LiteralPath '${workspaceRoot.replace(/'/g, "''")}'; ${command}`]
        : ["-lc", `cd '${workspaceRoot.replace(/'/g, "\\'")}'; ${command}`];

    return await new Promise((resolve) => {
      const child = spawn(shell, args, {
        cwd: workspaceRoot,
        env: process.env
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        resolve({
          code: code ?? 0,
          stdout: stdout.slice(-24000),
          stderr: stderr.slice(-12000)
        });
      });
    });
  }

  async function runCommand(command, options = {}) {
    disallowUnsafeCommand(command);
    if (options.source === "agent") {
      const decision = evaluatePolicyDecision({
        actionType: "run_cmd",
        command,
        preset: options.preset
      });
      audit("policy.decision", {
        actionType: "run_cmd",
        command,
        allowed: decision.allowed,
        requiresApproval: decision.requiresApproval,
        risk: decision.risk,
        preset: decision.preset,
        source: "agent",
        mode: agentRuntimeState.mode
      });
      if (!decision.allowed) {
        throw new Error(decision.reason);
      }
      if (decision.requiresApproval && !options.approved) {
        throw new Error("run_cmd requires explicit approval by policy.");
      }
    }
    audit("agent.run_cmd", { command, terminalId: options.terminalId || "" });

    if (options.terminalId) {
      const record = terminals.get(options.terminalId);
      if (!record) {
        throw new Error("Target terminal not found.");
      }
      emitTerminalData(options.terminalId, `\r\n> ${command}\r\n`);
      try {
        return await runCommandInTerminal(record, command);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/timed out/i.test(message)) {
          throw error;
        }
        emitTerminalData(options.terminalId, "\r\n[run_cmd fallback] terminal command timed out; running detached shell fallback.\r\n");
        return await runDetachedCommand(command);
      }
    }

    return await runDetachedCommand(command);
  }

  return {
    terminals,
    createTerminal,
    listTerminals,
    writeTerminal,
    resizeTerminal,
    killTerminal,
    runCommand
  };
}

module.exports = { createTerminalManager };
