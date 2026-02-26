import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Use relative asset URLs so GitHub Pages keeps working even if repository name changes.
  base: process.env.VITE_BASE_PATH || './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['tests/**']
  }
});
