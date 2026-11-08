import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'https://localhost:8787', secure: false },
      '/s': { target: 'https://localhost:8787', secure: false },
    },
  },
  build: { sourcemap: true, target: 'es2022' },
});
