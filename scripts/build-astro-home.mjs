import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const astroOut = resolve(root, '.astro-home');
const astroBin = resolve(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'astro.cmd' : 'astro'
);
const staticDir = resolve(root, 'static');
const staticAstroAssets = resolve(staticDir, '_astro');

rmSync(astroOut, { recursive: true, force: true });
rmSync(resolve(staticDir, 'index.html'), { force: true });
rmSync(staticAstroAssets, { recursive: true, force: true });

execFileSync(astroBin, ['build', '--outDir', astroOut], {
  cwd: root,
  stdio: 'inherit'
});

mkdirSync(staticDir, { recursive: true });
cpSync(resolve(astroOut, 'index.html'), resolve(staticDir, 'index.html'));
cpSync(resolve(astroOut, '_astro'), staticAstroAssets, { recursive: true });
