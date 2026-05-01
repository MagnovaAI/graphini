/**
 * Admin API Endpoints
 * Provides endpoints for admin dashboard, settings management, and state viewing
 */

import { requireAdmin } from '$lib/server/admin/auth';
import { handleAdminGet } from '$lib/server/admin/get-actions';
import { getCache } from '$lib/server/cache';
import {
  setRuntimeAnthropicApiKey,
  setRuntimeOpenAiApiKey,
  setRuntimeOpenRouterApiKey
} from '$lib/server/chat/model';
import { getDb } from '$lib/server/db';
import {
  adminDashboard,
  analyticsManager,
  settingsManager,
  stateManager
} from '$lib/server/state-manager';
import { json, type RequestHandler } from '@sveltejs/kit';

// ============================================================================
// GET - Dashboard Stats & Data
// ============================================================================

export const GET: RequestHandler = async ({ url, request }) => {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  try {
    return await handleAdminGet(url);
  } catch (error) {
    console.error('Admin API error:', error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
};

// ============================================================================
// POST - Create/Update Settings & Actions
// ============================================================================

export const POST: RequestHandler = async ({ request }) => {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'setSetting': {
        const { userId, category, key, value, description, isSensitive } = body;
        await settingsManager.set(userId || null, category, key, value, {
          description,
          isSensitive
        });
        await adminDashboard.logAction(null, 'set_setting', 'setting', `${category}:${key}`, {
          newValue: isSensitive ? '[REDACTED]' : value
        });
        return json({ success: true });
      }

      case 'deleteSetting': {
        const { userId, category, key } = body;
        const success = await settingsManager.delete(userId || null, category, key);
        if (success) {
          await adminDashboard.logAction(null, 'delete_setting', 'setting', `${category}:${key}`);
        }
        return json({ success });
      }

      case 'saveState': {
        const { userId, sessionId, stateType, stateData, metadata, expiresIn } = body;
        const id = await stateManager.save({
          expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
          metadata: metadata || {},
          sessionId: sessionId || null,
          stateData,
          stateType,
          userId: userId || null
        });
        return json({ success: true, id });
      }

      case 'trackEvent': {
        const { eventType, userId, sessionId, conversationId, eventData } = body;
        await analyticsManager.track({
          conversationId,
          eventData,
          eventType,
          sessionId,
          userId
        });
        return json({ success: true });
      }

      case 'clearCache': {
        const { tag, key } = body;
        if (key) {
          await getCache().delete(key);
        } else if (tag) {
          await getCache().deleteByTag(tag);
        } else {
          await getCache().clear();
        }
        await adminDashboard.logAction(null, 'clear_cache', 'cache', key || tag || 'all');
        return json({ success: true });
      }

      case 'cleanup': {
        const cacheCleanup = await getCache().cleanup();
        const stateCleanup = await stateManager.cleanup();
        await adminDashboard.logAction(null, 'cleanup', 'system');
        return json({
          success: true,
          data: {
            cache: cacheCleanup,
            states: stateCleanup
          }
        });
      }

      // Model Management Operations
      case 'createModel': {
        const { provider, modelData } = body;

        // Validation
        if (!provider || typeof provider !== 'string') {
          return json(
            { success: false, error: 'Provider is required and must be a string' },
            { status: 400 }
          );
        }
        if (!modelData || typeof modelData !== 'object') {
          return json(
            { success: false, error: 'Model data is required and must be an object' },
            { status: 400 }
          );
        }
        if (!modelData.id || typeof modelData.id !== 'string') {
          return json(
            { success: false, error: 'Model ID is required and must be a string' },
            { status: 400 }
          );
        }
        if (!modelData.label || typeof modelData.label !== 'string') {
          return json(
            { success: false, error: 'Model label is required and must be a string' },
            { status: 400 }
          );
        }
        if (!modelData.category || typeof modelData.category !== 'string') {
          return json(
            { success: false, error: 'Model category is required and must be a string' },
            { status: 400 }
          );
        }

        // Check if model already exists
        const existingModels = await settingsManager.getAll(null, 'models');
        const modelKey = `${provider}:${modelData.id}`;
        if (existingModels.some((m) => m.key === modelKey)) {
          return json(
            { success: false, error: 'Model already exists for this provider' },
            { status: 409 }
          );
        }

        await settingsManager.set(null, 'models', modelKey, modelData, {
          description: `Model: ${modelData.label} for ${provider}`
        });
        await adminDashboard.logAction(null, 'create_model', 'model', modelKey, {
          newValue: modelData.label
        });
        return json({ success: true });
      }

      case 'updateModel': {
        const { provider, modelId, modelData } = body;

        // Validation
        if (!provider || typeof provider !== 'string') {
          return json(
            { success: false, error: 'Provider is required and must be a string' },
            { status: 400 }
          );
        }
        if (!modelId || typeof modelId !== 'string') {
          return json(
            { success: false, error: 'Model ID is required and must be a string' },
            { status: 400 }
          );
        }
        if (!modelData || typeof modelData !== 'object') {
          return json(
            { success: false, error: 'Model data is required and must be an object' },
            { status: 400 }
          );
        }
        if (!modelData.label || typeof modelData.label !== 'string') {
          return json(
            { success: false, error: 'Model label is required and must be a string' },
            { status: 400 }
          );
        }
        if (!modelData.category || typeof modelData.category !== 'string') {
          return json(
            { success: false, error: 'Model category is required and must be a string' },
            { status: 400 }
          );
        }

        const modelKey = `${provider}:${modelId}`;

        // Check if model exists
        const existingModels = await settingsManager.getAll(null, 'models');
        if (!existingModels.some((m) => m.key === modelKey)) {
          return json({ success: false, error: 'Model not found' }, { status: 404 });
        }

        await settingsManager.set(null, 'models', modelKey, modelData, {
          description: `Model: ${modelData.label} for ${provider}`
        });
        await adminDashboard.logAction(null, 'update_model', 'model', modelKey, {
          newValue: modelData.label
        });
        return json({ success: true });
      }

      case 'deleteModel': {
        const { provider, modelId } = body;

        // Validation
        if (!provider || typeof provider !== 'string') {
          return json(
            { success: false, error: 'Provider is required and must be a string' },
            { status: 400 }
          );
        }
        if (!modelId || typeof modelId !== 'string') {
          return json(
            { success: false, error: 'Model ID is required and must be a string' },
            { status: 400 }
          );
        }

        const modelKey = `${provider}:${modelId}`;
        const success = await settingsManager.delete(null, 'models', modelKey);
        if (success) {
          await adminDashboard.logAction(null, 'delete_model', 'model', modelKey);
        } else {
          return json({ success: false, error: 'Model not found' }, { status: 404 });
        }
        return json({ success });
      }

      case 'createProvider': {
        const { providerId, providerData } = body;

        // Validation
        if (!providerId || typeof providerId !== 'string') {
          return json(
            { success: false, error: 'Provider ID is required and must be a string' },
            { status: 400 }
          );
        }
        if (!providerData || typeof providerData !== 'object') {
          return json(
            { success: false, error: 'Provider data is required and must be an object' },
            { status: 400 }
          );
        }
        if (!providerData.label || typeof providerData.label !== 'string') {
          return json(
            { success: false, error: 'Provider label is required and must be a string' },
            { status: 400 }
          );
        }

        // Check if provider already exists
        const existingProviders = await settingsManager.getAll(null, 'providers');
        if (existingProviders.some((p) => p.key === providerId)) {
          return json({ success: false, error: 'Provider already exists' }, { status: 409 });
        }

        await settingsManager.set(null, 'providers', providerId, providerData, {
          description: `Provider: ${providerData.label}`
        });
        await adminDashboard.logAction(null, 'create_provider', 'provider', providerId, {
          newValue: providerData.label
        });
        return json({ success: true });
      }

      case 'updateProvider': {
        const { providerId, providerData } = body;

        // Validation
        if (!providerId || typeof providerId !== 'string') {
          return json(
            { success: false, error: 'Provider ID is required and must be a string' },
            { status: 400 }
          );
        }
        if (!providerData || typeof providerData !== 'object') {
          return json(
            { success: false, error: 'Provider data is required and must be an object' },
            { status: 400 }
          );
        }
        if (!providerData.label || typeof providerData.label !== 'string') {
          return json(
            { success: false, error: 'Provider label is required and must be a string' },
            { status: 400 }
          );
        }

        // Check if provider exists
        const existingProviders = await settingsManager.getAll(null, 'providers');
        if (!existingProviders.some((p) => p.key === providerId)) {
          return json({ success: false, error: 'Provider not found' }, { status: 404 });
        }

        await settingsManager.set(null, 'providers', providerId, providerData, {
          description: `Provider: ${providerData.label}`
        });
        await adminDashboard.logAction(null, 'update_provider', 'provider', providerId, {
          newValue: providerData.label
        });
        return json({ success: true });
      }

      case 'addGems': {
        const { userId, amount, description } = body;
        if (!userId || typeof userId !== 'string') {
          return json({ success: false, error: 'userId is required' }, { status: 400 });
        }
        if (!amount || typeof amount !== 'number' || amount <= 0) {
          return json(
            { success: false, error: 'amount must be a positive number' },
            { status: 400 }
          );
        }
        const db = getDb();
        const user = await db.getUserById(userId);
        if (!user) return json({ success: false, error: 'User not found' }, { status: 404 });
        const newBalance = await db.addCredits(
          userId,
          amount,
          'bonus',
          description || `Admin added ${amount} gems`
        );
        await adminDashboard.logAction(null, 'add_gems', 'user', userId, {
          newValue: { amount, balance: newBalance.balance }
        });
        return json({ success: true, data: { balance: newBalance.balance } });
      }

      case 'setGems': {
        const { userId, amount } = body;
        if (!userId || typeof userId !== 'string') {
          return json({ success: false, error: 'userId is required' }, { status: 400 });
        }
        if (typeof amount !== 'number' || amount < 0) {
          return json(
            { success: false, error: 'amount must be a non-negative number' },
            { status: 400 }
          );
        }
        const db = getDb();
        const user = await db.getUserById(userId);
        if (!user) return json({ success: false, error: 'User not found' }, { status: 404 });
        const currentBalance = await db.getCreditBalance(userId);
        const currentAmount = currentBalance?.balance ?? 0;
        const diff = amount - currentAmount;
        let newBalance;
        if (diff > 0) {
          newBalance = await db.addCredits(userId, diff, 'bonus', `Admin set gems to ${amount}`);
        } else if (diff < 0) {
          const deductResult = await db.deductCredits(
            userId,
            Math.abs(diff),
            `Admin set gems to ${amount}`
          );
          if (!deductResult.success) {
            return json({ success: false, error: 'Failed to deduct credits' }, { status: 500 });
          }
          newBalance = { balance: amount };
        } else {
          newBalance = { balance: currentAmount };
        }
        await adminDashboard.logAction(null, 'set_gems', 'user', userId, {
          newValue: { amount, previousBalance: currentAmount, balance: newBalance.balance }
        });
        return json({ success: true, data: { balance: newBalance.balance } });
      }

      case 'updateUserRole': {
        const { userId, role } = body;
        if (!userId) return json({ success: false, error: 'userId required' }, { status: 400 });
        if (!['user', 'admin', 'superadmin'].includes(role))
          return json({ success: false, error: 'Invalid role' }, { status: 400 });
        const db = getDb();
        await db.updateUser(userId, { role });
        await adminDashboard.logAction(null, 'update_role', 'user', userId, { newValue: role });
        return json({ success: true });
      }

      case 'toggleUserActive': {
        const { userId, isActive } = body;
        if (!userId) return json({ success: false, error: 'userId required' }, { status: 400 });
        const db = getDb();
        await db.updateUser(userId, { is_active: isActive });
        await adminDashboard.logAction(null, 'toggle_active', 'user', userId);
        return json({ success: true });
      }

      case 'importOpenRouterModel': {
        const { modelData: orModelData } = body;
        if (!orModelData || !orModelData.model_id || !orModelData.model_name)
          return json(
            { success: false, error: 'modelData with model_id and model_name required' },
            { status: 400 }
          );
        const db = getDb();
        const existing = await db.getEnabledModel(orModelData.model_id);
        if (existing) {
          return json({ success: false, error: 'Model already exists' }, { status: 409 });
        }
        await db.upsertEnabledModel({
          category: orModelData.category || 'General',
          description: orModelData.description || '',
          gems_per_message: orModelData.gems_per_message ?? 2,
          is_enabled: true,
          is_free: orModelData.is_free || false,
          max_tokens: orModelData.max_tokens || 4000,
          metadata: orModelData.metadata || {},
          model_id: orModelData.model_id,
          model_name: orModelData.model_name,
          provider: orModelData.provider || 'openrouter',
          sort_order: orModelData.sort_order || 0,
          tool_support: orModelData.tool_support ?? true
        });
        await adminDashboard.logAction(null, 'import_model', 'enabled_model', orModelData.model_id);
        return json({ success: true });
      }

      case 'setOpenRouterApiKey': {
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
        if (!apiKey) {
          return json({ success: false, error: 'apiKey required' }, { status: 400 });
        }
        await settingsManager.set(null, 'ai_provider', 'openrouter_api_key', apiKey, {
          description: 'OpenRouter API key used for server-side AI requests',
          isSensitive: true
        });
        setRuntimeOpenRouterApiKey(apiKey);
        await adminDashboard.logAction(null, 'set_openrouter_api_key', 'setting', 'ai_provider');
        return json({ success: true });
      }

      case 'setProviderApiKey': {
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
        const provider =
          typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : '';
        const supportedProviders = new Set(['anthropic', 'openai', 'openrouter']);
        if (!supportedProviders.has(provider)) {
          return json(
            { success: false, error: 'provider must be openai, anthropic, or openrouter' },
            { status: 400 }
          );
        }
        if (!apiKey) {
          return json({ success: false, error: 'apiKey required' }, { status: 400 });
        }

        await settingsManager.set(null, 'ai_provider', `${provider}_api_key`, apiKey, {
          description: `${provider} API key used for server-side AI requests`,
          isSensitive: true
        });
        if (provider === 'anthropic') setRuntimeAnthropicApiKey(apiKey);
        if (provider === 'openai') setRuntimeOpenAiApiKey(apiKey);
        if (provider === 'openrouter') setRuntimeOpenRouterApiKey(apiKey);
        await adminDashboard.logAction(null, 'set_provider_api_key', 'setting', provider);
        return json({ success: true });
      }

      case 'updateEnabledModel': {
        const { modelData: updModelData } = body;
        if (!updModelData || !updModelData.model_id)
          return json(
            { success: false, error: 'modelData with model_id required' },
            { status: 400 }
          );
        const db = getDb();
        await db.upsertEnabledModel(updModelData);
        await adminDashboard.logAction(
          null,
          'update_model',
          'enabled_model',
          updModelData.model_id
        );
        return json({ success: true });
      }

      case 'deleteEnabledModel': {
        const { modelId: delModelId } = body;
        if (!delModelId)
          return json({ success: false, error: 'modelId required' }, { status: 400 });
        const db = getDb();
        await db.deleteEnabledModel(delModelId);
        await adminDashboard.logAction(null, 'delete_model', 'enabled_model', delModelId);
        return json({ success: true });
      }

      case 'toggleEnabledModel': {
        const { modelId: togModelId, isEnabled: togEnabled } = body;
        if (!togModelId)
          return json({ success: false, error: 'modelId required' }, { status: 400 });
        const db = getDb();
        const togModel = await db.getEnabledModel(togModelId);
        if (!togModel) return json({ success: false, error: 'Model not found' }, { status: 404 });
        await db.upsertEnabledModel({ ...togModel, is_enabled: togEnabled });
        await adminDashboard.logAction(null, 'toggle_model', 'enabled_model', togModelId, {
          newValue: togEnabled
        });
        return json({ success: true });
      }

      case 'reorderModels': {
        const { updates } = body;
        if (!Array.isArray(updates) || updates.length === 0)
          return json({ success: false, error: 'updates array required' }, { status: 400 });
        const db = getDb();
        for (const upd of updates) {
          if (upd.model_id && typeof upd.sort_order === 'number') {
            const existing = await db.getEnabledModel(upd.model_id);
            if (existing) {
              await db.upsertEnabledModel({ ...existing, sort_order: upd.sort_order });
            }
          }
        }
        await adminDashboard.logAction(null, 'reorder_models', 'enabled_model', 'batch', {
          newValue: updates.length
        });
        return json({ success: true });
      }

      case 'deleteUser': {
        const { userId } = body;
        if (!userId || typeof userId !== 'string') {
          return json({ success: false, error: 'userId is required' }, { status: 400 });
        }
        const db = getDb();
        const user = await db.getUserById(userId);
        if (!user) return json({ success: false, error: 'User not found' }, { status: 404 });
        // Delete all user data in order (respecting foreign keys)
        try {
          const client = // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (db as any).client;
          if (!client)
            return json(
              { success: false, error: 'Direct DB access not available' },
              { status: 500 }
            );
          // Delete messages (via conversations)
          const { data: convs } = await client
            .from('conversations')
            .select('id')
            .eq('user_id', userId);
          if (convs && convs.length > 0) {
            const convIds = convs.map((c: Record<string, unknown>) => c.id);
            await client.from('messages').delete().in('conversation_id', convIds);
          }
          // Delete conversations, sessions, credits, usage, settings
          await client.from('conversations').delete().eq('user_id', userId);
          await client.from('sessions').delete().eq('user_id', userId);
          await client.from('credit_transactions').delete().eq('user_id', userId);
          await client.from('credit_balances').delete().eq('user_id', userId);
          await client.from('usage_stats').delete().eq('user_id', userId);
          await client.from('app_settings').delete().eq('user_id', userId);
          // Finally delete the user
          await client.from('users').delete().eq('id', userId);
          await adminDashboard.logAction(null, 'delete_user', 'user', userId, {
            newValue: { email: user.email, display_name: user.display_name }
          });
          return json({ success: true });
        } catch (e) {
          console.error('Delete user failed:', e);
          return json(
            { success: false, error: e instanceof Error ? e.message : 'Delete failed' },
            { status: 500 }
          );
        }
      }

      case 'deleteProvider': {
        const { providerId } = body;

        // Validation
        if (!providerId || typeof providerId !== 'string') {
          return json(
            { success: false, error: 'Provider ID is required and must be a string' },
            { status: 400 }
          );
        }

        // Check if provider exists
        const existingProviders = await settingsManager.getAll(null, 'providers');
        if (!existingProviders.some((p) => p.key === providerId)) {
          return json({ success: false, error: 'Provider not found' }, { status: 404 });
        }

        // Also delete all models for this provider
        const allSettings = await settingsManager.getGrouped(null);
        const models = allSettings.models || [];
        const modelsToDelete = models
          .filter((model) => model.key.startsWith(`${providerId}:`))
          .map((model) => model.key);

        // Delete models first
        for (const modelKey of modelsToDelete) {
          await settingsManager.delete(null, 'models', modelKey);
        }

        // Delete provider
        const success = await settingsManager.delete(null, 'providers', providerId);
        if (success) {
          await adminDashboard.logAction(null, 'delete_provider', 'provider', providerId, {
            newValue: `Deleted ${modelsToDelete.length} models`
          });
        }
        return json({ success });
      }

      default:
        return json({ success: false, error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Admin API error:', error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
};

// ============================================================================
// DELETE - Remove Resources
// ============================================================================

export const DELETE: RequestHandler = async ({ url, request }) => {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  const resource = url.searchParams.get('resource');
  const id = url.searchParams.get('id');

  if (!resource) {
    return json({ success: false, error: 'Resource type required' }, { status: 400 });
  }

  try {
    switch (resource) {
      case 'cache':
        if (id) {
          await getCache().delete(id);
        }
        await adminDashboard.logAction(null, 'delete', 'cache', id || 'all');
        return json({ success: true });

      default:
        return json({ success: false, error: 'Invalid resource type' }, { status: 400 });
    }
  } catch (error) {
    console.error('Admin API error:', error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
};
