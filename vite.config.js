import { defineConfig } from 'vite';

export default defineConfig({
  base: '/inventario-scanner/',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    host: true, // Listen on all interfaces (for mobile testing on LAN)
    port: 5173
  }
});
