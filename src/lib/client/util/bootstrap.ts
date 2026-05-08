import { applyMigrations } from './state/migrations';
import { updateCodeStore, verifyState } from './state/state';
import { initAnalytics, plausible } from './stats';

function syncDiagram(): void {
  updateCodeStore({ updateDiagram: true });
}

export const initHandler = async (): Promise<void> => {
  applyMigrations();
  syncDiagram();
  await initAnalytics();
  plausible?.trackPageview({ url: window.location.origin + window.location.pathname });
  verifyState();
};
