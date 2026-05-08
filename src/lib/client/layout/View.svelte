<script lang="ts">
  import {
    removeIconStylesFromSvg,
    render as renderDiagram,
    reprocessIconTheme
  } from '$lib/client/features/diagram/mermaid';
  import { PanZoomState } from '$lib/client/features/diagram/panZoom';
  import type { State, ValidatedState } from '$lib/client/types';
  import { recordRenderTime, setTrailingCallback, shouldRefreshView } from '$lib/client/util/autoSync';
  import { findNodeDefinition, svgIdToNodeName } from '$lib/client/util/diagram/diagramMapper';
  import { inputStateStore, stateStore, updateCodeStore } from '$lib/client/util/state/state';
  import { logEvent, saveStatistics } from '$lib/client/util/stats';
  import FontAwesome, { mayContainFontAwesome } from '$lib/client/features/diagram/components/FontAwesome.svelte';
  import type { MermaidConfig } from 'mermaid';
  import { mode } from 'mode-watcher';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { Svg2Roughjs } from 'svg2roughjs';

  let {
    panZoomState = new PanZoomState(),
    shouldShowGrid = true,
    gridStyle = 'dots' as 'dots' | 'squares',
    isRendering = $bindable(false),
    renderError = $bindable('')
  }: {
    panZoomState?: PanZoomState;
    shouldShowGrid?: boolean;
    gridStyle?: 'dots' | 'squares';
    isRendering?: boolean;
    renderError?: string;
  } = $props();
  let code = '';
  let config = '';
  let container: HTMLDivElement | undefined;
  let rough = false;
  let view: HTMLDivElement | undefined;
  let error = $state(false);
  let panZoom = true;
  let manualUpdate = true;
  let waitForFontAwesomeToLoad = $state<FontAwesome['waitForFontAwesomeToLoad'] | undefined>(
    undefined
  );
  let activeTool: 'select' | 'pan' | 'draw' = 'select';
  let isDrawing = false;
  let currentPath = '';
  let previousMode: 'light' | 'dark' | undefined;

  // Selection state — supports multi-selection of same element types
  let selectedNodeIds = $state<string[]>([]);
  let selectedEdgeIds = $state<string[]>([]);
  let selectionRects: SVGRectElement[] = [];
  let hoveredEdge: Element | null = null;

  // Inline editor state for double-click to edit
  let inlineEditorVisible = $state(false);
  let inlineEditorValue = $state('');
  let inlineEditorNodeId = $state('');
  let inlineEditorPos = $state({ x: 0, y: 0 });
  let inlineEditorRef: HTMLInputElement | undefined = $state(undefined);

  // Keep single-value aliases for backward compat with events
  let selectedNodeId = $derived(
    selectedNodeIds.length > 0 ? selectedNodeIds[selectedNodeIds.length - 1] : null
  );
  let selectedEdgeId = $derived(
    selectedEdgeIds.length > 0 ? selectedEdgeIds[selectedEdgeIds.length - 1] : null
  );

  // Re-render diagram when mode changes
  $effect(() => {
    const currentMode = get(mode);
    if (previousMode !== undefined && previousMode !== currentMode) {
      // Immediately reprocess icon colors on the existing SVG
      // This provides instant visual feedback before the full re-render
      if (container) {
        const svg = container.querySelector('svg') as SVGSVGElement;
        if (svg) {
          reprocessIconTheme(svg, currentMode === 'dark');
        }
      }
      // Force re-render by triggering updateDiagram
      updateCodeStore({ updateDiagram: true });
    }
    previousMode = currentMode;
  });

  // Set up panZoom state observer to update the store when pan/zoom changes
  // Use inputStateStore.update directly (NOT updateCodeStore) to avoid
  // incrementing renderCount and triggering the full state pipeline
  const setupPanZoomObserver = () => {
    panZoomState.onPanZoomChange = (pan, zoom) => {
      inputStateStore.update((s) => ({ ...s, pan, zoom }));
      logEvent('panZoom');
    };
  };

  const handlePanZoom = (state: State, graphDiv: SVGSVGElement) => {
    try {
      panZoomState.updateElement(graphDiv, state);
    } catch (error) {
      console.error('PanZoom error:', error);
    }
  };

  const formatJSON = (obj: any): string => {
    return JSON.stringify(obj, null, 2);
  };

  const updateCursor = () => {
    if (!view) return;

    switch (activeTool) {
      case 'select':
        view.style.cursor = 'default';
        break;
      case 'pan':
        view.style.cursor = 'grab';
        break;
      case 'draw':
        view.style.cursor = 'crosshair';
        break;
    }
  };

  // Clear any existing selection visuals
  const clearSelection = () => {
    for (const r of selectionRects) r.remove();
    selectionRects = [];
    const svg = container?.querySelector('svg');
    if (svg) {
      svg.querySelectorAll('.graphini-selection-rect').forEach((el) => el.remove());
      svg.querySelectorAll('.graphini-selected').forEach((el) => {
        if (el.tagName === 'path' || el.tagName === 'line') {
          (el as SVGElement).style.strokeWidth = '';
          (el as SVGElement).style.stroke = '';
        }
        el.classList.remove('graphini-selected');
      });
    }
    selectedNodeIds = [];
    selectedEdgeIds = [];
  };

  // Strip common mermaid prefixes from node IDs to get clean name
  const cleanNodeId = (raw: string): string => {
    // Strip prefixes like 'flowchart-', 'flowchart-v2-', 'stateDiagram-', etc.
    return raw
      .replace(/^flowchart-v2-/, '')
      .replace(/^flowchart-/, '')
      .replace(/^stateDiagram-/, '')
      .replace(/^classDiagram-/, '')
      .replace(/^er-/, '')
      .replace(/-\d+$/, ''); // strip trailing numeric suffix like -0
  };

  // Extract a readable label from a node element
  const getNodeLabel = (nodeG: Element): string => {
    // Prefer .nodeLabel spans (mermaid's canonical label element)
    const nodeLabels = nodeG.querySelectorAll('.nodeLabel');
    if (nodeLabels.length > 0) {
      const label = Array.from(nodeLabels)
        .map((t) => t.textContent?.trim())
        .filter(Boolean)
        .join(' ');
      if (label) return label;
    }
    // Fallback: direct text elements only (not nested inside foreignObject to avoid dupes)
    const texts = nodeG.querySelectorAll(':scope > text, :scope > g > text');
    if (texts.length > 0) {
      const label = Array.from(texts)
        .map((t) => t.textContent?.trim())
        .filter(Boolean)
        .join(' ');
      if (label) return label;
    }
    // Fallback to cleaned id
    const rawId = nodeG.id || nodeG.getAttribute('data-id') || '';
    return rawId ? cleanNodeId(rawId) : 'Node';
  };

  // Add selection rectangle around a node. addToSelection=true for multi-select.
  const selectNode = (nodeEl: Element, addToSelection = false) => {
    if (!addToSelection) {
      clearSelection();
    } else if (selectedEdgeIds.length > 0) {
      // Can't mix types — clear edges if adding nodes
      clearSelection();
    }
    const svg = container?.querySelector('svg');
    if (!svg) return;

    // Try standard selectors first, fall back to the element itself
    // (handleDiagramClick may have already resolved icon nodes via DOM walk)
    const nodeG =
      nodeEl.closest('g.node:not(.nodes)') ||
      nodeEl.closest('g.nodeGroup') ||
      nodeEl.closest('g[class~="node"]') ||
      nodeEl.closest('g.cluster') ||
      (nodeEl.tagName === 'g' ? nodeEl : null);
    if (!nodeG) return;

    const nodeLabel = getNodeLabel(nodeG);
    const rawId = nodeG.id || nodeG.getAttribute('data-id') || '';
    const nodeId = rawId || nodeLabel;

    // Toggle off if already selected
    if (addToSelection && selectedNodeIds.includes(nodeId)) {
      selectedNodeIds = selectedNodeIds.filter((id) => id !== nodeId);
      // Remove its selection rect
      svg
        .querySelectorAll(`.graphini-selection-rect[data-node-id="${nodeId}"]`)
        .forEach((el) => el.remove());
      nodeG.classList.remove('graphini-selected');
      selectionRects = selectionRects.filter((r) => r.getAttribute('data-node-id') !== nodeId);
      window.dispatchEvent(
        new CustomEvent('node-selected', {
          detail: {
            nodeId: selectedNodeIds[selectedNodeIds.length - 1] ?? null,
            nodeIds: selectedNodeIds,
            label: nodeLabel
          }
        })
      );
      if (selectedNodeIds.length === 0) {
        window.dispatchEvent(new CustomEvent('selection-cleared'));
      }
      return;
    }

    selectedNodeIds = [...selectedNodeIds, nodeId];

    // Use getBBox to get node bounds, then transform to viewport group coords
    const svgEl = svg as SVGSVGElement;
    const nodeGEl = nodeG as SVGGraphicsElement;
    const bbox = nodeGEl.getBBox?.();
    if (!bbox) return;

    // Get the viewport group (where we'll append the rect)
    const viewportG = svgEl.querySelector('.svg-pan-zoom_viewport') as SVGGraphicsElement | null;

    // Get CTMs to transform node-local coords to viewport-group coords
    const ctm = nodeGEl.getCTM();
    const vpCtm = viewportG?.getCTM?.() || svgEl.getCTM?.();
    if (!ctm || !vpCtm) return;

    // Transform bbox corners to viewport group coordinate space
    const svgPoint = svgEl.createSVGPoint();
    const vpCtmInv = vpCtm.inverse();
    const toViewport = vpCtmInv.multiply(ctm);

    svgPoint.x = bbox.x;
    svgPoint.y = bbox.y;
    const topLeft = svgPoint.matrixTransform(toViewport);

    svgPoint.x = bbox.x + bbox.width;
    svgPoint.y = bbox.y + bbox.height;
    const bottomRight = svgPoint.matrixTransform(toViewport);

    const pad = 8;
    const rx = Math.min(topLeft.x, bottomRight.x);
    const ry = Math.min(topLeft.y, bottomRight.y);
    const rw = Math.abs(bottomRight.x - topLeft.x);
    const rh = Math.abs(bottomRight.y - topLeft.y);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(rx - pad));
    rect.setAttribute('y', String(ry - pad));
    rect.setAttribute('width', String(rw + pad * 2));
    rect.setAttribute('height', String(rh + pad * 2));
    rect.setAttribute('fill', '#6366f1');
    rect.setAttribute('fill-opacity', '0.06');
    rect.setAttribute('stroke', '#6366f1');
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('rx', '0');
    rect.setAttribute('ry', '0');
    rect.setAttribute('data-node-id', nodeId);
    rect.classList.add('graphini-selection-rect');
    rect.style.pointerEvents = 'none';

    // Append to the pan-zoom viewport group so it moves with pan/zoom
    const viewport = svgEl.querySelector('.svg-pan-zoom_viewport') || svgEl;
    viewport.appendChild(rect);
    selectionRects = [...selectionRects, rect];
    nodeG.classList.add('graphini-selected');

    window.dispatchEvent(
      new CustomEvent('node-selected', {
        detail: { bbox, element: nodeG, label: nodeLabel, nodeId, nodeIds: selectedNodeIds }
      })
    );
  };

  // Find the specific edge path element
  // Mermaid renders edges as <path data-edge="true"> with classes like edge-thickness-normal
  // directly inside g.edgePaths — NOT wrapped in g.edge groups
  const findEdgePath = (el: Element): SVGPathElement | null => {
    // If the element is a hit area, resolve to the actual edge path (next sibling)
    if (el.classList.contains('graphini-edge-hitarea')) {
      const next = el.nextElementSibling;
      if (next && next.tagName === 'path') return next as SVGPathElement;
    }
    // If the element itself is an edge path (not a hit area)
    if (
      el.tagName === 'path' &&
      !el.classList.contains('graphini-edge-hitarea') &&
      (el.hasAttribute('data-edge') || el.hasAttribute('data-et'))
    ) {
      return el as SVGPathElement;
    }
    // Check if it's a marker/arrowhead inside an edge path's defs
    const cls = el.getAttribute('class') || '';
    if (cls.includes('edge-thickness') || cls.includes('edge-pattern')) {
      return el as SVGPathElement;
    }
    // Walk up to check if we clicked on a child of an edge path (e.g. marker)
    let current: Element | null = el;
    while (current && current.tagName !== 'svg') {
      // Resolve hit areas
      if (current.classList.contains('graphini-edge-hitarea')) {
        const next = current.nextElementSibling;
        if (next && next.tagName === 'path') return next as SVGPathElement;
      }
      if (
        current.tagName === 'path' &&
        !current.classList.contains('graphini-edge-hitarea') &&
        (current.hasAttribute('data-edge') || current.hasAttribute('data-et'))
      ) {
        return current as SVGPathElement;
      }
      // Also check for edge class patterns on path elements
      const c = current.getAttribute('class') || '';
      if (
        current.tagName === 'path' &&
        !current.classList.contains('graphini-edge-hitarea') &&
        (c.includes('edge-thickness') || c.includes('edge-pattern'))
      ) {
        return current as SVGPathElement;
      }
      current = current.parentElement;
    }
    return null;
  };

  // Get edge index by counting among all edge paths in the SVG
  const getEdgeIndex = (edgePath: Element): number => {
    const svg = container?.querySelector('svg');
    if (!svg) return -1;
    // Select all edge paths — mermaid marks them with data-edge or edge-thickness classes
    const allEdgePaths = Array.from(
      svg.querySelectorAll('path[data-edge], path[data-et="edge"]')
    ).filter((p) => !p.classList.contains('graphini-edge-hitarea'));
    let idx = allEdgePaths.indexOf(edgePath);
    if (idx >= 0) return idx;
    // Fallback: match by class pattern
    const allByClass = Array.from(svg.querySelectorAll('path')).filter((p) => {
      const c = p.getAttribute('class') || '';
      return c.includes('edge-thickness');
    });
    idx = allByClass.indexOf(edgePath as unknown as SVGPathElement);
    return idx >= 0 ? idx : -1;
  };

  // Build a readable edge label from data-id (e.g. "L_A_B_0" → "A → B")
  const getEdgeLabel = (edgePath: SVGPathElement): string => {
    const dataId = edgePath.getAttribute('data-id') || '';
    // Mermaid edge data-id patterns: "L_NodeA_NodeB_0", "L-NodeA-NodeB-0", "flowchart-NodeA-NodeB-0"
    const parts = dataId.split(/[-_]/);
    if (parts.length >= 3) {
      // Filter out common prefixes and trailing index
      const filtered = parts.filter(
        (p) => p !== 'L' && p !== 'flowchart' && p !== '' && !/^\d+$/.test(p)
      );
      if (filtered.length >= 2) {
        return `${filtered[0]} → ${filtered[1]}`;
      }
      if (filtered.length === 1) return filtered[0];
    }
    // Fallback: try to find edge label text near this edge
    const svg = container?.querySelector('svg');
    if (svg) {
      const edgeIndex = getEdgeIndex(edgePath);
      const edgeLabels = svg.querySelectorAll('g.edgeLabels .edgeLabel');
      if (edgeLabels[edgeIndex]) {
        const text = edgeLabels[edgeIndex].textContent?.trim();
        if (text) return text;
      }
    }
    return dataId || `Edge #${getEdgeIndex(edgePath) + 1}`;
  };

  // Select an edge. addToSelection=true for multi-select.
  const selectEdge = (edgePath: SVGPathElement, addToSelection = false) => {
    if (!addToSelection) {
      clearSelection();
    } else if (selectedNodeIds.length > 0) {
      clearSelection();
    }

    const edgeId = edgePath.getAttribute('data-id') || edgePath.id || 'Edge';
    const edgeIndex = getEdgeIndex(edgePath);
    const edgeLabel = getEdgeLabel(edgePath);

    // Toggle off if already selected
    if (addToSelection && selectedEdgeIds.includes(edgeId)) {
      selectedEdgeIds = selectedEdgeIds.filter((id) => id !== edgeId);
      edgePath.style.strokeWidth = '';
      edgePath.style.stroke = '';
      edgePath.classList.remove('graphini-selected');
      if (selectedEdgeIds.length === 0) {
        window.dispatchEvent(new CustomEvent('selection-cleared'));
      }
      return;
    }

    selectedEdgeIds = [...selectedEdgeIds, edgeId];

    edgePath.style.strokeWidth = '3';
    edgePath.style.stroke = '#6366f1';
    edgePath.classList.add('graphini-selected');

    window.dispatchEvent(
      new CustomEvent('edge-selected', {
        detail: { edgeId, edgeIds: selectedEdgeIds, edgeIndex, element: edgePath, label: edgeLabel }
      })
    );
  };

  // Edge hover handlers
  const handleEdgeHover = (e: MouseEvent) => {
    if (activeTool !== 'select') return;
    const target = e.target as Element;
    const edgePath = findEdgePath(target);

    if (edgePath) {
      if (edgePath !== hoveredEdge) {
        // Remove previous hover styling
        if (hoveredEdge && !hoveredEdge.classList.contains('graphini-selected')) {
          (hoveredEdge as SVGElement).style.strokeWidth = '';
        }
        hoveredEdge = edgePath;
        // Bold on hover (only if not already selected)
        if (!edgePath.classList.contains('graphini-selected')) {
          edgePath.style.strokeWidth = '3';
        }
      }
    } else {
      // Mouse left edge area — reset previous hover
      if (hoveredEdge && !hoveredEdge.classList.contains('graphini-selected')) {
        (hoveredEdge as SVGElement).style.strokeWidth = '';
      }
      hoveredEdge = null;
    }
  };

  const setupCanvasInteractions = () => {
    if (!view) return;

    let isDrawing = false;
    let startX = 0;
    let startY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      if (activeTool === 'draw' && view) {
        isDrawing = true;
        startX = e.clientX;
        startY = e.clientY;
        view.style.cursor = 'crosshair';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      // Edge hover effect
      handleEdgeHover(e);

      if (isDrawing && activeTool === 'draw') {
        const currentX = e.clientX;
        const currentY = e.clientY;
      }
    };

    const handleMouseUp = () => {
      if (isDrawing) {
        isDrawing = false;
        updateCursor();
      }
    };

    view.addEventListener('mousedown', handleMouseDown);
    view.addEventListener('mousemove', handleMouseMove);
    view.addEventListener('mouseup', handleMouseUp);
    view.addEventListener('mouseleave', handleMouseUp);

    return () => {
      view?.removeEventListener('mousedown', handleMouseDown);
      view?.removeEventListener('mousemove', handleMouseMove);
      view?.removeEventListener('mouseup', handleMouseUp);
      view?.removeEventListener('mouseleave', handleMouseUp);
    };
  };

  const handleStateChange = async (state: ValidatedState) => {
    const startTime = Date.now();
    // Don't show errors for empty diagrams
    if (state.error !== undefined && state.code && state.code.trim().length > 0) {
      error = true;
      renderError = typeof state.error === 'string' ? state.error : 'Diagram has syntax errors';
      return;
    }
    error = false;
    renderError = '';
    let diagramType: string | undefined;
    try {
      if (container) {
        manualUpdate = true;
        // Do not render if there is no change in Code/Config/PanZoom
        if (
          code === state.code &&
          config === state.mermaid &&
          rough === state.rough &&
          panZoom === state.panZoom &&
          !state.updateDiagram
        ) {
          return;
        }

        if (!shouldRefreshView()) {
          return;
        }

        isRendering = true;

        // Reset updateDiagram flag directly (avoid updateCodeStore to prevent renderCount increment)
        if (state.updateDiagram) {
          inputStateStore.update((s) => ({ ...s, updateDiagram: false }));
        }

        code = state.code;
        config = state.mermaid;
        rough = state.rough;
        panZoom = state.panZoom ?? true;

        if (mayContainFontAwesome(code)) {
          await waitForFontAwesomeToLoad?.();
        }

        // Clear container if code is empty — no error for empty diagrams
        if (!code || code.trim().length === 0) {
          if (container) {
            container.innerHTML = '';
          }
          code = '';
          error = false;
          renderError = '';
          isRendering = false;
          return;
        }

        const scroll = view?.parentElement?.scrollTop;
        delete container.dataset.processed;
        const viewID = `graph-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        // Apply correct mermaid theme based on current mode
        const mermaidConfig = JSON.parse(state.mermaid) as MermaidConfig;

        const {
          svg,
          bindFunctions,
          diagramType: detectedDiagramType
        } = await renderDiagram(mermaidConfig, code, viewID);
        diagramType = detectedDiagramType;
        if (svg.length > 0) {
          // eslint-disable-next-line svelte/no-dom-manipulating
          container.innerHTML = svg;
          let graphDiv = document.querySelector<SVGSVGElement>(`#${viewID}`);
          if (!graphDiv) {
            throw new Error('graph-div not found');
          }
          if (state.rough) {
            const svg2roughjs = new Svg2Roughjs('#container');
            svg2roughjs.svg = graphDiv;
            await svg2roughjs.sketch();
            graphDiv.remove();
            const sketch = document.querySelector<SVGSVGElement>('#container > svg');
            if (!sketch) {
              throw new Error('sketch not found');
            }
            const height = sketch.getAttribute('height');
            const width = sketch.getAttribute('width');
            sketch.setAttribute('id', 'graph-div');
            sketch.setAttribute('height', '100%');
            sketch.setAttribute('width', '100%');
            sketch.setAttribute('viewBox', `0 0 ${width} ${height}`);
            sketch.style.maxWidth = '100%';
            graphDiv = sketch;
          } else {
            graphDiv.setAttribute('height', '100%');
            graphDiv.style.maxWidth = '100%';
            if (bindFunctions) {
              bindFunctions(graphDiv);
            }
          }
          if (state.panZoom) {
            handlePanZoom(state, graphDiv);
          }

          // Remove icon-related CSS rules from the SVG style tag
          // Pass current mode explicitly to avoid timing issues with DOM class updates
          removeIconStylesFromSvg(graphDiv, get(mode) === 'dark');

          // Inject invisible wider hit areas behind edge paths for easier clicking
          const edgePaths = graphDiv.querySelectorAll(
            'path[data-edge], path[data-et="edge"], path[class*="edge-thickness"]'
          );
          edgePaths.forEach((ep) => {
            const hitArea = ep.cloneNode(false) as SVGPathElement;
            hitArea.setAttribute('stroke', 'transparent');
            hitArea.setAttribute('stroke-width', '30');
            hitArea.setAttribute('fill', 'none');
            hitArea.removeAttribute('marker-end');
            hitArea.removeAttribute('marker-start');
            hitArea.style.pointerEvents = 'stroke';
            hitArea.style.cursor = 'pointer';
            hitArea.classList.add('graphini-edge-hitarea');
            // Copy data attributes so findEdgePath can resolve it
            for (const attr of ['data-edge', 'data-et', 'data-id']) {
              if (ep.hasAttribute(attr)) hitArea.setAttribute(attr, ep.getAttribute(attr)!);
            }
            ep.parentElement?.insertBefore(hitArea, ep);
          });
        }
        if (view?.parentElement && scroll) {
          view.parentElement.scrollTop = scroll;
        }
        error = false;
        renderError = '';
        isRendering = false;
      } else if (manualUpdate) {
        manualUpdate = false;
      }
    } catch (error_) {
      isRendering = false;
      // Remove any stray mermaid error bomb SVGs that leaked into the visible DOM
      document
        .querySelectorAll('[aria-roledescription="error"]')
        .forEach((el) => el.closest('[id^="d"]')?.remove());
      // Keep last valid SVG visible to prevent layout shift — only clear if no SVG exists
      if (container && !container.querySelector('svg')) {
        container.innerHTML = '';
      }
      // Handle ELK layout errors with dagre fallback (with loop guard)
      if (code && code.trim().length > 0) {
        const errorMsg = error_.message || '';
        if (errorMsg.includes('elk') || errorMsg.includes('ELK')) {
          try {
            const fallbackConfig = JSON.parse(state.mermaid) as MermaidConfig;
            if (fallbackConfig.layout !== 'dagre') {
              fallbackConfig.layout = 'dagre';
              delete fallbackConfig.elk;
              updateCodeStore({ mermaid: formatJSON(fallbackConfig), updateDiagram: true });
            }
          } catch {
            // Fallback failed silently
          }
        }
      }
      error = true;
      renderError = error_.message || 'Failed to render diagram';
    }
    const renderTime = Date.now() - startTime;
    saveStatistics({ code, diagramType, isRough: state.rough, renderTime });
    // Record render time for throttling but use a no-op updater.
    // Re-renders are already triggered by code/config changes via the stateStore subscription.
    // Passing an updater that sets updateDiagram:true caused an infinite render loop.
    recordRenderTime(renderTime, () => {});
  };

  onMount(() => {
    setupPanZoomObserver();

    // Listen for tool changes
    const handleToolChange = (e: CustomEvent) => {
      activeTool = e.detail.tool;
      updateCursor();
      if (activeTool !== 'select') clearSelection();
    };

    // Listen for grid toggle
    const handleGridToggle = (e: CustomEvent) => {
      if (e.detail.visible !== undefined) shouldShowGrid = e.detail.visible;
      if (e.detail.style) gridStyle = e.detail.style;
    };

    // Listen for rough mode toggle
    const handleRoughToggle = (e: CustomEvent) => {
      rough = e.detail.enabled;
      manualUpdate = true;
    };

    window.addEventListener('tool-changed', handleToolChange as EventListener);
    window.addEventListener('grid-toggle', handleGridToggle as EventListener);
    window.addEventListener('rough-mode-toggle', handleRoughToggle as EventListener);

    // Fix canvas getting stuck when returning to tab
    // svg-pan-zoom loses internal matrix state when SVG has 0 dimensions (tab hidden)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Small delay to let the browser finish layout
        requestAnimationFrame(() => {
          try { panZoomState.resize(); } catch { /* svg may not exist yet */ }
          // Force a single re-render to restore the canvas
          updateCodeStore({ updateDiagram: true });
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Canvas drawing handlers
    if (view) {
      setupCanvasInteractions();
    }

    return () => {
      window.removeEventListener('tool-changed', handleToolChange as EventListener);
      window.removeEventListener('grid-toggle', handleGridToggle as EventListener);
      window.removeEventListener('rough-mode-toggle', handleRoughToggle as EventListener);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  // Queue state changes to avoid race condition
  let pendingStateChange = Promise.resolve();
  stateStore.subscribe((state) => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    pendingStateChange = pendingStateChange.then(() => handleStateChange(state).catch(() => {}));
  });

  // When a render is throttled, autoSync schedules a trailing fire so the
  // final state always lands on the canvas.
  setTrailingCallback(() => {
    const state = get(stateStore);
    pendingStateChange = pendingStateChange.then(() => handleStateChange(state).catch(() => {}));
  });

  // Inline editor: commit the label change to mermaid code
  const commitInlineEdit = () => {
    if (!inlineEditorVisible || !inlineEditorNodeId) return;
    const nodeName = svgIdToNodeName(inlineEditorNodeId);
    if (!nodeName || !inlineEditorValue.trim()) {
      inlineEditorVisible = false;
      return;
    }
    const code = get(inputStateStore).code || '';
    const def = findNodeDefinition(code, nodeName);
    if (!def) {
      inlineEditorVisible = false;
      return;
    }
    const lines = code.split('\n');
    const line = def.line;
    const iconAnnotation = line.match(/@\{[^}]*\}/)?.[0] || '';
    const lineWithoutIcon = line.replace(/@\{[^}]*\}/, '').trimEnd();
    const escaped = nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const labelRegex = new RegExp(
      `^(\\s*${escaped})(\\s*)([\\[\\(\\{<>]+)(.+?)([\\]\\)\\}>]+)(.*)`
    );
    const m = lineWithoutIcon.match(labelRegex);
    if (m) {
      const newLine = `${m[1]}${m[2]}${m[3]}${inlineEditorValue}${m[5]}${m[6]}${iconAnnotation ? ' ' + iconAnnotation : ''}`;
      lines[def.lineIndex] = newLine;
      updateCodeStore({ code: lines.join('\n') });
    }
    inlineEditorVisible = false;
  };

  const cancelInlineEdit = () => {
    inlineEditorVisible = false;
  };

  // Double-click handler: open inline editor on a node
  const handleDiagramDblClick = (e: MouseEvent) => {
    if (activeTool !== 'select') return;
    const target = e.target as Element;
    if (target.closest('[class*="panzoom"]') || target.closest('[class*="control"]')) return;

    // Find the node element
    let nodeEl =
      target.closest('g.node:not(.nodes)') ||
      target.closest('g.nodeGroup') ||
      target.closest('g[class~="node"]');
    if (!nodeEl) return;

    // Don't inline-edit subgraphs or edges
    if (nodeEl.classList.contains('cluster') || nodeEl.closest('g.cluster') === nodeEl) return;

    const rawId = nodeEl.id || nodeEl.getAttribute('data-id') || '';
    if (!rawId) return;

    // Get the label text
    const label = getNodeLabel(nodeEl);
    const nodeName = svgIdToNodeName(rawId);
    if (!nodeName) return;

    // Read actual label from mermaid code
    const code = get(inputStateStore).code || '';
    const def = findNodeDefinition(code, nodeName);
    if (!def) return;
    const clean = def.line.replace(/@\{[^}]*\}/, '').trimEnd();
    const escaped = nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = clean.match(new RegExp(`${escaped}\\s*[\\[\\(\\{<>]+(.+?)[\\]\\)\\}>]+`));
    const codeLabel = m ? m[1] : label;

    // Position the editor at the node's location
    const viewRect = view?.getBoundingClientRect();
    if (!viewRect) return;

    // Get node position in screen coords
    const svg = container?.querySelector('svg') as SVGSVGElement;
    if (!svg) return;
    const nodeGEl = nodeEl as SVGGraphicsElement;
    const bbox = nodeGEl.getBBox?.();
    if (!bbox) return;
    const ctm = nodeGEl.getScreenCTM();
    if (!ctm) return;

    const centerX = bbox.x + bbox.width / 2;
    const centerY = bbox.y + bbox.height / 2;
    const screenX = centerX * ctm.a + ctm.e - viewRect.left;
    const screenY = centerY * ctm.d + ctm.f - viewRect.top;

    inlineEditorNodeId = rawId;
    inlineEditorValue = codeLabel;
    inlineEditorPos = { x: screenX, y: screenY };
    inlineEditorVisible = true;

    // Focus the input after it renders
    requestAnimationFrame(() => {
      inlineEditorRef?.focus();
      inlineEditorRef?.select();
    });

    e.preventDefault();
    e.stopPropagation();
  };

  // Add click handler to detect diagram elements and open appropriate sidebars
  const handleDiagramClick = (e: MouseEvent) => {
    if (activeTool !== 'select') return;
    const target = e.target as Element;

    // Ignore clicks on pan/zoom controls
    if (target.closest('[class*="panzoom"]') || target.closest('[class*="control"]')) {
      return;
    }

    // Check if clicked element is a node
    // IMPORTANT: avoid g[class*="node"] as it matches g.nodes (the parent container)
    let nodeEl =
      target.closest('g.node:not(.nodes)') ||
      target.closest('g.nodeGroup') ||
      target.closest('g[class~="node"]') ||
      target.closest('g.cluster');

    // Check if clicked element is an icon (or if the node contains an icon)
    const isIcon =
      target.closest('.fa') ||
      target.closest('[class*="iconShape"]') ||
      target.closest('[class*="icon-shape"]') ||
      target.closest('.label-icon') ||
      target.closest('.image-shape') ||
      target.closest('.fontawesome-icon') ||
      target.tagName === 'image' ||
      target.closest('image') ||
      target.closest('use') ||
      (target.closest('text') && target.closest('text')?.textContent?.match(/[\uf000-\uf2ff]/));

    // If we clicked on an icon but didn't find a node, walk up the DOM more aggressively
    // Mermaid wraps icon nodes in additional containers that may not have standard node classes
    if (isIcon && !nodeEl) {
      let el: Element | null = target;
      while (el && el !== container) {
        // Check for any g element with an ID that looks like a mermaid node ID
        if (
          el.tagName === 'g' &&
          el.id &&
          /^flowchart-|^stateDiagram-|^classDiagram-/.test(el.id)
        ) {
          nodeEl = el;
          break;
        }
        // Check for g elements with data-id attribute (mermaid node marker)
        if (el.tagName === 'g' && el.getAttribute('data-id')) {
          nodeEl = el;
          break;
        }
        // Check for g elements that have node-like structure (contain both shape and label)
        if (
          el.tagName === 'g' &&
          el.classList.length > 0 &&
          !el.classList.contains('nodes') &&
          !el.classList.contains('root')
        ) {
          const hasShape = el.querySelector('rect, circle, polygon, ellipse, path.basic');
          const hasLabel = el.querySelector('text, foreignObject');
          if (hasShape || hasLabel) {
            nodeEl = el;
            break;
          }
        }
        el = el.parentElement;
      }
    }

    // Also check if the parent node itself contains an icon element
    const nodeHasIcon = nodeEl
      ? nodeEl.querySelector(
          'image, use, .iconShape, .icon-shape, .label-icon, .image-shape, .fa, .fontawesome-icon'
        )
      : null;

    // Check if clicked element is an edge path
    const edgePath = findEdgePath(target);

    const isMulti = e.shiftKey || e.metaKey || e.ctrlKey;

    // Determine if the user directly clicked on an icon element (not just text in a node)
    const clickedDirectlyOnIcon =
      target.tagName === 'image' ||
      target.closest('.iconShape') ||
      target.closest('.icon-shape') ||
      target.closest('.image-shape') ||
      target.closest('.label-icon') ||
      target.closest('.fontawesome-icon') ||
      target.closest('use');

    // Determine if the selected element is a subgraph (cluster)
    const isSubgraph = nodeEl
      ? nodeEl.classList.contains('cluster') || nodeEl.closest('g.cluster') === nodeEl
      : false;

    if (clickedDirectlyOnIcon && nodeEl) {
      selectNode(nodeEl, isMulti);
      window.dispatchEvent(
        new CustomEvent('element-selected', {
          detail: {
            element: nodeEl,
            elementType: 'icon',
            label: getNodeLabel(nodeEl),
            nodeId: selectedNodeId,
            nodeIds: selectedNodeIds
          }
        })
      );
    } else if (clickedDirectlyOnIcon) {
      window.dispatchEvent(
        new CustomEvent('element-selected', { detail: { elementType: 'icon' } })
      );
    } else if (isSubgraph && nodeEl) {
      selectNode(nodeEl, isMulti);
      const subgraphTitle = getNodeLabel(nodeEl);
      const rawId = nodeEl.id || nodeEl.getAttribute('data-id') || '';
      window.dispatchEvent(
        new CustomEvent('element-selected', {
          detail: {
            element: nodeEl,
            elementType: 'subgraph',
            label: subgraphTitle,
            nodeId: rawId || subgraphTitle,
            nodeIds: selectedNodeIds
          }
        })
      );
    } else if (nodeEl) {
      selectNode(nodeEl, isMulti);
      window.dispatchEvent(
        new CustomEvent('element-selected', {
          detail: {
            element: nodeEl,
            elementType: nodeHasIcon ? 'icon' : 'node',
            label: getNodeLabel(nodeEl),
            nodeId: selectedNodeId,
            nodeIds: selectedNodeIds
          }
        })
      );
    } else if (edgePath) {
      selectEdge(edgePath, isMulti);
      const edgeIdx = getEdgeIndex(edgePath);
      window.dispatchEvent(
        new CustomEvent('element-selected', {
          detail: {
            edgeId: selectedEdgeId,
            edgeIds: selectedEdgeIds,
            edgeIndex: edgeIdx,
            element: edgePath,
            elementType: 'edge',
            label: getEdgeLabel(edgePath)
          }
        })
      );
    } else {
      clearSelection();
      window.dispatchEvent(new CustomEvent('selection-cleared'));
    }
  };
</script>

<FontAwesome bind:waitForFontAwesomeToLoad />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  id="view"
  bind:this={view}
  onclick={handleDiagramClick}
  ondblclick={handleDiagramDblClick}
  class="relative h-full w-full {shouldShowGrid && `grid-${gridStyle}-${get(mode)}`}">
  <div id="container" bind:this={container} class="h-full overflow-auto"></div>

  {#if inlineEditorVisible}
    <div
      class="absolute z-50"
      style="left: {inlineEditorPos.x}px; top: {inlineEditorPos.y}px; transform: translate(-50%, -50%);">
      <input
        bind:this={inlineEditorRef}
        type="text"
        class="max-w-[300px] min-w-[120px] rounded-lg border border-primary/50 bg-popover px-3 py-2 text-[13px] text-foreground shadow-xl ring-2 ring-primary/20 outline-none focus:ring-primary/40"
        value={inlineEditorValue}
        oninput={(e) => {
          inlineEditorValue = (e.target as HTMLInputElement).value;
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitInlineEdit();
          if (e.key === 'Escape') cancelInlineEdit();
        }}
        onblur={commitInlineEdit} />
    </div>
  {/if}
</div>

<style>
  /* Dots grid */
  .grid-dots-light {
    background-size: 24px 24px;
    background-image: radial-gradient(circle, #6b728033 1px, transparent 1px);
  }
  .grid-dots-dark {
    background-size: 24px 24px;
    background-image: radial-gradient(circle, #9ca3af33 1px, transparent 1px);
  }

  /* Squares grid */
  .grid-squares-light {
    background-size: 30px 30px;
    background-image: linear-gradient(to right, #e5e7eb44 1px, transparent 1px),
      linear-gradient(to bottom, #e5e7eb44 1px, transparent 1px);
  }
  .grid-squares-dark {
    background-size: 30px 30px;
    background-image: linear-gradient(to right, #37415144 1px, transparent 1px),
      linear-gradient(to bottom, #37415144 1px, transparent 1px);
  }

  :global(.graphini-selection-rect) {
    pointer-events: none;
  }
</style>
