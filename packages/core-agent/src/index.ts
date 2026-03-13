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
  | "preview_screenshot"
  | "preview_click"
  | "preview_type"
  | "preview_press"
  | "git_status"
  | "git_diff"
  | "git_stage"
  | "git_unstage"
  | "git_merge"
  | "git_rebase"
  | "git_cherry_pick"
  | "git_commit"
  | "git_push";

export type ActionRisk = "obvious" | "likely" | "uncertain" | "risky";

export type PermissionPreset =
  | "read_only"
  | "local_edit_only"
  | "local_build_mode"
  | "preview_operator"
  | "git_operator"
  | "full_local_workspace"
  | "trusted_workspace_profile";

export type PolicyDecision = {
  preset: PermissionPreset;
  actionType: ActionType;
  risk: ActionRisk;
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
};

export type AgentMode = "manual" | "live_build";

export type AgentPhase =
  | "understand"
  | "scope"
  | "plan"
  | "execute"
  | "verify"
  | "recover"
  | "propose"
  | "apply"
  | "summarize";

export type TaskStatus = "pending" | "running" | "done" | "failed" | "blocked";

export type TaskNode = {
  id: string;
  title: string;
  phase: AgentPhase;
  status: TaskStatus;
  confidence: ActionRisk;
  dependsOn: string[];
  detail?: string;
};

