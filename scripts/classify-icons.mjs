#!/usr/bin/env node
/**
 * Classify every SVG under static/icons/ as 'color' or 'noncolor' and write
 * the result back into static/icons/index.json under each entry's `colorMode`.
 *
 * The runtime icon resolver (src/lib/server/chat/tools/icon-resolver.ts)
 * trusts `colorMode` if present and skips its own re-classification. So this
 * script must use the same rules as that resolver — keep the two in sync.
 *
 * Run: pnpm node scripts/classify-icons.mjs
 *      pnpm node scripts/classify-icons.mjs --dry-run     (no writes, prints summary)
 *      pnpm node scripts/classify-icons.mjs --report=path (writes per-file CSV)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ICONS_DIR = path.join(ROOT, 'static', 'icons');
const INDEX_FILE = path.join(ICONS_DIR, 'index.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const REPORT_FLAG = args.find((a) => a.startsWith('--report='));
const REPORT_FILE = REPORT_FLAG ? REPORT_FLAG.split('=')[1] : null;

// ── Mirrors classifySvgColorMode in icon-resolver.ts ─────────────────────
const MONOCHROME_COLORS = new Set([
  '#000',
  '#000000',
  '#111',
  '#111111',
  '#1a1a1a',
  '#222',
  '#222222',
  '#333',
  '#333333',
  '#444',
  '#444444',
  '#555',
  '#555555',
  '#666',
  '#666666',
  '#777',
  '#777777',
  '#888',
  '#888888',
  '#999',
  '#999999',
  '#aaa',
  '#aaaaaa',
  '#bbb',
  '#bbbbbb',
  '#ccc',
  '#cccccc',
  '#ddd',
  '#dddddd',
  '#eee',
  '#eeeeee',
  '#fff',
  '#ffffff',
  'black',
  'white',
  'gray',
  'grey',
  'currentcolor'
]);
const NO_COLOR_VALUES = new Set(['', 'none', 'transparent', 'inherit', 'initial', 'unset']);

function normalizeColorValue(value) {
  return value.toLowerCase().trim();
}

function hasVisibleColor(value) {
  const normalized = normalizeColorValue(value);
  if (NO_COLOR_VALUES.has(normalized) || MONOCHROME_COLORS.has(normalized)) return false;
  if (normalized.startsWith('url(')) return true;
  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(normalized);
  if (rgbMatch) {
    const channels = (normalized.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (channels.length < 3) return false;
    return !(channels[0] === channels[1] && channels[1] === channels[2]);
  }
  if (/^hsla?\(/.test(normalized)) return true;
  return /^#[0-9a-f]{3,8}$/i.test(normalized)
    ? !MONOCHROME_COLORS.has(normalized)
    : !NO_COLOR_VALUES.has(normalized);
}

function classifySvgColorMode(svgContent) {
  if (/<(?:linearGradient|radialGradient|pattern)\b/i.test(svgContent)) return 'color';
  if (/stop-color\s*=\s*["']([^"']+)["']/i.test(svgContent)) return 'color';

  for (const match of svgContent.matchAll(/\b(?:fill|stroke)\s*=\s*["']([^"']+)["']/gi)) {
    if (hasVisibleColor(match[1])) return 'color';
  }
  for (const match of svgContent.matchAll(/\b(?:fill|stroke)\s*:\s*([^;"']+)/gi)) {
    if (hasVisibleColor(match[1])) return 'color';
  }
  return 'noncolor';
}

// ─────────────────────────────────────────────────────────────────────────

async function main() {
  const indexRaw = await fs.readFile(INDEX_FILE, 'utf8').catch(() => null);
  if (!indexRaw) {
    console.error(`Missing ${INDEX_FILE}`);
    process.exit(1);
  }
  const index = JSON.parse(indexRaw);
  if (!Array.isArray(index.icons)) {
    console.error('index.json has no icons[] array');
    process.exit(1);
  }

  let color = 0;
  let noncolor = 0;
  let missing = 0;
  const reportRows = [['id', 'colorMode']];

  for (const entry of index.icons) {
    // index.json stores web paths like "/icons/foo.svg"; map to static/icons/foo.svg.
    const webPath = entry.path.replace(/^\//, '');
    const filePath = webPath.startsWith('icons/')
      ? path.join(ROOT, 'static', webPath)
      : path.join(ROOT, webPath);

    let svg;
    try {
      svg = await fs.readFile(filePath, 'utf8');
    } catch {
      missing++;
      delete entry.colorMode;
      // Drop legacy field from earlier classifier run.
      delete entry.variant;
      continue;
    }
    const colorMode = classifySvgColorMode(svg);
    entry.colorMode = colorMode;
    delete entry.variant;
    if (colorMode === 'color') color++;
    else noncolor++;
    reportRows.push([entry.id, colorMode]);
  }

  console.log(`Total:    ${index.icons.length}`);
  console.log(`Color:    ${color}`);
  console.log(`Noncolor: ${noncolor}`);
  console.log(`Missing:  ${missing}`);

  if (REPORT_FILE) {
    const csv = reportRows.map((r) => r.join(',')).join('\n');
    await fs.writeFile(REPORT_FILE, csv, 'utf8');
    console.log(`Report: ${REPORT_FILE}`);
  }

  if (!DRY_RUN) {
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 0), 'utf8');
    console.log(`Wrote ${INDEX_FILE}`);
  } else {
    console.log('(dry run — index.json not modified)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
