export type WorkspaceNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  truncated?: boolean;
  children?: WorkspaceNode[];
};

export type LlmSettings = {
  provider: "lmstudio" | "ollama" | "custom";
  baseUrl: string;
  model: string;
  apiKey: string;
  onlineMode: boolean;
  compactMode: boolean;
  autoManageLocalRuntime: boolean;
  autoStopMinutes: number;
  recentModels: string[];
};

export type AuditEntry = {
  id: string;
  timestamp: string;
  action: string;
  detail: Record<string, unknown>;
};

declare global {
  interface Window {
    lumen: {
      workspace: {
        getRoot: () => Promise<{ root: string }>;
        openFolder: () => Promise<{ cancelled: boolean; root: string }>;
        list: (payload?: { path?: string }) => Promise<{ root: string; tree: WorkspaceNode }>;
        read: (payload: { path: string }) => Promise<{ path: string; content: string }>;
        write: (payload: { path: string; content: string }) => Promise<{ ok: boolean }>;
        create: (payload: { path: string }) => Promise<{ ok: boolean }>;
        mkdir: (payload: { path: string }) => Promise<{ ok: boolean }>;
        rename: (payload: { path: string; nextPath: string }) => Promise<{ ok: boolean }>;
        delete: (payload: { path: string }) => Promise<{ ok: boolean }>;
        search: (payload: { query: string; maxResults?: number }) => Promise<{ results: Array<{ path: string; line: number; preview: string }> }>;
      };
      terminal: {
        create: (payload?: { cols?: number; rows?: number }) => Promise<{ id: string; shell: string; cwd: string }>;
        list: () => Promise<{ terminals: Array<{ id: string }> }>;
        write: (payload: { id: string; data: string }) => Promise<{ ok: boolean }>;
        resize: (payload: { id: string; cols: number; rows: number }) => Promise<{ ok: boolean }>;
        kill: (payload: { id: string }) => Promise<{ ok: boolean }>;
        onData: (listener: (payload: { id: string; data: string }) => void) => () => void;
        onExit: (listener: (payload: { id: string; exitCode: number }) => void) => () => void;
      };
      git: {
        status: () => Promise<{
          isRepo: boolean;
          branch: string;
          files: Array<{ path: string; index: string; workingDir: string }>;
        }>;
        diff: (payload: { path?: string; staged?: boolean }) => Promise<{ isRepo: boolean; diff: string }>;
        stage: (payload: { paths: string[] }) => Promise<{ ok: boolean }>;
        unstage: (payload: { paths: string[] }) => Promise<{ ok: boolean }>;
        commit: (payload: { message: string }) => Promise<{ ok: boolean; hash: string }>;
        push: () => Promise<{ ok: boolean }>;
      };
      settings: {
        load: () => Promise<LlmSettings>;
        save: (payload: LlmSettings) => Promise<LlmSettings>;
      };
      llm: {
        test: (payload: {
          baseUrl: string;
          model: string;
          apiKey?: string;
        }) => Promise<{ ok: boolean; reply: string; modelUsed?: string; note?: string }>;
        listModels: (payload: { baseUrl: string; model: string; apiKey?: string; provider?: string }) => Promise<{ models: string[] }>;
        installModel: (payload: { baseUrl: string; model: string; apiKey?: string; provider?: string }) => Promise<{
          ok: boolean;
          model: string;
          output: string;
        }>;
        startStream: (payload: {
          requestId: string;
          config: { baseUrl: string; model: string; apiKey?: string; temperature?: number };
          messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
        }) => Promise<{ ok: boolean }>;
        abortStream: (payload: { requestId: string }) => Promise<{ ok: boolean }>;
        onChunk: (listener: (payload: { requestId: string; delta: string }) => void) => () => void;
        onDone: (listener: (payload: { requestId: string }) => void) => () => void;
        onError: (listener: (payload: { requestId: string; error: string }) => void) => () => void;
        onStatus: (listener: (payload: { requestId: string; message: string; modelUsed?: string }) => void) => () => void;
      };
      agent: {
        runCmd: (payload: { command: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
      };
      preview: {
        status: () => Promise<{ running: boolean; url: string; port: number; rootPath: string; entryFile: string }>;
        start: (payload?: { path?: string; entry?: string; port?: number }) => Promise<{
          running: boolean;
          url: string;
          port: number;
          rootPath: string;
          entryFile: string;
        }>;
        stop: () => Promise<{
          ok: boolean;
          running: boolean;
          url: string;
          port: number;
          rootPath: string;
          entryFile: string;
        }>;
      };
      audit: {
        list: () => Promise<{ entries: AuditEntry[] }>;
        clear: () => Promise<{ ok: boolean }>;
        onEntry: (listener: (payload: AuditEntry) => void) => () => void;
      };
    };
  }
}

export {};
