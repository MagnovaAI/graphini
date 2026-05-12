/**
 * Client-side store for the local-bridge connection state.
 *
 * Talks to /api/local-bridge for save/clear/probe and exposes:
 *  - `source` — "cloud" | "local"; what the chat tool will route to.
 *  - `hasUrl` — whether a bridge URL is saved (URL itself is never returned).
 *  - `loading`, `error`, `lastServerName` — surfaced by the settings UI.
 *
 * Shared by SettingsModal and the sidebar toggle so both stay in sync.
 */

type WorkspaceSource = 'cloud' | 'local';

interface LocalBridgeState {
  source: WorkspaceSource;
  hasUrl: boolean;
  serverName: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

class LocalBridgeStore {
  state = $state<LocalBridgeState>({
    error: null,
    hasUrl: false,
    loading: false,
    saving: false,
    serverName: null,
    source: 'cloud'
  });

  private loaded = false;

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    this.state.loading = true;
    this.state.error = null;
    try {
      const res = await fetch('/api/local-bridge', { credentials: 'include' });
      if (!res.ok) {
        // 401 means signed out — leave the defaults and don't loudly error.
        if (res.status !== 401) {
          this.state.error = `Could not load bridge state (HTTP ${res.status})`;
        }
        return;
      }
      const data = (await res.json()) as { source: WorkspaceSource; hasUrl: boolean };
      this.state.source = data.source === 'local' ? 'local' : 'cloud';
      this.state.hasUrl = !!data.hasUrl;
      this.loaded = true;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : 'Network error';
    } finally {
      this.state.loading = false;
    }
  }

  /** Persist a freshly pasted URL. Server probes it before saving. */
  async save(url: string): Promise<{ ok: boolean; error?: string }> {
    this.state.saving = true;
    this.state.error = null;
    try {
      const res = await fetch('/api/local-bridge', {
        body: JSON.stringify({ url }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        source?: WorkspaceSource;
        hasUrl?: boolean;
        serverName?: string;
      };
      if (!res.ok || !data.ok) {
        const error = data.error ?? `Save failed (HTTP ${res.status})`;
        this.state.error = error;
        return { error, ok: false };
      }
      this.state.source = data.source === 'local' ? 'local' : 'cloud';
      this.state.hasUrl = !!data.hasUrl;
      this.state.serverName = data.serverName ?? null;
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Network error';
      this.state.error = error;
      return { error, ok: false };
    } finally {
      this.state.saving = false;
    }
  }

  async clear(): Promise<void> {
    this.state.saving = true;
    this.state.error = null;
    try {
      const res = await fetch('/api/local-bridge', {
        credentials: 'include',
        method: 'DELETE'
      });
      if (res.ok) {
        const data = (await res.json()) as { source?: WorkspaceSource; hasUrl?: boolean };
        this.state.source = data.source === 'local' ? 'local' : 'cloud';
        this.state.hasUrl = !!data.hasUrl;
        this.state.serverName = null;
      }
    } finally {
      this.state.saving = false;
    }
  }

  async setSource(source: WorkspaceSource): Promise<{ ok: boolean; error?: string }> {
    const previous = this.state.source;
    this.state.source = source;
    try {
      const res = await fetch('/api/local-bridge', {
        body: JSON.stringify({ source }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH'
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        this.state.source = previous;
        return { error: data.error ?? `Toggle failed (HTTP ${res.status})`, ok: false };
      }
      return { ok: true };
    } catch (err) {
      this.state.source = previous;
      return {
        error: err instanceof Error ? err.message : 'Network error',
        ok: false
      };
    }
  }
}

export const localBridgeStore = new LocalBridgeStore();
