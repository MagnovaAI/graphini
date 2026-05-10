#!/usr/bin/env node
import 'dotenv/config';

const DEFAULT_URL = 'http://localhost:3000/api/chat';
const DEFAULT_URL_CANDIDATES = [
  'http://localhost:3000/api/chat',
  'http://localhost:3001/api/chat',
  'http://localhost:3002/api/chat',
  'http://localhost:5173/api/chat'
];
const DEFAULT_MESSAGE =
  'Design a small cloud architecture diagram with microservices, a database, a load balancer, and a queue.';

function parseArgs(argv) {
  const options = {
    activeTabEngine: 'mermaid',
    activeTabName: 'SystemArchitecture.mermaid',
    enabledTools: undefined,
    explicitUrl: Boolean(process.env.GRAPHINI_MONITOR_URL),
    includeText: true,
    message: DEFAULT_MESSAGE,
    model: process.env.GRAPHINI_MONITOR_MODEL ?? '',
    url: process.env.GRAPHINI_MONITOR_URL ?? DEFAULT_URL
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };

    if (arg === '--') continue;
    else if (arg === '--url') {
      options.explicitUrl = true;
      options.url = next();
    }
    else if (arg === '--model') options.model = next();
    else if (arg === '--message') options.message = next();
    else if (arg === '--cookie') options.cookie = next();
    else if (arg === '--conversation-id') options.conversationId = next();
    else if (arg === '--session-id') options.sessionId = next();
    else if (arg === '--active-tab-name') options.activeTabName = next();
    else if (arg === '--active-tab-engine') options.activeTabEngine = next();
    else if (arg === '--active-file-id') options.activeFileId = next();
    else if (arg === '--no-text') options.includeText = false;
    else if (arg === '--tools') {
      options.enabledTools = next()
        .split(',')
        .map((tool) => tool.trim())
        .filter(Boolean);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.model) {
    throw new Error('Missing model. Pass --model or set GRAPHINI_MONITOR_MODEL.');
  }

  return options;
}

function printHelp() {
  console.log(`Graphini chat stream monitor

Usage:
  pnpm chat:monitor -- --model openrouter:nvidia/nemotron-3-super-120b-a12b:free --cookie 'session=...'

Options:
  --url <url>                 Chat endpoint. Defaults to ${DEFAULT_URL}; root URLs are normalized to /api/chat.
  --model <id>                Enabled Graphini model id.
  --message <text>            Prompt to send.
  --cookie <cookie>           Browser session cookie for local authenticated requests.
  --conversation-id <id>      Existing conversation id.
  --session-id <id>           Session id. Defaults to monitor timestamp.
  --active-tab-name <name>    Active workspace file name.
  --active-tab-engine <name>  Active engine. Defaults to mermaid.
  --active-file-id <id>       Active workspace file id.
  --no-text                   Do not print reconstructed assistant text at the end.
  --tools <csv>               Enabled tool names, e.g. fileSystem,errorChecker.

Provider keys are read from env and forwarded as x-provider-* headers:
  OPENAI_API_KEY, ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, OPENROUTER_API_KEY,
  GEMINI_API_KEY, BRAVE_SEARCH_API_KEY, TAVILY_API_KEY
`);
}

function normalizeChatUrl(rawUrl) {
  const url = rawUrl.replace(/\/+$/, '');
  if (url.endsWith('/api/chat')) return url;
  return `${url}/api/chat`;
}

function requestUrls(options) {
  if (options.explicitUrl) return [normalizeChatUrl(options.url)];
  return [...new Set([normalizeChatUrl(options.url), ...DEFAULT_URL_CANDIDATES])];
}

