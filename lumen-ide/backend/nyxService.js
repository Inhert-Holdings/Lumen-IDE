const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { createResponse, listModels } = require('./openaiClient');

let cachedModels = null;
let cachedAt = 0;
let lastResponseText = '';
let lastResponseMeta = null;

const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

const WORKSPACE_STATE_FILE = 'lumen-workspace.json';
const DEFAULT_WORKSPACE_ROOT = path.resolve(__dirname, '..');
const MAX_TOOL_FILE_BYTES = 512 * 1024;
const MAX_TREE_ENTRIES = 1200;
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.lumen-user']);
const EXCLUDED_FILES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'lumen-settings.enc.json',
  'lumen-workspace.json'
]);
const MAX_SEARCH_RESULTS = 40;
const MAX_SEARCH_FILES = 400;
const MAX_SEARCH_FILE_BYTES = 300 * 1024;

const getUserDataDir = () => {
  try {
    return app?.getPath?.('userData') || path.join(DEFAULT_WORKSPACE_ROOT, '.lumen-user');
  } catch {
    return path.join(DEFAULT_WORKSPACE_ROOT, '.lumen-user');
  }
};

const getWorkspaceStatePath = () => path.join(getUserDataDir(), WORKSPACE_STATE_FILE);

const loadWorkspaceRoot = () => {
  const statePath = getWorkspaceStatePath();
  if (!fs.existsSync(statePath)) {
    return DEFAULT_WORKSPACE_ROOT;
  }
  try {
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (data?.root && fs.existsSync(data.root)) {
      const stat = fs.statSync(data.root);
      if (stat.isDirectory()) {
        return data.root;
      }
    }
  } catch {
    return DEFAULT_WORKSPACE_ROOT;
  }
  return DEFAULT_WORKSPACE_ROOT;
};

const isWithinWorkspace = (targetPath, workspaceRoot) => {
  const resolved = path.resolve(targetPath);
  return resolved === workspaceRoot || resolved.startsWith(`${workspaceRoot}${path.sep}`);
};

const shouldSkipEntry = (entry) => {
  if (!entry) return true;
  if (entry.isDirectory()) {
    return EXCLUDED_DIRS.has(entry.name);
  }
  return EXCLUDED_FILES.has(entry.name);
};

const buildTree = (currentPath, depth, maxDepth, counter) => {
  const name = path.basename(currentPath);
  const node = {
    name,
    path: currentPath,
    type: 'dir',
    children: [],
    truncated: false
  };

  if (depth >= maxDepth) {
    node.truncated = true;
    return node;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return node;
  }

  const filtered = entries.filter((entry) => !shouldSkipEntry(entry));
  filtered.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of filtered) {
    if (counter.count >= MAX_TREE_ENTRIES) {
      node.truncated = true;
      break;
    }
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      node.children.push(buildTree(entryPath, depth + 1, maxDepth, counter));
    } else {
      node.children.push({
        name: entry.name,
        path: entryPath,
        type: 'file'
      });
    }
    counter.count += 1;
  }

  return node;
};

const listWorkspaceTool = ({ max_depth: maxDepth = 4 } = {}) => {
  const workspaceRoot = loadWorkspaceRoot();
  const counter = { count: 0 };
  const tree = buildTree(workspaceRoot, 0, maxDepth, counter);
  return {
    status: 'ok',
    root: workspaceRoot,
    tree,
    truncated: counter.count >= MAX_TREE_ENTRIES
  };
};

const readWorkspaceFileTool = ({ path: filePath } = {}) => {
  const workspaceRoot = loadWorkspaceRoot();
  if (!filePath || !isWithinWorkspace(filePath, workspaceRoot)) {
    return { status: 'error', message: 'File is outside the workspace root.' };
  }

  const fileName = path.basename(filePath);
  if (EXCLUDED_FILES.has(fileName)) {
    return { status: 'error', message: 'This file is restricted.' };
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { status: 'error', message: 'File not found.' };
  }

  if (!stat.isFile()) {
    return { status: 'error', message: 'Path is not a file.' };
  }

  if (stat.size > MAX_TOOL_FILE_BYTES) {
    return { status: 'error', message: 'File is too large to read.' };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { status: 'ok', path: filePath, content };
  } catch {
    return { status: 'error', message: 'Unable to read file.' };
  }
};

