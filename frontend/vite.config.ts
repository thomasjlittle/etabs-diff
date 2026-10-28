import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { compareE2kPlugin } from './compareE2k';
import { saveRevisionPlugin } from './saveRevision';

export default defineConfig({
  plugins: [react(), tailwindcss(), compareE2kPlugin(), saveRevisionPlugin()],
  server: {
    // Let the app import the seeded demo from ../fixtures/demo.
    fs: { allow: ['..'] }, // relative to frontend/
  },
  test: { environment: 'jsdom' },
});
