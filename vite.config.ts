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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor';
          if (id.includes('recharts') || id.includes('d3-')) return 'charts-vendor';
          if (id.includes('jspdf-autotable')) return 'jspdf-autotable-vendor';
          if (id.includes('html2canvas') || id.includes('dompurify')) return 'pdf-html-vendor';
          if (
            id.includes('canvg') ||
            id.includes('rgbcolor') ||
            id.includes('svg-pathdata') ||
            id.includes('stackblur-canvas') ||
            id.includes('/raf/') ||
            id.includes('regenerator-runtime') ||
            id.includes('/core-js/')
          ) return 'pdf-render-vendor';
          if (id.includes('jspdf') || id.includes('fast-png') || id.includes('fflate')) return 'jspdf-vendor';
          if (id.includes('xlsx') || id.includes('papaparse')) return 'data-vendor';
          if (id.includes('motion') || id.includes('lucide-react') || id.includes('sonner')) return 'ui-vendor';
          if (id.includes('date-fns')) return 'date-vendor';

          return 'vendor';
        },
      },
    },
  },
});
