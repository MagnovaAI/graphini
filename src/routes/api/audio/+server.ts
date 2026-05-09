/**
 * Audio Transcription API Endpoint
 * Uses Google Gemini for speech-to-text, falls back to OpenRouter
 */

import { getDb } from '$lib/server/db';
import { extractProviderKeys } from '$lib/server/auth/provider-keys';
import { settingsManager, stateManager } from '$lib/server/state-manager';
import { validateSessionOrGuest } from '$lib/server/auth';
import { audioLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';
import { json, type RequestHandler } from '@sveltejs/kit';

/**
 * Cap audio uploads at 10MB. Audio is base64-encoded in memory before being
 * forwarded to the speech model — without a cap, a single 100MB upload OOMs
 * the worker (the encoded form is ~1.33x the binary size).
 */
const MAX_AUDIO_SIZE = 10 * 1024 * 1024;

const DEFAULT_VOICE_MODEL = 'google/gemini-2.0-flash-001';
const GEMINI_FALLBACK_MODEL = 'gemini-2.0-flash-lite';

async function loadVoiceModel(): Promise<string> {
  const configured = await settingsManager.get<string | null>(null, 'voice', 'model', null);
  return configured?.trim() || DEFAULT_VOICE_MODEL;
}

function normalizeOpenRouterModel(model: string): string {
  return model.startsWith('openrouter/') ? model.slice('openrouter/'.length) : model;
}

function normalizeGeminiModel(model: string): string {
  if (model.startsWith('google/')) return model.slice('google/'.length);
  if (model.startsWith('gemini/')) return model.slice('gemini/'.length);
  return model;
}

// Auto-register internal models so they appear in admin panel
let modelsRegistered = false;
async function ensureInternalModelsRegistered() {
  if (modelsRegistered) return;
  modelsRegistered = true;
  try {
    const db = getDb();
    const internalModels = [
      {
        category: 'Internal',
        description: 'Used for audio transcription and image processing',
        gems_per_message: 0,
        is_enabled: true,
        is_free: false,
        max_tokens: 8192,
        metadata: {},
        model_id: 'google/gemini-2.0-flash-001',
        model_name: 'Gemini 2.0 Flash (Audio/Vision)',
        provider: 'openrouter',
        sort_order: 900,
        tool_support: false
      },
      {
        category: 'Internal',
        description: 'Used for audio transcription via Gemini API',
        gems_per_message: 0,
        is_enabled: true,
        is_free: true,
        max_tokens: 2048,
        metadata: {},
        model_id: 'gemini-2.0-flash-lite',
        model_name: 'Gemini 2.0 Flash Lite (Audio)',
        provider: 'google',
        sort_order: 901,
        tool_support: false
      }
    ];
    for (const m of internalModels) {
      try {
        await db.upsertEnabledModel(m);
      } catch {
        /* already exists or DB unavailable */
      }
    }
  } catch {
    /* silent */
  }
}

async function transcribeWithGemini(
  geminiKey: string,
  base64Audio: string,
  mimeType: string,
  model = GEMINI_FALLBACK_MODEL
): Promise<string | null> {
  if (!geminiKey) return null;
  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${normalizeGeminiModel(model)}:generateContent?key=${geminiKey}`;
    const res = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: base64Audio } },
              {
                text: 'Transcribe this audio exactly as spoken. Return ONLY the transcribed text, nothing else. If the audio is unclear or empty, return an empty string.'
              }
            ]
          }
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 }
      })
    });
    if (!res.ok) {
      console.error('[Audio API] Gemini error:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  } catch (e: unknown) {
    console.error('[Audio API] Gemini exception:', e instanceof Error ? e.message : e);
    return null;
  }
}

async function transcribeWithOpenRouter(
  openRouterApiKey: string,
  base64Audio: string,
  mimeType: string,
  model: string
): Promise<string | null> {
  if (!openRouterApiKey) return null;
  try {
    const dataUri = `data:${mimeType};base64,${base64Audio}`;
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openRouterApiKey}`
      },
      body: JSON.stringify({
        model: normalizeOpenRouterModel(model),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transcribe this audio exactly as spoken. Return ONLY the transcribed text, nothing else. If the audio is unclear or empty, return an empty string.'
              },
              { type: 'image_url', image_url: { url: dataUri } }
            ]
          }
        ],
        temperature: 0,
        max_tokens: 2048
      })
    });
    if (!res.ok) {
      console.error('[Audio API] OpenRouter error:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || '';
  } catch (e: unknown) {
    console.error('[Audio API] OpenRouter exception:', e instanceof Error ? e.message : e);
    return null;
  }
}

export const POST: RequestHandler = async ({ request }) => {
  // Auth + rate limit before reading the body so anonymous floods get
  // rejected before we pay the multipart parsing / paid-provider costs.
  const rl = audioLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  const user = await validateSessionOrGuest(request).catch(() => null);
  if (!user) {
    return json({ error: 'Authentication required to transcribe audio.' }, { status: 401 });
  }

  // Register internal models in admin panel (fire-and-forget, runs once)
  ensureInternalModelsRegistered();
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;

    if (!audioFile) {
      return json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (audioFile.size > MAX_AUDIO_SIZE) {
      return json({ error: 'Audio file too large. Max 10MB allowed.' }, { status: 413 });
    }

    // Keys travel per-request: x-provider-gemini for direct Gemini calls,
    // x-provider-openrouter for the OpenRouter fallback. The user must
    // supply at least one — we don't read any global key here.
    const keys = extractProviderKeys(request);
    if (!keys.gemini && !keys.openrouter) {
      return json(
        {
          error:
            'No transcription API key set. Add a Gemini or OpenRouter key in Settings > Models & Keys.'
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = audioFile.type || 'audio/webm';
    const voiceModel = await loadVoiceModel();

    const prefersGeminiDirect =
      voiceModel.startsWith('gemini-') || voiceModel.startsWith('gemini/');

    let text = prefersGeminiDirect
      ? await transcribeWithGemini(keys.gemini, base64Audio, mimeType, voiceModel)
      : null;
    if (text === null) {
      text = await transcribeWithOpenRouter(keys.openrouter, base64Audio, mimeType, voiceModel);
    }
    if (text === null) {
      text = await transcribeWithGemini(keys.gemini, base64Audio, mimeType, GEMINI_FALLBACK_MODEL);
    }

    if (text === null) {
      return json({ error: 'All transcription providers failed' }, { status: 500 });
    }

    return json({ text, success: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Audio transcription failed';
    console.error('[Audio API] Error:', message);
    stateManager
      .logError(e instanceof Error ? e : new Error(message), {
        metadata: { endpoint: '/api/audio' }
      })
      .catch(() => {
        // Best-effort error logging; swallow secondary failures.
      });
    return json({ error: 'Transcription failed', details: message }, { status: 500 });
  }
};
