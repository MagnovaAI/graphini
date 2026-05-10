/**
 * Shared Document Markdown Store (Svelte 5 runes)
 * Allows workspace Markdown edits to update the Document panel content.
 * The DocumentPanel subscribes to this store and reflects changes in real-time.
 */

import { hmrRestore, hmrPreserve } from '$lib/client/util/hmr';

let markdown = $state<string>(hmrRestore('docMarkdown') ?? '');
hmrPreserve('docMarkdown', () => markdown);

export const documentMarkdownStore = {
  get value() {
    return markdown;
  },
  set(v: string) {
    markdown = v;
  }
};
