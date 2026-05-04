// Tracks the live render status of the diagram canvas so that other components
// (chat tool checkers, status pills) can surface the real error state instead
// of relying on parser-only validation.

class CanvasStatusStore {
  renderError = $state('');
  isRendering = $state(false);
}

export const canvasStatus = new CanvasStatusStore();
