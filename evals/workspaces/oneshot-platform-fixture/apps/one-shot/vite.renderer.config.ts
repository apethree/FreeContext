import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config
export default defineConfig(async () => {
  // eslint-disable-next-line import/no-unresolved
  const { default: tailwindcss } = await import('@tailwindcss/vite');
  const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
  const port = Number(env.ONESHOT_RENDERER_PORT || process.env.ONESHOT_RENDERER_PORT || 5173);
  return {
    plugins: [tailwindcss(), react()],
    server: {
      host: '127.0.0.1',
      port: Number.isFinite(port) && port > 0 ? port : 5173,
      strictPort: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@oneshot/annotation-core': path.resolve(__dirname, '../../packages/annotation-core/src'),
        zod: path.resolve(__dirname, './node_modules/zod'),
      },
    },
  };
});
