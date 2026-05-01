<script lang="ts">
  import { coloredIconNodes } from '$lib/features/diagram/mermaid';
  import { cn } from '$lib/util';
  import {
    changeEdgeArrow,
    changeEdgeLabel,
    EDGE_THICKNESS_MAP,
    findNodeDefinition,
    findSubgraphDefinition,
    FONT_MAP,
    getEdgeArrowType,
    getEdgeLabelText,
    getEdgeStyle,
    injectEdgeStyle,
    injectNodeStyle,
    injectSubgraphStyle,
    svgIdToNodeName,
    TEXT_SIZE_MAP
  } from '$lib/util/diagram/diagramMapper';
  import { inputStateStore, updateCodeStore } from '$lib/util/state/state';
  import {
    ArrowDown,
    ArrowLeftRight,
    ArrowRight,
    ChevronDown,
    Circle,
    Diamond,
    Hexagon,
    Image as ImageIcon,
    Minus,
    RectangleHorizontal,
    Square,
    Triangle,
    Type,
    X
  } from 'lucide-svelte';
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';

  // Element selection state
  let elementType = $state<'node' | 'edge' | 'icon' | 'subgraph' | null>(null);
  let elementLabel = $state('');
  let elementNodeId = $state('');
  let elementEdgeIndex = $state(-1);
  let isVisible = $derived(elementType !== null);

  // Node toolbar state
  let nodeShape = $state('rect');
  let nodeBorderColor = $state('#6366f1');
  let nodeFillColor = $state('#e0e7ff');
  let nodeTextColor = $state('#1e293b');
  let nodeTextSize = $state<'sm' | 'md' | 'lg'>('md');
  let nodeFont = $state<'sans' | 'serif' | 'mono'>('sans');
  let nodeLabel = $state('');

  // Edge toolbar state
  let edgeLabel = $state('');
  let edgeColor = $state('#6366f1');
  let edgeTextColor = $state('#1e293b');
  let edgeFont = $state<'sans' | 'serif' | 'mono'>('sans');
  let edgeThickness = $state<'thin' | 'normal' | 'thick'>('normal');
  let edgeArrowType = $state<'-->' | '---' | '-.->' | '==>' | '<-->' | '<---'>('-->');
  let edgeIsDashed = $state(false);

  // Subgraph toolbar state
  let subgraphTitle = $state('');
  let subgraphFillColor = $state('#eef2ff');
  let subgraphTextColor = $state('#1e293b');
  let subgraphTextSize = $state<'sm' | 'md' | 'lg'>('md');
  let subgraphFont = $state<'sans' | 'serif' | 'mono'>('sans');
  let subgraphFilled = $state(true);
  let subgraphDirection = $state<'LR' | 'TB'>('TB');

  // Icon toolbar state
  let iconColorMode = $state<'original' | 'simple'>('original');
  let iconNodeLabel = $state('');
  let iconSrc = $state('');
  let iconColor = $state('#000000');

  // Color palette
  const colors = [
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#84cc16',
    '#22c55e',
    '#10b981',
    '#06b6d4',
    '#0ea5e9',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#d946ef',
    '#f43f5e',
    '#78716c',
    '#475569',
    '#1e293b'
  ];

  const fillColors = [
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#84cc16',
    '#22c55e',
    '#10b981',
    '#06b6d4',
    '#0ea5e9',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#d946ef',
    '#f43f5e',
    '#78716c',
    '#475569',
    '#ffffff'
  ];

  const subgraphColors = [
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#84cc16',
    '#22c55e',
    '#10b981',
    '#06b6d4',
    '#0ea5e9',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#d946ef',
    '#f43f5e',
    '#78716c',
    '#475569',
    '#ffffff'
  ];

  // Mermaid shape map
  const shapes: { id: string; label: string; syntax: [string, string] }[] = [
    { id: 'rect', label: 'Rectangle', syntax: ['[', ']'] },
    { id: 'rounded', label: 'Rounded', syntax: ['(', ')'] },
    { id: 'stadium', label: 'Stadium', syntax: ['([', '])'] },
    { id: 'subroutine', label: 'Subroutine', syntax: ['[[', ']]'] },
    { id: 'cylinder', label: 'Cylinder', syntax: ['[(', ')]'] },
    { id: 'circle', label: 'Circle', syntax: ['((', '))'] },
    { id: 'rhombus', label: 'Diamond', syntax: ['{', '}'] },
    { id: 'hexagon', label: 'Hexagon', syntax: ['{{', '}}'] },
    { id: 'trapezoid', label: 'Trapezoid', syntax: ['[/', '\\]'] },
    { id: 'flag', label: 'Flag', syntax: ['>', ']'] }
  ];

  // Font options
  const fonts: { id: 'sans' | 'serif' | 'mono'; label: string }[] = [
    { id: 'sans', label: 'Sans' },
    { id: 'serif', label: 'Serif' },
    { id: 'mono', label: 'Mono' }
  ];

  // Arrow types for edge direction
  const arrowTypes: {
    id: '-->' | '---' | '-.->' | '==>' | '<-->' | '<---';
    label: string;
    icon: typeof ArrowRight | null;
  }[] = [
    { id: '-->', label: 'Forward', icon: ArrowRight },
    { id: '<-->', label: 'Both', icon: ArrowLeftRight },
    { id: '---', label: 'None', icon: Minus },
    { id: '-.->', label: 'Dashed', icon: null },
    { id: '==>', label: 'Thick', icon: null }
  ];

  function getCleanNodeName(): string {
    return svgIdToNodeName(elementNodeId);
  }

  function getCleanSubgraphId(): string {
    return elementNodeId
      .replace(/^flowchart-/, '')
      .replace(/^stateDiagram-/, '')
      .replace(/^classDiagram-/, '')
      .replace(/-\d+$/, '');
  }

  function getCurrentCode(): string {
    return get(inputStateStore).code || '';
  }

  // ── Node Actions ──

  function applyNodeShape(shape: (typeof shapes)[number]) {
    const nodeName = getCleanNodeName();
    if (!nodeName) return;
    let code = getCurrentCode();
    const def = findNodeDefinition(code, nodeName);
    if (!def) return;

    const labelMatch = def.line.match(/(?:\[|\(|\{|<)+(.+?)(?:\]|\)|\}|>)+/);
    const currentLabel = labelMatch ? labelMatch[1] : nodeName;

    const lines = code.split('\n');
    const indent = def.indent;
    lines[def.lineIndex] =
      `${indent}${nodeName}${shape.syntax[0]}${currentLabel}${shape.syntax[1]}`;
    updateCodeStore({ code: lines.join('\n') });
    nodeShape = shape.id;
  }

  function applyNodeBorder(color: string) {
    const nodeName = getCleanNodeName();
    if (!nodeName) return;
    let code = getCurrentCode();
    code = injectNodeStyle(code, nodeName, { stroke: color, strokeWidth: '2px' });
    updateCodeStore({ code });
    nodeBorderColor = color;
  }

  function applyNodeFill(color: string) {
    const nodeName = getCleanNodeName();
    if (!nodeName) return;
    let code = getCurrentCode();
    code = injectNodeStyle(code, nodeName, { fill: color });
    updateCodeStore({ code });
    nodeFillColor = color;
  }

  function applyNodeTextColor(color: string) {
    const nodeName = getCleanNodeName();
    if (!nodeName) return;
    let code = getCurrentCode();
    code = injectNodeStyle(code, nodeName, { color });
    updateCodeStore({ code });
    nodeTextColor = color;
  }

  function applyNodeTextSize(size: 'sm' | 'md' | 'lg') {
    const nodeName = getCleanNodeName();
    if (!nodeName) return;
    let code = getCurrentCode();
    code = injectNodeStyle(code, nodeName, { fontSize: TEXT_SIZE_MAP[size] });
    updateCodeStore({ code });
    nodeTextSize = size;
  }

  function applyNodeFont(font: 'sans' | 'serif' | 'mono') {
    const nodeName = getCleanNodeName();
    if (!nodeName) return;
    let code = getCurrentCode();
    code = injectNodeStyle(code, nodeName, { fontFamily: FONT_MAP[font] });
    updateCodeStore({ code });
    nodeFont = font;
  }

  function applyNodeLabel() {
    const nodeName = getCleanNodeName();
    if (!nodeName || !nodeLabel.trim()) return;
    let code = getCurrentCode();
    const def = findNodeDefinition(code, nodeName);
    if (!def) return;
    const lines = code.split('\n');
    const line = def.line;
    // Separate the @{...} icon annotation from the node definition part
    const iconAnnotation = line.match(/@\{[^}]*\}/)?.[0] || '';
    const lineWithoutIcon = line.replace(/@\{[^}]*\}/, '').trimEnd();
    // Match the label brackets on the clean line
    const escaped = nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const labelRegex = new RegExp(
      `^(\\s*${escaped})(\\s*)([\\[\\(\\{<>]+)(.+?)([\\]\\)\\}>]+)(.*)`
    );
    const m = lineWithoutIcon.match(labelRegex);
    if (m) {
      const newLine = `${m[1]}${m[2]}${m[3]}${nodeLabel}${m[5]}${m[6]}${iconAnnotation ? ' ' + iconAnnotation : ''}`;
      lines[def.lineIndex] = newLine;
      updateCodeStore({ code: lines.join('\n') });
    }
  }

  function readNodeLabel(): string {
    const nodeName = getCleanNodeName();
    if (!nodeName) return '';
    const code = getCurrentCode();
    const def = findNodeDefinition(code, nodeName);
    if (!def) return '';
    const clean = def.line.replace(/@\{[^}]*\}/, '').trimEnd();
    const escaped = nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = clean.match(new RegExp(`${escaped}\\s*[\\[\\(\\{<>]+(.+?)[\\]\\)\\}>]+`));
    return m ? m[1] : '';
  }

  function debouncedApplyNodeLabel() {
    clearTimeout(updateTimeouts.nodeLabel);
    updateTimeouts.nodeLabel = setTimeout(() => applyNodeLabel(), 300);
  }

  // ── Icon Node Actions ──

  function hexToHSL(hex: string): { h: number; s: number; l: number } {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h = 0,
      s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function buildColorFilter(hex: string): string {
    const { h, s, l } = hexToHSL(hex);
    // Target: make icon appear as the chosen color
    // Step 1: brightness(0) makes everything black
    // Step 2: invert() controls lightness — invert(1) = white, invert(0.5) = mid grey
    // Step 3: sepia(1) gives a warm brown base for hue-rotate
    // Step 4: hue-rotate shifts to target hue
    // Step 5: saturate controls color intensity
    // Step 6: brightness fine-tunes lightness
    const invertVal = l > 50 ? 1 : l / 50;
    const hueVal = Math.round(h - 10); // sepia base is ~30deg, offset
    const satVal = Math.max(5, Math.round(s * 10));
    const brightVal = Math.max(0.5, Math.min(2, l / 50));
    return `brightness(0) saturate(100%) invert(${invertVal.toFixed(2)}) sepia(1) saturate(${satVal}) hue-rotate(${hueVal}deg) brightness(${brightVal.toFixed(2)})`;
  }

  function applyIconColor(color: string) {
    iconColor = color;
    iconColorMode = 'simple';
    const container = document.querySelector('#container svg');
    if (!container) return;
    const nodeEl = container.querySelector(`[id*="${elementNodeId}"]`);
    if (!nodeEl) return;
    const img = nodeEl.querySelector('image');
    const iconContainer = nodeEl.querySelector('.icon-shape, .label-icon');
    const target = img || iconContainer;
    if (target) {
      const filterValue = buildColorFilter(color);
      (target as HTMLElement).style.filter = filterValue;
      // Track in shared map so dark mode inversion skips this icon on re-render
      const nodeName = getCleanNodeName();
      if (nodeName) coloredIconNodes.set(nodeName, filterValue);
    }
  }

  function applyIconOriginal() {
    iconColorMode = 'original';
    // Remove color filter from icon element
    const container = document.querySelector('#container svg');
    if (!container) return;
    const nodeEl = container.querySelector(`[id*="${elementNodeId}"]`);
    if (!nodeEl) return;
    const img = nodeEl.querySelector('image');
    const iconContainer = nodeEl.querySelector('.icon-shape, .label-icon');
    const target = img || iconContainer;
    if (target) {
      (target as HTMLElement).style.filter = '';
    }
    // Remove from shared map so dark mode inversion can apply normally
    const nodeName = getCleanNodeName();
    if (nodeName) coloredIconNodes.delete(nodeName);
  }

  function applyIconNodeLabel() {
    const nodeName = getCleanNodeName();
    if (!nodeName || !iconNodeLabel.trim()) return;
    let code = getCurrentCode();
    const def = findNodeDefinition(code, nodeName);
    if (!def) return;
    const lines = code.split('\n');
    const line = def.line;
    // Separate the @{...} icon annotation from the node definition part
    const iconAnnotation = line.match(/@\{[^}]*\}/)?.[0] || '';
    const lineWithoutIcon = line.replace(/@\{[^}]*\}/, '').trimEnd();
    // Now match the label brackets on the clean line
    const escaped = nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const labelRegex = new RegExp(
      `^(\\s*${escaped})(\\s*)([\\[\\(\\{<>]+)(.+?)([\\]\\)\\}>]+)(.*)`
    );
    const m = lineWithoutIcon.match(labelRegex);
    if (m) {
      const newLine = `${m[1]}${m[2]}${m[3]}${iconNodeLabel}${m[5]}${m[6]}${iconAnnotation ? ' ' + iconAnnotation : ''}`;
      lines[def.lineIndex] = newLine;
      updateCodeStore({ code: lines.join('\n') });
    }
  }

  function readIconNodeLabel(): string {
    const nodeName = getCleanNodeName();
    if (!nodeName) return '';
    const code = getCurrentCode();
    const def = findNodeDefinition(code, nodeName);
    if (!def) return '';
    // Strip @{...} then extract label from brackets
    const clean = def.line.replace(/@\{[^}]*\}/, '').trimEnd();
    const escaped = nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = clean.match(new RegExp(`${escaped}\\s*[\\[\\(\\{<>]+(.+?)[\\]\\)\\}>]+`));
    return m ? m[1] : '';
  }

  // ── Edge Actions ──

  function applyEdgeLabel() {
    if (elementEdgeIndex < 0) return;
    let code = getCurrentCode();
    code = changeEdgeLabel(code, elementEdgeIndex, edgeLabel);
    updateCodeStore({ code });
  }

  function applyEdgeColor(color: string) {
    if (elementEdgeIndex < 0) return;
    let code = getCurrentCode();
    code = injectEdgeStyle(code, elementEdgeIndex, { stroke: color });
    updateCodeStore({ code });
    edgeColor = color;
  }

  function applyEdgeTextColor(color: string) {
    // Mermaid linkStyle doesn't support text color — update local state only
    edgeTextColor = color;
  }

  function applyEdgeThickness(thickness: 'thin' | 'normal' | 'thick') {
    if (elementEdgeIndex < 0) return;
    let code = getCurrentCode();
    code = injectEdgeStyle(code, elementEdgeIndex, { strokeWidth: EDGE_THICKNESS_MAP[thickness] });
    updateCodeStore({ code });
    edgeThickness = thickness;
  }

  function applyEdgeArrowType(arrow: typeof edgeArrowType) {
    if (elementEdgeIndex < 0) return;
    let code = getCurrentCode();
    code = changeEdgeArrow(code, elementEdgeIndex, arrow);
    updateCodeStore({ code });
    edgeArrowType = arrow;
    edgeIsDashed = arrow === '-.->';
  }

  function applyEdgeFont(font: 'sans' | 'serif' | 'mono') {
    // Mermaid linkStyle doesn't support font-family — update local state only
    edgeFont = font;
  }

  function toggleEdgeDash() {
    edgeIsDashed = !edgeIsDashed;
    if (elementEdgeIndex < 0) return;
    let code = getCurrentCode();
    if (edgeIsDashed) {
      code = changeEdgeArrow(code, elementEdgeIndex, '-.->');
      edgeArrowType = '-.->';
    } else {
      code = changeEdgeArrow(code, elementEdgeIndex, '-->');
      edgeArrowType = '-->';
    }
    updateCodeStore({ code });
  }

  // ── Subgraph Actions ──

  function applySubgraphTitle() {
    if (!elementNodeId) return;
    const sgId = getCleanSubgraphId();
    let code = getCurrentCode();
    const def = findSubgraphDefinition(code, sgId);
    if (!def) return;
    if (subgraphTitle.trim()) {
      const lines = code.split('\n');
      lines[def.lineIndex] = lines[def.lineIndex].replace(
        /subgraph\s+\S+(?:\s*\[.*?\])?/,
        `subgraph ${def.subgraphId}[${subgraphTitle}]`
      );
      updateCodeStore({ code: lines.join('\n') });
    }
  }

  function applySubgraphDirection(dir: 'LR' | 'TB') {
    subgraphDirection = dir;
    if (!elementNodeId) return;
    const sgId = getCleanSubgraphId();
    let code = getCurrentCode();
    const def = findSubgraphDefinition(code, sgId);
    if (!def) return;
    const lines = code.split('\n');
    if (
      def.lineIndex + 1 < lines.length &&
      lines[def.lineIndex + 1].trim().match(/^direction\s+(LR|TB|RL|BT)$/)
    ) {
      lines[def.lineIndex + 1] = lines[def.lineIndex + 1].replace(
        /direction\s+\w+/,
        `direction ${dir}`
      );
    } else {
      lines.splice(def.lineIndex + 1, 0, `${def.indent}    direction ${dir}`);
    }
    updateCodeStore({ code: lines.join('\n') });
  }

  function applySubgraphFill(color: string) {
    const sgId = getCleanSubgraphId();
    if (!elementNodeId) return;
    let code = getCurrentCode();
    code = injectSubgraphStyle(code, sgId, { fill: color });
    updateCodeStore({ code });
    subgraphFillColor = color;
  }

  function applySubgraphTextColor(color: string) {
    if (!elementNodeId) return;
    const sgId = getCleanSubgraphId();
    let code = getCurrentCode();
    code = injectSubgraphStyle(code, sgId, { color });
    updateCodeStore({ code });
    subgraphTextColor = color;
  }

  function applySubgraphTextSize(size: 'sm' | 'md' | 'lg') {
    if (!elementNodeId) return;
    const sgId = getCleanSubgraphId();
    let code = getCurrentCode();
    code = injectSubgraphStyle(code, sgId, { fontSize: TEXT_SIZE_MAP[size] });
    updateCodeStore({ code });
    subgraphTextSize = size;
  }

  function applySubgraphFont(font: 'sans' | 'serif' | 'mono') {
    if (!elementNodeId) return;
    const sgId = getCleanSubgraphId();
    let code = getCurrentCode();
    code = injectSubgraphStyle(code, sgId, { fontFamily: FONT_MAP[font] });
    updateCodeStore({ code });
    subgraphFont = font;
  }

  function toggleSubgraphFilled() {
    subgraphFilled = !subgraphFilled;
    if (!elementNodeId) return;
    const sgId = getCleanSubgraphId();
    let code = getCurrentCode();
    if (subgraphFilled) {
      code = injectSubgraphStyle(code, sgId, { fill: subgraphFillColor });
    } else {
      code = injectSubgraphStyle(code, sgId, { fill: '#ffffff', stroke: subgraphFillColor });
    }
    updateCodeStore({ code });
  }

  // ── Event Handlers ──

  function handleElementSelected(e: CustomEvent) {
    const detail = e.detail;
    elementType = detail.elementType || null;
    elementLabel = detail.label || '';
    elementNodeId = detail.nodeId || '';
    elementEdgeIndex = detail.edgeIndex ?? -1;

    if (elementType === 'icon') {
      // Read actual label from mermaid code (not SVG-derived label)
      iconNodeLabel = readIconNodeLabel() || elementLabel || '';
      iconColorMode = 'original';
      // Try to extract icon src from the SVG element or mermaid code
      const el = detail.element as Element | undefined;
      if (el) {
        const img = el.querySelector('image');
        const svgIcon = el.querySelector('.icon-shape svg, .label-icon svg');
        if (img) {
          iconSrc = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
        } else if (svgIcon) {
          iconSrc = ''; // inline SVG icon, no external src
        } else {
          iconSrc = '';
        }
      } else {
        iconSrc = '';
      }
    }
    if (elementType === 'node') {
      nodeLabel = readNodeLabel() || elementLabel || '';
    }
    if (elementType === 'subgraph') {
      subgraphTitle = elementLabel;
    }
    if (elementType === 'edge') {
      // Read existing edge state from the mermaid code to restore toolbar
      if (elementEdgeIndex >= 0) {
        const code = getCurrentCode();
        // Read actual label text from code (not the SVG-derived "A → B" label)
        edgeLabel = getEdgeLabelText(code, elementEdgeIndex);
        // Read existing linkStyle properties
        const existingStyle = getEdgeStyle(code, elementEdgeIndex);
        if (existingStyle) {
          const sw = existingStyle.get('stroke-width');
          if (sw === EDGE_THICKNESS_MAP.thin) edgeThickness = 'thin';
          else if (sw === EDGE_THICKNESS_MAP.thick) edgeThickness = 'thick';
          else edgeThickness = 'normal';
          const sc = existingStyle.get('stroke');
          if (sc) edgeColor = sc;
          else edgeColor = '#6366f1';
        } else {
          edgeThickness = 'normal';
          edgeColor = '#6366f1';
        }
        // Read arrow type
        const arrow = getEdgeArrowType(code, elementEdgeIndex);
        if (arrow) {
          edgeArrowType = arrow as typeof edgeArrowType;
          edgeIsDashed = arrow === '-.->';
        } else {
          edgeArrowType = '-->';
          edgeIsDashed = false;
        }
      } else {
        edgeLabel = '';
        edgeThickness = 'normal';
        edgeColor = '#6366f1';
        edgeArrowType = '-->';
        edgeIsDashed = false;
      }
    }
  }

  function handleSelectionCleared() {
    elementType = null;
    elementLabel = '';
    elementNodeId = '';
    elementEdgeIndex = -1;
  }

  function dismiss() {
    elementType = null;
    window.dispatchEvent(new CustomEvent('selection-cleared'));
  }

  onMount(() => {
    window.addEventListener('element-selected', handleElementSelected as EventListener);
    window.addEventListener('selection-cleared', handleSelectionCleared);
    document.addEventListener('mousedown', handleClickOutside);
  });

  onDestroy(() => {
    window.removeEventListener('element-selected', handleElementSelected as EventListener);
    window.removeEventListener('selection-cleared', handleSelectionCleared);
    document.removeEventListener('mousedown', handleClickOutside);
  });

  // Active dropdown state
  let activeColorPicker = $state<
    'border' | 'fill' | 'text' | 'edge' | 'subgraph' | 'edgeText' | 'sgText' | 'iconColor' | null
  >(null);
  let showShapePicker = $state(false);
  let showIconDropdown = $state(false);
  let showFontPicker = $state<'node' | 'edge' | 'subgraph' | null>(null);
  let showArrowPicker = $state(false);

  function closeAllDropdowns() {
    activeColorPicker = null;
    showShapePicker = false;
    showIconDropdown = false;
    showFontPicker = null;
    showArrowPicker = false;
  }

  function handleClickOutside(e: MouseEvent) {
    if (toolbarRef && !toolbarRef.contains(e.target as Node)) {
      // If any dropdown is open, just close dropdowns first
      if (
        activeColorPicker ||
        showShapePicker ||
        showIconDropdown ||
        showFontPicker ||
        showArrowPicker
      ) {
        closeAllDropdowns();
      } else {
        // No dropdown open — dismiss the entire toolbar
        dismiss();
      }
    }
  }

  // Debounced update functions for real-time input
  let updateTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};

  function debouncedApplyEdgeLabel() {
    clearTimeout(updateTimeouts.edge);
    updateTimeouts.edge = setTimeout(() => applyEdgeLabel(), 300);
  }

  function debouncedApplyIconNodeLabel() {
    clearTimeout(updateTimeouts.icon);
    updateTimeouts.icon = setTimeout(() => applyIconNodeLabel(), 300);
  }

  function debouncedApplySubgraphTitle() {
    clearTimeout(updateTimeouts.subgraph);
    updateTimeouts.subgraph = setTimeout(() => applySubgraphTitle(), 100);
  }
  let canvasWidth = $state(9999);
  let canvasHeight = $state(9999);
  let toolbarRef: HTMLDivElement | undefined = $state(undefined);
  let isCompact = $derived(canvasWidth < 500);
  let isVertical = $derived(canvasHeight < 200);

  function updateCanvasDimensions() {
    if (toolbarRef?.parentElement) {
      canvasWidth = toolbarRef.parentElement.clientWidth;
      canvasHeight = toolbarRef.parentElement.clientHeight;
    }
  }

  $effect(() => {
    if (!toolbarRef) return;
    updateCanvasDimensions();
    const ro = new ResizeObserver(() => updateCanvasDimensions());
    if (toolbarRef.parentElement) ro.observe(toolbarRef.parentElement);
    return () => ro.disconnect();
  });

  // Shape icon map for the grid dropdown
  const shapeIconMap: Record<string, { icon: typeof RectangleHorizontal | null; text?: string }> = {
    circle: { icon: Circle },
    cylinder: { icon: null, text: '[(])' },
    flag: { icon: null, text: '> ]' },
    hexagon: { icon: Hexagon },
    rect: { icon: RectangleHorizontal },
    rhombus: { icon: Diamond },
    rounded: { icon: Square },
    stadium: { icon: null, text: '([])' },
    subroutine: { icon: null, text: '[[]]' },
    trapezoid: { icon: Triangle }
  };
