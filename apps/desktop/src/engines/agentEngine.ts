import { buildTaskGraph, type AgentAction, type ToolExecutionResult } from "@lumen/core-agent";
import type { TaskNode } from "@/state/storeTypes";

export function createExecutionTaskGraph(goal: string, actions: AgentAction[]): TaskNode[] {
  return buildTaskGraph(goal, actions).map((node) => ({
    ...node,
    phase: node.phase as TaskNode["phase"]
  }));
}

export function applyActionResultsToTaskGraph(
  graph: TaskNode[],
  actionResults: Array<{ action: AgentAction; result: ToolExecutionResult; skipped?: boolean }>
): TaskNode[] {
  const withDirectStatus: TaskNode[] = graph.map((node, index) => {
    const result = actionResults[index];
    if (!result) return node;
    if (result.skipped) {
      return {
        ...node,
        status: "blocked" as const,
        detail: result.result.error || node.detail
      };
    }
    return {
      ...node,
      status: (result.result.ok ? "done" : "failed") as TaskNode["status"],
      detail: result.result.ok ? node.detail : result.result.error || node.detail
    };
  });

  return withDirectStatus.map((node) => {
    if (!node.dependsOn.length || node.status !== "pending") return node;
    const hasFailedDependency = node.dependsOn.some((dependencyId) => {
      const dependency = withDirectStatus.find((candidate) => candidate.id === dependencyId);
      return dependency?.status === "failed" || dependency?.status === "blocked";
    });
    if (!hasFailedDependency) return node;
    return {
      ...node,
      status: "blocked",
      detail: node.detail || "Blocked by dependency failure."
    };
  });
}
