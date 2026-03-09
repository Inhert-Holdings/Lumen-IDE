import { createTwoFilesPatch } from "diff";

export type ActionType =
  | "list_dir"
  | "read_file"
  | "search_files"
  | "write_file"
  | "delete_file"
  | "run_cmd"
  | "preview_start"
  | "preview_status"
  | "preview_snapshot"
  | "preview_click"
  | "preview_type"
  | "preview_press"
  | "git_status"
  | "git_diff"
  | "git_stage"
  | "git_unstage"
  | "git_commit"
  | "git_push";

export type AgentAction = {
  type: ActionType;
  reason?: string;
  path?: string;
  query?: string;
  content?: string;
  command?: string;
  message?: string;
  paths?: string[];
  staged?: boolean;
  entry?: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  port?: number;
};

export type PermissionRequirement = {
  approvalRequired: boolean;
  onlineRequired: boolean;
  reason: string;
};

export type PendingChange = {
  id: string;
  type: "write" | "delete";
  path: string;
  nextContent: string;
  previousContent: string;
  existedBefore: boolean;
  diff: string;
};

export type ToolExecutionResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
  pendingChange?: PendingChange;
};

export type AgentAuditEntry = {
  timestamp: string;
  action: string;
  detail: Record<string, unknown>;
};

export type AgentLoopOptions = {
  goal: string;
  actions: AgentAction[];
  onlineMode: boolean;
  executeTool: (action: AgentAction) => Promise<ToolExecutionResult>;
  requestApproval: (action: AgentAction, requirement: PermissionRequirement) => Promise<boolean>;
  verify?: () => Promise<ToolExecutionResult | null>;
  log: (entry: AgentAuditEntry) => void;
};

export type AgentLoopResult = {
  plan: string[];
  actionResults: Array<{ action: AgentAction; result: ToolExecutionResult; skipped?: boolean }>;
  pendingChanges: PendingChange[];
  verifyResult: ToolExecutionResult | null;
};

export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[REDACTED_KEY]")
    .replace(/(api[_-]?key\s*[:=]\s*)([^\s,\"'}]+)/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)([^\s,\"'}]+)/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)([^\s]+)/gi, "$1[REDACTED]");
}

export function buildPlan(goal: string, actions: AgentAction[]): string[] {
  return [
    `PLAN: ${goal}`,
    `EXECUTE: ${actions.length} tool action(s) with permission gating`,
    "VERIFY: run lint/tests when requested",
    "PROPOSE: show diff preview for any pending file changes",
    "APPLY: only after explicit approval"
  ];
}

export function permissionForAction(action: AgentAction): PermissionRequirement {
  if (action.type === "write_file") {
    return { approvalRequired: true, onlineRequired: false, reason: "write_file requires approval" };
  }
  if (action.type === "delete_file") {
    return { approvalRequired: true, onlineRequired: false, reason: "delete_file requires approval" };
  }
  if (action.type === "run_cmd") {
    return {
      approvalRequired: !isReadOnlyCommand(action.command || ""),
      onlineRequired: false,
      reason: isReadOnlyCommand(action.command || "")
        ? "safe read-only command"
        : "run_cmd is not in read-only allowlist"
    };
  }
  if (action.type === "preview_start") {
    return {
      approvalRequired: true,
      onlineRequired: false,
      reason: "preview_start may launch a local dev server command"
    };
  }
  if (action.type === "git_commit") {
    return { approvalRequired: true, onlineRequired: false, reason: "git_commit requires approval" };
  }
  if (action.type === "git_push") {
    return { approvalRequired: true, onlineRequired: true, reason: "git_push requires approval and Online mode" };
  }
  return { approvalRequired: false, onlineRequired: false, reason: "no approval required" };
}

export function isReadOnlyCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return true;
  const allowlist = [
    /^dir$/,
    /^ls(\s|$)/,
    /^pwd$/,
    /^git\s+status(\s|$)/,
    /^git\s+diff(\s|$)/,
    /^git\s+log(\s|$)/,
    /^cat(\s|$)/,
    /^type(\s|$)/,
    /^rg(\s|$)/,
    /^findstr(\s|$)/,
    /^echo(\s|$)/,
    /^whoami$/,
    /^Get-ChildItem(\s|$)/i,
    /^Get-Content(\s|$)/i
  ];
  return allowlist.some((pattern) => pattern.test(normalized));
}

export function buildDiff(path: string, beforeText: string, afterText: string): string {
  return createTwoFilesPatch(path, path, beforeText, afterText, "before", "after", { context: 3 });
}

export function extractActionsFromText(text: string): AgentAction[] {
  const trimmed = text.trim();
  const raw = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "")
    : trimmed;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Model output must be a JSON array of actions.");
  }
  return parsed.map(validateAction);
}

