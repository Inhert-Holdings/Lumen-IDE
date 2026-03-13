import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePolicyDecision,
  extractActionsFromText,
  isReadOnlyCommand,
  permissionForAction,
  runAutonomousLoop,
  type AgentAction,
  type AgentAuditEntry,
  type ToolExecutionResult
} from "./index";

test("policy blocks git push when online mode is disabled", () => {
  const decision = evaluatePolicyDecision(
    { type: "git_push" },
    "full_local_workspace",
    false
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresApproval, false);
  assert.equal(decision.reason, "Online mode is disabled.");
});

test("policy marks merge and rebase as risky and approval-gated", () => {
  const mergeDecision = evaluatePolicyDecision(
    { type: "git_merge", branch: "main" },
    "full_local_workspace",
    true
  );
  const rebaseDecision = evaluatePolicyDecision(
    { type: "git_rebase", upstream: "main" },
    "trusted_workspace_profile",
    true
  );

  assert.equal(mergeDecision.allowed, true);
  assert.equal(mergeDecision.risk, "risky");
  assert.equal(mergeDecision.requiresApproval, true);
  assert.equal(rebaseDecision.allowed, true);
  assert.equal(rebaseDecision.risk, "risky");
  assert.equal(rebaseDecision.requiresApproval, true);
});

test("permission requirements include preview start and git maturity operations", () => {
  assert.deepEqual(permissionForAction({ type: "preview_start" }), {
    approvalRequired: true,
    onlineRequired: false,
    reason: "preview_start may launch a local dev server command"
  });
  assert.deepEqual(permissionForAction({ type: "git_rebase", upstream: "main" }), {
    approvalRequired: true,
    onlineRequired: false,
    reason: "git_rebase requires approval"
  });
  assert.equal(isReadOnlyCommand("git status"), true);
  assert.equal(isReadOnlyCommand("pnpm dev"), false);
});

test("extractActionsFromText supports git merge/rebase/cherry-pick actions", () => {
  const actions = extractActionsFromText(
    JSON.stringify([
      { type: "git_merge", branch: "release" },
      { type: "git_rebase", upstream: "main" },
      { type: "git_cherry_pick", commit: "abc1234" }
    ])
  );

  assert.deepEqual(
    actions.map((action) => action.type),
    ["git_merge", "git_rebase", "git_cherry_pick"]
  );
  assert.equal(actions[0]?.branch, "release");
  assert.equal(actions[1]?.upstream, "main");
  assert.equal(actions[2]?.commit, "abc1234");
});

test("autonomous loop handles preview + policy gating and skips online-only actions", async () => {
  const actions: AgentAction[] = [
    { type: "preview_start", command: "pnpm dev", reason: "Start app" },
    { type: "preview_snapshot", reason: "Inspect page" },
    { type: "write_file", path: "src/App.tsx", content: "next", reason: "Patch page" },
    { type: "git_push", reason: "Publish result" }
  ];
  const executed: AgentAction["type"][] = [];
  const approvalRequests: AgentAction["type"][] = [];
  const logs: AgentAuditEntry[] = [];

  const result = await runAutonomousLoop({
    goal: "Run and patch preview",
    actions,
    onlineMode: false,
    executeTool: async (action): Promise<ToolExecutionResult> => {
      executed.push(action.type);
      if (action.type === "write_file") {
        return {
          ok: true,
          pendingChange: {
            id: "change-1",
            type: "write",
            path: "src/App.tsx",
            nextContent: "next",
            previousContent: "prev",
            existedBefore: true,
            diff: "@@ -1 +1 @@"
          }
        };
      }
      return { ok: true, output: { action: action.type } };
    },
    requestApproval: async (action) => {
      approvalRequests.push(action.type);
      return true;
    },
    verify: async () => ({ ok: true, output: { tests: "pass" } }),
    log: (entry) => {
      logs.push(entry);
    }
  });

  assert.deepEqual(executed, ["preview_start", "preview_snapshot", "write_file"]);
  assert.deepEqual(approvalRequests, ["preview_start", "write_file"]);
  assert.equal(result.actionResults.length, 4);
  assert.equal(result.actionResults[3]?.skipped, true);
  assert.equal(result.actionResults[3]?.result.error, "Action requires Online mode");
  assert.equal(result.pendingChanges.length, 1);
  assert.equal(result.verifyResult?.ok, true);
  assert.equal(logs.some((entry) => entry.action === "agent.skip"), true);
});

test("autonomous loop records denied approvals without executing tool", async () => {
  const actions: AgentAction[] = [{ type: "write_file", path: "x.ts", content: "x" }];
  let executed = false;

  const result = await runAutonomousLoop({
    goal: "Denied write",
    actions,
    onlineMode: true,
    executeTool: async () => {
      executed = true;
      return { ok: true };
    },
    requestApproval: async () => false,
    log: () => {}
  });

  assert.equal(executed, false);
  assert.equal(result.actionResults.length, 1);
  assert.equal(result.actionResults[0]?.skipped, true);
  assert.equal(result.actionResults[0]?.result.error, "Action denied by user");
});
