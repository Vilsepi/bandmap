import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
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
      process.env['VITE_API_BASE_URL'] ?? 'https://rfn56k5slh.execute-api.eu-north-1.amazonaws.com/prod',
    ),
  },
});