function validateAction(action: unknown): AgentAction {
  if (!action || typeof action !== "object") {
    throw new Error("Invalid action entry.");
  }
  const candidate = action as Record<string, unknown>;
  if (typeof candidate.type !== "string") {
    throw new Error("Action is missing type.");
  }

  const type = candidate.type as ActionType;
  const allowedTypes: ActionType[] = [
    "list_dir",
    "read_file",
    "search_files",
    "write_file",
    "delete_file",
    "run_cmd",
    "preview_start",
    "preview_status",
    "preview_snapshot",
    "preview_click",
    "preview_type",
    "preview_press",
    "git_status",
    "git_diff",
    "git_stage",
    "git_unstage",
    "git_commit",
    "git_push"
  ];

  if (!allowedTypes.includes(type)) {
    throw new Error(`Unsupported action type: ${String(type)}`);
  }

  return {
    type,
    reason: typeof candidate.reason === "string" ? candidate.reason : "",
    path: typeof candidate.path === "string" ? candidate.path : undefined,
    query: typeof candidate.query === "string" ? candidate.query : undefined,
    content: typeof candidate.content === "string" ? candidate.content : undefined,
    command: typeof candidate.command === "string" ? candidate.command : undefined,
    message: typeof candidate.message === "string" ? candidate.message : undefined,
    paths: Array.isArray(candidate.paths) ? candidate.paths.filter((item): item is string => typeof item === "string") : undefined,
    staged: typeof candidate.staged === "boolean" ? candidate.staged : undefined,
    entry: typeof candidate.entry === "string" ? candidate.entry : undefined,
    url: typeof candidate.url === "string" ? candidate.url : undefined,
    selector: typeof candidate.selector === "string" ? candidate.selector : undefined,
    text: typeof candidate.text === "string" ? candidate.text : undefined,
    key: typeof candidate.key === "string" ? candidate.key : undefined,
    port: typeof candidate.port === "number" ? candidate.port : undefined
  };
}

export function fallbackActions(goal: string): AgentAction[] {
  const lower = goal.toLowerCase();
  const actions: AgentAction[] = [{ type: "list_dir", path: ".", reason: "Inspect workspace" }];

  if (lower.includes("search") || lower.includes("find")) {
    actions.push({ type: "search_files", query: goal.split(" ").slice(-1)[0], reason: "Find matching files" });
  }

  if (lower.includes("git")) {
    actions.push({ type: "git_status", reason: "Inspect git status" });
  }

  if (lower.includes("test") || lower.includes("lint")) {
    actions.push({ type: "run_cmd", command: "pnpm test", reason: "Run tests" });
  }

  return actions;
}

export async function runAutonomousLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const plan = buildPlan(options.goal, options.actions);
  options.log({ timestamp: new Date().toISOString(), action: "agent.plan", detail: { goal: options.goal, steps: plan } });

  const actionResults: Array<{ action: AgentAction; result: ToolExecutionResult; skipped?: boolean }> = [];
  const pendingChanges: PendingChange[] = [];

  for (const action of options.actions) {
    const permission = permissionForAction(action);

    if (permission.onlineRequired && !options.onlineMode) {
      const result = { ok: false, error: "Action requires Online mode" };
      actionResults.push({ action, result, skipped: true });
      options.log({
        timestamp: new Date().toISOString(),
        action: "agent.skip",
        detail: { type: action.type, reason: "online_mode_disabled" }
      });
      continue;
    }

    if (permission.approvalRequired) {
      const approved = await options.requestApproval(action, permission);
      if (!approved) {
        const result = { ok: false, error: "Action denied by user" };
        actionResults.push({ action, result, skipped: true });
        options.log({
          timestamp: new Date().toISOString(),
          action: "agent.denied",
          detail: { type: action.type, reason: permission.reason }
        });
        continue;
      }
    }

    const result = await options.executeTool(action);
    if (result.pendingChange) {
      pendingChanges.push(result.pendingChange);
    }

    actionResults.push({ action, result, skipped: false });
    options.log({
      timestamp: new Date().toISOString(),
      action: `agent.${action.type}`,
      detail: {
        ok: result.ok,
        error: result.error,
        reason: action.reason || ""
      }
    });
  }

  const verifyResult = options.verify ? await options.verify() : null;
  if (verifyResult) {
    options.log({
      timestamp: new Date().toISOString(),
      action: "agent.verify",
      detail: {
        ok: verifyResult.ok,
        error: verifyResult.error || ""
      }
    });
  }

  options.log({
    timestamp: new Date().toISOString(),
    action: "agent.propose",
    detail: { pendingChanges: pendingChanges.length }
  });

  return {
    plan,
    actionResults,
    pendingChanges,
    verifyResult
  };
}
