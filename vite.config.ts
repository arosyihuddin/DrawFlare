import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // Excalidraw is loaded with a dynamic import() inside onMount, so Vite only discovers it
  // after the first page load, re-optimizes dependencies mid-session and force-reloads the
  // page. Pre-bundling it up front avoids that re-optimization/reload cycle in dev.
  optimizeDeps: {
    include: ['@excalidraw/excalidraw', 'react', 'react-dom/client', 'fflate']
  }
});
