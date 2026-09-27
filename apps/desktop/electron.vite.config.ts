import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // The core workspace package must be bundled into the main process. If it
    // is externalised, electron-builder leaves the workspace package in the
    // ASAR and Node's CommonJS loader cannot resolve its ESM-only `exports`
    // map (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
    plugins: [externalizeDepsPlugin({ exclude: ['@hermes-cowork/core'] })],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname),
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      rollupOptions: { input: resolve(__dirname, 'index.html') },
    },
  },
});
