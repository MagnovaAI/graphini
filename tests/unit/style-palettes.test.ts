import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  getStylePalette,
  MIN_TEXT_CONTRAST_RATIO,
  STYLE_PALETTE_NAMES,
  STYLE_THEME_MODES
} from '../../src/lib/server/chat/tools/stylePalettes';

describe('style palettes', () => {
  it('keeps every generated text color readable on its fill', () => {
    for (const themeMode of STYLE_THEME_MODES) {
      for (const palette of STYLE_PALETTE_NAMES) {
        for (const color of getStylePalette(palette, themeMode)) {
          expect(contrastRatio(color.text, color.fill)).toBeGreaterThanOrEqual(
            MIN_TEXT_CONTRAST_RATIO
          );
        }
      }
    }
  });

  it('keeps dark theme fills dark and light theme fills light', () => {
    // Two palettes intentionally break the "fill matches theme" rule:
    //   • pastel  — soft mid-light fills in dark mode (washed jewel tones
    //               with dark text) are the palette's identity.
    //   • vibrant — saturated `*-600` fills are perceptually mid-tone, so
    //               some lean light (teal/amber) and some lean dark
    //               (blue/violet). ensureReadableText picks the right text
    //               for each individually; the test below enforces that.
    const themedPalettes = STYLE_PALETTE_NAMES.filter(
      (p) => p !== 'pastel' && p !== 'vibrant'
    );

    for (const palette of themedPalettes) {
      for (const color of getStylePalette(palette, 'dark')) {
        expect(contrastRatio('#ffffff', color.fill)).toBeGreaterThan(
          contrastRatio('#000000', color.fill)
        );
      }

      for (const color of getStylePalette(palette, 'light')) {
        expect(contrastRatio('#000000', color.fill)).toBeGreaterThan(
          contrastRatio('#ffffff', color.fill)
        );
      }
    }
  });
});
