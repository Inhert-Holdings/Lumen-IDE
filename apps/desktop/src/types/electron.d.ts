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
  lowResourceMode: boolean;
  permissionPreset:
    | "read_only"
    | "local_edit_only"
    | "local_build_mode"
    | "preview_operator"
    | "git_operator"
    | "full_local_workspace"
    | "trusted_workspace_profile";
};

export type ActionRisk = "obvious" | "likely" | "uncertain" | "risky";

export type PolicyDecision = {
  preset: LlmSettings["permissionPreset"];
  actionType: string;
  risk: ActionRisk;
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
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

export type PreviewScreenshot = {
  path: string;
  url: string;
  title: string;
};

export type PreviewPickedSelector = {
  selector: string;
  tag: string;
  text: string;
  x: number;
  y: number;
  ratioX: number;
  ratioY: number;
};

export type PreviewBrowserDiagnostics = {
  url: string;
  title: string;
  consoleEvents: Array<{
    type: string;
    text: string;
    location?: { url?: string; lineNumber?: number; columnNumber?: number } | null;
    at: string;
  }>;
  networkEvents: Array<{
    type: string;
    url: string;
    method: string;
    status: number;
    ok: boolean;
    error?: string;
    at: string;
  }>;
  domSummary: null | {
    url: string;
    title: string;
    headings: string[];
    counts: {
      links: number;
      buttons: number;
      inputs: number;
      forms: number;
      interactive: number;
    };
    textSample: string;
  };
};

declare global {
  interface Window {
    lumen: {
      workspace: {
        getRoot: () => Promise<{ root: string }>;
        openFolder: () => Promise<{ cancelled: boolean; root: string }>;
        setRoot: (payload: { root: string; source?: string }) => Promise<{ ok: boolean; root: string }>;
        list: (payload?: { path?: string }) => Promise<{ root: string; tree: WorkspaceNode }>;
        read: (payload: { path: string }) => Promise<{ path: string; content: string }>;
        write: (payload: {
          path: string;
          content: string;
          approved?: boolean;
          source?: "user" | "agent_apply";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<{ ok: boolean }>;
        create: (payload: { path: string }) => Promise<{ ok: boolean }>;
        mkdir: (payload: { path: string }) => Promise<{ ok: boolean }>;
        rename: (payload: { path: string; nextPath: string }) => Promise<{ ok: boolean }>;
        delete: (payload: {
          path: string;
          approved?: boolean;
          source?: "user" | "agent_apply";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<{ ok: boolean }>;
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
        commit: (payload: { message: string; approved?: boolean }) => Promise<{ ok: boolean; hash: string }>;
        push: (payload?: { approved?: boolean }) => Promise<{ ok: boolean }>;
        merge: (payload: { branch: string; approved?: boolean }) => Promise<{
          ok: boolean;
          branch: string;
          summary: { changes: number; insertions: number; deletions: number } | null;
        }>;
        rebase: (payload: { upstream: string; approved?: boolean }) => Promise<{
          ok: boolean;
          upstream: string;
          output: string;
        }>;
        cherryPick: (payload: { commit: string; approved?: boolean }) => Promise<{
          ok: boolean;
          commit: string;
          output: string;
        }>;
        branches: () => Promise<{
          isRepo: boolean;
          current: string;
          branches: Array<{ name: string; current: boolean; remote: boolean }>;
        }>;
        checkout: (payload: { name: string; create?: boolean }) => Promise<{ ok: boolean; current: string }>;
        history: (payload?: { limit?: number }) => Promise<{
          isRepo: boolean;
          commits: Array<{ hash: string; shortHash: string; message: string; author: string; date: string }>;
        }>;
        restore: (payload: { paths: string[]; staged?: boolean; workingTree?: boolean }) => Promise<{ ok: boolean }>;
        conflicts: () => Promise<{ isRepo: boolean; hasConflicts: boolean; files: string[]; hints: string[] }>;
        resolveConflict: (payload: { path: string; strategy: "ours" | "theirs" }) => Promise<{
          ok: boolean;
          path: string;
          strategy: "ours" | "theirs";
        }>;
      };
      policy: {
        get: () => Promise<{ preset: LlmSettings["permissionPreset"]; presets: LlmSettings["permissionPreset"][] }>;
        setPreset: (payload: { preset: LlmSettings["permissionPreset"] }) => Promise<{ preset: LlmSettings["permissionPreset"]; presets: LlmSettings["permissionPreset"][] }>;
        evaluate: (payload: { actionType: string; command?: string; preset?: LlmSettings["permissionPreset"] }) => Promise<PolicyDecision>;
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
        runCmd: (payload: {
          command: string;
          terminalId?: string;
          approved?: boolean;
          source?: "agent" | "system";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<{ code: number; stdout: string; stderr: string }>;
        setMode: (payload: { mode: "manual" | "live_build"; taskGraph?: unknown[] }) => Promise<{ mode: "manual" | "live_build" }>;
        getTaskGraph: () => Promise<{ mode: "manual" | "live_build"; taskGraph: unknown[] }>;
      };
      preview: {
        status: () => Promise<PreviewStatus>;
        start: (payload?: {
          path?: string;
          entry?: string;
          port?: number;
          approved?: boolean;
          source?: "user" | "agent";
          preset?: LlmSettings["permissionPreset"];
          command?: string;
        }) => Promise<{
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
        startProject: (payload?: {
          path?: string;
          command?: string;
          url?: string;
          port?: number;
          terminalId?: string;
          approved?: boolean;
          source?: "user" | "agent";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<PreviewStatus>;
        stop: () => Promise<{ ok: boolean } & PreviewStatus>;
        browserConnect: (payload?: {
          url?: string;
          approved?: boolean;
          source?: "user" | "agent";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<{
          connected: boolean;
          url: string;
          title: string;
          executable: string;
          snapshot: PreviewSnapshot;
        }>;
        browserSnapshot: (payload?: {
          approved?: boolean;
          source?: "user" | "agent";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<PreviewSnapshot>;
        browserDiagnostics: (payload?: {
          url?: string;
          limit?: number;
          includeDom?: boolean;
          approved?: boolean;
          source?: "user" | "agent";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<PreviewBrowserDiagnostics>;
        browserScreenshot: (payload?: {
          url?: string;
          fileName?: string;
          fullPage?: boolean;
          approved?: boolean;
          source?: "user" | "agent";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<PreviewScreenshot>;
        browserClick: (payload: {
          selector: string;
          url?: string;
          approved?: boolean;
          source?: "user" | "agent";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<PreviewSnapshot>;
        browserType: (payload: {
          selector: string;
          text: string;
          url?: string;
          approved?: boolean;
          source?: "user" | "agent";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<PreviewSnapshot>;
        browserPress: (payload: {
          key: string;
          url?: string;
          approved?: boolean;
          source?: "user" | "agent";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<PreviewSnapshot>;
        browserPick: (payload: {
          ratioX: number;
          ratioY: number;
          url?: string;
          approved?: boolean;
          source?: "user" | "agent";
          preset?: LlmSettings["permissionPreset"];
        }) => Promise<PreviewPickedSelector>;
        browserClose: () => Promise<{ connected: boolean; url: string; title: string; executable: string }>;
      };
      runtime: {
        setLowResourceMode: (payload: { enabled: boolean }) => Promise<{
          lowResourceMode: boolean;
          managedRuntime: { active: boolean; name: string; modelsPath: string };
          preview: { staticRunning: boolean; projectRunning: boolean; browserConnected: boolean };
          workspaceWatcher: { active: boolean; eventCount: number; lastEventAt: string; reason: string };
          workspaceIndex: {
            status: string;
            queued: boolean;
            running: boolean;
            filesIndexed: number;
            dirsIndexed: number;
            truncated: boolean;
            lastIndexedAt: string;
            lastDurationMs: number;
            maxDepth: number;
            maxEntries: number;
            lastReason: string;
            error: string;
          };
          process: { pid: number; uptimeSec: number; memoryRss: number };
        }>;
        getHealth: () => Promise<{
          lowResourceMode: boolean;
          managedRuntime: { active: boolean; name: string; modelsPath: string };
          preview: { staticRunning: boolean; projectRunning: boolean; browserConnected: boolean };
          workspaceWatcher: { active: boolean; eventCount: number; lastEventAt: string; reason: string };
          workspaceIndex: {
            status: string;
            queued: boolean;
            running: boolean;
            filesIndexed: number;
            dirsIndexed: number;
            truncated: boolean;
            lastIndexedAt: string;
            lastDurationMs: number;
            maxDepth: number;
            maxEntries: number;
            lastReason: string;
            error: string;
          };
          process: { pid: number; uptimeSec: number; memoryRss: number };
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
