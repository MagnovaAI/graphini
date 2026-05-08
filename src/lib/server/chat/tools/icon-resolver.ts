import fs from 'fs';
import path from 'path';

// --- Iconifier: local icon index & resolution helpers ---

interface IconEntry {
  colorMode?: IconColorMode;
  id: string;
  path: string;
  category: string;
  keywords: string[];
}

export type IconColorMode = 'color' | 'noncolor';
export type IconModeFilter = IconColorMode | 'any';
export type IconSource = 'local' | 'web';

export interface ResolvedIconCandidate {
  colorMode: IconColorMode;
  confidence: number;
  iconId: string;
  source: IconSource;
  url: string;
}

interface ResolveIconOptions {
  colorMode?: IconModeFilter;
  includeWebSuggestions?: boolean;
  localLimit?: number;
  webLimit?: number;
}

// Load icon index from static/icons/index.json (cached in memory)
let _iconIndex: IconEntry[] | null = null;
const _iconColorModeCache = new Map<string, IconColorMode>();
function getIconIndex(): IconEntry[] {
  if (_iconIndex) return _iconIndex;
  try {
    const indexPath = path.resolve('static/icons/index.json');
    const raw = fs.readFileSync(indexPath, 'utf-8');
    const data = JSON.parse(raw);
    _iconIndex = data.icons as IconEntry[];
  } catch (e) {
    console.error('[iconifier] Failed to load icon index:', e);
    _iconIndex = [];
  }
  return _iconIndex;
}

const CONFIDENCE_THRESHOLD = 0.7;
const MIN_REVERSE_SUBSTRING_LENGTH = 4;
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

function normalizeColorValue(value: string): string {
  return value.toLowerCase().trim();
}

function hasVisibleColor(value: string): boolean {
  const normalized = normalizeColorValue(value);
  if (NO_COLOR_VALUES.has(normalized) || MONOCHROME_COLORS.has(normalized)) return false;
  if (normalized.startsWith('url(')) return true;
  if (/^rgba?\(([^)]+)\)$/.test(normalized)) {
    const channels = normalized.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (channels.length < 3) return false;
    return !(channels[0] === channels[1] && channels[1] === channels[2]);
  }
  if (/^hsla?\(/.test(normalized)) return true;
  return /^#[0-9a-f]{3,8}$/i.test(normalized)
    ? !MONOCHROME_COLORS.has(normalized)
    : !NO_COLOR_VALUES.has(normalized);
}

export function classifySvgColorMode(svgContent: string): IconColorMode {
  if (/<(?:linearGradient|radialGradient|pattern)\b/i.test(svgContent)) return 'color';
  if (/stop-color\s*=\s*["']([^"']+)["']/i.test(svgContent)) return 'color';

  const directColorMatches = svgContent.matchAll(/\b(?:fill|stroke)\s*=\s*["']([^"']+)["']/gi);
  for (const match of directColorMatches) {
    if (hasVisibleColor(match[1])) return 'color';
  }

  const styleColorMatches = svgContent.matchAll(/\b(?:fill|stroke)\s*:\s*([^;"']+)/gi);
  for (const match of styleColorMatches) {
    if (hasVisibleColor(match[1])) return 'color';
  }

  return 'noncolor';
}

function getLocalIconColorMode(icon: IconEntry): IconColorMode {
  if (icon.colorMode) return icon.colorMode;
  const cached = _iconColorModeCache.get(icon.path);
  if (cached) return cached;

  try {
    const localPath = icon.path.startsWith('/')
      ? path.resolve('static', icon.path.slice(1))
      : path.resolve(icon.path);
    const svg = fs.readFileSync(localPath, 'utf-8');
    const colorMode = classifySvgColorMode(svg);
    _iconColorModeCache.set(icon.path, colorMode);
    return colorMode;
  } catch {
    _iconColorModeCache.set(icon.path, 'color');
    return 'color';
  }
}

function matchesColorMode(colorMode: IconColorMode, requested: IconModeFilter = 'any') {
  return requested === 'any' || colorMode === requested;
}

async function fetchVerifiedSvgColorMode(url: string): Promise<IconColorMode | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    const svg = await res.text();
    if (!contentType.includes('svg') && !svg.includes('<svg')) return null;
    return classifySvgColorMode(svg);
  } catch {
    return null;
  }
}

// --- Iconify web icon search fallback ---
async function searchIconifyWeb(
  query: string,
  limit = 3,
  colorMode: IconModeFilter = 'any'
): Promise<ResolvedIconCandidate[]> {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `https://api.iconify.design/search?query=${encoded}&limit=${Math.max(limit * 4, 12)}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const icons: string[] = data.icons || [];

    const verified: ResolvedIconCandidate[] = [];
    for (const [i, iconId] of icons.entries()) {
      const [prefix, ...nameParts] = iconId.split(':');
      const name = nameParts.join(':');
      if (!prefix || !name) continue;

      const url = `https://api.iconify.design/${prefix}/${name}.svg`;
      const candidateColorMode = await fetchVerifiedSvgColorMode(url);
      if (!candidateColorMode || !matchesColorMode(candidateColorMode, colorMode)) continue;

      verified.push({
        colorMode: candidateColorMode,
        confidence: Math.max(0.7, 0.9 - i * 0.05),
        iconId,
        source: 'web',
        url
      });
      if (verified.length >= limit) break;
    }
    return verified;
  } catch {
    return [];
  }
}

