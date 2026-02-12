import React from "react";
import Editor from "@monaco-editor/react";
import styled from "styled-components";

const Wrapper = styled.div`
  flex: 1;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  min-height: 0;
`;

export default function MonacoEditor({ value, onChange }) {
  return (
    <Wrapper>
      {/* Monaco editor core; future Nyx inline suggestions will land here. */}
      <Editor
        height="100%"
        defaultLanguage="javascript"
        theme="vs-dark"
        value={value}
        onChange={(next) => onChange(next || "")}
        options={{
          fontSize: 14,
          fontFamily: "JetBrains Mono, Consolas, 'Courier New', monospace",
          minimap: { enabled: false },
          wordWrap: "on",
          scrollBeyondLastLine: false
        }}
      />
    </Wrapper>
  );
}
