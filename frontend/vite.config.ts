import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:3000'
const devProxyWsTarget = process.env.VITE_DEV_PROXY_WS_TARGET ?? devProxyTarget.replace(/^http/i, 'ws')

export default defineConfig({
  assetsInclude: ['**/*.wasm'],
  plugins: [wasm(), topLevelAwait(), react()],
  optimizeDeps: {
    exclude: ['@myriaddreamin/typst-ts-web-compiler'],
    // Rolldown's tree-shaking breaks Lucide's deep re-export chain, so icons
    // end up bundled without their path data. Force esbuild to pre-bundle the
    // package flat so the real icon nodes ship.
    include: ['lucide-react'],
  },
  build: {
    target: ['safari16', 'es2020'],
    cssTarget: 'safari16',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
            return 'react-vendor'
          }

          if (id.includes('/node_modules/react-router/') || id.includes('/node_modules/react-router-dom/')) {
            return 'router-vendor'
          }

          if (id.includes('/node_modules/@codemirror/') || id.includes('/node_modules/codemirror/') || id.includes('/node_modules/@lezer/')) {
            return 'editor-vendor'
          }

          if (id.includes('/node_modules/codemirror-lang-typst/') || id.includes('/node_modules/web-tree-sitter/')) {
            return 'typst-vendor'
          }

          if (id.includes('/node_modules/yjs/') || id.includes('/node_modules/y-protocols/') || id.includes('/node_modules/@hocuspocus/')) {
            return 'collab-vendor'
          }

          if (id.includes('/node_modules/react-resizable-panels/') || id.includes('/node_modules/axios/') || id.includes('/node_modules/@react-oauth/')) {
            return 'ui-vendor'
          }
        },
      },
    },
  },
  server: {
    port: 8989,
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/api': {
        target: devProxyTarget,
        changeOrigin: true,
        ws: true,
      },
      '/ws': {
        target: devProxyWsTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