// Normalize text for matching
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMeaningfulReverseSubstring(query: string, iconId: string): boolean {
  return iconId.length >= MIN_REVERSE_SUBSTRING_LENGTH && query.includes(iconId);
}

// Extract keywords from text (remove common words)
function extractKeywords(text: string): string[] {
  const commonWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'by',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'must',
    'this',
    'that',
    'these',
    'those',
    'i',
    'you',
    'he',
    'she',
    'it',
    'we',
    'they',
    'me',
    'him',
    'her',
    'us',
    'them',
    'service',
    'server',
    'layer',
    'system',
    'component',
    'primary',
    'main',
    'core',
    'handles',
    'manages',
    'provides',
    'stores',
    'processes'
  ]);
  return normalizeText(text)
    .split(' ')
    .filter((w) => w.length >= 2 && !commonWords.has(w));
}

// Score how well a query matches an icon entry
function scoreIconMatch(query: string, icon: IconEntry): number {
  const q = normalizeText(query);
  const iconId = icon.id.toLowerCase();
  const iconWords = icon.keywords.map((k) => k.toLowerCase());

  // Exact match on icon id
  if (q === iconId) return 1.0;

  // Query equals one of the keywords exactly
  if (iconWords.includes(q)) return 0.95;

  // Icon id contains query or vice versa
  if (iconId.includes(q)) return 0.9;
  if (isMeaningfulReverseSubstring(q, iconId)) return 0.85;

  // Keyword overlap scoring
  const queryKeywords = extractKeywords(query);
  if (queryKeywords.length === 0) return 0;

  let matchedKeywords = 0;
  for (const qk of queryKeywords) {
    // Check against icon id and keywords
    if (iconId.includes(qk) || isMeaningfulReverseSubstring(qk, iconId)) {
      matchedKeywords += 1;
    } else if (iconWords.some((iw) => iw.includes(qk) || qk.includes(iw))) {
      matchedKeywords += 0.8;
    }
  }

  const keywordScore = matchedKeywords / queryKeywords.length;

  // Dice coefficient for fuzzy matching
  const diceScore = diceCoefficient(q, iconId);

  return Math.max(keywordScore * 0.8, diceScore * 0.6, keywordScore * 0.5 + diceScore * 0.3);
}

// Dice coefficient for string similarity
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bi = a.substring(i, i + 2);
    bigrams.set(bi, (bigrams.get(bi) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bi = b.substring(i, i + 2);
    const count = bigrams.get(bi) || 0;
    if (count > 0) {
      bigrams.set(bi, count - 1);
      hits++;
    }
  }
  return (2 * hits) / (a.length - 1 + b.length - 1);
}

