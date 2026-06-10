import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend builds to ./dist, which the Express server serves in production.
// In dev (`npm run dev`), Vite runs on 5173 and proxies API + uploads to 3001.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
    },
  },
});
