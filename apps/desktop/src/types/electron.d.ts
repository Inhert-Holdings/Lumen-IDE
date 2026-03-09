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
  helperEnabled: boolean;
  helperUsesMainConnection: boolean;
  helperProvider: "lmstudio" | "ollama" | "custom";
  helperBaseUrl: string;
  helperModel: string;
  helperApiKey: string;
  onlineMode: boolean;
  compactMode: boolean;
  autoManageLocalRuntime: boolean;
  autoStopMinutes: number;
  recentModels: string[];
  helperRecentModels: string[];
};

export type AuditEntry = {
  id: string;
  timestamp: string;
  action: string;
  detail: Record<string, unknown>;
};

export type ProjectInspection = {
  rootPath: string;
  kind: "node" | "python" | "static" | "unknown";
  framework: string;
  confidence: "high" | "medium" | "low";
  packageManager: string;
  scripts: Array<{ name: string; command: string }>;
  runCommand: string;
  buildCommand: string;
  devUrl: string;
  staticRoot: string;
  entryFile: string;
  summary: string;
};

export type PreviewStatus = {
  running: boolean;
  mode: "idle" | "static" | "project";
  url: string;
  port: number;
  rootPath: string;
  entryFile: string;
  projectPath: string;
  projectCommand: string;
  terminalId: string;
  startedAt: string;
  lastDetectedUrl: string;
  inspection: ProjectInspection;
  browser: {
    connected: boolean;
    url: string;
    title: string;
    executable: string;
    consoleErrors: number;
    networkErrors: number;
    lastConsoleError: string;
    lastNetworkError: string;
  };
};

export type PreviewSnapshot = {
  url: string;
  title: string;
  text: string;
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
        inspect: (payload?: { path?: string }) => Promise<ProjectInspection>;
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
        runCmd: (payload: { command: string; terminalId?: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
      };
      preview: {
        status: () => Promise<PreviewStatus>;
        start: (payload?: { path?: string; entry?: string; port?: number }) => Promise<{
          running: boolean;
          mode: "idle" | "static" | "project";
          url: string;
          port: number;
          rootPath: string;
          entryFile: string;
          projectPath: string;
          projectCommand: string;
          terminalId: string;
          startedAt: string;
          lastDetectedUrl: string;
          inspection: ProjectInspection;
          browser: {
            connected: boolean;
            url: string;
            title: string;
            executable: string;
            consoleErrors: number;
            networkErrors: number;
            lastConsoleError: string;
            lastNetworkError: string;
          };
        }>;
        startProject: (payload?: { path?: string; command?: string; url?: string; port?: number; terminalId?: string }) => Promise<PreviewStatus>;
        stop: () => Promise<{ ok: boolean } & PreviewStatus>;
        browserConnect: (payload?: { url?: string }) => Promise<{
          connected: boolean;
          url: string;
          title: string;
          executable: string;
          snapshot: PreviewSnapshot;
        }>;
        browserSnapshot: () => Promise<PreviewSnapshot>;
        browserClick: (payload: { selector: string; url?: string }) => Promise<PreviewSnapshot>;
        browserType: (payload: { selector: string; text: string; url?: string }) => Promise<PreviewSnapshot>;
        browserPress: (payload: { key: string; url?: string }) => Promise<PreviewSnapshot>;
        browserClose: () => Promise<{ connected: boolean; url: string; title: string; executable: string }>;
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
