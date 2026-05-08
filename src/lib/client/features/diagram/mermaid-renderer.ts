/**
 * Mermaid renderer — SVG rendering, DOM manipulation, icon style fixes.
 * Browser-only (depends on DOM APIs).
 */

/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-non-null-assertion */

import { injectAWSIcons } from '$lib/client/features/icons/iconInjector';
import elkLayouts from '@mermaid-js/layout-elk';
import tidyTreeLayouts from '@mermaid-js/layout-tidy-tree';
import zenuml from '@mermaid-js/mermaid-zenuml';
import type { MermaidConfig, RenderResult } from 'mermaid';
import mermaid from 'mermaid';
import { DIAGRAM_TYPES_LOWER } from './mermaid-parser';

// ── Mermaid initialisation (side-effects, runs once on import) ───────────

mermaid.registerLayoutLoaders([...elkLayouts, ...tidyTreeLayouts]);
const init = mermaid.registerExternalDiagrams([zenuml]);

// Register icon packs from static assets and CDN
try {
  mermaid.registerIconPacks([
    {
      name: 'aws',
      loader: async () => {
        const res = await fetch('/icons/aws/icons.json');
        if (!res.ok) throw new Error(`Failed to load AWS icons: ${res.status}`);
        return res.json();
      }
    },
    {
      name: 'logos',
      loader: async () => {
        const res = await fetch('https://unpkg.com/@iconify-json/logos@1/icons.json');
        if (!res.ok) throw new Error(`Failed to load logos icons: ${res.status}`);
        return res.json();
      }
    }
  ]);
} catch {
  // Non-fatal: mermaid versions without registerIconPacks or environments without fetch
}

// ── Shared map: tracks icon nodes colored by the toolbar palette ─────────
// Key = mermaid node name (e.g. "A"), Value = CSS filter string
export const coloredIconNodes = new Map<string, string>();

// ── Cache for fetched external SVG icon content ──────────────────────────
// Key = URL, Value = { svg: string, isMonochrome: boolean }
const svgIconCache = new Map<string, { isMonochrome: boolean; svg: string }>();

/** Detect if SVG content is monochrome (only black/white/grey fills, no gradients, no real colors) */
function isSvgMonochrome(svgContent: string): boolean {
  if (svgContent.includes('linearGradient') || svgContent.includes('radialGradient')) return false;
  if (/stop-color=["']#[0-9a-fA-F]{3,6}["']/.test(svgContent)) return false;
  const fillMatches = svgContent.matchAll(/fill=["']([^"']+)["']/gi);
  for (const m of fillMatches) {
    const v = m[1].toLowerCase().trim();
    if (!v || v === 'none' || v === 'transparent' || v === 'currentcolor' || v.startsWith('url('))
      continue;
    if (
      /^#(000|000000|111|111111|1a1a1a|222|222222|333|333333|fff|ffffff|eee|eeeeee|ddd|dddddd)$/i.test(
        v
      )
    )
      continue;
    if (v === 'black' || v === 'white') continue;
    return false;
  }
  const strokeMatches = svgContent.matchAll(/stroke=["']([^"']+)["']/gi);
  for (const m of strokeMatches) {
    const v = m[1].toLowerCase().trim();
    if (!v || v === 'none' || v === 'transparent' || v === 'currentcolor') continue;
    if (
      /^#(000|000000|111|111111|1a1a1a|222|222222|333|333333|fff|ffffff|eee|eeeeee|ddd|dddddd)$/i.test(
        v
      )
    )
      continue;
    if (v === 'black' || v === 'white') continue;
    return false;
  }
  const styleFillMatches = svgContent.matchAll(/fill\s*:\s*([^;"']+)/gi);
  for (const m of styleFillMatches) {
    const v = m[1].toLowerCase().trim();
    if (!v || v === 'none' || v === 'transparent' || v === 'currentcolor') continue;
    if (
      /^#(000|000000|111|111111|222|222222|333|333333|fff|ffffff|eee|eeeeee|ddd|dddddd)$/i.test(v)
    )
      continue;
    if (v === 'black' || v === 'white') continue;
    return false;
  }
  return true;
}

/** Fetch external SVG icon and cache the result */
async function fetchAndCacheSvgIcon(
  url: string
): Promise<{ isMonochrome: boolean; svg: string } | null> {
  if (svgIconCache.has(url)) return svgIconCache.get(url)!;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const svg = await res.text();
    if (!svg.includes('<svg')) return null;
    const isMonochrome = isSvgMonochrome(svg);
    const entry = { isMonochrome, svg };
    svgIconCache.set(url, entry);
    return entry;
  } catch {
    return null;
  }
}

// ── Strip broken icon annotations ────────────────────────────────────────
//
// Mermaid icon shapes (`Node@{ img: "URL", ... }`) render via inline <image>
// elements. If a URL 404s or returns non-SVG, the browser surfaces "The
// source image cannot be decoded" and the whole render fails — one bad icon
// kills the diagram. We probe each unique `img:` URL up front and drop only
// the annotation lines whose URL fails. Probes are cached, so repeat renders
// are free.
const ICON_ANNOTATION_LINE = /^\s*[A-Za-z][\w]*\s*@\{[^}]*\bimg:\s*"([^"]+)"[^}]*\}\s*$/;

