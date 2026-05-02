import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { FileSystemIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    Icons({
      compiler: 'svelte',
      // Preserve original icon colors by preventing SVGO from stripping fill/stroke
      svgo: false,
      customCollections: {
        custom: FileSystemIconLoader('./static/icons')
      }
    }),
    devtoolsJson()
  ],
  resolve: {
    conditions: ['svelte', 'browser', 'import', 'default'],
    alias: {
      'mode-watcher': path.resolve(__dirname, 'node_modules/mode-watcher/dist/index.js'),
      paneforge: path.resolve(__dirname, 'node_modules/paneforge/dist/index.js'),
      runed: path.resolve(__dirname, 'node_modules/runed/dist/index.js')
    }
  },
  ssr: {
    noExternal: ['svelte-streamdown'],
    resolve: {
      conditions: ['svelte', 'node', 'import', 'default'],
      externalConditions: ['svelte']
    }
  },
  envPrefix: ['MERMAID_', 'OPENROUTER_', 'OPENAI_', 'GEMINI_'],
  server: {
    host: true,
    port: 3000,
    watch: {
      ignored: ['**/.vercel/**', '**/.svelte-kit/output/**', '**/.svelte-kit/generated/**']
    }
  },
  preview: { port: 3000, host: true },
  build: {
    chunkSizeWarningLimit: 1000
  },
  test: {
    environment: 'jsdom',
    // in-source testing
    includeSource: ['src/**/*.{js,ts,svelte}'],
    include: ['src/**/*.{test,spec}.{js,ts}', 'tests/unit/**/*.{test,spec}.{js,ts}'],
    exclude: [
      'tests/e2e/**/*',
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*'
    ],
    setupFiles: './tests/unit/setup.ts',
    coverage: {
      exclude: ['src/mocks', '.svelte-kit', 'src/**/*.test.ts'],
      reporter: ['text', 'json', 'html', 'lcov']
    }
  }
});
