import React from "react";
import styled from "styled-components";

const Header = styled.div`
  padding: 14px 16px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const NyxAction = styled.button`
  padding: 8px 12px;
  font-size: 12px;
`;

const Content = styled.div`
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  overflow: auto;
  color: var(--text-muted);
`;

const ResponseBox = styled.div`
  background: rgba(121, 241, 214, 0.08);
  border: 1px solid rgba(121, 241, 214, 0.2);
  border-radius: 12px;
  padding: 12px;
  color: #d7fef5;
`;

const Suggestion = styled.div`
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.03);
`;

export default function NyxConsole({ nyxData, onSend }) {
  return (
    <>
      <Header>
        Nyx AI Console
        <NyxAction onClick={onSend}>Send to Nyx</NyxAction>
      </Header>
      <Content>
        {!nyxData && (
          <p>
            Nyx is warming up. Send your current file to receive AI suggestions.
          </p>
        )}
        {nyxData && (
          <>
            <ResponseBox>{nyxData.summary}</ResponseBox>
            <div>
              <strong>Suggestions</strong>
              <div style={{ display: "grid", gap: "8px", marginTop: "8px" }}>
                {nyxData.suggestions?.map((item) => (
                  <Suggestion key={item}>{item}</Suggestion>
                ))}
              </div>
            </div>
            <small>Last update: {nyxData.timestamp}</small>
          </>
        )}
      </Content>
    </>
  );
}