function providerHeaders() {
  return Object.fromEntries(
    [
      ['x-provider-openai', process.env.OPENAI_API_KEY],
      ['x-provider-anthropic', process.env.ANTHROPIC_API_KEY],
      ['x-provider-anthropic-auth', process.env.ANTHROPIC_AUTH_TOKEN],
      ['x-provider-openrouter', process.env.OPENROUTER_API_KEY],
      ['x-provider-gemini', process.env.GEMINI_API_KEY],
      ['x-provider-brave-search', process.env.BRAVE_SEARCH_API_KEY],
      ['x-provider-tavily', process.env.TAVILY_API_KEY]
    ].filter(([, value]) => Boolean(value))
  );
}

function buildRequestBody(options) {
  return {
    activeFileId: options.activeFileId ?? null,
    activeTabEngine: options.activeTabEngine,
    activeTabName: options.activeTabName,
    conversationId: options.conversationId,
    enabledTools: options.enabledTools,
    engine: options.activeTabEngine,
    message: options.message,
    messages: [],
    model: options.model,
    sessionId: options.sessionId ?? `monitor-${Date.now()}`,
    workspaceTabs: [
      {
        engine: options.activeTabEngine,
        id: 'monitor-active-tab',
        title: options.activeTabName
      }
    ]
  };
}

function describeEvent(payload) {
  if (!payload) return '';
  if (payload.type) {
    const bits = [payload.type];
    if (payload.toolName) bits.push(`tool=${payload.toolName}`);
    if (payload.toolCallId) bits.push(`call=${payload.toolCallId}`);
    if (payload.textDelta) bits.push(`text=${JSON.stringify(payload.textDelta)}`);
    if (payload.delta) bits.push(`delta=${JSON.stringify(payload.delta)}`);
    if (payload.errorText || payload.error)
      bits.push(`error=${payload.errorText ?? payload.error}`);
    return bits.join(' ');
  }
  return '';
}

function textDeltaFromPayload(payload) {
  if (!payload || payload.type !== 'text-delta') return '';
  if (typeof payload.delta === 'string') return payload.delta;
  if (typeof payload.textDelta === 'string') return payload.textDelta;
  return '';
}

function printStreamLine(line, state) {
  if (!line.trim()) return;
  if (!line.startsWith('data:')) {
    console.log(line);
    return;
  }

  const data = line.slice(5).trimStart();
  if (data === '[DONE]') {
    console.log('data: [DONE]');
    return;
  }

  try {
    const payload = JSON.parse(data);
    state.assistantText += textDeltaFromPayload(payload);
    const summary = describeEvent(payload);
    console.log(summary ? `data: ${summary}` : `data: ${data}`);
  } catch {
    console.log(line);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const headers = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    ...providerHeaders()
  };
  if (options.cookie) headers.Cookie = options.cookie;

  const body = buildRequestBody(options);
  const urls = requestUrls(options);
  console.log(`POST ${urls[0]}`);
  console.log(`model: ${options.model}`);
  console.log(`message: ${options.message}`);
  console.log('');

  let response;
  let lastFetchError;
  for (const [index, url] of urls.entries()) {
    try {
      response = await fetch(url, {
        body: JSON.stringify(body),
        headers,
        method: 'POST'
      });
      if (index > 0) console.log(`connected: ${url}`);
      break;
    } catch (error) {
      lastFetchError = error;
      if (options.explicitUrl || index === urls.length - 1) throw error;
      console.log(`retry: ${url} unavailable`);
    }
  }

  if (!response) throw lastFetchError ?? new Error('No chat endpoint response.');

  console.log(`status: ${response.status} ${response.statusText}`);
  console.log(`content-type: ${response.headers.get('content-type') ?? 'unknown'}`);
  console.log('');

  if (!response.ok || !response.body) {
    console.log(await response.text());
    process.exitCode = 1;
    return;
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  const state = { assistantText: '' };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) printStreamLine(line, state);
  }
  if (buffer) printStreamLine(buffer, state);

  if (options.includeText) {
    const text = state.assistantText.trim();
    console.log('');
    console.log('assistant text:');
    console.log(text || '[none]');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
