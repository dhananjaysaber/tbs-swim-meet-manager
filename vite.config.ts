import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const APP_VERSION = '2026-04-10-v4';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      devOptions: {
        enabled: true,
      },

      manifest: {
        id: '/',
        name: 'Panthers Swim Meet Console',
        short_name: 'Swim Meet',
        description:
          'Panthers Swim Meet launcher for Lane Timer and Starter Console.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        lang: 'en',
        categories: ['sports', 'events', 'utilities'],
        icons: [
          {
            src: `https://tbspanthers.british-school.org/wp-content/uploads/2026/04/improved-swim-fan-logo192.png?v=${APP_VERSION}`,
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: `https://tbspanthers.british-school.org/wp-content/uploads/2026/04/improved-swim-fan-logo512.png?v=${APP_VERSION}`,
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: `https://tbspanthers.british-school.org/wp-content/uploads/2026/04/improved-swim-fan-logo512.png?v=${APP_VERSION}`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },

      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
});
