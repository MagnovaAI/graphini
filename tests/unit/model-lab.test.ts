import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyProviderKeys, type ProviderKeys } from '../../src/lib/server/auth/provider-keys';
import { parseModelLabProvider, searchProviderModels } from '../../src/lib/server/model-lab';

function keysWith(overrides: Partial<ProviderKeys>): ProviderKeys {
  return { ...emptyProviderKeys(), ...overrides };
}

describe('model lab provider parsing', () => {
  it('accepts the supported providers case-insensitively', () => {
    expect(parseModelLabProvider('OpenAI')).toBe('openai');
    expect(parseModelLabProvider('anthropic')).toBe('anthropic');
    expect(parseModelLabProvider('OPENROUTER')).toBe('openrouter');
  });

  it('rejects unsupported providers', () => {
    expect(() => parseModelLabProvider('gemini')).toThrowError(
      'Provider must be one of: openai, anthropic, openrouter.'
    );
    expect(() => parseModelLabProvider(null)).toThrowError(
      'Provider must be one of: openai, anthropic, openrouter.'
    );
  });
});

describe('model lab search', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searches OpenAI models and normalizes their shape', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          { created: 1_700_000_000, id: 'gpt-5.1-mini', owned_by: 'openai' },
          { created: 1_700_000_001, id: 'tts-1', owned_by: 'openai' }
        ]
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await searchProviderModels({
      keys: keysWith({ openai: 'test-openai-key' }),
      limit: 10,
      provider: 'openai',
      query: 'gpt'
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', {
      headers: { Authorization: 'Bearer test-openai-key' }
    });
    expect(models).toEqual([
      {
        created: 1_700_000_000,
        description: 'Owned by openai',
        id: 'gpt-5.1-mini',
        name: 'gpt-5.1-mini',
        provider: 'openai'
      }
    ]);
  });

  it('searches Anthropic models and normalizes display names', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          {
            created_at: '2026-01-01T00:00:00Z',
            display_name: 'Claude Sonnet Test',
            id: 'claude-sonnet-test'
          }
        ]
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await searchProviderModels({
      keys: keysWith({ anthropic: 'test-anthropic-key' }),
      limit: 1,
      provider: 'anthropic'
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/models', {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': 'test-anthropic-key'
      }
    });
    expect(models).toEqual([
      {
        created: Date.parse('2026-01-01T00:00:00Z'),
        id: 'claude-sonnet-test',
        name: 'Claude Sonnet Test',
        provider: 'anthropic'
      }
    ]);
  });

  it('uses Anthropic OAuth/OAT auth tokens as bearer credentials for model search', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [{ display_name: 'Claude Haiku Test', id: 'claude-haiku-test' }]
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await searchProviderModels({
      keys: keysWith({ anthropicAuthToken: 'test-anthropic-oat-token' }),
      limit: 1,
      provider: 'anthropic',
      query: 'haiku'
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/models', {
      headers: {
        Authorization: 'Bearer test-anthropic-oat-token',
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01'
      }
    });
  });

  it('treats OAT-looking Anthropic API key values as bearer tokens', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [{ display_name: 'Claude OAuth Test', id: 'claude-oauth-test' }]
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await searchProviderModels({
      keys: keysWith({ anthropic: 'sk-ant-oat-test-token' }),
      limit: 1,
      provider: 'anthropic',
      query: 'oauth'
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/models', {
      headers: {
        Authorization: 'Bearer sk-ant-oat-test-token',
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01'
      }
    });
  });

  it('searches OpenRouter models with capability metadata', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          {
            context_length: 128_000,
            created: 1_700_000_002,
            description: 'Fast routed test model',
            id: 'openai/gpt-test',
            name: 'GPT Test',
            supported_parameters: ['tools', 'reasoning']
          }
        ]
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await searchProviderModels({
      keys: keysWith({ openrouter: 'test-openrouter-key' }),
      limit: 10,
      provider: 'openrouter',
      query: 'fast'
    });

    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: 'Bearer test-openrouter-key' }
    });
    expect(models).toEqual([
      {
        contextWindow: 128_000,
        created: 1_700_000_002,
        description: 'Fast routed test model',
        id: 'openai/gpt-test',
        name: 'GPT Test',
        provider: 'openrouter',
        supportedParameters: ['tools', 'reasoning']
      }
    ]);
  });

  it('clamps provider search limits to the supported range', async () => {
    const data = Array.from({ length: 105 }, (_, index) => ({
      id: `provider/model-${index}`,
      name: `Model ${index}`
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data }))
    );

    await expect(
      searchProviderModels({
        keys: keysWith({ openrouter: 'test-openrouter-key' }),
        limit: 0,
        provider: 'openrouter'
      })
    ).resolves.toHaveLength(1);
    await expect(
      searchProviderModels({
        keys: keysWith({ openrouter: 'test-openrouter-key' }),
        limit: 1_000,
        provider: 'openrouter'
      })
    ).resolves.toHaveLength(100);
  });

  it.each([
    {
      keyField: 'openai' as const,
      provider: 'openai' as const,
      status: 503,
      expectedMessage: 'OpenAI models API error: 503'
    },
    {
      keyField: 'anthropic' as const,
      provider: 'anthropic' as const,
      status: 429,
      expectedMessage: 'Anthropic models API error: 429'
    },
    {
      keyField: 'openrouter' as const,
      provider: 'openrouter' as const,
      status: 502,
      expectedMessage: 'OpenRouter models API error: 502'
    }
  ])(
    'surfaces $provider model API failures',
    async ({ expectedMessage, keyField, provider, status }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('nope', { status }))
      );

      await expect(
        searchProviderModels({
          keys: keysWith({ [keyField]: `test-${provider}-key` } as Partial<ProviderKeys>),
          provider
        })
      ).rejects.toThrowError(expectedMessage);
    }
  );
});

