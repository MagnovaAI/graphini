import adapterVercel from '@sveltejs/adapter-vercel';
import { sveltePreprocess } from 'svelte-preprocess';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://github.com/sveltejs/svelte-preprocess
  // for more information about preprocessors
  preprocess: [
    sveltePreprocess({
      typescript: {
        tsconfigFile: './tsconfig.json',
        reportDiagnostics: false
      }
    })
  ],
  kit: {
    adapter: adapterVercel()
  },
  runes: true
};

export default config;
