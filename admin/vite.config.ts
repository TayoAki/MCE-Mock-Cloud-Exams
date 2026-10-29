import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // GitHub Codespaces forwards ports under *.app.github.dev.
    allowedHosts: ['.app.github.dev'],
    // The backoffice calls /v1 on its own origin in development; Vite forwards it to the API.
    proxy: { '/v1': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000', changeOrigin: true } },
  },
  preview: {
    allowedHosts: ['.app.github.dev'],
    proxy: { '/v1': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000', changeOrigin: true } },
  },
});
