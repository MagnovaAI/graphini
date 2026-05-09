import { kv } from '$lib/client/stores/kvStore.svelte';
import {
  getActiveUserNamespace,
  subscribeNamespaceChange
} from '$lib/client/stores/settings.svelte';
import { hmrRestore, hmrPreserve } from '$lib/client/util/hmr';

// ── Types ──

export type PanelId = 'canvas' | 'document' | 'code' | 'chat';
export type ViewerPanelId = Exclude<PanelId, 'chat'>;
/** The three viewer panels are mutually exclusive — only one shows at a time. */
export const VIEWER_PANEL_IDS: ViewerPanelId[] = ['canvas', 'document', 'code'];
export const VISIBLE_PANEL_SWITCHER_IDS: PanelId[] = ['code', 'canvas'];

export interface PanelConfig {
  id: PanelId;
  label: string;
  visible: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  /** If true, this panel fills remaining space (flex-1) instead of fixed width */
  flex?: boolean;
}

// ── Defaults ──

const DEFAULT_ORDER: PanelId[] = ['chat', 'code', 'canvas', 'document'];
export const WORKSPACE_PANEL_ORDER: PanelId[] = ['chat', 'code', 'canvas', 'document'];

const PANEL_DEFAULTS: Record<PanelId, Omit<PanelConfig, 'id'>> = {
  canvas: { flex: true, label: 'Canvas', maxWidth: 9999, minWidth: 200, visible: true, width: 0 },
  document: { label: 'Markdown', maxWidth: 9999, minWidth: 220, visible: false, width: 400 },
  code: { flex: true, label: 'Code', maxWidth: 9999, minWidth: 220, visible: true, width: 0 },
  chat: { label: 'Chat', maxWidth: 9999, minWidth: 220, visible: true, width: 380 }
};

// Panel layout is per-user. Storage keys are namespaced by the active user
// id (or 'guest' when no one is signed in) so two users on the same browser
// don't share their layout.
function panelStateKey(): string {
  return `graphini_panels_v4_${getActiveUserNamespace()}`;
}
function panelOrderKey(): string {
  return `graphini_panel_order_v1_${getActiveUserNamespace()}`;
}

// Panel preferences are stored in localStorage via kv (already wired below).
// Earlier versions also mirrored each change to /api/user/preferences for
// cross-device sync; that endpoint is deleted as part of the local-settings
// revamp. Each browser keeps its own panel layout — deliberate trade-off.

// ── Helpers ──

function buildDefaults(): Record<PanelId, PanelConfig> {
  return Object.fromEntries(
    DEFAULT_ORDER.map((id) => [id, { id, ...PANEL_DEFAULTS[id] }])
  ) as Record<PanelId, PanelConfig>;
}

function loadPanelState(): Record<PanelId, PanelConfig> {
  const defaults = buildDefaults();
  if (typeof window === 'undefined') return defaults;

  try {
    const saved = kv.get<Partial<Record<PanelId, Partial<PanelConfig>>>>('panels', panelStateKey());
    if (!saved) return defaults;
    for (const id of DEFAULT_ORDER) {
      const entry = saved[id];
      if (entry) {
        if (typeof entry.visible === 'boolean') defaults[id].visible = entry.visible;
        if (typeof entry.width === 'number') {
          defaults[id].width = Math.max(defaults[id].minWidth, entry.width);
        }
      }
    }
    return defaults;
  } catch {
    /* fallback to defaults */
    return defaults;
  }
}

function loadPanelOrder(): PanelId[] {
  if (typeof window === 'undefined') return [...DEFAULT_ORDER];
  try {
    const saved = kv.get<PanelId[]>('panels', panelOrderKey());
    if (!saved) return [...DEFAULT_ORDER];
    if (
      Array.isArray(saved) &&
      saved.length === DEFAULT_ORDER.length &&
      DEFAULT_ORDER.every((id) => saved.includes(id))
    ) {
      return saved;
    }
  } catch {
    /* fallback to defaults */
  }
  return [...DEFAULT_ORDER];
}

// ── PanelManager ──

