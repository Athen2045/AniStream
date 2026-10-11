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
    build: { minify: "esbuild" },
  },
});
