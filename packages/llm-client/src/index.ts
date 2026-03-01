export type Provider = "lmstudio" | "ollama" | "custom";

export type LlmConfig = {
  provider: Provider;
  baseUrl: string;
  model: string;
  apiKey: string;
  onlineMode: boolean;
  compactMode: boolean;
  autoManageLocalRuntime: boolean;
  autoStopMinutes: number;
  recentModels: string[];
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamCallbacks = {
  onDelta: (delta: string) => void;
  onDone?: () => void;
};

export const LM_STUDIO_PRESET: Omit<
  LlmConfig,
  "onlineMode" | "compactMode" | "recentModels" | "autoManageLocalRuntime" | "autoStopMinutes"
> = {
  provider: "lmstudio",
  baseUrl: "http://localhost:1234/v1",
  model: "Qwen2.5-Coder-7B-Instruct",
  apiKey: ""
};

export const OLLAMA_PRESET: Omit<
  LlmConfig,
  "onlineMode" | "compactMode" | "recentModels" | "autoManageLocalRuntime" | "autoStopMinutes"
> = {
  provider: "ollama",
  baseUrl: "http://localhost:11434/v1",
  model: "qwen2.5-coder:7b",
  apiKey: ""
};

export function defaultLlmConfig(): LlmConfig {
  return {
    ...OLLAMA_PRESET,
    onlineMode: false,
    compactMode: true,
    autoManageLocalRuntime: true,
    autoStopMinutes: 10,
    recentModels: [LM_STUDIO_PRESET.model, OLLAMA_PRESET.model]
  };
}

export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function canUseBaseUrl(baseUrl: string, onlineMode: boolean): boolean {
  return isLocalBaseUrl(baseUrl) || onlineMode;
}

export async function testConnection(config: Pick<LlmConfig, "baseUrl" | "model" | "apiKey" | "onlineMode">) {
  if (!canUseBaseUrl(config.baseUrl, config.onlineMode)) {
    return { ok: false, error: "Online mode is disabled for non-local endpoints." };
  }

  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      temperature: 0,
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with: pong" }]
    })
  });

  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` };
  }

  return { ok: true };
}

export async function streamChat(
  config: Pick<LlmConfig, "baseUrl" | "model" | "apiKey" | "onlineMode">,
  messages: ChatMessage[],
  callbacks: StreamCallbacks
): Promise<string> {
  if (!canUseBaseUrl(config.baseUrl, config.onlineMode)) {
    throw new Error("Online mode is disabled for non-local endpoints.");
  }

  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      temperature: 0.2
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let endIndex = buffer.indexOf("\n\n");
    while (endIndex >= 0) {
      const packet = buffer.slice(0, endIndex);
      buffer = buffer.slice(endIndex + 2);

      for (const line of packet.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payloadText = line.slice(5).trim();
        if (!payloadText || payloadText === "[DONE]") continue;

        const json = JSON.parse(payloadText);
        const delta: string | undefined = json?.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          callbacks.onDelta(delta);
        }
      }

      endIndex = buffer.indexOf("\n\n");
    }
  }

  callbacks.onDone?.();
  return fullText;
}
