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
      const githubSha = process.env['GITHUB_SHA'];
      const githubRunId = process.env['GITHUB_RUN_ID'];
      const githubRepository = process.env['GITHUB_REPOSITORY'];

      const buildInfo: Record<string, string> = {
        timestamp: new Date().toISOString(),
        buildIdentifier: getBuildIdentifier(),
      };

      if (githubSha) {
        buildInfo.githubSha = githubSha;
      }

      if (githubRunId) {
        buildInfo.githubRunId = githubRunId;
      }

      if (githubRepository && githubRunId) {
        buildInfo.deploymentUrl = `https://github.com/${githubRepository}/actions/runs/${githubRunId}`;
      }

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
