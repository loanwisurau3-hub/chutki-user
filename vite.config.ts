import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const resolvedMapsKey =
    env.VITE_GOOGLE_MAPS_API_KEY ||
    env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';
  return {
    define: {
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(resolvedMapsKey),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
        manifest: {
          id: '/',
          name: 'Chutki',
          short_name: 'Chutki',
          description: '15-Minute Local Grocery Delivery App with live order tracking, multi-store basket, wallet, and push notifications.',
          theme_color: '#0c831f',
          background_color: '#f4f6fb',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          categories: ['shopping', 'food', 'lifestyle'],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      {
        name: 'pwa-dev-hmr-guard',
        apply: 'serve',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            // src/main.tsx registers the SW via virtual:pwa-register without needing an HMR WebSocket;
            // strip vite-plugin-pwa's dev-ready HMR ping which crashes in Vite 8 when WS is disabled/proxied.
            return html.replace(/<script id="vite-plugin-pwa:register-dev-sw"[^>]*>[\s\S]*?<\/script>\s*/g, '');
          },
        },
        transform(code, id) {
          if (id.includes('pwa-entry-point-loaded')) {
            return {
              code: code.replace(/import\.meta\.hot\.send\([^)]*\);?/g, 'void 0;'),
              map: null,
            };
          }
          return undefined;
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      forwardConsole: false,
    },
  };
});
