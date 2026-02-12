const DEFAULT_TIMEOUT_MS = 60000;

const getBaseUrl = () => {
  return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
};

const withTimeout = async (promise, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await promise(controller.signal);
    clearTimeout(timer);
    return result;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
};

const request = async ({ path, method = 'GET', apiKey, body }) => {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing. Set it in your environment.');
  }

  const url = `${getBaseUrl()}${path}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  const response = await withTimeout(
    (signal) =>
      fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal
      }),
    DEFAULT_TIMEOUT_MS
  );

  const text = await response.text();
  if (!response.ok) {
    const message = text ? text.slice(0, 1200) : response.statusText;
    throw new Error(`OpenAI API error (${response.status}): ${message}`);
  }

  return text ? JSON.parse(text) : {};
};

const listModels = async (apiKey) => {
  return request({ path: '/models', method: 'GET', apiKey });
};

const createResponse = async (apiKey, body) => {
  return request({ path: '/responses', method: 'POST', apiKey, body });
};

module.exports = {
  listModels,
  createResponse
};
