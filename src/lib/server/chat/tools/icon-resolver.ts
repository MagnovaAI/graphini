import fs from 'fs';
import path from 'path';

// --- Iconifier: local icon index & resolution helpers ---

interface IconEntry {
  id: string;
  path: string;
  category: string;
  keywords: string[];
}

// Load icon index from static/icons/index.json (cached in memory)
let _iconIndex: IconEntry[] | null = null;
function getIconIndex(): IconEntry[] {
  if (_iconIndex) return _iconIndex;
  try {
    const indexPath = path.resolve('static/icons/index.json');
    const raw = fs.readFileSync(indexPath, 'utf-8');
    const data = JSON.parse(raw);
    _iconIndex = data.icons as IconEntry[];
    console.log(`[iconifier] Loaded ${_iconIndex.length} icons from local index`);
  } catch (e) {
    console.error('[iconifier] Failed to load icon index:', e);
    _iconIndex = [];
  }
  return _iconIndex;
}

const CONFIDENCE_THRESHOLD = 0.7;

// --- Iconify web icon search fallback ---
async function searchIconifyWeb(
  query: string,
  limit = 3
): Promise<{ url: string; iconId: string; confidence: number }[]> {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `https://api.iconify.design/search?query=${encoded}&limit=${limit * 2}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const icons: string[] = data.icons || [];
    return icons.slice(0, limit).map((iconId, i) => {
      const [prefix, name] = iconId.split(':');
      return {
        url: `https://api.iconify.design/${prefix}/${name}.svg`,
        iconId,
        confidence: Math.max(0.7, 0.9 - i * 0.05)
      };
    });
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
  if (q.includes(iconId) && iconId.length > 2) return 0.85;

  // Keyword overlap scoring
  const queryKeywords = extractKeywords(query);
  if (queryKeywords.length === 0) return 0;

  let matchedKeywords = 0;
  for (const qk of queryKeywords) {
    // Check against icon id and keywords
    if (iconId.includes(qk) || qk.includes(iconId)) {
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
  limit = 5
): { path: string; iconId: string; confidence: number }[] {
  if (!query.trim()) return [];
  const icons = getIconIndex();
  const scored: { path: string; iconId: string; confidence: number }[] = [];

  for (const icon of icons) {
    const score = scoreIconMatch(query, icon);
    if (score >= CONFIDENCE_THRESHOLD) {
      scored.push({ path: icon.path, iconId: icon.id, confidence: Math.round(score * 100) / 100 });
    }
  }

  // Sort by confidence descending
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, limit);
}

// Resolve icon for a diagram node — tries local then web fallback
export async function resolveIconForNode(
  nodeId: string,
  nodeText: string
): Promise<{ url: string; iconId: string; confidence: number } | null> {
  // Strategy 1: Direct nodeId match (highest priority — nodeId should be a brand name)
  const directMatch = searchLocalIcons(nodeId, 1);
  if (directMatch.length > 0 && directMatch[0].confidence >= 0.85) {
    return {
      url: directMatch[0].path,
      iconId: directMatch[0].iconId,
      confidence: directMatch[0].confidence
    };
  }

  // Strategy 2: Extract brand-like words from nodeId (camelCase split)
  const camelParts = nodeId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((p) => p.length > 2);
  for (const part of camelParts) {
    const partMatch = searchLocalIcons(part, 1);
    if (partMatch.length > 0 && partMatch[0].confidence >= 0.85) {
      return {
        url: partMatch[0].path,
        iconId: partMatch[0].iconId,
        confidence: partMatch[0].confidence
      };
    }
  }

  // Strategy 3: Search using node text keywords
  if (nodeText.trim()) {
    const textMatch = searchLocalIcons(nodeText, 1);
    if (textMatch.length > 0 && textMatch[0].confidence >= CONFIDENCE_THRESHOLD) {
      return {
        url: textMatch[0].path,
        iconId: textMatch[0].iconId,
        confidence: textMatch[0].confidence
      };
    }

    // Strategy 4: Individual keywords from text
    const keywords = extractKeywords(nodeText);
    for (const kw of keywords) {
      const kwMatch = searchLocalIcons(kw, 1);
      if (kwMatch.length > 0 && kwMatch[0].confidence >= 0.85) {
        return {
          url: kwMatch[0].path,
          iconId: kwMatch[0].iconId,
          confidence: kwMatch[0].confidence
        };
      }
    }
  }

  // Strategy 5: Combined nodeId + first keyword from text
  if (nodeText.trim()) {
    const keywords = extractKeywords(nodeText);
    if (keywords.length > 0) {
      const combined = `${nodeId} ${keywords[0]}`;
      const combinedMatch = searchLocalIcons(combined, 1);
      if (combinedMatch.length > 0 && combinedMatch[0].confidence >= CONFIDENCE_THRESHOLD) {
        return {
          url: combinedMatch[0].path,
          iconId: combinedMatch[0].iconId,
          confidence: combinedMatch[0].confidence
        };
      }
    }
  }

  // Strategy 6: Iconify web search fallback (async)
  const webQueries = [nodeId, nodeText.trim()].filter(Boolean);
  for (const wq of webQueries) {
    const webResults = await searchIconifyWeb(wq, 1);
    if (webResults.length > 0) {
      return webResults[0];
    }
  }

  return null;
}

// AI SDK Tool Definitions for Multi-Step Calling
