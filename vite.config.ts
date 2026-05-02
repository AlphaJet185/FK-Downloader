import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: 'static',
  resolve: {
    preserveSymlinks: true,
  },
  optimizeDeps: {
    disabled: true,
    esbuildOptions: {
      preserveSymlinks: true,
    },
  },
  build: {
    outDir: 'public',
    emptyOutDir: true,
  },
});
