import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Proxy API + Socket.IO traffic to the backend during development so the
// browser can use same-origin relative URLs ('/api', '/socket.io').
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/Report-Safe/' : '/',
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
