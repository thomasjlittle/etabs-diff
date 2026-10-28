import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { compareE2kPlugin } from './compareE2k';
import { saveRevisionPlugin } from './saveRevision';

export default defineConfig({
  plugins: [react(), tailwindcss(), compareE2kPlugin(), saveRevisionPlugin()],
  server: {
    // Backend API (uvicorn on 8000) is reached through the dev server.
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } },
    // Let the app import shared files from ../fixtures.
    fs: { allow: ['..'] }, // relative to frontend/
  },
  test: { environment: 'jsdom' },
});
