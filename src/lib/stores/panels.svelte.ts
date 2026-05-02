import { kv } from '$lib/stores/kvStore.svelte';
import { hmrRestore, hmrPreserve } from '$lib/util/hmr';

// ── Types ──

export type PanelId = 'canvas' | 'document' | 'code' | 'chat';
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

const STORAGE_KEY = 'graphini_panels_v4';
const ORDER_STORAGE_KEY = 'graphini_panel_order_v1';

// ── Server Sync ──

let serverSyncTimeout: ReturnType<typeof setTimeout> | null = null;

function savePrefsToServer(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  if (serverSyncTimeout) clearTimeout(serverSyncTimeout);
  serverSyncTimeout = setTimeout(async () => {
    try {
      await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { [key]: value } }),
        credentials: 'include'
      });
    } catch {
      /* silent fail */
    }
  }, 300);
}

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
    const saved = kv.get<Partial<Record<PanelId, Partial<PanelConfig>>>>('panels', STORAGE_KEY);
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
    const saved = kv.get<PanelId[]>('panels', ORDER_STORAGE_KEY);
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
      kv.set('panels', STORAGE_KEY, toSave);
      savePrefsToServer('panelState', toSave);
    }, 150);
  }

  private saveOrder() {
    kv.set('panels', ORDER_STORAGE_KEY, this.order);
    savePrefsToServer('panelOrder', this.order);
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
    kv.set('panels', STORAGE_KEY, toSave);
    kv.set('panels', ORDER_STORAGE_KEY, this.order);
    savePrefsToServer('panelState', toSave);
    savePrefsToServer('panelOrder', this.order);
  }
}

// ── Exports ──

export const panels: PanelManager = hmrRestore('panelsInstance') ?? new PanelManager();
hmrPreserve('panelsInstance', () => panels);
export const PANEL_ORDER = DEFAULT_ORDER;

/** Call after login to pull server prefs into the panels instance */
export async function syncPreferencesFromServer(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const res = await fetch('/api/user/preferences', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    const prefs = data.preferences;
    if (!prefs) return;

    if (prefs.panelOrder) {
      const order = prefs.panelOrder as PanelId[];
      if (
        Array.isArray(order) &&
        order.length === DEFAULT_ORDER.length &&
        DEFAULT_ORDER.every((id) => order.includes(id))
      ) {
        panels.reorder(order);
      }
    }

    if (prefs.panelState) {
      const saved = prefs.panelState as Partial<
        Record<PanelId, { visible: boolean; width: number }>
      >;
      for (const id of DEFAULT_ORDER) {
        const entry = saved[id];
        if (entry) {
          if (typeof entry.visible === 'boolean') {
            if (entry.visible) panels.show(id);
            else panels.hide(id);
          }
          if (typeof entry.width === 'number') {
            panels.setWidth(id, entry.width);
          }
        }
      }
    }
  } catch {
    /* silent */
  }
}
