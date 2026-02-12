import React, { useState } from "react";
import styled, { keyframes } from "styled-components";

const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(4, 6, 10, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
`;

const Modal = styled.div`
  width: min(520px, 90vw);
  background: linear-gradient(180deg, rgba(15, 19, 26, 0.96), rgba(10, 13, 18, 0.96));
  border: 1px solid var(--border-subtle);
  border-radius: 18px;
  padding: 24px;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5);
  animation: ${fadeIn} 220ms ease both;
`;

const Title = styled.h2`
  margin: 0 0 16px;
  font-size: 20px;
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;

  label {
    font-size: 13px;
    color: var(--text-muted);
  }
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
`;

export default function SettingsModal({ initialSettings, onClose, onSave }) {
  // Placeholder storage until real encryption + secrets manager is wired in.
  const [apiKey, setApiKey] = useState(initialSettings?.apiKey || "");
  const [ssh, setSsh] = useState(initialSettings?.ssh || "");
  const [db, setDb] = useState(initialSettings?.db || "");

  const handleSave = () => {
    onSave({ apiKey, ssh, db });
  };

  return (
    <Overlay>
      <Modal>
        <Title>Settings & Credentials</Title>
        <Field>
          <label>API Key</label>
          <input
            type="password"
            placeholder="Enter API key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </Field>
        <Field>
          <label>SSH / VPS Placeholder</label>
          <input
            type="text"
            placeholder="user@host:22"
            value={ssh}
            onChange={(event) => setSsh(event.target.value)}
          />
        </Field>
        <Field>
          <label>Database Connection Placeholder</label>
          <input
            type="text"
            placeholder="postgres://user:pass@host:5432/db"
            value={db}
            onChange={(event) => setDb(event.target.value)}
          />
        </Field>
        <small>
          Stored locally using a placeholder encrypted JSON format. Replace with
          real encryption and secret storage in production.
        </small>
        <Actions>
          <button onClick={onClose}>Cancel</button>
          <button onClick={handleSave}>Save</button>
        </Actions>
      </Modal>
    </Overlay>
  );
}
