import type { State } from '$lib/client/types';
import Hammer from 'hammerjs';
import type { Point } from 'mermaid/dist/types.js';
import panzoom from 'svg-pan-zoom';
type PanZoom = typeof panzoom;

export class PanZoomState {
  private pan?: Point;
  private zoom?: number;
  private pzoom: PanZoom | undefined;
  private isDirty = false;
  private resizeObserver: ResizeObserver;
  private svgElement?: SVGElement;

  /** Check if the SVG element has valid (non-zero) dimensions */
  private hasValidDimensions(): boolean {
    if (!this.svgElement) return false;
    const rect = this.svgElement.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  public isPanEnabled: boolean;
  public onPanZoomChange?: (pan: Point, zoom: number) => void;

  constructor() {
    this.isPanEnabled = true;
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      if (!this.isDirty) {
        this.reset();
      }
    });
  }

  public updateElement(diagramView: SVGElement, { pan, zoom }: Pick<State, 'pan' | 'zoom'>) {
    this.pzoom?.destroy();
    this.svgElement = diagramView;
    let hammer: HammerManager | undefined;
    let wheelHandler: ((e: WheelEvent) => void) | undefined;
    this.pzoom = panzoom(diagramView, {
      center: true,
      controlIconsEnabled: false,
      customEventsHandler: {
        haltEventListeners: ['touchstart', 'touchend', 'touchmove', 'touchleave', 'touchcancel'],
        init: function (options) {
          const instance = options.instance;
          let initialScale = 1;
          let pannedX = 0;
          let pannedY = 0;
          hammer = new Hammer(options.svgElement);

          const resetPanned = () => {
            pannedX = 0;
            pannedY = 0;
          };
          const handlePan = (event: HammerInput) => {
            instance.panBy({ x: event.deltaX - pannedX, y: event.deltaY - pannedY });
            pannedX = event.deltaX;
            pannedY = event.deltaY;
          };

          hammer.get('pinch').set({ enable: true });
          hammer.on('panstart panmove', function (event) {
            if (event.type === 'panstart') {
              resetPanned();
            }
            handlePan(event);
          });
          hammer.on('pinchstart pinchmove', function (event) {
            if (event.type === 'pinchstart') {
              initialScale = instance.getZoom();
              resetPanned();
            }
            try {
              instance.zoomAtPoint(initialScale * event.scale, {
                x: event.center.x,
                y: event.center.y
              });
            } catch (error) {
              console.warn('Pinch zoom failed due to non-invertible matrix', error);
            }
            handlePan(event);
          });
          options.svgElement.addEventListener(
            'touchmove',
            function (event) {
              event.preventDefault();
            },
            { passive: false }
          );

          // Two-finger trackpad: wheel without ctrlKey = pan, with ctrlKey = zoom
          wheelHandler = (e: WheelEvent) => {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
              // Pinch-to-zoom gesture (ctrlKey is set by trackpad pinch)
              const zoomFactor = 1 - e.deltaY * 0.01;
              try {
                instance.zoomAtPoint(instance.getZoom() * zoomFactor, {
                  x: e.offsetX,
                  y: e.offsetY
                });
              } catch {
                // ignore non-invertible matrix
              }
            } else {
              // Two-finger swipe = pan
              instance.panBy({ x: -e.deltaX, y: -e.deltaY });
            }
          };
          options.svgElement.addEventListener('wheel', wheelHandler, { passive: false });
        },
        destroy: function () {
          hammer?.destroy();
        }
      },
      fit: true,
      maxZoom: 12,
      minZoom: 0.2,
      zoomEnabled: false,
      onPan: (pan) => {
        this.pan = pan;
        this.zoom = this.pzoom?.getZoom();
        this.isDirty = true;
        if (this.zoom) {
          this.onPanZoomChange?.(this.pan, this.zoom);
        }
      },
      onZoom: (zoom) => {
        this.zoom = zoom;
        this.pan = this.pzoom?.getPan();
        this.isDirty = true;
        if (this.pan) {
          this.onPanZoomChange?.(this.pan, this.zoom);
        }
      },
      panEnabled: true
    });

    this.pzoom.disableDblClickZoom();

    this.resizeObserver.disconnect();
    this.resizeObserver.observe(diagramView);

    if (pan && zoom && Number.isFinite(zoom) && Number.isFinite(pan.x) && Number.isFinite(pan.y)) {
      this.restorePanZoom(pan, zoom);
    } else {
      this.reset();
    }

    // Enable/disable pan based on state (zoom is handled by custom wheel handler)
    if (this.isPanEnabled) {
      this.pzoom.enablePan();
    } else {
      this.pzoom.disablePan();
    }

    if (pan === undefined && zoom === undefined) {
      this.reset();
    }
  }

  public restorePanZoom(pan: Point, zoom: number) {
    if (!this.pzoom) {
      console.error('PanZoomState.restorePanZoom: pzoom is not initialized');
      return;
    }
    try {
      this.pzoom.zoom(zoom);
      this.pzoom.pan(pan);
    } catch (error) {
      console.warn(
        'PanZoomState.restorePanZoom: Failed to restore pan/zoom, possibly due to non-invertible matrix',
        error
      );
    }
  }

  public resize() {
    if (!this.pzoom) return;
    if (!this.hasValidDimensions()) return;
    try {
      this.pzoom.resize();
      if (!this.isDirty) {
        this.reset();
      }
    } catch (error) {
      console.warn(
        'PanZoomState.resize: Failed to resize, possibly due to non-invertible matrix',
        error
      );
      this.isDirty = false;
    }
  }

  public zoomIn() {
    if (!this.pzoom) return;
    try {
      this.pzoom.zoomIn();
    } catch (error) {
      console.warn(
        'PanZoomState.zoomIn: Failed to zoom in, possibly due to non-invertible matrix',
        error
      );
    }
  }

  public zoomOut() {
    if (!this.pzoom) return;
    try {
      this.pzoom.zoomOut();
    } catch (error) {
      console.warn(
        'PanZoomState.zoomOut: Failed to zoom out, possibly due to non-invertible matrix',
        error
      );
    }
  }

  public reset() {
    if (!this.pzoom) return;
    if (!this.hasValidDimensions()) return;
    try {
      this.pzoom.reset();
      this.pzoom.zoom(0.875);
      this.isDirty = false;
    } catch (error) {
      console.warn(
        'PanZoomState.reset: Failed to reset zoom, possibly due to non-invertible matrix',
        error
      );
      this.isDirty = false;
    }
  }
}
