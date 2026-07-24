import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During local dev, proxy API calls to the two backends:
//   /api/parse  -> Python (Flask) parser on :3002
//   /api/*      -> Node (Express) on :3001
// Note: the more specific /api/parse rule is listed first so it wins.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/parse': 'http://localhost:3002',
      '/api': 'http://localhost:3001',
    },
  },
});
