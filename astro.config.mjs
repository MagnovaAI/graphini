import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [svelte()],
  output: 'static',
  vite: {
    plugins: [tailwindcss()]
  }
});
