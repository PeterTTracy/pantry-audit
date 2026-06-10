import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Fully client-side PWA: builds to ./dist, deployable on any static host.
// base './' + HashRouter means it works from a subpath (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Pantry Audit — MIT Dining',
        short_name: 'Pantry Audit',
        description: 'Allergen compliance pantry auditing',
        start_url: '.',
        display: 'standalone',
        background_color: '#1d3557',
        theme_color: '#1d3557',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
