export type StylePaletteName = 'earth' | 'monochrome' | 'ocean' | 'pastel' | 'sunset' | 'vibrant';

export type StyleThemeMode = 'dark' | 'light';

export interface StyleColor {
  fill: string;
  stroke: string;
  text: string;
}

export const MIN_TEXT_CONTRAST_RATIO = 4.5;

export const STYLE_PALETTE_NAMES = [
  'vibrant',
  'pastel',
  'earth',
  'ocean',
  'sunset',
  'monochrome'
] as const satisfies readonly StylePaletteName[];

export const STYLE_THEME_MODES = ['light', 'dark'] as const satisfies readonly StyleThemeMode[];

// Each palette: 6 fill+stroke+text triples per theme mode.
//  • Light fills use *-100/50 tints; stroke = *-700 sibling; text leans *-900.
//  • Dark  fills use *-950/900 "tinted blacks"; stroke = *-300/400 sibling;
//    text leans *-50/100.
//  • ensureReadableText() at the bottom of this file is the safety net — any
//    triple that drops below 4.5:1 has its text channel swapped for the
//    nearest readable neutral, so these values stay coherent under audit.
export const STYLE_PALETTES: Record<StyleThemeMode, Record<StylePaletteName, StyleColor[]>> = {
  dark: {
    // Muted, organic — clay, moss, bark, lichen.
    earth: [
      { fill: '#451a03', stroke: '#fcd34d', text: '#fef3c7' }, // amber
      { fill: '#1c1917', stroke: '#d6d3d1', text: '#f5f5f4' }, // stone
      { fill: '#431407', stroke: '#fdba74', text: '#ffedd5' }, // orange
      { fill: '#052e16', stroke: '#86efac', text: '#dcfce7' }, // green
      { fill: '#1a2e05', stroke: '#bef264', text: '#ecfccb' }, // lime
      { fill: '#022c22', stroke: '#6ee7b7', text: '#d1fae5' } //  emerald
    ],
    // Greyscale ladder; one accent line per surface for hierarchy.
    monochrome: [
      { fill: '#0f172a', stroke: '#94a3b8', text: '#f8fafc' }, // slate 900
      { fill: '#1f2937', stroke: '#9ca3af', text: '#f9fafb' }, // gray 800
      { fill: '#262626', stroke: '#a3a3a3', text: '#fafafa' }, // neutral 800
      { fill: '#1c1917', stroke: '#a8a29e', text: '#fafaf9' }, // stone 900
      { fill: '#18181b', stroke: '#a1a1aa', text: '#fafafa' }, // zinc 900
      { fill: '#0a0a0a', stroke: '#737373', text: '#e5e5e5' } //  neutral 950
    ],
    // Cool, watery hues — teal, cyan, sky, indigo.
    ocean: [
      { fill: '#022c22', stroke: '#5eead4', text: '#ccfbf1' }, // teal
      { fill: '#083344', stroke: '#67e8f9', text: '#cffafe' }, // cyan
      { fill: '#082f49', stroke: '#7dd3fc', text: '#e0f2fe' }, // sky
      { fill: '#172554', stroke: '#93c5fd', text: '#dbeafe' }, // blue
      { fill: '#1e1b4b', stroke: '#a5b4fc', text: '#e0e7ff' }, // indigo
      { fill: '#042f2e', stroke: '#5eead4', text: '#ccfbf1' } //  teal deep
    ],
    // Soft jewel tones — readable but never loud.
    pastel: [
      { fill: '#1e1b4b', stroke: '#a5b4fc', text: '#e0e7ff' }, // indigo
      { fill: '#042f2e', stroke: '#5eead4', text: '#ccfbf1' }, // teal
      { fill: '#451a03', stroke: '#fcd34d', text: '#fef3c7' }, // amber
      { fill: '#450a0a', stroke: '#fca5a5', text: '#fee2e2' }, // red
      { fill: '#2e1065', stroke: '#c4b5fd', text: '#ede9fe' }, // violet
      { fill: '#052e16', stroke: '#86efac', text: '#dcfce7' } //  green
    ],
    // Warm dusk — reds through violets.
    sunset: [
      { fill: '#450a0a', stroke: '#fca5a5', text: '#fee2e2' }, // red
      { fill: '#431407', stroke: '#fdba74', text: '#ffedd5' }, // orange
      { fill: '#451a03', stroke: '#fcd34d', text: '#fef3c7' }, // amber
      { fill: '#500724', stroke: '#f9a8d4', text: '#fce7f3' }, // pink
      { fill: '#4a044e', stroke: '#f0abfc', text: '#fae8ff' }, // fuchsia
      { fill: '#2e1065', stroke: '#c4b5fd', text: '#ede9fe' } //  violet
    ],
    // Saturated but disciplined — one chip per hue family.
    vibrant: [
      { fill: '#172554', stroke: '#60a5fa', text: '#dbeafe' }, // blue
      { fill: '#022c22', stroke: '#2dd4bf', text: '#ccfbf1' }, // teal
      { fill: '#451a03', stroke: '#fbbf24', text: '#fef3c7' }, // amber
      { fill: '#2e1065', stroke: '#a78bfa', text: '#ede9fe' }, // violet
      { fill: '#4a044e', stroke: '#e879f9', text: '#fae8ff' }, // fuchsia
      { fill: '#450a0a', stroke: '#f87171', text: '#fee2e2' } //  red
    ]
  },
  light: {
    earth: [
      { fill: '#fef3c7', stroke: '#b45309', text: '#451a03' }, // amber
      { fill: '#f5f5f4', stroke: '#57534e', text: '#1c1917' }, // stone
      { fill: '#ffedd5', stroke: '#c2410c', text: '#431407' }, // orange
      { fill: '#dcfce7', stroke: '#15803d', text: '#052e16' }, // green
      { fill: '#ecfccb', stroke: '#4d7c0f', text: '#1a2e05' }, // lime
      { fill: '#d1fae5', stroke: '#047857', text: '#022c22' } //  emerald
    ],
    monochrome: [
      { fill: '#f8fafc', stroke: '#475569', text: '#0f172a' }, // slate 50
      { fill: '#f1f5f9', stroke: '#334155', text: '#0f172a' }, // slate 100
      { fill: '#e2e8f0', stroke: '#475569', text: '#1e293b' }, // slate 200
      { fill: '#fafafa', stroke: '#52525b', text: '#18181b' }, // zinc 50
      { fill: '#f5f5f5', stroke: '#525252', text: '#171717' }, // neutral 100
      { fill: '#ffffff', stroke: '#64748b', text: '#0f172a' } //  white
    ],
    ocean: [
      { fill: '#ccfbf1', stroke: '#0f766e', text: '#022c22' }, // teal
      { fill: '#cffafe', stroke: '#0e7490', text: '#083344' }, // cyan
      { fill: '#e0f2fe', stroke: '#0369a1', text: '#082f49' }, // sky
      { fill: '#dbeafe', stroke: '#1d4ed8', text: '#172554' }, // blue
      { fill: '#e0e7ff', stroke: '#4338ca', text: '#1e1b4b' }, // indigo
      { fill: '#f0fdfa', stroke: '#0d9488', text: '#134e4a' } //  teal soft
    ],
    pastel: [
      { fill: '#e0e7ff', stroke: '#4338ca', text: '#1e1b4b' }, // indigo
      { fill: '#ccfbf1', stroke: '#0f766e', text: '#022c22' }, // teal
      { fill: '#fef3c7', stroke: '#b45309', text: '#451a03' }, // amber
      { fill: '#fee2e2', stroke: '#b91c1c', text: '#450a0a' }, // red
      { fill: '#ede9fe', stroke: '#6d28d9', text: '#2e1065' }, // violet
      { fill: '#dcfce7', stroke: '#15803d', text: '#052e16' } //  green
    ],
    sunset: [
      { fill: '#fee2e2', stroke: '#b91c1c', text: '#450a0a' }, // red
      { fill: '#ffedd5', stroke: '#c2410c', text: '#431407' }, // orange
      { fill: '#fef3c7', stroke: '#b45309', text: '#451a03' }, // amber
      { fill: '#fce7f3', stroke: '#be185d', text: '#500724' }, // pink
      { fill: '#fae8ff', stroke: '#a21caf', text: '#4a044e' }, // fuchsia
      { fill: '#ede9fe', stroke: '#6d28d9', text: '#2e1065' } //  violet
    ],
    vibrant: [
      { fill: '#dbeafe', stroke: '#1d4ed8', text: '#172554' }, // blue
      { fill: '#ccfbf1', stroke: '#0f766e', text: '#022c22' }, // teal
      { fill: '#fef3c7', stroke: '#b45309', text: '#451a03' }, // amber
      { fill: '#ede9fe', stroke: '#6d28d9', text: '#2e1065' }, // violet
      { fill: '#fae8ff', stroke: '#a21caf', text: '#4a044e' }, // fuchsia
      { fill: '#fee2e2', stroke: '#b91c1c', text: '#450a0a' } //  red
    ]
  }
};

