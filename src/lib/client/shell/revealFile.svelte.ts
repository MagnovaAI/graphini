/**
 * Tiny pulse channel for "reveal this file in the sidebar Files tree".
 *
 * Chat artifacts call `revealFile(path)` when the user clicks a filename;
 * AppSidebar listens via `$effect` and reacts (switches to Files mode,
 * expands ancestor folders, sets active). Lives outside the component tree
 * because AppSidebar and Chat are siblings under the route.
 *
 * The token is a monotonically-increasing counter plus the path, so the
 * same path clicked twice still fires the effect (a plain string wouldn't
 * re-trigger because the value would be unchanged).
 */

interface RevealPulse {
  path: string;
  token: number;
}

let counter = 0;
let pulse = $state<RevealPulse | null>(null);

export const revealFileChannel = {
  get current(): RevealPulse | null {
    return pulse;
  }
};

export function revealFile(path: string): void {
  counter += 1;
  pulse = { path, token: counter };
}
