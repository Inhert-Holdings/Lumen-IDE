import React, { useEffect, useState } from "react";
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

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: rgba(200, 207, 218, 0.7);
`;

const Input = styled.textarea`
  min-height: 90px;
  resize: vertical;
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  background: rgba(8, 10, 14, 0.7);
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: 13px;
  font-family: var(--font-ui);
`;

const SelectRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
`;

const QuickActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const PillButton = styled.button`
  padding: 6px 10px;
  font-size: 11px;
  border-radius: 999px;
`;

const ToggleRow = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: rgba(200, 207, 218, 0.7);
`;

const ToggleInput = styled.input`
  width: 16px;
  height: 16px;
`;

const Select = styled.select`
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: rgba(8, 10, 14, 0.7);
  color: var(--text-primary);
  padding: 8px 10px;
  font-size: 13px;
`;

const TextInput = styled.input`
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: rgba(8, 10, 14, 0.7);
  color: var(--text-primary);
  padding: 8px 10px;
  font-size: 13px;
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

const Status = styled.span`
  font-size: 12px;
  color: ${({ $active }) => ($active ? "#79f1d6" : "rgba(200, 207, 218, 0.6)")};
`;

const MODEL_OPTIONS = [
  { value: "auto", label: "Auto select" },
  { value: "gpt-5.2-codex", label: "gpt-5.2-codex" },
  { value: "gpt-5.1-codex", label: "gpt-5.1-codex" },
  { value: "gpt-5-codex", label: "gpt-5-codex" },
  { value: "codex-mini-latest", label: "codex-mini-latest" },
  { value: "gpt-4.1", label: "gpt-4.1" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  { value: "custom", label: "Custom model ID" }
];

const MODE_OPTIONS = [
  { value: "review", label: "Review" },
  { value: "refactor", label: "Refactor" },
  { value: "tests", label: "Generate tests" },
  { value: "explain", label: "Explain" },
  { value: "fix", label: "Bug hunt" }
];

const MODE_TEMPLATES = {
  review: "Review the current file and suggest improvements with clear, actionable steps.",
  refactor:
    "Refactor the current file for clarity, maintainability, and performance. Provide a step-by-step plan and proposed edits.",
  tests: "Generate tests for the current file. Focus on edge cases and core behavior.",
  explain: "Explain what this file does, key flows, and how it fits the system.",
  fix: "Identify likely bugs or risks and propose concrete fixes."
};

export default function NyxConsole({ status, payload, activeFile, onSend }) {
  const [prompt, setPrompt] = useState("");
  const [lastTemplate, setLastTemplate] = useState("");
  const [mode, setMode] = useState("review");
  const [modelChoice, setModelChoice] = useState("auto");
  const [customModel, setCustomModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState("auto");
  const [allowWrite, setAllowWrite] = useState(false);

  useEffect(() => {
    const template = MODE_TEMPLATES[mode] || "";
    if (!prompt || prompt === lastTemplate) {
      setPrompt(template);
      setLastTemplate(template);
    }
  }, [mode]);

  const handlePromptChange = (event) => {
    setPrompt(event.target.value);
    setLastTemplate("");
  };

  const handleSend = () => {
    const model = modelChoice === "custom" ? customModel.trim() || "auto" : modelChoice;
    onSend({ prompt: prompt.trim(), model, reasoningEffort, allowWrite, mode });
  };

  const runQuickAction = (nextMode) => {
    const template = MODE_TEMPLATES[nextMode] || prompt;
    const model = modelChoice === "custom" ? customModel.trim() || "auto" : modelChoice;
    setMode(nextMode);
    setPrompt(template);
    setLastTemplate(template);
    onSend({ prompt: template.trim(), model, reasoningEffort, allowWrite, mode: nextMode });
  };

  return (
    <>
      <Header>
        Nyx AI Console
        <NyxAction onClick={handleSend}>Summon Nyx</NyxAction>
      </Header>
      <Content>
        <Status $active={status === "thinking"}>
          {status === "thinking" ? "Nyx scanning workspace..." : "Idle"}
        </Status>
        <Field>
          Mode
          <Select value={mode} onChange={(event) => setMode(event.target.value)}>
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Input
          placeholder="Describe the task for Nyx (review, refactor, tests, etc.)"
          value={prompt}
          onChange={handlePromptChange}
        />
        <QuickActions>
          <PillButton type="button" onClick={() => runQuickAction("refactor")}>
            Refactor file
          </PillButton>
          <PillButton type="button" onClick={() => runQuickAction("tests")}>
            Generate tests
          </PillButton>
          <PillButton type="button" onClick={() => runQuickAction("explain")}>
            Explain file
          </PillButton>
        </QuickActions>
        <SelectRow>
          <Field>
            Model
            <Select value={modelChoice} onChange={(event) => setModelChoice(event.target.value)}>
              {MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            Reasoning effort
            <Select
              value={reasoningEffort}
              onChange={(event) => setReasoningEffort(event.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
        </SelectRow>
        <ToggleRow>
          <ToggleInput
            type="checkbox"
            checked={allowWrite}
            onChange={(event) => setAllowWrite(event.target.checked)}
          />
          Allow Nyx to edit files in this workspace
        </ToggleRow>
        {activeFile && <small>Active file: {activeFile}</small>}
        {modelChoice === "custom" && (
          <Field>
            Custom model ID
            <TextInput
              placeholder="e.g. gpt-5-codex"
              value={customModel}
              onChange={(event) => setCustomModel(event.target.value)}
            />
          </Field>
        )}
        {!payload && (
          <p>Nyx is warming up. Send your current file to receive AI suggestions.</p>
        )}
        {payload && (
          <>
            <ResponseBox>{payload.response?.message}</ResponseBox>
            <div>
              <strong>Suggestions</strong>
              <div style={{ display: "grid", gap: "8px", marginTop: "8px" }}>
                {payload.suggestions?.suggestions?.map((item) => (
                  <Suggestion key={item}>{item}</Suggestion>
                ))}
              </div>
            </div>
          </>
        )}
      </Content>
    </>
  );
}
