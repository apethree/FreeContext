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
  plugins: [
    {
      name: 'externalize-sherpa-onnx',
      enforce: 'pre',
      resolveId(source) {
        // Prevent Vite/Rollup from resolving sherpa-onnx-node and its
        // platform-specific native addon packages into the bundle.
        if (source === 'sherpa-onnx-node' || source.startsWith('sherpa-onnx-')) {
          return { id: source, external: true };
        }
        return null;
      },
    },
  ],
  build: {
    rollupOptions: {
      // ws has optional native addons that can't be bundled by Vite/Rollup.
      // Mark them external so the require() calls are left as-is at runtime
      // (Node will silently skip them since they're optional).
      external: [
        'bufferutil',
        'utf-8-validate',
        'sherpa-onnx-node',
        'pm2',
      ],
    },
  },
});