async function stripBrokenIconAnnotations(code: string): Promise<string> {
  const lines = code.split('\n');
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const line of lines) {
    const match = line.match(ICON_ANNOTATION_LINE);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      urls.push(match[1]);
    }
  }
  if (urls.length === 0) return code;

  const probeResults = await Promise.all(
    urls.map(async (url) => {
      // Data URIs are inlined SVG; trust them without a network probe.
      if (url.startsWith('data:image/svg+xml')) return [url, true] as const;
      const cached = await fetchAndCacheSvgIcon(url);
      return [url, Boolean(cached)] as const;
    })
  );
  const valid = new Map(probeResults);

  return lines
    .filter((line) => {
      const match = line.match(ICON_ANNOTATION_LINE);
      if (!match) return true;
      return valid.get(match[1]) === true;
    })
    .join('\n');
}

// ── Performance: cache last config to skip redundant mermaid.initialize() ──
let lastConfigJson = '';

// ��─ Render ───────────────────────────────────────────────────────────────

export const render = async (
  config: MermaidConfig,
  code: string,
  id: string
): Promise<RenderResult> => {
  await init;

  const processedCode = code;

  // Handle empty or invalid code
  let finalCode = processedCode;
  const isEmptyDiagram = !finalCode || finalCode.trim() === '';
  if (isEmptyDiagram) {
    finalCode = `flowchart TD
    A[No diagram content]`;
  }

  // Consolidated syntax validation + default type insertion (single pass)
  let enhancedCode = finalCode.trim();
  const lines = enhancedCode.split('\n');
  const firstNonCommentLine = lines.find(
    (line) => !line.trim().startsWith('%%') && line.trim().length > 0
  );

  if (firstNonCommentLine) {
    const firstLine = firstNonCommentLine.trim().toLowerCase();
    const hasValidStart = DIAGRAM_TYPES_LOWER.some((type) => firstLine.startsWith(type));

    if (!hasValidStart) {
      enhancedCode = `flowchart TD\n${enhancedCode}`;
    }
  }

  // Drop icon annotations whose URL we can't fetch as an SVG. One bad URL
  // would otherwise make the browser throw "The source image cannot be
  // decoded" and abort the whole render.
  if (!isEmptyDiagram) {
    enhancedCode = await stripBrokenIconAnnotations(enhancedCode);
  }

  const dp = (config.dompurifyConfig ?? {}) as Record<string, unknown>;
  const isDarkMode =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const mergedConfig: MermaidConfig = {
    ...config,
    dompurifyConfig: {
      ...dp,
      ADD_ATTR: [
        ...new Set([
          ...((dp.ADD_ATTR as unknown[]) ?? []),
          'fill',
          'stroke',
          'stroke-width',
          'stroke-linecap',
          'stroke-linejoin',
          'stroke-opacity',
          'fill-opacity',
          'clip-path',
          'mask',
          'filter',
          'gradientUnits',
          'gradientTransform',
          'x1',
          'y1',
          'x2',
          'y2',
          'offset',
          'stop-color',
          'stop-opacity',
          'style',
          'id',
          'class',
          'viewBox',
          'xmlns',
          'xmlns:xlink',
          'xml:space',
          'xlink:href'
        ])
      ],
      ADD_TAGS: [
        ...new Set([
          ...((dp.ADD_TAGS as unknown[]) ?? []),
          'svg',
          'g',
          'path',
          'defs',
          'linearGradient',
          'stop',
          'clipPath',
          'mask',
          'pattern',
          'title',
          'desc',
          'rect',
          'circle',
          'ellipse',
          'polygon',
          'polyline',
          'line'
        ])
      ],
      USE_PROFILES: {
        ...((dp.USE_PROFILES as Record<string, unknown>) ?? {}),
        svg: true,
        svgFilters: true
      }
    } as unknown as MermaidConfig['dompurifyConfig'],
    flowchart: {
      ...config.flowchart,
      curve: 'basis',
      htmlLabels: true,
      subGraph: {
        margin: 20,
        useMaxWidth: true
      }
    },
    sequence: {
      ...config.sequence,
      actorMargin: 50,
      bottomMarginAdj: 1,
      boxMargin: 10,
      boxTextMargin: 5,
      diagramMarginX: 50,
      diagramMarginY: 10,
      height: 65,
      messageMargin: 35,
      mirrorActors: false,
      noteMargin: 10,
      rightAngles: false,
      showSequenceNumbers: false,
      useMaxWidth: true,
      width: 150
    },
    themeCSS: isDarkMode
      ? `
      /* Dark-mode subgraph palette — each nesting level is lighter than the
         canvas (#141414) so boundaries stay visible. */
      .cluster rect {
        fill: #1e1e22 !important;
        stroke: #3a3a3f !important;
        stroke-width: 1px !important;
        rx: 0 !important;
        ry: 0 !important;
        fill-opacity: 1 !important;
      }
      .cluster .cluster rect {
        fill: #25252a !important;
        stroke: #4a4a50 !important;
      }
      .cluster .cluster .cluster rect {
        fill: #2c2c32 !important;
        stroke: #5a5a60 !important;
      }
      .cluster .cluster .cluster .cluster rect {
        fill: #33333a !important;
        stroke: #6a6a70 !important;
      }
      .cluster-label span {
        background: #2a2a30 !important;
        color: #e5e5e5 !important;
        padding: 4px 14px !important;
        border-radius: 0 !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        border: 1px solid #3a3a3f !important;
      }
    `
      : `
      /* Light-mode subgraph palette — each nesting level is darker than the
         canvas (white) so boundaries stay visible. */
      .cluster rect {
        fill: #f5f5f7 !important;
        stroke: #d4d4d8 !important;
        stroke-width: 1px !important;
        rx: 0 !important;
        ry: 0 !important;
        fill-opacity: 1 !important;
      }
      .cluster .cluster rect {
        fill: #eaeaee !important;
        stroke: #c4c4c8 !important;
      }
      .cluster .cluster .cluster rect {
        fill: #dfdfe4 !important;
        stroke: #b4b4b8 !important;
      }
      .cluster .cluster .cluster .cluster rect {
        fill: #d4d4da !important;
        stroke: #a4a4a8 !important;
      }
      .cluster-label span {
        background: #ffffff !important;
        color: #18181b !important;
        padding: 4px 14px !important;
        border-radius: 0 !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        border: 1px solid #d4d4d8 !important;
      }
    `
  } as MermaidConfig;

  // Only re-initialize if config actually changed
  const configJson = JSON.stringify(mergedConfig);
  if (configJson !== lastConfigJson) {
    const _log = console.log;
    const _err = console.error;
    const _warn = console.warn;
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    try {
      mermaid.initialize(mergedConfig);
    } finally {
      console.log = _log;
      console.error = _err;
      console.warn = _warn;
    }
    lastConfigJson = configJson;
  }

  // Pre-validate
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  if (!isEmptyDiagram) {
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    try {
      await mermaid.parse(enhancedCode);
    } catch (parseErr: unknown) {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
      throw new Error((parseErr as Error)?.message || 'Syntax error in diagram');
    }
  }

  // Render into a hidden off-screen container
  let offscreen = document.getElementById('mermaid-offscreen');
  if (!offscreen) {
    offscreen = document.createElement('div');
    offscreen.id = 'mermaid-offscreen';
    offscreen.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
    document.body.appendChild(offscreen);
  }

  let result;
  try {
    result = await mermaid.render(id, enhancedCode, offscreen);
  } finally {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    // Always clean up mermaid's temporary DOM elements, even if render throws.
    // Mermaid injects a `d${id}` div with error bomb SVGs that persist if not removed.
    const tempDiv = document.getElementById(`d${id}`);
    if (tempDiv) tempDiv.remove();
    if (offscreen) offscreen.innerHTML = '';
  }

  // Safety check for error SVGs
  if (
    !isEmptyDiagram &&
    typeof result.svg === 'string' &&
    (result.svg.includes('Syntax error in text') ||
      result.svg.includes('aria-roledescription="error"') ||
      result.svg.includes('class="error-icon"') ||
      result.svg.includes('class="error-text"'))
  ) {
    throw new Error('Syntax error in diagram');
  }

  // Remove any stray mermaid error elements that leaked into the visible DOM
  document
    .querySelectorAll('[aria-roledescription="error"], [id^="d"][id$="mermaid"] .error-icon')
    .forEach((el) => {
      const parent = el.closest('[id^="d"]');
      if (parent && parent !== offscreen) parent.remove();
    });

  // Post-process SVG: remove icon CSS overrides and inject AWS icons
  if (typeof result.svg === 'string') {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(result.svg, 'image/svg+xml');
    const svgElement = svgDoc.querySelector('svg') as SVGSVGElement;
    if (svgElement) {
      removeIconStylesFromSvg(svgElement, document.documentElement?.classList?.contains('dark'));
      injectAWSIcons(svgElement);
      result.svg = new XMLSerializer().serializeToString(svgElement);
    }
  }

  return result;
};