class PanelManager {
  panels = $state<Record<PanelId, PanelConfig>>(loadPanelState());
  order = $state<PanelId[]>(loadPanelOrder());
  visiblePanels = $derived(
    this.order.filter((id) => this.panels[id].visible).map((id) => this.panels[id])
  );

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  private debouncedSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      const toSave: Partial<Record<PanelId, { visible: boolean; width: number }>> = {};
      for (const id of DEFAULT_ORDER) {
        toSave[id] = { visible: this.panels[id].visible, width: this.panels[id].width };
      }
      kv.set('panels', panelStateKey(), toSave);
    }, 150);
  }

  private saveOrder() {
    kv.set('panels', panelOrderKey(), this.order);
  }

  toggle(id: PanelId): void {
    this.panels[id].visible = !this.panels[id].visible;
    this.panels = { ...this.panels };
    this.debouncedSave();
  }

  show(id: PanelId): void {
    this.panels[id].visible = true;
    this.panels = { ...this.panels };
    this.debouncedSave();
  }

  hide(id: PanelId): void {
    this.panels[id].visible = false;
    this.panels = { ...this.panels };
    this.debouncedSave();
  }

  /**
   * Show exactly one viewer panel (canvas / code / document) and hide the
   * other two. Chat is independent and untouched. Enforces the two-window
   * layout: chat (optional) + one viewer.
   */
  showViewer(id: ViewerPanelId): void {
    for (const v of VIEWER_PANEL_IDS) this.panels[v].visible = v === id;
    this.panels = { ...this.panels };
    this.debouncedSave();
  }

  /** Hide every viewer panel (chat-only mode). */
  hideAllViewers(): void {
    for (const v of VIEWER_PANEL_IDS) this.panels[v].visible = false;
    this.panels = { ...this.panels };
    this.debouncedSave();
  }

  /** The currently-visible viewer, or null when none is open. */
  currentViewer(): ViewerPanelId | null {
    for (const v of VIEWER_PANEL_IDS) if (this.panels[v].visible) return v;
    return null;
  }

  setWidth(id: PanelId, width: number): void {
    const p = this.panels[id];
    p.width = Math.max(p.minWidth, width);
    this.panels = { ...this.panels };
    this.debouncedSave();
  }

  reorder(newOrder: PanelId[]): void {
    this.order = newOrder;
    this.saveOrder();
  }

  setWorkspaceOrder(): void {
    this.order = [...WORKSPACE_PANEL_ORDER];
    this.saveOrder();
  }

  reset(): void {
    this.panels = buildDefaults();
    this.order = [...DEFAULT_ORDER];
    const toSave: Partial<Record<PanelId, { visible: boolean; width: number }>> = {};
    for (const id of DEFAULT_ORDER) {
      toSave[id] = { visible: this.panels[id].visible, width: this.panels[id].width };
    }
    kv.set('panels', panelStateKey(), toSave);
    kv.set('panels', panelOrderKey(), this.order);
  }

  /**
   * Reload from the current user namespace's localStorage slot. Called by
   * the settings-namespace subscriber when the active user changes; cancels
   * any in-flight debounced save so we don't write user A's pending state
   * into user B's slot.
   */
  reloadFromActiveNamespace(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.panels = loadPanelState();
    this.order = loadPanelOrder();
  }
}

// ── Exports ──

export const panels: PanelManager = hmrRestore('panelsInstance') ?? new PanelManager();
hmrPreserve('panelsInstance', () => panels);
export const PANEL_ORDER = DEFAULT_ORDER;

// Reload panels when the active user changes so two users on the same
// browser don't see each other's layout.
subscribeNamespaceChange(() => panels.reloadFromActiveNamespace());

/**
 * Compatibility shim. Earlier versions pulled panel layout from
 * /api/user/preferences after login; the local-only revamp removed that
 * endpoint. Panel state now lives in localStorage and loads at construction
 * time via `loadPanelState` / `loadPanelOrder`. Callers don't need to call
 * this anymore, but it stays as a no-op so we don't have to delete every
 * call site in one go.
 */
export async function syncPreferencesFromServer(): Promise<void> {
  // No-op: panels load from localStorage at construction time.
}
