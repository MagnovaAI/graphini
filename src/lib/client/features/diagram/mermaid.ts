/**
 * Mermaid barrel — re-exports from parser and renderer modules.
 * All existing importers continue to resolve through this file.
 */

// Parser (no DOM dependency)
export { parse } from './mermaid-parser';

// Renderer (browser-only, DOM-dependent)
export {
  coloredIconNodes,
  removeIconStylesFromSvg,
  render,
  reprocessIconTheme
} from './mermaid-renderer';