const writeWorkspaceFileTool = ({ path: filePath, content } = {}, allowWrite = false) => {
  if (!allowWrite) {
    return { status: 'error', message: 'Write access is disabled. Enable file edits to apply changes.' };
  }

  const workspaceRoot = loadWorkspaceRoot();
  if (!filePath || !isWithinWorkspace(filePath, workspaceRoot)) {
    return { status: 'error', message: 'File is outside the workspace root.' };
  }

  const fileName = path.basename(filePath);
  if (EXCLUDED_FILES.has(fileName)) {
    return { status: 'error', message: 'This file is restricted.' };
  }

  if (typeof content !== 'string') {
    return { status: 'error', message: 'Content must be a string.' };
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return { status: 'ok', path: filePath, bytes: Buffer.byteLength(content, 'utf8') };
  } catch {
    return { status: 'error', message: 'Unable to write file.' };
  }
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const searchWorkspaceTool = ({ query, max_results: maxResults = MAX_SEARCH_RESULTS, case_sensitive: caseSensitive = false, use_regex: useRegex = false } = {}) => {
  const workspaceRoot = loadWorkspaceRoot();
  if (!query || !String(query).trim()) {
    return { status: 'error', message: 'Query is required.' };
  }

  let regex;
  try {
    const flags = caseSensitive ? 'g' : 'gi';
    regex = useRegex ? new RegExp(query, flags) : new RegExp(escapeRegExp(query), flags);
  } catch {
    return { status: 'error', message: 'Invalid search pattern.' };
  }

  const results = [];
  let fileCount = 0;

  const walk = (dir) => {
    if (fileCount >= MAX_SEARCH_FILES || results.length >= maxResults) {
      return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults || fileCount >= MAX_SEARCH_FILES) {
        return;
      }
      if (shouldSkipEntry(entry)) {
        continue;
      }
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else {
        fileCount += 1;
        let stat;
        try {
          stat = fs.statSync(entryPath);
        } catch {
          continue;
        }
        if (!stat.isFile() || stat.size > MAX_SEARCH_FILE_BYTES) {
          continue;
        }
        let content;
        try {
          content = fs.readFileSync(entryPath, 'utf8');
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          if (regex.test(lines[i])) {
            results.push({
              path: entryPath,
              line: i + 1,
              preview: lines[i].trim().slice(0, 240)
            });
            if (results.length >= maxResults) {
              return;
            }
          }
        }
      }
    }
  };

  walk(workspaceRoot);
  return { status: 'ok', query: String(query), results, truncated: results.length >= maxResults };
};

const normalizeText = (text) => {
  if (!text) {
    return '';
  }
  return text.replace(/\r\n/g, '\n').trim();
};

const scoreComplexity = ({ fileContent, prompt }) => {
  const content = fileContent || '';
  const task = prompt || '';
  const lines = content.split('\n').length;
  const promptLength = task.length;

  let score = 0;
  if (lines > 800) score += 6;
  else if (lines > 300) score += 3;
  else if (lines > 120) score += 1;

  if (promptLength > 800) score += 6;
  else if (promptLength > 300) score += 3;
  else if (promptLength > 120) score += 1;

  const complexityHints = [
    'architecture',
    'refactor',
    'multi-file',
    'migration',
    'performance',
    'optimize',
    'security',
    'test suite',
    'end-to-end',
    'integration'
  ];

  const lowerPrompt = task.toLowerCase();
  complexityHints.forEach((hint) => {
    if (lowerPrompt.includes(hint)) {
      score += 2;
    }
  });

  const simplicityHints = ['quick', 'small', 'minor', 'typo', 'format'];
  simplicityHints.forEach((hint) => {
    if (lowerPrompt.includes(hint)) {
      score -= 1;
    }
  });

  if (score >= 8) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
};

const uniqueList = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
};

const candidateModelsForTier = (tier) => {
  const envOverride = process.env.LUMEN_MODEL_OVERRIDE;
  if (envOverride) {
    return [envOverride];
  }

  const low = [
    process.env.LUMEN_MODEL_LOW,
    'codex-mini-latest',
    'gpt-5-codex',
    'gpt-4.1-mini'
  ];
  const medium = [
    process.env.LUMEN_MODEL_MEDIUM,
    'gpt-5.1-codex',
    'gpt-5-codex',
    'gpt-4.1'
  ];
  const high = [
    process.env.LUMEN_MODEL_HIGH,
    'gpt-5.2-codex',
    'gpt-5.1-codex',
    'gpt-5-codex',
    'gpt-4.1'
  ];

  if (tier === 'high') return uniqueList(high);
  if (tier === 'medium') return uniqueList(medium);
  return uniqueList(low);
};

const loadModels = async (apiKey) => {
  const now = Date.now();
  if (cachedModels && now - cachedAt < MODEL_CACHE_TTL_MS) {
    return cachedModels;
  }

  const response = await listModels(apiKey);
  cachedModels = response?.data?.map((item) => item.id) || [];
  cachedAt = now;
  return cachedModels;
};

