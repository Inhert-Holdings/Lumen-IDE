const { createResponse, listModels } = require('./openaiClient');

let cachedModels = null;
let cachedAt = 0;
let lastResponseText = '';
let lastResponseMeta = null;

const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

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

const truncateContent = (content, maxChars) => {
  if (content.length <= maxChars) {
    return { text: content, truncated: false };
  }

  return {
    text: content.slice(0, maxChars),
    truncated: true
  };
};

const buildPrompt = ({ fileContent, prompt }) => {
  const task = normalizeText(prompt) || 'Review this file and provide the best improvements.';
  const normalizedContent = normalizeText(fileContent);
  const { text, truncated } = truncateContent(normalizedContent, 12000);

  const notes = truncated
    ? '\n\n[Note: File content truncated for context. Request full file if needed.]'
    : '';

  return `Task: ${task}\n\nFile content:\n\n${text}${notes}`.trim();
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

const sendToNyx = async (payload = '') => {
  const apiKey = process.env.OPENAI_API_KEY;
  const { fileContent, prompt, model: requestedModel, reasoningEffort: requestedReasoning } =
    typeof payload === 'string'
      ? { fileContent: payload, prompt: '', model: 'auto', reasoningEffort: 'auto' }
      : {
          fileContent: payload.fileContent || '',
          prompt: payload.prompt || '',
          model: payload.model || 'auto',
          reasoningEffort: payload.reasoningEffort || 'auto'
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

  try {
    const requestPayload = {
      model: resolvedModel,
      input: [
        {
          role: 'system',
          content:
            'You are Nyx, the internal AI engine for Lumen IDE. Provide crisp, actionable guidance. If suggesting code, keep it concise and explain why.'
        },
        {
          role: 'user',
          content: buildPrompt({ fileContent, prompt })
        }
      ],
      max_output_tokens: maxOutputTokensForTier(tier),
      reasoning_effort: reasoningEffort
    };

    const supportsTemperature =
      resolvedModel && !resolvedModel.startsWith('gpt-5') && !resolvedModel.includes('codex');
    if (supportsTemperature) {
      requestPayload.temperature = 0.2;
    }

    const response = await createResponse(apiKey, requestPayload);

    const outputText = extractOutputText(response);
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