// ── removeIconStylesFromSvg ───────────────────────────────────��──────────

/**
 * Removes icon-related CSS rules from the style tag in the rendered SVG.
 */
export const removeIconStylesFromSvg = (
  svgElement: SVGSVGElement,
  forceDarkMode?: boolean
): void => {
  try {
    const styleTag = svgElement.querySelector('style');
    if (!styleTag || !styleTag.textContent) {
      return;
    }

    const cssText = styleTag.textContent;

    const extractRules = (css: string): string[] => {
      const rules: string[] = [];
      let currentRule = '';
      let braceDepth = 0;

      for (const char of css) {
        currentRule += char;
        if (char === '{') {
          braceDepth++;
        } else if (char === '}') {
          braceDepth--;
          if (braceDepth === 0) {
            rules.push(currentRule.trim());
            currentRule = '';
          }
        }
      }
      return rules;
    };

    const rules = extractRules(cssText);
    const iconSelectors = [
      '.label-icon',
      '.icon-shape',
      '.image-shape',
      '.iconify',
      'svg.icon',
      '.node-icon'
    ];
    const filteredRules = rules.filter((rule) => {
      return !iconSelectors.some((selector) => rule.includes(selector));
    });
    styleTag.textContent = filteredRules.join('');

    // Fix icon colors
    const iconContainers = svgElement.querySelectorAll('.label-icon, .icon-shape, .image-shape');

    iconContainers.forEach((container) => {
      container.removeAttribute('fill');

      const style = container.getAttribute('style');
      if (style) {
        container.setAttribute('style', style.replace(/fill\s*:\s*[^;]+;?/gi, ''));
      }

      const monochromeSet = new Set([
        '#000',
        '#000000',
        '#111',
        '#111111',
        '#1a1a1a',
        '#222',
        '#222222',
        '#333',
        '#333333',
        '#fff',
        '#ffffff',
        '#eee',
        '#eeeeee',
        '#ddd',
        '#dddddd'
      ]);
      container.querySelectorAll('*').forEach((child) => {
        const fill = child.getAttribute('fill');
        if (fill && fill.startsWith('url(')) {
          child.setAttribute(
            'style',
            `fill: ${fill} !important; ${child.getAttribute('style') || ''}`
          );
        } else if (fill && fill.startsWith('#') && !monochromeSet.has(fill.toLowerCase())) {
          child.setAttribute(
            'style',
            `fill: ${fill} !important; ${child.getAttribute('style') || ''}`
          );
        } else if (fill === 'currentColor') {
          child.removeAttribute('fill');
        }
      });
    });

    // Make web-icon node background shapes transparent
    const hideNodeBg = (shape: Element) => {
      if (shape.classList.contains('graphini-selection-rect')) return;
      if (shape.closest('foreignObject') || shape.closest('marker') || shape.closest('defs'))
        return;
      const fill = shape.getAttribute('fill');
      if (fill && fill !== 'none' && fill !== 'transparent') {
        shape.setAttribute('fill', 'none');
        shape.setAttribute('fill-opacity', '0');
        shape.setAttribute(
          'style',
          (shape.getAttribute('style') || '').replace(/fill\s*:[^;]+;?/gi, '') +
            '; fill: none !important; fill-opacity: 0 !important;'
        );
      }
      const stroke = shape.getAttribute('stroke');
      if (stroke && stroke !== 'none' && stroke !== 'transparent') {
        shape.setAttribute('stroke', 'none');
        shape.setAttribute('stroke-opacity', '0');
        shape.setAttribute(
          'style',
          (shape.getAttribute('style') || '') + ' stroke: none !important;'
        );
      }
    };
    svgElement.querySelectorAll('.image-shape').forEach((node) => {
      node.querySelectorAll('path, rect, circle, polygon, ellipse').forEach(hideNodeBg);
    });
    svgElement.querySelectorAll('.node').forEach((node) => {
      if (!node.querySelector('image')) return;
      if (node.classList.contains('image-shape') || node.classList.contains('icon-shape')) return;
      node.querySelectorAll('path, rect, circle, polygon, ellipse').forEach(hideNodeBg);
    });

    // Fix icon node label text color
    const isDark = forceDarkMode ?? document.documentElement.classList.contains('dark');
    const isInvisibleColor = (color: string): boolean => {
      if (!color) return false;
      const c = color.toLowerCase().replace(/\s/g, '');
      if (isDark) {
        return (
          c === '#000' ||
          c === '#000000' ||
          c === '#0a0a0a' ||
          c === '#111' ||
          c === '#111111' ||
          c === 'rgb(0,0,0)' ||
          c === 'black'
        );
      } else {
        return (
          c === '#fff' ||
          c === '#ffffff' ||
          c === '#fafafa' ||
          c === '#f5f5f5' ||
          c === 'rgb(255,255,255)' ||
          c === 'white'
        );
      }
    };
    const fixLabelTextColor = (node: Element) => {
      const textEls = node.querySelectorAll(
        'text, tspan, .nodeLabel, .label, foreignObject span, foreignObject div, foreignObject p'
      );
      const themeColor = isDark ? '#e2e8f0' : '#1e293b';
      textEls.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const computed = window.getComputedStyle(htmlEl);
        const fill = htmlEl.getAttribute('fill') || computed.fill || '';
        const color = computed.color || '';
        if (isInvisibleColor(fill) || isInvisibleColor(color)) {
          htmlEl.style.setProperty('fill', themeColor, 'important');
          htmlEl.style.setProperty('color', themeColor, 'important');
        }
      });
    };
    svgElement.querySelectorAll('.image-shape').forEach(fixLabelTextColor);
    svgElement.querySelectorAll('.icon-shape').forEach(fixLabelTextColor);
    svgElement.querySelectorAll('.node').forEach((node) => {
      if (
        node.querySelector('image') ||
        node.querySelector('.icon-shape') ||
        node.querySelector('.label-icon')
      ) {
        fixLabelTextColor(node);
      }
    });

    // Theme-aware icon coloring
    const isDarkMode = isDark;
    const noColorValues = new Set(['', 'none', 'transparent', 'currentcolor']);
    const monochromeColors = new Set([
      '#000',
      '#000000',
      '#111',
      '#111111',
      '#1a1a1a',
      '#222',
      '#222222',
      '#333',
      '#333333',
      'black',
      '#fff',
      '#ffffff',
      '#eee',
      '#eeeeee',
      '#ddd',
      '#dddddd',
      'white'
    ]);

    const hasNoColor = (el: Element): boolean => {
      if (el.querySelector('linearGradient, radialGradient')) return false;
      const existingFilter = (el as HTMLElement).style?.filter;
      if (existingFilter && existingFilter !== '' && existingFilter !== 'none') return false;

      const shapes = el.querySelectorAll('path, rect, circle, polygon, ellipse, line, use');
      for (const child of shapes) {
        const f = (child.getAttribute('fill') || '').toLowerCase().trim();
        if (f && f.startsWith('url(')) return false;
        if (f && !noColorValues.has(f) && !monochromeColors.has(f)) return false;
        const styleStr = (child.getAttribute('style') || '').toLowerCase();
        const fillMatch = styleStr.match(/fill\s*:\s*([^;!]+)/i);
        if (fillMatch) {
          const sv = fillMatch[1].trim();
          if (sv && sv.startsWith('url(')) return false;
          if (sv && !noColorValues.has(sv) && !monochromeColors.has(sv)) return false;
        }
        const stroke = (child.getAttribute('stroke') || '').toLowerCase().trim();
        if (stroke && !noColorValues.has(stroke) && !monochromeColors.has(stroke)) return false;
        const strokeMatch = styleStr.match(/stroke\s*:\s*([^;!]+)/i);
        if (strokeMatch) {
          const ssv = strokeMatch[1].trim();
          if (ssv && !noColorValues.has(ssv) && !monochromeColors.has(ssv)) return false;
        }
      }
      return true;
    };

    const getNodeNameFromEl = (el: Element): string => {
      const nodeGroup = el.closest('[id*="flowchart-"], [id*="stateDiagram-"], .node');
      if (!nodeGroup) return '';
      const gid = nodeGroup.getAttribute('id') || '';
      const m = gid.match(/^(?:flowchart|stateDiagram)-(.+?)-\d+$/);
      return m ? m[1] : gid;
    };

    const applyThemeColor = (container: Element) => {
      if (isDarkMode) {
        (container as HTMLElement).style.setProperty('filter', 'invert(1)', 'important');
        container.setAttribute('data-theme-switchable', 'true');
      } else {
        container
          .querySelectorAll('path, rect, circle, polygon, ellipse, line, use')
          .forEach((child) => {
            const f = (child.getAttribute('fill') || '').toLowerCase().trim();
            if (!f || noColorValues.has(f) || monochromeColors.has(f)) {
              (child as HTMLElement).style.setProperty('fill', 'currentColor', 'important');
              child.setAttribute('fill', 'currentColor');
            }
            const stroke = (child.getAttribute('stroke') || '').toLowerCase().trim();
            if (stroke && monochromeColors.has(stroke)) {
              (child as HTMLElement).style.setProperty('stroke', 'currentColor', 'important');
              child.setAttribute('stroke', 'currentColor');
            }
          });
        container.setAttribute('data-theme-switchable', 'true');
      }
    };

    // Inline SVG icons
    svgElement.querySelectorAll('.icon-shape, .label-icon').forEach((container) => {
      const nodeName = getNodeNameFromEl(container);
      if (nodeName && coloredIconNodes.has(nodeName)) {
        (container as HTMLElement).style.filter = coloredIconNodes.get(nodeName)!;
        return;
      }
      if (hasNoColor(container)) {
        applyThemeColor(container);
      }
    });

    // External image icons
    const imageNodes = svgElement.querySelectorAll('.image-shape, .node');
    const externalIconPromises: Promise<void>[] = [];
    imageNodes.forEach((node) => {
      const img = node.querySelector('image');
      if (!img) return;
      const nodeName = getNodeNameFromEl(node);
      if (nodeName && coloredIconNodes.has(nodeName)) {
        (img as unknown as HTMLElement).style.filter = coloredIconNodes.get(nodeName)!;
        return;
      }
      const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';

      if (href.startsWith('data:image/svg+xml')) {
        try {
          const decoded = decodeURIComponent(href.split(',')[1] || '');
          if (!isSvgMonochrome(decoded)) return;
        } catch {
          return;
        }
        if (isDarkMode) {
          (img as unknown as HTMLElement).style.setProperty('filter', 'invert(1)', 'important');
        } else {
          (img as unknown as HTMLElement).style.removeProperty('filter');
        }
        img.setAttribute('data-theme-switchable', 'true');
      } else if (href.includes('.svg')) {
        const promise = fetchAndCacheSvgIcon(href).then((cached) => {
          if (!cached) return;
          if (!cached.isMonochrome) {
            (img as unknown as HTMLElement).style.removeProperty('filter');
            return;
          }
          const dataUri = 'data:image/svg+xml,' + encodeURIComponent(cached.svg);
          img.setAttribute('href', dataUri);
          if (img.hasAttribute('xlink:href')) img.setAttribute('xlink:href', dataUri);
          if (isDarkMode) {
            (img as unknown as HTMLElement).style.setProperty('filter', 'invert(1)', 'important');
          } else {
            (img as unknown as HTMLElement).style.removeProperty('filter');
          }
          img.setAttribute('data-theme-switchable', 'true');
        });
        externalIconPromises.push(promise);
      }
    });
    if (externalIconPromises.length > 0) {
      Promise.all(externalIconPromises).catch(() => {});
    }
  } catch {
    // Failed to remove icon styles from SVG - continue without cleanup
  }
};

