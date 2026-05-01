/**
 * Audio Transcription API Endpoint
 * Uses Google Gemini for speech-to-text, falls back to OpenRouter
 */

import { getDb } from '$lib/server/db';
import { loadOpenRouterApiKey } from '$lib/server/chat/model';
import { stateManager } from '$lib/server/state-manager';
import { json, type RequestHandler } from '@sveltejs/kit';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash-lite';

// Auto-register internal models so they appear in admin panel
let modelsRegistered = false;
async function ensureInternalModelsRegistered() {
  if (modelsRegistered) return;
  modelsRegistered = true;
  try {
    const db = getDb();
    const internalModels = [
      {
        model_id: 'google/gemini-2.0-flash-001',
        model_name: 'Gemini 2.0 Flash (Audio/Vision)',
        provider: 'openrouter',
        category: 'Internal',
        description: 'Used for audio transcription and image processing',
        is_enabled: true,
        is_free: false,
        gems_per_message: 0,
        max_tokens: 8192,
        tool_support: false,
        metadata: {},
        sort_order: 900
      },
      {
        model_id: 'gemini-2.0-flash-lite',
        model_name: 'Gemini 2.0 Flash Lite (Audio)',
        provider: 'google',
        category: 'Internal',
        description: 'Used for audio transcription via Gemini API',
        is_enabled: true,
        is_free: true,
        gems_per_message: 0,
        max_tokens: 2048,
        tool_support: false,
        metadata: {},
        sort_order: 901
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

async function transcribeWithGemini(base64Audio: string, mimeType: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
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
  } catch (e: any) {
    console.error('[Audio API] Gemini exception:', e?.message);
    return null;
  }
}

async function transcribeWithOpenRouter(
  base64Audio: string,
  mimeType: string
): Promise<string | null> {
  const openRouterApiKey = await loadOpenRouterApiKey();
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
        model: 'google/gemini-2.0-flash-001',
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
  } catch (e: any) {
    console.error('[Audio API] OpenRouter exception:', e?.message);
    return null;
  }
}

export const POST: RequestHandler = async ({ request }) => {
  // Register internal models in admin panel (fire-and-forget, runs once)
  ensureInternalModelsRegistered();
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;

    if (!audioFile) {
      return json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (!GEMINI_API_KEY && !(await loadOpenRouterApiKey())) {
      return json({ error: 'No transcription API key configured' }, { status: 500 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = audioFile.type || 'audio/webm';

    // Try OpenRouter first (more reliable), fall back to Gemini
    let text = await transcribeWithOpenRouter(base64Audio, mimeType);
    if (text === null) {
      text = await transcribeWithGemini(base64Audio, mimeType);
    }

    if (text === null) {
      return json({ error: 'All transcription providers failed' }, { status: 500 });
    }

    return json({ text, success: true });
  } catch (e: any) {
    console.error('[Audio API] Error:', e?.message || e);
    stateManager
      .logError(e instanceof Error ? e : new Error(e?.message || 'Audio transcription failed'), {
        metadata: { endpoint: '/api/audio' }
      })
      .catch(() => {});
    return json({ error: 'Transcription failed', details: e?.message }, { status: 500 });
  }
};
