import type { WorkspaceNode } from "@/types/electron";

export function buildAgentPersistenceKey(workspaceRoot: string) {
  const safeWorkspace = workspaceRoot.replace(/[^A-Za-z0-9_-]+/g, "_").slice(-120);
  return `lumen.agent.memory.v2.${safeWorkspace}`;
}

export function workspaceDisplayName(workspaceRoot: string) {
  if (!workspaceRoot) return "No Workspace";
  const parts = workspaceRoot.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || workspaceRoot;
}

export function toWorkspaceRelativePath(workspaceRoot: string, targetPath: string) {
  if (!workspaceRoot || !targetPath) return targetPath || "";
  if (!targetPath.startsWith(workspaceRoot)) return targetPath;
  return targetPath.slice(workspaceRoot.length).replace(/^[\\/]+/, "") || ".";
}

export function flattenWorkspaceFiles(tree: WorkspaceNode | null, limit = 400): string[] {
  if (!tree) return [];
  const files: string[] = [];
  const stack: WorkspaceNode[] = [tree];
  while (stack.length > 0 && files.length < limit) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "file") {
      files.push(node.path);
      continue;
    }
    if (!Array.isArray(node.children) || node.children.length === 0) continue;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (!child) continue;
      stack.push(child);
    }
  }
  return files;
}
