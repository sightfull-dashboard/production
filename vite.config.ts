import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.onrender.com', 'dashboard.sightfull.co.za', 'www.dashboard.sightfull.co.za', 'localhost', '127.0.0.1'],
    hmr: process.env.DISABLE_HMR !== 'true',
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['.onrender.com', 'dashboard.sightfull.co.za', 'www.dashboard.sightfull.co.za', 'localhost', '127.0.0.1'],
  },
});
