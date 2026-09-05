import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';

const dirname =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

// Library build (ES + CJS) for the timeline plugin; `vite dev` serves the
// root index.html → /playground (T3's live-verification page — NOT
// storybook, plan T3).
//
// Externals: React (a UI peer), zod (schema peer, codegen pattern), and the
// host — TYPE-ONLY usage, never bundled (plan §2: works while the host is
// frozen; peerDependenciesMeta marks it optional).
export default defineConfig({
  plugins: [
    react(),
    dts({ rollupTypes: true, tsconfigPath: './tsconfig.app.json' }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'zod'],
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
  build: {
    lib: {
      entry: ['src/index.ts'],
      name: 'react-blender-nodes-timeline',
      fileName: (format) =>
        format === 'cjs'
          ? 'react-blender-nodes-timeline.cjs'
          : 'react-blender-nodes-timeline.es.js',
      formats: ['es', 'cjs'],
      cssFileName: 'style',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'zod',
        '@theclearsky/react-blender-nodes',
      ],
    },
    sourcemap: false,
    emptyOutDir: true,
  },
});