</script>

{#snippet colorGrid(type: 'border' | 'fill' | 'text' | 'edge' | 'subgraph' | 'edgeText' | 'sgText')}
  {#if activeColorPicker === type}
    <div
      class="absolute bottom-full left-1/2 z-50 mb-2.5 w-56 -translate-x-1/2 rounded-xl border border-border bg-popover p-2.5 text-popover-foreground shadow-[0_4px_16px_var(--dash-card-shadow)]">
      <div class="mb-1.5 flex items-center justify-between">
        <span class="text-[10px] font-medium text-muted-foreground">
          {type === 'border'
            ? 'Border'
            : type === 'fill'
              ? 'Fill'
              : type === 'text'
                ? 'Text'
                : type === 'edge'
                  ? 'Edge'
                  : type === 'edgeText'
                    ? 'Label'
                    : type === 'sgText'
                      ? 'Text'
                      : 'Subgraph'} Color
        </span>
        <button
          type="button"
          class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onclick={() => (activeColorPicker = null)}>
          <X class="size-3" />
        </button>
      </div>
      <div class="grid grid-cols-9 gap-1">
        {#each type === 'fill' ? fillColors : type === 'subgraph' ? subgraphColors : colors as color (color)}
          <button
            type="button"
            class="size-5 rounded-full border border-border transition-all hover:scale-110 hover:ring-2 hover:ring-foreground/20"
            style="background-color: {color}"
            title={color}
            onclick={() => {
              if (type === 'border') applyNodeBorder(color);
              else if (type === 'fill') applyNodeFill(color);
              else if (type === 'text') applyNodeTextColor(color);
              else if (type === 'edge') applyEdgeColor(color);
              else if (type === 'edgeText') applyEdgeTextColor(color);
              else if (type === 'subgraph') applySubgraphFill(color);
              else if (type === 'sgText') applySubgraphTextColor(color);
              activeColorPicker = null;
            }}>
          </button>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet iconColorGrid()}
  {#if activeColorPicker === 'iconColor' && elementType === 'icon'}
    <div
      class="absolute bottom-full left-1/2 z-50 mb-2.5 w-56 -translate-x-1/2 rounded-xl border border-border bg-popover p-2.5 text-popover-foreground shadow-[0_4px_16px_var(--dash-card-shadow)]">
      <div class="mb-1.5 flex items-center justify-between">
        <span class="text-[10px] font-medium text-muted-foreground"> Icon Color </span>
        <button
          type="button"
          class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onclick={() => (activeColorPicker = null)}>
          <X class="size-3" />
        </button>
      </div>
      <div class="grid grid-cols-9 gap-1">
        {#each colors as color (color)}
          <button
            type="button"
            class="size-5 rounded-full border border-border transition-all hover:scale-110 hover:ring-2 hover:ring-foreground/20"
            style="background-color: {color}"
            title={color}
            onclick={() => {
              applyIconColor(color);
              activeColorPicker = null;
            }}>
          </button>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet fontDropdown(target: 'node' | 'edge' | 'subgraph')}
  {#if showFontPicker === target}
    <div
      class="absolute bottom-full left-1/2 z-50 mb-2.5 w-36 -translate-x-1/2 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_4px_16px_var(--dash-card-shadow)]">
      <div class="mb-1 flex items-center justify-between px-1">
        <span class="text-[10px] font-medium text-muted-foreground">Font</span>
        <button
          type="button"
          class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onclick={() => (showFontPicker = null)}>
          <X class="size-3" />
        </button>
      </div>
      {#each fonts as font (font.id)}
        {@const currentFont =
          target === 'node' ? nodeFont : target === 'edge' ? edgeFont : subgraphFont}
        <button
          type="button"
          class={cn(
            'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors',
            currentFont === font.id
              ? 'bg-accent font-medium text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          style="font-family: {font.id === 'sans'
            ? 'Inter, sans-serif'
            : font.id === 'serif'
              ? 'Georgia, serif'
              : 'Fira Code, monospace'}"
          onclick={() => {
            if (target === 'node') applyNodeFont(font.id);
            else if (target === 'edge') applyEdgeFont(font.id);
            else applySubgraphFont(font.id);
            showFontPicker = null;
          }}>
          {font.label}
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

{#if isVisible}
  <div
    bind:this={toolbarRef}
    class={cn(
      'absolute z-40 flex gap-1',
      isCompact || isVertical
        ? 'top-3 right-3 flex-col items-end'
        : 'right-0 bottom-8 left-0 mx-auto w-fit max-w-[95%] flex-col items-center'
    )}>
    <!-- Main toolbar -->
    <div
      class="relative z-40 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-popover px-3 py-2 text-popover-foreground shadow-[0_4px_16px_var(--dash-card-shadow)]">
      <!-- Type badge -->
      <span
        class="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase">
        {elementType}
      </span>
      <span class="max-w-[120px] truncate text-[11px] font-medium text-foreground/70"
        >{elementLabel}</span>
      <div class="mx-1 h-5 w-px bg-border"></div>

      <!-- ═══ NODE TOOLBAR ═══ -->
      {#if elementType === 'node'}
        <!-- Shape selector -->
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Change node shape"
            onclick={() => {
              const was = showShapePicker;
              closeAllDropdowns();
              showShapePicker = !was;
            }}>
            {#if shapeIconMap[nodeShape]?.icon}
              {@const ShapeIcon = shapeIconMap[nodeShape].icon}
              <ShapeIcon class="size-3.5" />
            {:else}
              <span class="font-mono text-[9px]">{shapeIconMap[nodeShape]?.text || '[]'}</span>
            {/if}
            <ChevronDown class="size-3" />
          </button>
          {#if showShapePicker}
            <div
              class="absolute bottom-full left-1/2 z-50 mb-2.5 w-72 -translate-x-1/2 rounded-xl border border-border bg-popover p-2.5 text-popover-foreground shadow-[0_4px_16px_var(--dash-card-shadow)]">
              <div class="mb-1.5 flex items-center justify-between">
                <span class="text-[10px] font-medium text-muted-foreground">Shape</span>
                <button
                  type="button"
                  class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  onclick={() => (showShapePicker = false)}><X class="size-3" /></button>
              </div>
              <div class="grid grid-cols-5 gap-1">
                {#each shapes as shape (shape.id)}
                  <button
                    type="button"
                    class={cn(
                      'flex flex-col items-center gap-1 rounded-md p-1.5 transition-colors',
                      nodeShape === shape.id
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent'
                    )}
                    title={shape.label}
                    onclick={() => {
                      applyNodeShape(shape);
                      showShapePicker = false;
                    }}>
                    {#if shapeIconMap[shape.id]?.icon}
                      {@const SIcon = shapeIconMap[shape.id].icon}
                      <SIcon class="size-4" />
                    {:else}
                      <span class="font-mono text-[8px] leading-none"
                        >{shapeIconMap[shape.id]?.text || shape.syntax[0] + shape.syntax[1]}</span>
                    {/if}
                    <span class="text-[7px] leading-none font-medium">{shape.label}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Node label edit -->
        <input
          type="text"
          name="node-label"
          class="h-7 w-28 rounded-lg border border-border bg-background px-2.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
          placeholder="Label..."
          value={nodeLabel}
          oninput={(e) => {
            const target = e.target as HTMLInputElement;
            if (target) {
              nodeLabel = target.value;
              debouncedApplyNodeLabel();
            }
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') applyNodeLabel();
          }}
          onblur={() => applyNodeLabel()} />

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Fill color -->
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Fill color"
            onclick={() => {
              const was = activeColorPicker === 'fill';
              closeAllDropdowns();
              if (!was) activeColorPicker = 'fill';
            }}>
            <div
              class="size-3.5 rounded-full border border-border/50"
              style="background-color: {nodeFillColor}">
            </div>
          </button>
          {@render colorGrid('fill')}
        </div>

        <!-- Border color -->
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Border color"
            onclick={() => {
              const was = activeColorPicker === 'border';
              closeAllDropdowns();
              if (!was) activeColorPicker = 'border';
            }}>
            <div class="size-3.5 rounded-full border-2" style="border-color: {nodeBorderColor}">
            </div>
          </button>
          {@render colorGrid('border')}
        </div>

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Text color -->
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Text color"
            onclick={() => {
              const was = activeColorPicker === 'text';
              closeAllDropdowns();
              if (!was) activeColorPicker = 'text';
            }}>
            <Type class="size-3.5" style="color: {nodeTextColor}" />
          </button>
          {@render colorGrid('text')}
        </div>

        <!-- Text size S/M/L -->
        <div class="flex items-center gap-0.5">
          {#each ['sm', 'md', 'lg'] as const as size (size)}
            <button
              type="button"
              class={cn(
                'rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors',
                nodeTextSize === size
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              )}
              title={size === 'sm' ? 'Small' : size === 'md' ? 'Medium' : 'Large'}
              onclick={() => applyNodeTextSize(size)}>
              {size === 'sm' ? 'S' : size === 'md' ? 'M' : 'L'}
            </button>
          {/each}
        </div>

        <!-- Font picker -->
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Font family"
            onclick={() => {
              const was = showFontPicker === 'node';
              closeAllDropdowns();
              if (!was) showFontPicker = 'node';
            }}>
            <span
              style="font-family: {nodeFont === 'sans'
                ? 'Inter, sans-serif'
                : nodeFont === 'serif'
                  ? 'Georgia, serif'
                  : 'Fira Code, monospace'}"
              class="text-[10px]">Aa</span>
            <ChevronDown class="size-2.5" />
          </button>
          {@render fontDropdown('node')}
        </div>

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Icon dropdown -->
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Attach icon"
            onclick={() => {
              const was = showIconDropdown;
              closeAllDropdowns();
              showIconDropdown = !was;
            }}>
            <ImageIcon class="size-3.5" />
            <ChevronDown class="size-2.5" />
          </button>
          {#if showIconDropdown}
            <div
              class="absolute right-0 bottom-full z-50 mb-2.5 w-48 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_4px_16px_var(--dash-card-shadow)]">
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                onclick={() => {
                  showIconDropdown = false;
                  window.dispatchEvent(
                    new CustomEvent('open-icon-panel', {
                      detail: { nodeId: elementNodeId, source: 'toolbar' }
                    })
                  );
                }}>
                <ImageIcon class="size-4" />
                <span>Browse Icons</span>
              </button>
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium text-destructive/80 transition-colors hover:bg-destructive/10 hover:text-destructive"
                onclick={() => {
                  showIconDropdown = false;
                  const nodeName = getCleanNodeName();
                  if (!nodeName) return;
                  let code = getCurrentCode();
                  const iconPattern = new RegExp(
                    `(${nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*@\\{\\s*(?:icon|img):\\s*"[^"]*"[^}]*\\}`,
                    'g'
                  );
                  code = code.replace(iconPattern, '$1');
                  updateCodeStore({ code });
                }}>
                <X class="size-4" />
                <span>Remove Icon</span>
              </button>
            </div>
          {/if}
        </div>

        <!-- ═══ EDGE TOOLBAR ═══ -->
      {:else if elementType === 'edge'}
        <!-- Edge label -->
        <input
          type="text"
          name="edge-label"
          class="h-7 w-28 rounded-lg border border-border bg-background px-2.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
          value={edgeLabel}
          oninput={(e) => {
            const target = e.target as HTMLInputElement;
            if (target) {
              edgeLabel = target.value;
              debouncedApplyEdgeLabel();
            }
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') applyEdgeLabel();
          }}
          onblur={() => applyEdgeLabel()} />

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Edge thickness (3 sizes) -->
        <div class="flex items-center gap-0.5">
          {#each ['thin', 'normal', 'thick'] as const as t (t)}
            <button
              type="button"
              class={cn(
                'rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors',
                edgeThickness === t
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              )}
              title={t === 'thin' ? 'Thin line' : t === 'normal' ? 'Normal line' : 'Thick line'}
              onclick={() => applyEdgeThickness(t)}>
              <div class="flex items-center justify-center" style="width: 16px; height: 12px;">
                <div
                  class="w-full rounded-full bg-current"
                  style="height: {t === 'thin' ? '1px' : t === 'normal' ? '2px' : '4px'}">
                </div>
              </div>
            </button>
          {/each}
        </div>

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Arrow direction picker -->
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Arrow direction"
            onclick={() => {
              const was = showArrowPicker;
              closeAllDropdowns();
              showArrowPicker = !was;
            }}>
            {#if edgeArrowType === '-->'}
              <ArrowRight class="size-3.5" />
            {:else if edgeArrowType === '<-->'}
              <ArrowLeftRight class="size-3.5" />
            {:else if edgeArrowType === '---'}
              <Minus class="size-3.5" />
            {:else}
              <span class="font-mono text-[9px]">{edgeArrowType}</span>
            {/if}
            <ChevronDown class="size-2.5" />
          </button>
          {#if showArrowPicker}
            <div
              class="absolute bottom-full left-1/2 z-50 mb-2.5 w-36 -translate-x-1/2 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_4px_16px_var(--dash-card-shadow)]">
              <div class="mb-1 flex items-center justify-between px-1">
                <span class="text-[10px] font-medium text-muted-foreground">Arrow</span>
                <button
                  type="button"
                  class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  onclick={() => (showArrowPicker = false)}><X class="size-3" /></button>
              </div>
              {#each arrowTypes as arrow (arrow.id)}
                <button
                  type="button"
                  class={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] transition-colors',
                    edgeArrowType === arrow.id
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                  onclick={() => {
                    applyEdgeArrowType(arrow.id);
                    showArrowPicker = false;
                  }}>
                  {#if arrow.icon}
                    {@const AIcon = arrow.icon}
                    <AIcon class="size-3.5" />
                  {:else}
                    <span class="font-mono text-[9px]">{arrow.id}</span>
                  {/if}
                  {arrow.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Dash toggle -->
        <button
          type="button"
          class={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
            edgeIsDashed ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'
          )}
          title={edgeIsDashed ? 'Make solid' : 'Make dashed'}
          onclick={toggleEdgeDash}>
          <Minus class="size-3.5" />
        </button>

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Edge color -->
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Edge color"
            onclick={() => {
              const was = activeColorPicker === 'edge';
              closeAllDropdowns();
              if (!was) activeColorPicker = 'edge';
            }}>
            <div
              class="size-3.5 rounded-full border border-border/50"
              style="background-color: {edgeColor}">
            </div>
          </button>
          {@render colorGrid('edge')}
        </div>

        <!-- Label text color (visual only - Mermaid linkStyle limitation) -->
        <div class="relative">
          <button
            type="button"
            class="flex cursor-not-allowed items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground/40"
            title="Label text color (not supported by Mermaid linkStyle)"
            disabled>
            <Type class="size-3.5" style="color: {edgeTextColor}" />
          </button>
        </div>

        <!-- ═══ ICON TOOLBAR ═══ -->
      {:else if elementType === 'icon'}
        <!-- Icon preview + Change -->
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-accent"
          title="Change icon"
          onclick={() => {
            window.dispatchEvent(
              new CustomEvent('open-icon-panel', {
                detail: { nodeId: elementNodeId, source: 'toolbar' }
              })
            );
          }}>
          {#if iconSrc}
            <div class="flex size-7 items-center justify-center rounded-md bg-muted/50">
              <img src={iconSrc} alt="icon" class="size-5 object-contain" />
            </div>
          {:else}
            <div class="flex size-7 items-center justify-center rounded-md bg-muted/50">
              <ImageIcon class="size-4 text-muted-foreground" />
            </div>
          {/if}
          <span class="text-[10px] font-medium text-muted-foreground">Change</span>
        </button>

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Editable node label -->
        <input
          type="text"
          name="icon-label"
          class="h-7 w-36 rounded-lg border border-border bg-background px-2.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
          placeholder="Label..."
          value={iconNodeLabel}
          oninput={(e) => {
            const target = e.target as HTMLInputElement;
            if (target) {
              iconNodeLabel = target.value;
              debouncedApplyIconNodeLabel();
            }
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') applyIconNodeLabel();
          }}
          onblur={() => applyIconNodeLabel()} />

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Color mode toggle: Original / Simple -->
        <div class="flex items-center rounded-lg border border-border">
          <button
            type="button"
            class={cn(
              'rounded-l-lg px-2.5 py-1 text-[10px] font-medium transition-colors',
              iconColorMode === 'original'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title="Original colors"
            onclick={() => applyIconOriginal()}>Original</button>
          <button
            type="button"
            class={cn(
              'rounded-r-lg px-2.5 py-1 text-[10px] font-medium transition-colors',
              iconColorMode === 'simple'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title="Colorize icon"
            onclick={() => {
              iconColorMode = 'simple';
              applyIconColor(iconColor);
            }}>Simple</button>
        </div>

        <!-- Icon color picker (only in Simple mode) -->
        {#if iconColorMode === 'simple'}
          <div class="relative">
            <button
              type="button"
              class="flex items-center gap-1 rounded-lg px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="Icon color"
              onclick={() => {
                const was = activeColorPicker === 'iconColor';
                closeAllDropdowns();
                if (!was) activeColorPicker = 'iconColor';
              }}>
              <div
                class="size-4 rounded-full border border-border"
                style="background-color: {iconColor}">
              </div>
            </button>
            {@render iconColorGrid()}
          </div>
        {/if}

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Delete icon (at end) -->
        <button
          type="button"
          class="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
          title="Remove icon"
          onclick={() => {
            const nodeName = getCleanNodeName();
            if (!nodeName) return;
            let code = getCurrentCode();
            const iconPattern = new RegExp(
              `(${nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*@\\{\\s*(?:icon|img):\\s*"[^"]*"[^}]*\\}`,
              'g'
            );
            code = code.replace(iconPattern, '$1');
            updateCodeStore({ code });
          }}>
          <X class="size-3.5" />
        </button>

        <!-- ═══ SUBGRAPH TOOLBAR ═══ -->
      {:else if elementType === 'subgraph'}
        <!-- Title edit -->
        <input
          type="text"
          name="subgraph-title"
          class="h-6 w-28 rounded-md border border-border bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
          placeholder="Title..."
          value={subgraphTitle}
          oninput={(e) => {
            const target = e.target as HTMLInputElement;
            if (target) {
              subgraphTitle = target.value;
              debouncedApplySubgraphTitle();
            }
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') applySubgraphTitle();
          }}
          onblur={() => applySubgraphTitle()} />

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Subgraph fill color (border auto-derived) -->
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Fill color (border auto)"
            onclick={() => {
              const was = activeColorPicker === 'subgraph';
              closeAllDropdowns();
              if (!was) activeColorPicker = 'subgraph';
            }}>
            <div
              class="size-3.5 rounded-full border border-border/50"
              style="background-color: {subgraphFillColor}">
            </div>
          </button>
          {@render colorGrid('subgraph')}
        </div>

        <!-- Filled / Outline toggle -->
        <button
          type="button"
          class={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
            subgraphFilled ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'
          )}
          title={subgraphFilled ? 'Switch to outline' : 'Switch to filled'}
          onclick={toggleSubgraphFilled}>
          {subgraphFilled ? 'Filled' : 'Outline'}
        </button>

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Subgraph text color -->
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Text color"
            onclick={() => {
              const was = activeColorPicker === 'sgText';
              closeAllDropdowns();
              if (!was) activeColorPicker = 'sgText';
            }}>
            <Type class="size-3.5" style="color: {subgraphTextColor}" />
          </button>
          {@render colorGrid('sgText')}
        </div>

        <!-- Text size S/M/L -->
        <div class="flex items-center gap-0.5">
          {#each ['sm', 'md', 'lg'] as const as size (size)}
            <button
              type="button"
              class={cn(
                'rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors',
                subgraphTextSize === size
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              )}
              title={size === 'sm' ? 'Small' : size === 'md' ? 'Medium' : 'Large'}
              onclick={() => applySubgraphTextSize(size)}>
              {size === 'sm' ? 'S' : size === 'md' ? 'M' : 'L'}
            </button>
          {/each}
        </div>

        <!-- Font picker -->
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Font family"
            onclick={() => {
              const was = showFontPicker === 'subgraph';
              closeAllDropdowns();
              if (!was) showFontPicker = 'subgraph';
            }}>
            <span
              style="font-family: {subgraphFont === 'sans'
                ? 'Inter, sans-serif'
                : subgraphFont === 'serif'
                  ? 'Georgia, serif'
                  : 'Fira Code, monospace'}"
              class="text-[10px]">Aa</span>
            <ChevronDown class="size-2.5" />
          </button>
          {@render fontDropdown('subgraph')}
        </div>

        <div class="mx-1 h-5 w-px bg-border"></div>

        <!-- Direction toggle -->
        <div class="flex items-center gap-0.5">
          <button
            type="button"
            class={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
              subgraphDirection === 'LR'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
            title="Left to Right"
            onclick={() => applySubgraphDirection('LR')}>
            <ArrowRight class="size-3.5" />
          </button>
          <button
            type="button"
            class={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
              subgraphDirection === 'TB'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
            title="Top to Bottom"
            onclick={() => applySubgraphDirection('TB')}>
            <ArrowDown class="size-3.5" />
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