describe('model lab API route', () => {
  afterEach(() => {
    vi.doUnmock('$lib/server/admin/auth');
    vi.doUnmock('$lib/server/model-lab');
    vi.resetModules();
  });

  async function loadRoute({
    admin = true,
    searchModels = vi.fn(async () => [{ id: 'model-a', name: 'Model A', provider: 'openrouter' }]),
    smokeTest = vi.fn(async () => ({
      elapsedMs: 12,
      finishReason: 'stop',
      modelId: 'model-a',
      prompt: 'prompt',
      provider: 'openrouter',
      text: 'ok',
      usage: { totalTokens: 3 }
    }))
  } = {}) {
    vi.doMock('$lib/server/admin/auth', () => ({
      requireAdmin: vi.fn(async () =>
        admin ? { userId: 'admin-user' } : Response.json({ error: 'nope' }, { status: 401 })
      )
    }));
    vi.doMock('$lib/server/model-lab', () => ({
      modelLabPromptPresets: ['preset prompt'],
      parseModelLabProvider: (provider: string | null) => {
        const normalized = provider?.toLowerCase();
        if (normalized !== 'openai' && normalized !== 'anthropic' && normalized !== 'openrouter') {
          throw new Error('Provider must be one of: openai, anthropic, openrouter.');
        }
        return normalized;
      },
      searchProviderModels: searchModels,
      smokeTestProviderModel: smokeTest
    }));

    return {
      ...(await import('../../src/routes/api/model-lab/+server')),
      searchModels,
      smokeTest
    };
  }

  it('requires admin access before model search and smoke tests', async () => {
    const { GET, POST, searchModels, smokeTest } = await loadRoute({ admin: false });

    const getResponse = await GET({
      request: new Request('http://localhost/api/model-lab?provider=openrouter'),
      url: new URL('http://localhost/api/model-lab?provider=openrouter')
    } as Parameters<typeof GET>[0]);
    const postResponse = await POST({
      request: new Request('http://localhost/api/model-lab', {
        body: JSON.stringify({ modelId: 'model-a', provider: 'openrouter' }),
        method: 'POST'
      })
    } as Parameters<typeof POST>[0]);

    expect(getResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
    expect(searchModels).not.toHaveBeenCalled();
    expect(smokeTest).not.toHaveBeenCalled();
  });

  it('returns provider search results and prompt presets from GET', async () => {
    const { GET, searchModels } = await loadRoute();
    const response = await GET({
      request: new Request(
        'http://localhost/api/model-lab?provider=openrouter&q=nemotron&limit=5',
        {
          headers: { 'x-provider-openrouter': 'caller-key' }
        }
      ),
      url: new URL('http://localhost/api/model-lab?provider=openrouter&q=nemotron&limit=5')
    } as Parameters<typeof GET>[0]);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(searchModels).toHaveBeenCalledWith({
      keys: keysWith({ openrouter: 'caller-key' }),
      limit: 5,
      provider: 'openrouter',
      query: 'nemotron'
    });
    expect(body).toMatchObject({
      data: {
        models: [{ id: 'model-a', name: 'Model A', provider: 'openrouter' }],
        promptPresets: ['preset prompt']
      },
      success: true
    });
  });

  it('validates provider and required model id in API requests', async () => {
    const { GET, POST, smokeTest } = await loadRoute();
    const badProviderResponse = await GET({
      request: new Request('http://localhost/api/model-lab?provider=gemini'),
      url: new URL('http://localhost/api/model-lab?provider=gemini')
    } as Parameters<typeof GET>[0]);
    const missingModelResponse = await POST({
      request: new Request('http://localhost/api/model-lab', {
        body: JSON.stringify({ provider: 'openrouter' }),
        method: 'POST'
      })
    } as Parameters<typeof POST>[0]);

    await expect(badProviderResponse.json()).resolves.toMatchObject({
      error: 'Provider must be one of: openai, anthropic, openrouter.',
      success: false
    });
    await expect(missingModelResponse.json()).resolves.toMatchObject({
      error: 'modelId is required',
      success: false
    });
    expect(badProviderResponse.status).toBe(400);
    expect(missingModelResponse.status).toBe(400);
    expect(smokeTest).not.toHaveBeenCalled();
  });

  it('runs model smoke tests through POST', async () => {
    const { POST, smokeTest } = await loadRoute();
    const response = await POST({
      request: new Request('http://localhost/api/model-lab', {
        body: JSON.stringify({
          maxOutputTokens: 40,
          modelId: 'model-a',
          prompt: 'Draw a diagram',
          provider: 'openrouter'
        }),
        headers: { 'x-provider-openrouter': 'caller-key' },
        method: 'POST'
      })
    } as Parameters<typeof POST>[0]);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(smokeTest).toHaveBeenCalledWith({
      keys: keysWith({ openrouter: 'caller-key' }),
      maxOutputTokens: 40,
      modelId: 'model-a',
      prompt: 'Draw a diagram',
      provider: 'openrouter'
    });
    expect(body).toMatchObject({
      data: {
        elapsedMs: 12,
        finishReason: 'stop',
        modelId: 'model-a',
        provider: 'openrouter',
        text: 'ok'
      },
      success: true
    });
  });
});
