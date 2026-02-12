import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  listWorkspace,
  readWorkspaceFile,
  selectWorkspaceRoot
} from "../services/explorerService";

const Header = styled.div`
  padding: 14px 16px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 10px 16px;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;

  li {
    letter-spacing: 0.2px;
  }
`;

const RefreshButton = styled.button`
  padding: 6px 10px;
  font-size: 12px;
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
`;

const TreeRow = styled.button`
  background: transparent;
  border: 1px solid transparent;
  color: inherit;
  text-align: left;
  padding: 6px 8px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;

  &:hover {
    background: rgba(121, 241, 214, 0.08);
    color: var(--text-primary);
  }

  &[data-active="true"] {
    background: rgba(121, 241, 214, 0.14);
    border-color: rgba(121, 241, 214, 0.2);
    color: #d7fef5;
  }
`;

const TreeLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

const Meta = styled.div`
  padding: 0 16px 12px;
  font-size: 12px;
  color: rgba(200, 207, 218, 0.6);
`;

export default function ExplorerPanel({ activeFile, onOpenFile }) {
  const [tree, setTree] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(new Set());

  const rootPath = tree?.root || "";

  const loadWorkspace = async () => {
    setStatus("loading");
    setError("");
    const response = await listWorkspace({ maxDepth: 5 });
    if (response?.status === "ok") {
      setTree(response);
      setStatus("ready");
    } else {
      setError(response?.message || "Unable to load workspace.");
      setStatus("error");
    }
  };

  const handleSelectRoot = async () => {
    const response = await selectWorkspaceRoot();
    if (response?.status === "ok") {
      setTree(response);
      setStatus("ready");
      setError("");
      return;
    }
    if (response?.status === "cancelled") {
      return;
    }
    setError(response?.message || "Unable to open folder.");
    setStatus("error");
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    if (tree?.tree?.path) {
      setExpanded(new Set([tree.tree.path]));
    }
  }, [tree?.tree?.path]);

  const toggleExpand = (path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleOpenFile = async (node) => {
    if (!node || node.type !== "file") {
      if (node?.path) {
        toggleExpand(node.path);
      }
      return;
    }
    const response = await readWorkspaceFile(node.path);
    if (response?.status === "ok") {
      onOpenFile?.(response);
      return;
    }
    setError(response?.message || "Unable to open file.");
  };

  const treeNodes = useMemo(() => tree?.tree || null, [tree]);

  const renderNode = (node, depth = 0) => {
    if (!node) return null;
    const isDir = node.type === "dir";
    const isExpanded = expanded.has(node.path);
    const label = isDir ? (isExpanded ? "v" : ">") : "-";
    return (
      <li key={node.path}>
        <TreeRow
          type="button"
          onClick={() => handleOpenFile(node)}
          data-active={activeFile === node.path}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <TreeLabel>
            <span>{label}</span>
            <span>{node.name}</span>
          </TreeLabel>
        </TreeRow>
        {isDir && isExpanded && node.children?.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
        {isDir && isExpanded && node.truncated && (
          <Meta style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
            Folder truncated. Expand depth in settings later.
          </Meta>
        )}
      </li>
    );
  };

  return (
    <>
      <Header>
        Explorer
        <Actions>
          <RefreshButton type="button" onClick={loadWorkspace}>
            Refresh
          </RefreshButton>
          <RefreshButton type="button" onClick={handleSelectRoot}>
            Open Folder
          </RefreshButton>
        </Actions>
      </Header>
      <List>
        {status === "loading" && <li>Loading workspace...</li>}
        {status === "error" && <li>{error || "Unable to load workspace."}</li>}
        {status === "ready" && treeNodes && renderNode(treeNodes)}
      </List>
      {rootPath && <Meta>Workspace: {rootPath}</Meta>}
    </>
  );
}
