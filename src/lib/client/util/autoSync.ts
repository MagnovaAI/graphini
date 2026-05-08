let renderPromise: Promise<void> | undefined;
let resolveRenderPromise: (() => void) | undefined;

// Adaptive throttle: skip render attempts that arrive sooner than the last
// render took. Long renders → wider gap; cheap renders → near-realtime.
let lastRenderEndAt = 0;
let lastRenderDuration = 0;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;
let trailingCallback: (() => void) | null = null;
const MIN_GAP_MS = 60; // floor — at most ~16 fps even on tiny diagrams
const MAX_GAP_MS = 600; // ceiling — never wait more than this

export const recordRenderTime = (renderTimeMs: number, updaterFunction: () => void): void => {
  lastRenderDuration = renderTimeMs;
  lastRenderEndAt = Date.now();
  void updaterFunction;
  resolveRenderPromise?.();
};

/**
 * Set the callback the throttle should fire when a skipped render's wait
 * period elapses.  Pass `null` to clear.
 */
export const setTrailingCallback = (callback: (() => void) | null): void => {
  trailingCallback = callback;
};

export const shouldRefreshView = (): boolean => {
  const sinceLast = Date.now() - lastRenderEndAt;
  const requiredGap = Math.max(MIN_GAP_MS, Math.min(MAX_GAP_MS, lastRenderDuration));
  if (sinceLast < requiredGap) {
    // Schedule a trailing render so the final state isn't lost.
    if (trailingTimer) clearTimeout(trailingTimer);
    const wait = requiredGap - sinceLast;
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      trailingCallback?.();
    }, wait);
    return false;
  }
  // A render is going through — cancel any pending trailing fire.
  if (trailingTimer) {
    clearTimeout(trailingTimer);
    trailingTimer = null;
  }

  if (!renderPromise) {
    renderPromise = new Promise((resolve) => {
      resolveRenderPromise = () => {
        renderPromise = undefined;
        resolve();
      };
    });
  }
  return true;
};

export const waitForRender = (): Promise<void> => {
  return renderPromise ?? Promise.resolve();
};
