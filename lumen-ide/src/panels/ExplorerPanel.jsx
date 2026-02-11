import React from "react";
import styled from "styled-components";

const Header = styled.div`
  padding: 14px 16px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-subtle);
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 10px 16px;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;

  li {
    letter-spacing: 0.2px;
  }
`;

export default function ExplorerPanel() {
  return (
    <>
      <Header>Explorer</Header>
      <List>
        {/* Placeholder tree until project/file system integration is wired. */}
        <li>lumen-ide/</li>
        <li>  src/</li>
        <li>  backend/</li>
        <li>  components/</li>
        <li>  editor/</li>
        <li>  panels/</li>
      </List>
    </>
  );
}
