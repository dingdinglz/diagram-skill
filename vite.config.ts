import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  base: './',
  build: {
    outDir: '../skills/diagram-plan/web',
    emptyOutDir: true,
    sourcemap: false,
  },
});