// ── reprocessIconTheme ───────────────────────────────────────────────────

/**
 * Re-process icon theme coloring on an existing SVG without full re-render.
 * Called when theme changes to update icon colors in-place.
 */
export const reprocessIconTheme = (svgElement: SVGSVGElement, isDark: boolean): void => {
  try {
    const noColorValues = new Set(['', 'none', 'transparent', 'currentcolor']);
    const monochromeColors = new Set([
      '#000',
      '#000000',
      '#111',
      '#111111',
      '#1a1a1a',
      '#222',
      '#222222',
      '#333',
      '#333333',
      'black',
      '#fff',
      '#ffffff',
      '#eee',
      '#eeeeee',
      '#ddd',
      '#dddddd',
      'white'
    ]);

    // Re-process inline SVG icons
    svgElement.querySelectorAll('.icon-shape, .label-icon').forEach((container) => {
      const nodeGroup = container.closest('[id*="flowchart-"], [id*="stateDiagram-"], .node');
      if (nodeGroup) {
        const gid = nodeGroup.getAttribute('id') || '';
        const m = gid.match(/^(?:flowchart|stateDiagram)-(.+?)-\d+$/);
        const nodeName = m ? m[1] : gid;
        if (nodeName && coloredIconNodes.has(nodeName)) return;
      }

      if (container.querySelector('linearGradient, radialGradient')) return;
      const existingFilter = (container as HTMLElement).style?.filter;
      if (
        existingFilter &&
        existingFilter !== '' &&
        existingFilter !== 'none' &&
        !existingFilter.includes('invert')
      )
        return;

      let hasColor = false;
      const shapes = container.querySelectorAll('path, rect, circle, polygon, ellipse, line, use');
      for (const child of shapes) {
        const f = (child.getAttribute('fill') || '').toLowerCase().trim();
        if (f && f.startsWith('url(')) {
          hasColor = true;
          break;
        }
        const styleStr = (child.getAttribute('style') || '').toLowerCase();
        const fillMatch = styleStr.match(/fill\s*:\s*([^;!]+)/i);
        if (fillMatch) {
          const sv = fillMatch[1].trim();
          if (sv && sv.startsWith('url(')) {
            hasColor = true;
            break;
          }
          if (sv && !noColorValues.has(sv) && !monochromeColors.has(sv) && sv !== 'currentcolor') {
            hasColor = true;
            break;
          }
        }
        if (f && !noColorValues.has(f) && !monochromeColors.has(f)) {
          hasColor = true;
          break;
        }
      }
      if (hasColor) return;

      if (isDark) {
        (container as HTMLElement).style.setProperty('filter', 'invert(1)', 'important');
        shapes.forEach((child) => {
          const f = (child.getAttribute('fill') || '').toLowerCase().trim();
          if (f === 'currentcolor') {
            child.removeAttribute('fill');
            (child as HTMLElement).style.removeProperty('fill');
          }
        });
      } else {
        (container as HTMLElement).style.removeProperty('filter');
        shapes.forEach((child) => {
          const f = (child.getAttribute('fill') || '').toLowerCase().trim();
          if (!f || noColorValues.has(f) || monochromeColors.has(f)) {
            (child as HTMLElement).style.setProperty('fill', 'currentColor', 'important');
            child.setAttribute('fill', 'currentColor');
          }
          const stroke = (child.getAttribute('stroke') || '').toLowerCase().trim();
          if (stroke && monochromeColors.has(stroke)) {
            (child as HTMLElement).style.setProperty('stroke', 'currentColor', 'important');
            child.setAttribute('stroke', 'currentColor');
          }
        });
      }
    });

    // Re-process external image icons
    svgElement.querySelectorAll('.image-shape, .node').forEach((node) => {
      const img = node.querySelector('image');
      if (!img) return;
      const nodeGroup = node.closest('[id*="flowchart-"], [id*="stateDiagram-"], .node') || node;
      const gid = nodeGroup.getAttribute('id') || '';
      const m = gid.match(/^(?:flowchart|stateDiagram)-(.+?)-\d+$/);
      const nodeName = m ? m[1] : gid;
      if (nodeName && coloredIconNodes.has(nodeName)) return;

      const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
      if (href.startsWith('data:image/svg+xml')) {
        try {
          const decoded = decodeURIComponent(href.split(',')[1] || '');
          if (!isSvgMonochrome(decoded)) {
            (img as unknown as HTMLElement).style.removeProperty('filter');
            return;
          }
        } catch {
          return;
        }

        if (isDark) {
          (img as unknown as HTMLElement).style.setProperty('filter', 'invert(1)', 'important');
        } else {
          (img as unknown as HTMLElement).style.removeProperty('filter');
        }
      } else if (href.includes('.svg')) {
        const cached = svgIconCache.get(href);
        if (cached) {
          if (!cached.isMonochrome) {
            (img as unknown as HTMLElement).style.removeProperty('filter');
            return;
          }
          const dataUri = 'data:image/svg+xml,' + encodeURIComponent(cached.svg);
          img.setAttribute('href', dataUri);
          if (img.hasAttribute('xlink:href')) img.setAttribute('xlink:href', dataUri);
          if (isDark) {
            (img as unknown as HTMLElement).style.setProperty('filter', 'invert(1)', 'important');
          } else {
            (img as unknown as HTMLElement).style.removeProperty('filter');
          }
        } else {
          fetchAndCacheSvgIcon(href)
            .then((entry) => {
              if (!entry) return;
              if (!entry.isMonochrome) {
                (img as unknown as HTMLElement).style.removeProperty('filter');
                return;
              }
              const dataUri = 'data:image/svg+xml,' + encodeURIComponent(entry.svg);
              img.setAttribute('href', dataUri);
              if (img.hasAttribute('xlink:href')) img.setAttribute('xlink:href', dataUri);
              if (isDark) {
                (img as unknown as HTMLElement).style.setProperty(
                  'filter',
                  'invert(1)',
                  'important'
                );
              } else {
                (img as unknown as HTMLElement).style.removeProperty('filter');
              }
            })
            .catch(() => {});
        }
      }
    });

    // Re-fix label text colors
    const themeColor = isDark ? '#e2e8f0' : '#1e293b';
    const isInvisible = (color: string): boolean => {
      if (!color) return false;
      const c = color.toLowerCase().replace(/\s/g, '');
      if (isDark) {
        return (
          c === '#000' ||
          c === '#000000' ||
          c === '#0a0a0a' ||
          c === '#111' ||
          c === '#111111' ||
          c === 'rgb(0,0,0)' ||
          c === 'black'
        );
      } else {
        return (
          c === '#fff' ||
          c === '#ffffff' ||
          c === '#fafafa' ||
          c === '#f5f5f5' ||
          c === 'rgb(255,255,255)' ||
          c === 'white'
        );
      }
    };
    const fixLabelText = (node: Element) => {
      node
        .querySelectorAll(
          'text, tspan, .nodeLabel, .label, foreignObject span, foreignObject div, foreignObject p'
        )
        .forEach((el) => {
          const htmlEl = el as HTMLElement;
          const computed = window.getComputedStyle(htmlEl);
          const fill = htmlEl.getAttribute('fill') || computed.fill || '';
          const color = computed.color || '';
          if (isInvisible(fill) || isInvisible(color)) {
            htmlEl.style.setProperty('fill', themeColor, 'important');
            htmlEl.style.setProperty('color', themeColor, 'important');
          }
        });
    };
    svgElement.querySelectorAll('.image-shape').forEach(fixLabelText);
    svgElement.querySelectorAll('.icon-shape').forEach(fixLabelText);
    svgElement.querySelectorAll('.node').forEach((node) => {
      if (
        node.querySelector('image') ||
        node.querySelector('.icon-shape') ||
        node.querySelector('.label-icon')
      ) {
        fixLabelText(node);
      }
    });
  } catch {
    // Silently fail
  }
};