export type AgentAction = {
  type: ActionType;
  reason?: string;
  path?: string;
  query?: string;
  content?: string;
  command?: string;
  message?: string;
  branch?: string;
  upstream?: string;
  commit?: string;
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

export type RecoveryPolicy =
  | "retry_same_command"
  | "inspect_scripts"
  | "inspect_port_conflict"
  | "install_dependencies"
  | "localize_compile_error"
  | "rollback_patch";

export type RecoverySuggestion = {
  policy: RecoveryPolicy;
  reason: string;
  confidence: ActionRisk;
  blocker: string;
  action?: AgentAction;
  filePath?: string;
  line?: number;
};

export const POLICY_PRESETS: PermissionPreset[] = [
  "read_only",
  "local_edit_only",
  "local_build_mode",
  "preview_operator",
  "git_operator",
  "full_local_workspace",
  "trusted_workspace_profile"
];

export function riskForAction(action: AgentAction): ActionRisk {
  if (
    action.type === "git_push" ||
    action.type === "git_commit" ||
    action.type === "git_merge" ||
    action.type === "git_rebase" ||
    action.type === "git_cherry_pick"
  ) {
    return "risky";
  }
  if (action.type === "delete_file" || action.type === "write_file") return "uncertain";
  if (action.type === "run_cmd") {
    return isReadOnlyCommand(action.command || "") ? "likely" : "risky";
  }
  if (
    action.type === "preview_click" ||
    action.type === "preview_type" ||
    action.type === "preview_press" ||
    action.type === "preview_screenshot"
  ) {
    return "likely";
  }
  if (action.type === "preview_start") return "likely";
  return "obvious";
}

function presetAllowsAction(preset: PermissionPreset, action: AgentAction): boolean {
  const readActions: ActionType[] = [
    "list_dir",
    "read_file",
    "search_files",
    "git_status",
    "git_diff",
    "preview_status",
    "preview_snapshot",
    "preview_screenshot"
  ];
  const editActions: ActionType[] = ["write_file", "delete_file"];
  const previewActions: ActionType[] = ["preview_start", "preview_click", "preview_type", "preview_press"];
  const gitActions: ActionType[] = [
    "git_stage",
    "git_unstage",
    "git_merge",
    "git_rebase",
    "git_cherry_pick",
    "git_commit",
    "git_push"
  ];

  if (preset === "read_only") {
    return readActions.includes(action.type);
  }
  if (preset === "local_edit_only") {
    return readActions.includes(action.type) || editActions.includes(action.type);
  }
  if (preset === "preview_operator") {
    return readActions.includes(action.type) || previewActions.includes(action.type);
  }
  if (preset === "git_operator") {
    return readActions.includes(action.type) || gitActions.includes(action.type);
  }
  if (preset === "local_build_mode") {
    return (
      readActions.includes(action.type) ||
      editActions.includes(action.type) ||
      previewActions.includes(action.type) ||
      action.type === "run_cmd" ||
      action.type === "git_stage" ||
      action.type === "git_unstage"
    );
  }
  if (preset === "full_local_workspace") {
    return true;
  }
  if (preset === "trusted_workspace_profile") {
    return true;
  }
  return false;
}

export function evaluatePolicyDecision(
  action: AgentAction,
  preset: PermissionPreset,
  onlineMode: boolean
): PolicyDecision {
  const risk = riskForAction(action);
  if (action.type === "git_push" && !onlineMode) {
    return {
      preset,
      actionType: action.type,
      risk,
      allowed: false,
      requiresApproval: false,
      reason: "Online mode is disabled."
    };
  }

  const allowed = presetAllowsAction(preset, action);
  if (!allowed) {
    return {
      preset,
      actionType: action.type,
      risk,
      allowed: false,
      requiresApproval: false,
      reason: `Action ${action.type} is blocked by ${preset} preset.`
    };
  }

  const baseline = permissionForAction(action).approvalRequired;
  const requiresApproval =
    preset === "trusted_workspace_profile"
      ? risk === "risky"
      : baseline || risk === "uncertain" || risk === "risky";

  return {
    preset,
    actionType: action.type,
    risk,
    allowed: true,
    requiresApproval,
    reason: requiresApproval ? `Requires approval (${risk} risk).` : `Allowed (${risk} risk).`
  };
}

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

function phaseForAction(action: AgentAction): AgentPhase {
  if (action.type === "list_dir" || action.type === "read_file" || action.type === "search_files" || action.type === "git_status") {
    return "scope";
  }
  if (action.type === "preview_status" || action.type === "preview_snapshot" || action.type === "preview_screenshot") {
    return "verify";
  }
  if (action.type === "write_file" || action.type === "delete_file") {
    return "propose";
  }
  return "execute";
}

function labelForAction(action: AgentAction): string {
  if (action.path) return `${action.type} · ${action.path.split(/[\\/]/).pop() || action.path}`;
  if (action.command) return `${action.type} · ${action.command}`;
  if (action.query) return `${action.type} · ${action.query}`;
  if (action.selector) return `${action.type} · ${action.selector}`;
  return action.type;
}

export function buildTaskGraph(goal: string, actions: AgentAction[]): TaskNode[] {
  const baseNodes = actions.map((action, index) => ({
    id: `${index + 1}`,
    title: labelForAction(action),
    phase: phaseForAction(action),
    status: "pending" as TaskStatus,
    confidence: riskForAction(action),
    dependsOn: index > 0 ? [`${index}`] : [],
    detail: action.reason || goal
  }));

  if (!actions.some((action) => action.type === "write_file" || action.type === "delete_file")) {
    return baseNodes;
  }

  const lastId = baseNodes.length ? baseNodes[baseNodes.length - 1].id : "0";
  const verifyId = `${baseNodes.length + 1}`;
  const proposeId = `${baseNodes.length + 2}`;
  const applyId = `${baseNodes.length + 3}`;

  return [
    ...baseNodes,
    {
      id: verifyId,
      title: "Run verification command(s)",
      phase: "verify",
      status: "pending",
      confidence: "likely",
      dependsOn: [lastId],
      detail: "Validate proposed changes before apply."
    },
    {
      id: proposeId,
      title: "Review diff proposal",
      phase: "propose",
      status: "pending",
      confidence: "likely",
      dependsOn: [verifyId],
      detail: "Confirm file/hunk selection."
    },
    {
      id: applyId,
      title: "Apply approved changes",
      phase: "apply",
      status: "pending",
      confidence: "uncertain",
      dependsOn: [proposeId],
      detail: "Write only after explicit approval."
    }
  ];
}

function normalizeFailureText(errorText: string, outputText: string): string {
  return `${String(errorText || "")}\n${String(outputText || "")}`.trim().toLowerCase();
}

function extractCompileLocation(rawText: string): { filePath: string; line: number } | null {
  const match = String(rawText || "").match(
    /([A-Za-z]:\\[^:\n\r]+|\.[\\/][^:\n\r]+|\b[\w./\\-]+\.(?:ts|tsx|js|jsx|py|rs|go|java)):(\d+)(?::(\d+))?/
  );
  if (!match?.[1]) return null;
  return { filePath: match[1], line: Number(match[2] || 0) };
}

export function deriveRecoverySuggestions(input: {
  failedAction: AgentAction;
  error?: string;
  output?: unknown;
  hasPendingChanges?: boolean;
  recoveryAttempt?: number;
}): RecoverySuggestion[] {
  const suggestions: RecoverySuggestion[] = [];
  const raw = `${input.error || ""}\n${String(input.output || "")}`.trim();
  const failure = normalizeFailureText(input.error || "", String(input.output || ""));

  if (input.failedAction.type === "run_cmd" && input.failedAction.command) {
    suggestions.push({
      policy: "retry_same_command",
      reason: "Retry once to rule out transient shell/tool failures.",
      confidence: "likely",
      blocker: "Command execution instability",
      action: { type: "run_cmd", command: input.failedAction.command, reason: "Recovery retry command" }
    });
  }

  if (failure.includes("no runnable project script") || failure.includes("missing script")) {
    suggestions.push({
      policy: "inspect_scripts",
      reason: "Inspect package scripts and pick a runnable dev command.",
      confidence: "likely",
      blocker: "Missing/incorrect project script",
      action: { type: "read_file", path: "package.json", reason: "Recovery inspect scripts" }
    });
  }

  if (failure.includes("eaddrinuse") || failure.includes("address already in use")) {
    suggestions.push({
      policy: "inspect_port_conflict",
      reason: "Check listening ports before restarting preview.",
      confidence: "likely",
      blocker: "Port conflict",
      action: {
        type: "run_cmd",
        command: "netstat -ano | findstr LISTENING",
        reason: "Recovery inspect listening ports"
      }
    });
  }

  if (failure.includes("cannot find module") || failure.includes("command not found") || failure.includes("is not recognized")) {
    suggestions.push({
      policy: "install_dependencies",
      reason: "Install missing dependencies or binaries before rerun.",
      confidence: "uncertain",
      blocker: "Missing dependency/toolchain",
      action: { type: "run_cmd", command: "pnpm install", reason: "Recovery install dependencies" }
    });
  }

  const compileLocation = extractCompileLocation(raw);
  if (compileLocation) {
    suggestions.push({
      policy: "localize_compile_error",
      reason: "Localize compile error by opening file context.",
      confidence: "likely",
      blocker: "Compile/runtime error location",
      filePath: compileLocation.filePath,
      line: compileLocation.line
    });
  }

  if (input.hasPendingChanges && (input.recoveryAttempt || 0) >= 2) {
    suggestions.push({
      policy: "rollback_patch",
      reason: "Repeated failures with pending edits; rollback last patch set.",
      confidence: "risky",
      blocker: "Potential bad patch state"
    });
  }

  return suggestions;
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
  if (action.type === "git_merge") {
    return { approvalRequired: true, onlineRequired: false, reason: "git_merge requires approval" };
  }
  if (action.type === "git_rebase") {
    return { approvalRequired: true, onlineRequired: false, reason: "git_rebase requires approval" };
  }
  if (action.type === "git_cherry_pick") {
    return { approvalRequired: true, onlineRequired: false, reason: "git_cherry_pick requires approval" };
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
    "preview_screenshot",
    "preview_click",
    "preview_type",
    "preview_press",
    "git_status",
    "git_diff",
    "git_stage",
    "git_unstage",
    "git_merge",
    "git_rebase",
    "git_cherry_pick",
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
    branch: typeof candidate.branch === "string" ? candidate.branch : undefined,
    upstream: typeof candidate.upstream === "string" ? candidate.upstream : undefined,
    commit: typeof candidate.commit === "string" ? candidate.commit : undefined,
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
