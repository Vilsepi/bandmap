import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function getBuildIdentifier(): string {
  const environmentBuildIdentifier =
    process.env['BUILD_IDENTIFIER'] ?? process.env['GITHUB_SHA'] ?? process.env['CI_COMMIT_SHA'];

  if (environmentBuildIdentifier) {
    return environmentBuildIdentifier.slice(0, 12);
  }

  try {
    return execSync('git rev-parse --short=8 HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function buildInfoPlugin() {
  let outputDirectory = 'dist';

  return {
    name: 'build-info',
    apply: 'build' as const,
    configResolved(config: { build: { outDir: string } }) {
      outputDirectory = config.build.outDir;
    },
    closeBundle() {
      const buildInfoFile = resolve(__dirname, outputDirectory, 'buildinfo.json');
      const buildInfo = {
        timestamp: new Date().toISOString(),
        buildIdentifier: getBuildIdentifier(),
      };

      mkdirSync(resolve(__dirname, outputDirectory), { recursive: true });
      writeFileSync(buildInfoFile, `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');
    },
  };
}

export default defineConfig({
  plugins: [buildInfoPlugin()],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(
      process.env['VITE_API_BASE_URL'] ?? 'https://api.music.heap.fi',
    ),
  },
});
