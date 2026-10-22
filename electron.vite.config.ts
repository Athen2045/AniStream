import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    // electron-vite leaves output unminified; the renderer is the one bundle worth shrinking
    // (less to parse and keep compiled at launch). Main and preload stay readable.
    build: { minify: "oxc" },
    // The ASS subtitle renderer (JASSUB) runs in a module worker, which needs ES output.
    worker: { format: "es" },
    // Pre-bundling moves JASSUB away from its worker and WebAssembly files (new URL(…, import.meta.url)).
    // Its CommonJS dependencies still need converting, so those are pre-bundled on their own.
    optimizeDeps: {
      exclude: ["jassub"],
      // Only the CommonJS ones: pre-bundling the ESM abslink would split it into two copies.
      include: ["jassub > throughput", "jassub > rvfc-polyfill"],
    },
  },
});
