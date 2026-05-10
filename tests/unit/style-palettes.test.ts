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
    for (const palette of STYLE_PALETTE_NAMES) {
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
