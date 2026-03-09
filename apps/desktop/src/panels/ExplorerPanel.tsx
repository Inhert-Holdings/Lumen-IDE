import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAppStore } from "@/state/useAppStore";
import type { WorkspaceNode } from "@/types/electron";

type ExplorerPanelProps = {
  refreshTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
};

function joinPath(base: string, leaf: string): string {
  if (!base) return leaf;
  return `${base.replace(/[\\/]+$/, "")}\\${leaf.replace(/^[\\/]+/, "")}`;
}

function parentDir(target: string): string {
  const normalized = target.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return target;
  return normalized.slice(0, idx).replace(/\//g, "\\");
}

function NodeItem({
  node,
  level,
  selectedPath,
  onSelect,
  onOpenFile
}: {
  node: WorkspaceNode;
  level: number;
  selectedPath: string;
  onSelect: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(level < 2);
  const indent = { paddingLeft: `${level * 10 + 6}px` };

  if (node.type === "file") {
    return (
      <button
        style={indent}
        className={`flex h-6 w-full items-center gap-1 text-left text-[11px] hover:bg-white/5 ${
          selectedPath === node.path ? "bg-accent/20 text-accent" : "text-text"
        }`}
        onClick={() => {
          onSelect(node.path);
          onOpenFile(node.path);
        }}
      >
        <span className="text-muted">•</span>
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        style={indent}
        className={`flex h-6 w-full items-center gap-1 text-left text-[11px] hover:bg-white/5 ${
          selectedPath === node.path ? "bg-accent/20 text-accent" : "text-text"
        }`}
        onClick={() => {
          onSelect(node.path);
          setExpanded((value) => !value);
        }}
      >
        <span className="w-3 text-muted">{expanded ? "▾" : "▸"}</span>
        <span className="truncate">{node.name}</span>
      </button>
      {expanded &&
        node.children?.map((child) => (
          <NodeItem
            key={child.path}
            node={child}
            level={level + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onOpenFile={onOpenFile}
          />
        ))}
    </div>
  );
}

export function ExplorerPanel({ refreshTree, openFile }: ExplorerPanelProps) {
  const tree = useAppStore((state) => state.tree);
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const selectedPath = useAppStore((state) => state.selectedPath);
  const setSelectedPath = useAppStore((state) => state.setSelectedPath);

  const selectedNode = useMemo(() => {
    if (!tree || !selectedPath) return null;
    const stack: WorkspaceNode[] = [tree];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.path === selectedPath) return node;
      node.children?.forEach((child) => stack.push(child));
    }
    return null;
  }, [tree, selectedPath]);

  const createFile = async () => {
    const basePath = selectedNode?.type === "dir" ? selectedNode.path : parentDir(selectedPath || workspaceRoot);
    const name = window.prompt("New file path (relative):", "new-file.ts");
    if (!name) return;
    await window.lumen.workspace.create({ path: joinPath(basePath, name) });
    await refreshTree();
  };

  const createFolder = async () => {
    const basePath = selectedNode?.type === "dir" ? selectedNode.path : parentDir(selectedPath || workspaceRoot);
    const name = window.prompt("New folder name:", "new-folder");
    if (!name) return;
    await window.lumen.workspace.mkdir({ path: joinPath(basePath, name) });
    await refreshTree();
  };

  const renamePath = async () => {
    if (!selectedPath || selectedPath === workspaceRoot) return;
    const nextName = window.prompt("Rename to:", selectedNode?.name || "");
    if (!nextName) return;
    await window.lumen.workspace.rename({
      path: selectedPath,
      nextPath: joinPath(parentDir(selectedPath), nextName)
    });
    await refreshTree();
  };

  const deletePath = async () => {
    if (!selectedPath || selectedPath === workspaceRoot) return;
    if (!window.confirm(`Delete ${selectedPath}?`)) return;
    await window.lumen.workspace.delete({ path: selectedPath });
    setSelectedPath(workspaceRoot);
    await refreshTree();
  };

  return (
    <div className="flex h-full flex-col border-r border-border bg-panel/80">
      <div className="border-b border-border px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Explorer</div>
            <div className="max-w-[180px] truncate text-[12px] text-text">{selectedNode?.name || "Workspace"}</div>
          </div>
          <div className="text-[11px] text-muted">{selectedNode?.type || "dir"}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button onClick={createFile}>+F</Button>
          <Button onClick={createFolder}>+D</Button>
          <Button onClick={renamePath}>Ren</Button>
          <Button onClick={deletePath}>Del</Button>
          <Button onClick={() => void refreshTree()}>↻</Button>
        </div>
      </div>
      <div className="border-b border-border px-2 py-1.5 text-[11px] text-muted">
        <div className="truncate">{workspaceRoot || "No folder"}</div>
      </div>
      <div className="lumen-scroll flex-1 overflow-auto py-1">
        {tree ? (
          <NodeItem
            node={tree}
            level={0}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            onOpenFile={openFile}
          />
        ) : (
          <div className="px-2 py-3 text-xs text-muted">Open a folder to begin.</div>
        )}
      </div>
    </div>
  );
}
