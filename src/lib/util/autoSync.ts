let renderPromise: Promise<void> | undefined;
let resolveRenderPromise: (() => void) | undefined;

export const recordRenderTime = (renderTimeMs: number, updaterFunction: () => void): void => {
  void renderTimeMs;
  void updaterFunction;
  resolveRenderPromise?.();
};

export const shouldRefreshView = (): boolean => {
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
