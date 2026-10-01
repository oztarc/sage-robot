import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { main: 'index.html', v02: 'v02.html' },
    },
  },
  server: {
    host: true,
  },
});