function hexToRgb(hex: string): { b: number; g: number; r: number } | undefined {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[\da-f]{6}$/i.test(normalized)) return undefined;
  return {
    b: Number.parseInt(normalized.slice(4, 6), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    r: Number.parseInt(normalized.slice(0, 2), 16)
  };
}

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export function contrastRatio(foreground: string, background: string): number {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  if (!fg || !bg) return 1;
  const fgLuminance =
    0.2126 * channelToLinear(fg.r) +
    0.7152 * channelToLinear(fg.g) +
    0.0722 * channelToLinear(fg.b);
  const bgLuminance =
    0.2126 * channelToLinear(bg.r) +
    0.7152 * channelToLinear(bg.g) +
    0.0722 * channelToLinear(bg.b);
  const lighter = Math.max(fgLuminance, bgLuminance);
  const darker = Math.min(fgLuminance, bgLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function textCandidates(themeMode: StyleThemeMode, preferred: string): string[] {
  return themeMode === 'dark'
    ? [preferred, '#f8fafc', '#ffffff', '#e5e7eb', '#0f172a', '#000000']
    : [preferred, '#0f172a', '#111827', '#000000', '#f8fafc', '#ffffff'];
}

function ensureReadableText(color: StyleColor, themeMode: StyleThemeMode): StyleColor {
  const candidates = textCandidates(themeMode, color.text);
  const readable = candidates.find(
    (text) => contrastRatio(text, color.fill) >= MIN_TEXT_CONTRAST_RATIO
  );
  if (readable) return { ...color, text: readable };

  const best = candidates.toSorted(
    (a, b) => contrastRatio(b, color.fill) - contrastRatio(a, color.fill)
  )[0];
  return { ...color, text: best ?? color.text };
}

export function getStylePalette(palette: StylePaletteName, themeMode: StyleThemeMode) {
  return STYLE_PALETTES[themeMode][palette].map((color) => ensureReadableText(color, themeMode));
}

export function stylePalettePreview(themeMode: StyleThemeMode) {
  return STYLE_PALETTE_NAMES.map((name) => ({
    name,
    colors: getStylePalette(name, themeMode).slice(0, 3)
  }));
}
