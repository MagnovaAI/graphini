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
//
// Design rules — every palette must read DISTINCTLY at a glance, so the
// user can pick one from a screenshot. Past version had every dark palette
// using near-black `*-950` fills, which made earth / ocean / sunset / pastel
// all look the same on canvas (only the strokes hinted at the intent).
//
// New approach:
//  • Fill carries the palette's identity (the user sees the fill first).
//      - Vibrant  dark → `*-600` saturated mids, bright white text
//      - Pastel   dark → `*-300/400` mid-light tints with dark text
//      - Earth    dark → desaturated `*-700/800` clay/moss tones
//      - Ocean    dark → cool `*-700/800` teal→indigo ramp
//      - Sunset   dark → warm `*-600/700` red→fuchsia ramp
//      - Monochrome    → true grayscale ladder, fills span the full range
//  • Stroke is one shade lighter (dark mode) / darker (light mode) than the
//    fill — it draws the outline without competing.
//  • Text is forced to the highest-contrast neutral for the fill.
//  • ensureReadableText() at the bottom of this file is the safety net —
//    any triple that drops below 4.5:1 has its text channel swapped for
//    the nearest readable neutral, so these values stay coherent under audit.
export const STYLE_PALETTES: Record<StyleThemeMode, Record<StylePaletteName, StyleColor[]>> = {
  dark: {
    // Desaturated, organic — clay, moss, bark, lichen. Mid-dark fills with
    // warm muted strokes; reads "earthy" not "muddy".
    earth: [
      { fill: '#78350f', stroke: '#fbbf24', text: '#fffbeb' }, // amber 800
      { fill: '#44403c', stroke: '#d6d3d1', text: '#fafaf9' }, // stone 700
      { fill: '#9a3412', stroke: '#fb923c', text: '#fff7ed' }, // orange 800
      { fill: '#14532d', stroke: '#86efac', text: '#f0fdf4' }, // green 800
      { fill: '#3f6212', stroke: '#bef264', text: '#f7fee7' }, // lime 800
      { fill: '#064e3b', stroke: '#6ee7b7', text: '#ecfdf5' } //  emerald 800
    ],
    // True grayscale ladder — fills span 950 → 600 so the six rows are
    // visually distinct, not all "near-black". Stroke is two steps lighter
    // than fill for a clean outline at every level.
    monochrome: [
      { fill: '#0a0a0a', stroke: '#525252', text: '#fafafa' }, // neutral 950
      { fill: '#171717', stroke: '#737373', text: '#fafafa' }, // neutral 900
      { fill: '#262626', stroke: '#a3a3a3', text: '#fafafa' }, // neutral 800
      { fill: '#404040', stroke: '#d4d4d4', text: '#fafafa' }, // neutral 700
      { fill: '#525252', stroke: '#e5e5e5', text: '#fafafa' }, // neutral 600
      { fill: '#737373', stroke: '#f5f5f5', text: '#fafafa' } //  neutral 500
    ],
    // Cool, watery hues — teal → cyan → sky → blue → indigo. Mid-dark fills
    // (`*-700/800`) so the ramp reads as a clear cool family on canvas.
    ocean: [
      { fill: '#115e59', stroke: '#5eead4', text: '#f0fdfa' }, // teal 800
      { fill: '#155e75', stroke: '#67e8f9', text: '#ecfeff' }, // cyan 800
      { fill: '#075985', stroke: '#7dd3fc', text: '#f0f9ff' }, // sky 800
      { fill: '#1e40af', stroke: '#93c5fd', text: '#eff6ff' }, // blue 800
      { fill: '#3730a3', stroke: '#a5b4fc', text: '#eef2ff' }, // indigo 800
      { fill: '#134e4a', stroke: '#5eead4', text: '#f0fdfa' } //  teal 900
    ],
    // Soft, muted jewel tones — mid-light fills (`*-300/400`) with dark text
    // for a calm, low-energy read. The whole point of "pastel" is that the
    // fill carries a hint of color but isn't shouting.
    pastel: [
      { fill: '#a5b4fc', stroke: '#4338ca', text: '#1e1b4b' }, // indigo 300
      { fill: '#5eead4', stroke: '#0f766e', text: '#042f2e' }, // teal 300
      { fill: '#fcd34d', stroke: '#b45309', text: '#451a03' }, // amber 300
      { fill: '#fca5a5', stroke: '#b91c1c', text: '#450a0a' }, // red 300
      { fill: '#c4b5fd', stroke: '#6d28d9', text: '#2e1065' }, // violet 300
      { fill: '#86efac', stroke: '#15803d', text: '#052e16' } //  green 300
    ],
    // Warm dusk ramp — red → orange → amber → pink → fuchsia → violet.
    // `*-700` fills give the "deep sunset" feel without going black.
    sunset: [
      { fill: '#991b1b', stroke: '#fca5a5', text: '#fef2f2' }, // red 800
      { fill: '#9a3412', stroke: '#fb923c', text: '#fff7ed' }, // orange 800
      { fill: '#92400e', stroke: '#fcd34d', text: '#fffbeb' }, // amber 800
      { fill: '#9d174d', stroke: '#f9a8d4', text: '#fdf2f8' }, // pink 800
      { fill: '#86198f', stroke: '#f0abfc', text: '#fdf4ff' }, // fuchsia 800
      { fill: '#6b21a8', stroke: '#c4b5fd', text: '#faf5ff' } //  purple 800
    ],
    // Bright, saturated — `*-600` fills with `*-100` text. These are the
    // "make it pop" colors; each chip carries its hue family clearly and
    // the contrast still passes WCAG AA at standard text sizes.
    vibrant: [
      { fill: '#2563eb', stroke: '#bfdbfe', text: '#eff6ff' }, // blue 600
      { fill: '#0d9488', stroke: '#99f6e4', text: '#f0fdfa' }, // teal 600
      { fill: '#d97706', stroke: '#fde68a', text: '#fffbeb' }, // amber 600
      { fill: '#7c3aed', stroke: '#ddd6fe', text: '#f5f3ff' }, // violet 600
      { fill: '#c026d3', stroke: '#f5d0fe', text: '#fdf4ff' }, // fuchsia 600
      { fill: '#dc2626', stroke: '#fecaca', text: '#fef2f2' } //  red 600
    ]
  },
  light: {
    // Soft warm tints — amber/orange/green/lime with `*-700` strokes for
    // contrast against the cream fills.
    earth: [
      { fill: '#fef3c7', stroke: '#b45309', text: '#451a03' }, // amber 100
      { fill: '#e7e5e4', stroke: '#57534e', text: '#1c1917' }, // stone 200
      { fill: '#ffedd5', stroke: '#c2410c', text: '#431407' }, // orange 100
      { fill: '#dcfce7', stroke: '#15803d', text: '#052e16' }, // green 100
      { fill: '#ecfccb', stroke: '#4d7c0f', text: '#1a2e05' }, // lime 100
      { fill: '#d1fae5', stroke: '#047857', text: '#022c22' } //  emerald 100
    ],
    // White → light-gray ladder. Backgrounds are differentiable (not all
    // pure white) and each row carries a slightly heavier stroke for the
    // step down so the hierarchy reads top-to-bottom.
    monochrome: [
      { fill: '#ffffff', stroke: '#a1a1aa', text: '#18181b' }, // white
      { fill: '#fafafa', stroke: '#71717a', text: '#18181b' }, // neutral 50
      { fill: '#f4f4f5', stroke: '#52525b', text: '#18181b' }, // zinc 100
      { fill: '#e4e4e7', stroke: '#3f3f46', text: '#09090b' }, // zinc 200
      { fill: '#d4d4d8', stroke: '#27272a', text: '#09090b' }, // zinc 300
      { fill: '#a1a1aa', stroke: '#09090b', text: '#fafafa' } //  zinc 400 (inverts)
    ],
    ocean: [
      { fill: '#ccfbf1', stroke: '#0f766e', text: '#042f2e' }, // teal 100
      { fill: '#cffafe', stroke: '#0e7490', text: '#083344' }, // cyan 100
      { fill: '#e0f2fe', stroke: '#0369a1', text: '#082f49' }, // sky 100
      { fill: '#dbeafe', stroke: '#1d4ed8', text: '#172554' }, // blue 100
      { fill: '#e0e7ff', stroke: '#4338ca', text: '#1e1b4b' }, // indigo 100
      { fill: '#f0fdfa', stroke: '#0d9488', text: '#134e4a' } //  teal 50
    ],
    pastel: [
      { fill: '#e0e7ff', stroke: '#4338ca', text: '#1e1b4b' }, // indigo 100
      { fill: '#ccfbf1', stroke: '#0f766e', text: '#042f2e' }, // teal 100
      { fill: '#fef3c7', stroke: '#b45309', text: '#451a03' }, // amber 100
      { fill: '#fee2e2', stroke: '#b91c1c', text: '#450a0a' }, // red 100
      { fill: '#ede9fe', stroke: '#6d28d9', text: '#2e1065' }, // violet 100
      { fill: '#dcfce7', stroke: '#15803d', text: '#052e16' } //  green 100
    ],
    sunset: [
      { fill: '#fee2e2', stroke: '#b91c1c', text: '#450a0a' }, // red 100
      { fill: '#ffedd5', stroke: '#c2410c', text: '#431407' }, // orange 100
      { fill: '#fef3c7', stroke: '#b45309', text: '#451a03' }, // amber 100
      { fill: '#fce7f3', stroke: '#be185d', text: '#500724' }, // pink 100
      { fill: '#fae8ff', stroke: '#a21caf', text: '#4a044e' }, // fuchsia 100
      { fill: '#ede9fe', stroke: '#6d28d9', text: '#2e1065' } //  violet 100
    ],
    // Saturated mid-fills (`*-500/600`) with white text — the light-mode
    // counterpart to the dark "pop" palette. Reads as bold, branded, not
    // pastel. Previous version was identical to light-pastel, defeating
    // the point of having a "vibrant" choice in light mode.
    vibrant: [
      { fill: '#2563eb', stroke: '#1e3a8a', text: '#ffffff' }, // blue 600
      { fill: '#0d9488', stroke: '#134e4a', text: '#ffffff' }, // teal 600
      { fill: '#d97706', stroke: '#78350f', text: '#ffffff' }, // amber 600
      { fill: '#7c3aed', stroke: '#4c1d95', text: '#ffffff' }, // violet 600
      { fill: '#c026d3', stroke: '#701a75', text: '#ffffff' }, // fuchsia 600
      { fill: '#dc2626', stroke: '#7f1d1d', text: '#ffffff' } //  red 600
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