// Search local icon index for best match
function searchLocalIcons(
  query: string,
  limit = 5,
  colorMode: IconModeFilter = 'any'
): ResolvedIconCandidate[] {
  if (!query.trim()) return [];
  const icons = getIconIndex();
  const scored: ResolvedIconCandidate[] = [];

  for (const icon of icons) {
    const iconColorMode = getLocalIconColorMode(icon);
    if (!matchesColorMode(iconColorMode, colorMode)) continue;

    const score = scoreIconMatch(query, icon);
    if (score >= CONFIDENCE_THRESHOLD) {
      scored.push({
        colorMode: iconColorMode,
        confidence: Math.round(score * 100) / 100,
        iconId: icon.id,
        source: 'local',
        url: icon.path
      });
    }
  }

  // Sort by confidence descending
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, limit);
}

function mergeCandidates(
  candidates: ResolvedIconCandidate[],
  limit: number
): ResolvedIconCandidate[] {
  const byUrl = new Map<string, ResolvedIconCandidate>();
  for (const candidate of candidates) {
    const previous = byUrl.get(candidate.url);
    if (!previous || candidate.confidence > previous.confidence) {
      byUrl.set(candidate.url, candidate);
    }
  }

  return [...byUrl.values()].sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

export async function resolveIconCandidatesForNode(
  nodeId: string,
  nodeText: string,
  options: ResolveIconOptions = {}
): Promise<ResolvedIconCandidate[]> {
  const colorMode = options.colorMode ?? 'any';
  const localLimit = options.localLimit ?? 3;
  const webLimit = options.webLimit ?? 2;
  const candidates: ResolvedIconCandidate[] = [];

  const addLocalMatches = (query: string, limit = 1, minimumConfidence = CONFIDENCE_THRESHOLD) => {
    const matches = searchLocalIcons(query, limit, colorMode).filter(
      (match) => match.confidence >= minimumConfidence
    );
    candidates.push(...matches);
  };

  // Strategy 1: Direct nodeId match (highest priority — nodeId should be a brand name)
  addLocalMatches(nodeId, localLimit, 0.85);

  // Strategy 2: Extract brand-like words from nodeId (camelCase split)
  const camelParts = nodeId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((p) => p.length > 2);
  for (const part of camelParts) {
    addLocalMatches(part, 1, 0.85);
  }

  // Strategy 3: Search using node text keywords
  if (nodeText.trim()) {
    addLocalMatches(nodeText, localLimit, CONFIDENCE_THRESHOLD);

    // Strategy 4: Individual keywords from text
    const keywords = extractKeywords(nodeText);
    for (const kw of keywords) {
      addLocalMatches(kw, 1, 0.85);
    }

    // Strategy 5: Combined nodeId + first keyword from text
    if (keywords.length > 0) {
      addLocalMatches(`${nodeId} ${keywords[0]}`, localLimit, CONFIDENCE_THRESHOLD);
    }
  }

  const localCandidates = mergeCandidates(candidates, localLimit);
  const shouldSearchWeb = options.includeWebSuggestions || localCandidates.length === 0;
  if (!shouldSearchWeb || webLimit <= 0) return localCandidates;

  const webQueries = [nodeId, nodeText.trim()].filter(Boolean);
  const webCandidates: ResolvedIconCandidate[] = [];
  for (const webQuery of webQueries) {
    webCandidates.push(...(await searchIconifyWeb(webQuery, webLimit, colorMode)));
    if (webCandidates.length >= webLimit) break;
  }

  return mergeCandidates([...localCandidates, ...webCandidates], localLimit + webLimit);
}

// Resolve icon for a diagram node — tries local then web fallback
export async function resolveIconForNode(
  nodeId: string,
  nodeText: string,
  options: ResolveIconOptions = {}
): Promise<ResolvedIconCandidate | null> {
  const candidates = await resolveIconCandidatesForNode(nodeId, nodeText, {
    ...options,
    localLimit: 1,
    webLimit: options.webLimit ?? 1
  });
  return candidates[0] ?? null;
}

// AI SDK Tool Definitions for Multi-Step Calling
