import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Everything is bundled locally: no CDN, fonts or telemetry (NFR-01).
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 2000, assetsInlineLimit: 0 },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8080', ws: true } },
  },
});
