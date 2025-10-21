import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    proxy: {
      '/api/quote': {
        target: 'https://api.nasdaq.com',
        changeOrigin: true,
        // '/api' 경로를 ''으로 다시 씀
        // rewrite: (path) => path.replace(/^\/api\/quote/, ''),
      },
      '/api/kv': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        // '/api' 경로를 ''으로 다시 씀
        // rewrite: (path) => path.replace(/^\/api\/quote/, ''),
      },
    },
  },
})
