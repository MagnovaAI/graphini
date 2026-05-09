/**
 * Mermaid barrel — re-exports from parser and renderer modules.
 * All existing importers continue to resolve through this file.
 */

// Parser (no DOM dependency)
import { parse } from './mermaid-parser';

// Renderer (browser-only, DOM-dependent)
import {
  coloredIconNodes,
  removeIconStylesFromSvg,
  render,
  reprocessIconTheme
} from './mermaid-renderer';

export { coloredIconNodes, parse, removeIconStylesFromSvg, render, reprocessIconTheme };

// Dev-only test hook: lets e2e tests probe parse/render parity from the
// browser without taking a hard dependency on the editor UI. Safe to keep
// guarded so it never ships to prod.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __graphiniDiagram?: unknown }).__graphiniDiagram = {
    parse,
    render
  };
}