const selectModel = async ({ apiKey, tier }) => {
  const candidates = candidateModelsForTier(tier);
  if (!apiKey) {
    return candidates[0] || 'gpt-5-codex';
  }

  try {
    const available = await loadModels(apiKey);
    const match = candidates.find((model) => available.includes(model));
    if (match) return match;

    const codexFallback = available.find((id) => id.includes('codex'));
    return codexFallback || available[0] || candidates[0] || 'gpt-5-codex';
  } catch (_error) {
    return candidates[0] || 'gpt-5-codex';
  }
};

const extractOutputText = (response) => {
  if (!response) return '';
  if (response.output_text) return response.output_text;

  const output = response.output || [];
  const parts = [];
  for (const item of output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      item.content.forEach((content) => {
        if (content.type === 'output_text' && content.text) {
          parts.push(content.text);
        }
      });
    }
  }

  return parts.join('\n').trim();
};

const sanitizeModelOutput = (text) => {
  if (!text) return '';
  const lines = text.split('\n');
  const cleaned = lines
    .filter((line) => !line.includes('<replace_with_actual_path>'))
    .filter((line) => !line.includes('<replace'))
    .filter((line) => !line.trim().startsWith('F:'))
    .filter((line) => !/\\+L\\d+-L\\d+/i.test(line))
    .map((line) =>
      line.replace(/<replace_with_actual_path>/g, '').replace(/<replace[^>]*>/g, '').trimEnd()
    );
  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const truncateContent = (content, maxChars) => {
  if (content.length <= maxChars) {
    return { text: content, truncated: false };
  }

  return {
    text: content.slice(0, maxChars),
    truncated: true
  };
};

const buildPrompt = ({ fileContent, prompt, filePath, workspaceRoot }) => {
  const task = normalizeText(prompt) || 'Review this file and provide the best improvements.';
  const normalizedContent = normalizeText(fileContent);
  const { text, truncated } = truncateContent(normalizedContent, 12000);

  const notes = truncated
    ? '\n\n[Note: File content truncated for context. Request full file if needed.]'
    : '';

  const header = [];
  if (workspaceRoot) header.push(`Workspace root: ${workspaceRoot}`);
  if (filePath) header.push(`Current file: ${filePath}`);

  const headerText = header.length ? `${header.join('\n')}\n\n` : '';

  return `${headerText}Task: ${task}\n\nFile content:\n\n${text}${notes}`.trim();
};

const determineReasoningEffort = (model, tier) => {
  if (!model || !model.startsWith('gpt-5')) {
    return undefined;
  }

  if (tier === 'high') return 'high';
  if (tier === 'medium') return 'medium';
  return 'low';
};

const maxOutputTokensForTier = (tier) => {
  if (tier === 'high') return 2200;
  if (tier === 'medium') return 1200;
  return 500;
};


const MAX_TOOL_ROUNDS = 6;

const buildTools = ({ allowWrite } = {}) => {
  const tools = [
    {
      type: 'function',
      name: 'list_workspace',
      description: 'List the workspace file tree. Use for project context.',
      parameters: {
        type: 'object',
        properties: {
          max_depth: { type: 'integer', minimum: 1, maximum: 8 }
        }
      }
    },
    {
      type: 'function',
      name: 'read_file',
      description: 'Read a file from the workspace by absolute path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    },
    {
      type: 'function',
      name: 'search_files',
      description: 'Search workspace files for a query and return matching lines.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_results: { type: 'integer', minimum: 1, maximum: 200 },
          case_sensitive: { type: 'boolean' },
          use_regex: { type: 'boolean' }
        },
        required: ['query']
      }
    }
  ];

  if (allowWrite) {
    tools.push({
      type: 'function',
      name: 'write_file',
      description: 'Write a file to the workspace (create or overwrite).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    });
  }

  return tools;
};

const parseToolArguments = (raw) => {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const executeToolCall = (call, allowWrite) => {
  const name = call?.name;
  const args = parseToolArguments(call?.arguments);

  switch (name) {
    case 'list_workspace':
      return listWorkspaceTool(args);
    case 'read_file':
      return readWorkspaceFileTool(args);
    case 'search_files':
      return searchWorkspaceTool(args);
    case 'write_file':
      return writeWorkspaceFileTool(args, allowWrite);
    default:
      return { status: 'error', message: `Unknown tool: ${name}` };
  }
};

const runNyxWithTools = async ({ apiKey, basePayload, allowWrite }) => {
  let input = basePayload.input || [];
  const tools = basePayload.tools || [];

  let response = null;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    response = await createResponse(apiKey, { ...basePayload, input, tools });
    const outputItems = response.output || [];
    const toolCalls = outputItems.filter((item) => item.type === 'function_call');

    if (!toolCalls.length) {
      return response;
    }

    input = input.concat(outputItems);

    const toolOutputs = toolCalls.map((call) => ({
      type: 'function_call_output',
      call_id: call.call_id,
      output: JSON.stringify(executeToolCall(call, allowWrite))
    }));

    input = input.concat(toolOutputs);
  }

  return response;
};

const sendToNyx = async (payload = '') => {
  const apiKey = process.env.OPENAI_API_KEY;
  const {
    fileContent,
    prompt,
    model: requestedModel,
    reasoningEffort: requestedReasoning,
    filePath,
    allowWrite
  } =
    typeof payload === 'string'
      ? {
          fileContent: payload,
          prompt: '',
          model: 'auto',
          reasoningEffort: 'auto',
          filePath: '',
          allowWrite: false
        }
      : {
          fileContent: payload.fileContent || '',
          prompt: payload.prompt || '',
          model: payload.model || 'auto',
          reasoningEffort: payload.reasoningEffort || 'auto',
          filePath: payload.filePath || '',
          allowWrite: Boolean(payload.allowWrite)
        };

  if (!apiKey) {
    lastResponseText = '';
    lastResponseMeta = null;
    return {
      status: 'error',
      message: 'OPENAI_API_KEY is missing. Set it in your environment to enable Nyx.'
    };
  }

  const tier = scoreComplexity({ fileContent, prompt });
  const resolvedModel =
    requestedModel && requestedModel !== 'auto'
      ? requestedModel
      : await selectModel({ apiKey, tier });
  const baseEffort = determineReasoningEffort(resolvedModel, tier);
  const resolvedReasoningEffort =
    requestedReasoning && requestedReasoning !== 'auto' ? requestedReasoning : baseEffort;
  const reasoningEffort =
    resolvedModel && resolvedModel.startsWith('gpt-5') ? resolvedReasoningEffort : undefined;

  const workspaceRoot = loadWorkspaceRoot();
  const tools = buildTools({ allowWrite });

  try {
    const requestPayload = {
      model: resolvedModel,
      input: [
        {
          role: 'system',
          content:
            'You are Nyx, the internal AI engine for Lumen IDE. Provide crisp, actionable guidance based on workspace data. Use tools to inspect files instead of guessing. If suggesting code, keep it concise and explain why. Avoid placeholder paths, fake citations, or line markers (no <replace_with_actual_path>, no F:, no +L1-L2). If you need to reference the file, say "the current file" instead. If write_file is unavailable, ask the user to enable file edits before proposing changes.'
        },
        {
          role: 'user',
          content: buildPrompt({ fileContent, prompt, filePath, workspaceRoot })
        }
      ],
      max_output_tokens: maxOutputTokensForTier(tier),
      tools
    };

    if (reasoningEffort) {
      requestPayload.reasoning = { effort: reasoningEffort };
    }

    const supportsTemperature =
      resolvedModel && !resolvedModel.startsWith('gpt-5') && !resolvedModel.includes('codex');
    if (supportsTemperature) {
      requestPayload.temperature = 0.2;
    }

    const response = await runNyxWithTools({ apiKey, basePayload: requestPayload, allowWrite });

    const outputText = sanitizeModelOutput(extractOutputText(response));
    lastResponseText = outputText;
    lastResponseMeta = {
      model: resolvedModel,
      tier,
      reasoningEffort,
      usage: response.usage || null
    };

    return {
      status: 'ok',
      message: outputText || 'Nyx returned an empty response.',
      model: resolvedModel,
      tier,
      reasoningEffort,
      usage: response.usage || null
    };
  } catch (error) {
    lastResponseText = '';
    lastResponseMeta = null;
    return {
      status: 'error',
      message: error.message || 'Nyx request failed.'
    };
  }
};

const receiveSuggestions = () => {
  if (!lastResponseText) {
    return {
      status: 'ok',
      suggestions: [
        'Nyx is ready. Provide a task prompt to get targeted improvements.',
        'Set OPENAI_API_KEY in your environment for live inference.'
      ]
    };
  }

  const suggestions = lastResponseText
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 6);

  return {
    status: 'ok',
    suggestions: suggestions.length
      ? suggestions
      : ['Nyx response received. Review the output panel for details.'],
    meta: lastResponseMeta
  };
};

module.exports = {
  sendToNyx,
  receiveSuggestions
};
