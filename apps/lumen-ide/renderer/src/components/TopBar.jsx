import React from "react";
import styled from "styled-components";

const Bar = styled.header`
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-subtle);
  backdrop-filter: blur(12px);
  position: relative;
  z-index: 2;
`;

const Title = styled.div`
  font-size: 18px;
  letter-spacing: 0.6px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const Badge = styled.span`
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(121, 241, 214, 0.12);
  color: var(--accent-teal);
  text-transform: uppercase;
`;

const SettingsButton = styled.button`
  background: linear-gradient(135deg, rgba(121, 241, 214, 0.14), rgba(216, 179, 106, 0.18));
  border: 1px solid rgba(121, 241, 214, 0.18);
  padding: 8px 14px;
`;

export default function TopBar({ onOpenSettings }) {
  return (
    <Bar>
      <Title>
        Lumen IDE
        <Badge>Nyx</Badge>
      </Title>
      <SettingsButton onClick={onOpenSettings}>Settings</SettingsButton>
    </Bar>
  );
}
