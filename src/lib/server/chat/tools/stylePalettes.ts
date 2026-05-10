export type StylePaletteName = 'earth' | 'monochrome' | 'ocean' | 'pastel' | 'sunset' | 'vibrant';

export type StyleThemeMode = 'dark' | 'light';

export interface StyleColor {
  fill: string;
  stroke: string;
  text: string;
}

export const STYLE_PALETTE_NAMES = [
  'vibrant',
  'pastel',
  'earth',
  'ocean',
  'sunset',
  'monochrome'
] as const satisfies readonly StylePaletteName[];

export const STYLE_THEME_MODES = ['light', 'dark'] as const satisfies readonly StyleThemeMode[];

export const STYLE_PALETTES: Record<StyleThemeMode, Record<StylePaletteName, StyleColor[]>> = {
  dark: {
    earth: [
      { fill: '#713f12', stroke: '#a16207', text: '#fef3c7' },
      { fill: '#064e3b', stroke: '#059669', text: '#d1fae5' },
      { fill: '#7c2d12', stroke: '#c2410c', text: '#fed7aa' },
      { fill: '#1e3a5f', stroke: '#3b82f6', text: '#dbeafe' },
      { fill: '#4a1942', stroke: '#a21caf', text: '#fae8ff' },
      { fill: '#365314', stroke: '#65a30d', text: '#ecfccb' }
    ],
    monochrome: [
      { fill: '#111827', stroke: '#4b5563', text: '#f9fafb' },
      { fill: '#1f2937', stroke: '#6b7280', text: '#f9fafb' },
      { fill: '#374151', stroke: '#9ca3af', text: '#f9fafb' },
      { fill: '#4b5563', stroke: '#d1d5db', text: '#ffffff' },
      { fill: '#0f172a', stroke: '#64748b', text: '#e2e8f0' },
      { fill: '#27272a', stroke: '#a1a1aa', text: '#fafafa' }
    ],
    ocean: [
      { fill: '#075985', stroke: '#38bdf8', text: '#f0f9ff' },
      { fill: '#155e75', stroke: '#22d3ee', text: '#ecfeff' },
      { fill: '#134e4a', stroke: '#2dd4bf', text: '#f0fdfa' },
      { fill: '#1e3a8a', stroke: '#60a5fa', text: '#eff6ff' },
      { fill: '#312e81', stroke: '#818cf8', text: '#eef2ff' },
      { fill: '#164e63', stroke: '#67e8f9', text: '#ecfeff' }
    ],
    pastel: [
      { fill: '#312e81', stroke: '#a5b4fc', text: '#eef2ff' },
      { fill: '#134e4a', stroke: '#5eead4', text: '#f0fdfa' },
      { fill: '#713f12', stroke: '#facc15', text: '#fef9c3' },
      { fill: '#7f1d1d', stroke: '#fca5a5', text: '#fef2f2' },
      { fill: '#4c1d95', stroke: '#c4b5fd', text: '#f5f3ff' },
      { fill: '#14532d', stroke: '#86efac', text: '#f0fdf4' }
    ],
    sunset: [
      { fill: '#7f1d1d', stroke: '#f87171', text: '#fef2f2' },
      { fill: '#7c2d12', stroke: '#fb923c', text: '#fff7ed' },
      { fill: '#713f12', stroke: '#fbbf24', text: '#fffbeb' },
      { fill: '#581c87', stroke: '#c084fc', text: '#faf5ff' },
      { fill: '#881337', stroke: '#fb7185', text: '#fff1f2' },
      { fill: '#3730a3', stroke: '#818cf8', text: '#eef2ff' }
    ],
    vibrant: [
      { fill: '#3730a3', stroke: '#818cf8', text: '#eef2ff' },
      { fill: '#0f766e', stroke: '#2dd4bf', text: '#f0fdfa' },
      { fill: '#92400e', stroke: '#fbbf24', text: '#fffbeb' },
      { fill: '#6d28d9', stroke: '#c4b5fd', text: '#f5f3ff' },
      { fill: '#0e7490', stroke: '#67e8f9', text: '#ecfeff' },
      { fill: '#be123c', stroke: '#fb7185', text: '#fff1f2' }
    ]
  },
  light: {
    earth: [
      { fill: '#fef3c7', stroke: '#d97706', text: '#78350f' },
      { fill: '#d1fae5', stroke: '#059669', text: '#064e3b' },
      { fill: '#fed7aa', stroke: '#ea580c', text: '#7c2d12' },
      { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a' },
      { fill: '#fae8ff', stroke: '#c026d3', text: '#701a75' },
      { fill: '#ecfccb', stroke: '#65a30d', text: '#365314' }
    ],
    monochrome: [
      { fill: '#f9fafb', stroke: '#9ca3af', text: '#111827' },
      { fill: '#e5e7eb', stroke: '#6b7280', text: '#111827' },
      { fill: '#d1d5db', stroke: '#4b5563', text: '#111827' },
      { fill: '#f3f4f6', stroke: '#6b7280', text: '#1f2937' },
      { fill: '#e2e8f0', stroke: '#64748b', text: '#0f172a' },
      { fill: '#fafafa', stroke: '#a1a1aa', text: '#18181b' }
    ],
    ocean: [
      { fill: '#e0f2fe', stroke: '#0284c7', text: '#075985' },
      { fill: '#cffafe', stroke: '#0891b2', text: '#164e63' },
      { fill: '#ccfbf1', stroke: '#0d9488', text: '#134e4a' },
      { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a' },
      { fill: '#e0e7ff', stroke: '#6366f1', text: '#312e81' },
      { fill: '#ecfeff', stroke: '#06b6d4', text: '#155e75' }
    ],
    pastel: [
      { fill: '#e0e7ff', stroke: '#818cf8', text: '#312e81' },
      { fill: '#ccfbf1', stroke: '#2dd4bf', text: '#134e4a' },
      { fill: '#fef3c7', stroke: '#fbbf24', text: '#78350f' },
      { fill: '#fee2e2', stroke: '#f87171', text: '#7f1d1d' },
      { fill: '#ede9fe', stroke: '#a78bfa', text: '#4c1d95' },
      { fill: '#dcfce7', stroke: '#4ade80', text: '#14532d' }
    ],
    sunset: [
      { fill: '#fee2e2', stroke: '#ef4444', text: '#7f1d1d' },
      { fill: '#ffedd5', stroke: '#f97316', text: '#7c2d12' },
      { fill: '#fef3c7', stroke: '#f59e0b', text: '#713f12' },
      { fill: '#f3e8ff', stroke: '#a855f7', text: '#581c87' },
      { fill: '#ffe4e6', stroke: '#e11d48', text: '#881337' },
      { fill: '#e0e7ff', stroke: '#6366f1', text: '#3730a3' }
    ],
    vibrant: [
      { fill: '#e0e7ff', stroke: '#6366f1', text: '#312e81' },
      { fill: '#ccfbf1', stroke: '#14b8a6', text: '#134e4a' },
      { fill: '#fef3c7', stroke: '#f59e0b', text: '#78350f' },
      { fill: '#ede9fe', stroke: '#8b5cf6', text: '#4c1d95' },
      { fill: '#cffafe', stroke: '#06b6d4', text: '#164e63' },
      { fill: '#fee2e2', stroke: '#ef4444', text: '#7f1d1d' }
    ]
  }
};

export function getStylePalette(palette: StylePaletteName, themeMode: StyleThemeMode) {
  return STYLE_PALETTES[themeMode][palette];
}

export function stylePalettePreview(themeMode: StyleThemeMode) {
  return STYLE_PALETTE_NAMES.map((name) => ({
    name,
    colors: STYLE_PALETTES[themeMode][name].slice(0, 3)
  }));
}
