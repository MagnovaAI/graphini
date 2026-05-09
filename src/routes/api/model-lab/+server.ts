import { requireAdmin } from '$lib/server/admin/auth';
import { extractProviderKeys } from '$lib/server/auth/provider-keys';
import {
  modelLabPromptPresets,
  parseModelLabProvider,
  searchProviderModels,
  smokeTestProviderModel
} from '$lib/server/model-lab';
import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ request, url }) => {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  try {
    const provider = parseModelLabProvider(url.searchParams.get('provider'));
    const query = url.searchParams.get('q') ?? '';
    const limit = Number(url.searchParams.get('limit') ?? 25);
    const keys = extractProviderKeys(request);
    const models = await searchProviderModels({ keys, limit, provider, query });

    return json({
      data: {
        models,
        promptPresets: modelLabPromptPresets
      },
      success: true
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Failed to search models', success: false },
      { status: 400 }
    );
  }
};

export const POST: RequestHandler = async ({ request }) => {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  try {
    const body = (await request.json()) as {
      maxOutputTokens?: number;
      modelId?: string;
      prompt?: string;
      provider?: string;
    };
    const provider = parseModelLabProvider(body.provider ?? null);
    if (!body.modelId) {
      return json({ error: 'modelId is required', success: false }, { status: 400 });
    }

    const keys = extractProviderKeys(request);
    const result = await smokeTestProviderModel({
      keys,
      maxOutputTokens: body.maxOutputTokens,
      modelId: body.modelId,
      prompt: body.prompt,
      provider
    });

    return json({ data: result, success: true });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to run model smoke test',
        success: false
      },
      { status: 400 }
    );
  }
};
