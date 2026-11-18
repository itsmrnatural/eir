import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: { port: 8080, host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    exclude: ['e2e/**', 'node_modules/**'],
    // Absolute URL so Node's fetch works in jsdom; MSW handlers match any origin.
    env: { VITE_API_BASE_URL: 'http://localhost:4000/api/v1' },
  },
});
