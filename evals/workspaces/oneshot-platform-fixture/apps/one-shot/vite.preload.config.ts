import { defineConfig } from 'vite';
import path from 'node:path';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@oneshot/annotation-core': path.resolve(__dirname, '../../packages/annotation-core/src'),
      zod: path.resolve(__dirname, './node_modules/zod'),
    },
  },
});
